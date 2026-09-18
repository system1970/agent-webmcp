// Real-page timing: nav + DOM snapshot vs true AX tree (+ optional Jev on real state).
// Zero deps (Node 22+ global fetch + WebSocket).
// Usage:
//   node cdp_perf.mjs --session perf1 [--jev] [--url ...]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (k) => args.includes(k);
const session = opt("--session", "perf1");
let urls = args.filter((a, i) => args[i - 1] === "--url");
if (!urls.length)
  urls = ["https://example.com/", "https://en.wikipedia.org/wiki/Main_Page", "https://news.ycombinator.com/"];

const port = readFileSync(`${homedir()}/.agent-webmcp/sessions/${session}/cdp-port`, "utf8").trim();

async function targets() {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  return r.json();
}
async function pickPage() {
  const ts = await targets();
  const page = ts.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  return page;
}

let id = 0;
function cdp(ws, method, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const cur = ++id;
    const t = setTimeout(() => reject(new Error(`cdp_timeout ${method}`)), timeoutMs);
    const onMsg = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== cur) return;
      clearTimeout(t);
      ws.removeEventListener("message", onMsg);
      m.error ? reject(new Error(`cdp_error ${method}: ${JSON.stringify(m.error).slice(0, 200)}`)) : resolve(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id: cur, method, params }));
  });
}
const ms = () => Number(process.hrtime.bigint() / 1000000n);

// Compact DOM snapshot mirroring observe.go cost: visible interactive
// elements + accessible names + page text. Timed inside the page.
const SNAP_JS = `(() => {
  const t0 = performance.now();
  const norm = s => ((s||'').replace(/\\s+/g,' ').trim());
  const vis = e => { try { return e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}); } catch { return false; } };
  const els = [];
  for (const e of document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"]')) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    els.push({tag: e.tagName, role: e.getAttribute('role')||'', label: norm(e.getAttribute('aria-label')||e.innerText||e.value||'').slice(0,120)});
    if (els.length >= 500) break;
  }
  const text = norm(document.body ? document.body.innerText : '').slice(0,6000);
  return JSON.stringify({actions: els.length, bytes: 0, eval_ms: Math.round(performance.now()-t0), text_len: text.length, sample: els.slice(0,5), text: text.slice(0,500)});
})()`;

async function main() {
  const page = await pickPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  await cdp(ws, "Page.enable");
  console.log(`session=${session} port=${port} page=${page.url}`);
  for (const url of urls) {
    console.log(`\n## ${url}`);
    let t = ms();
    await cdp(ws, "Page.navigate", { url }, 30000);
    // wait for load event (cap 15s)
    await new Promise((res) => {
      const to = setTimeout(res, 15000);
      const h = (ev) => {
        try { if (JSON.parse(ev.data).method === "Page.loadEventFired") { clearTimeout(to); ws.removeEventListener("message", h); res(); } } catch {}
      };
      ws.addEventListener("message", h);
    });
    console.log(`  nav+load: ${ms() - t}ms`);

    t = ms();
    const snap = await cdp(ws, "Runtime.evaluate", { expression: SNAP_JS, returnByValue: true }, 30000);
    const snapMs = ms() - t;
    const val = JSON.parse(snap.result.value);
    const snapBytes = Buffer.byteLength(snap.result.value);
    console.log(`  dom-snapshot: ${snapMs}ms (page-eval ${val.eval_ms}ms) actions=${val.actions} bytes=${snapBytes} text_len=${val.text_len}`);

    t = ms();
    const ax = await cdp(ws, "Accessibility.getFullAXTree", {}, 60000);
    const axMs = ms() - t;
    const axBytes = Buffer.byteLength(JSON.stringify(ax.nodes));
    console.log(`  ax-tree: ${axMs}ms nodes=${ax.nodes.length} bytes=${axBytes}`);

    if (flag("--jev")) {
      const key = (process.env.TYPESAFE_API_KEY || "").trim();
      if (!key) { console.log("  jev: skipped (no TYPESAFE_API_KEY)"); continue; }
      const body = {
        model: process.env.TYPESAFE_MODEL || "jev-latest",
        state: {
          goal: "perf probe: which operation advances on this page?",
          page: { url, title: url, text: val.text },
          elements: val.sample,
        },
        questions: {
          operation: {
            type: "choice",
            instructions: "Which browser operation advances the goal?",
            criteria: { CLICK: "Click a visible element.", TYPE_TEXT: "Enter text in a field.", WAIT: "Content still loading." },
          },
        },
      };
      t = ms();
      const r = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await r.json();
      console.log(`  jev: ${ms() - t}ms state_bytes=${Buffer.byteLength(JSON.stringify(body.state))} usage=${JSON.stringify(out.usage)} choice=${out.answers?.operation?.choice}`);
    }
  }
  ws.close();
}
main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
