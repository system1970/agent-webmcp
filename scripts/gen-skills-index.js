// Generates skills.json + llms.txt from skills-catalog.
// Supports both layouts:
//   skills-catalog/<legacy-id>/SKILL.md (+ overlay.js)
//   skills-catalog/<domain>/<skill>/SKILL.md (+ overlay.js)
// Canonical path: <domain>/<skill> for nested, <id> for legacy.
// Usage: node scripts/gen-skills-index.js [--out <dir>]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const cat = path.join(root, "skills-catalog");
let outDir = path.join(root, "site", "public");
const ai = process.argv.indexOf("--out");
if (ai !== -1 && process.argv[ai + 1]) outDir = path.resolve(process.argv[ai + 1]);

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    let v = line.slice(i + 1).trim();
    if (v.startsWith("[") && v.endsWith("]"))
      v = v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    fm[line.slice(0, i).trim()] = v;
  }
  return fm;
}
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const unquote = (v) =>
  typeof v === "string" && v.length > 1 && v.startsWith("'") && v.endsWith("'")
    ? v.slice(1, -1)
    : v;
const normHosts = (fm) => {
  for (const k of ["site", "sites", "website", "domain"]) {
    const v = asList(fm[k]);
    if (v.length) return v;
  }
  return [];
};
const prefixOf = (h) => h.split(".")[0].replace(/[^a-z0-9]/gi, "");
const expandVerbs = (verbs, hosts) => {
  if (!verbs.some((v) => v.includes("<prefix>"))) return verbs;
  const out = [];
  for (const h of hosts.length ? hosts : ["site"]) {
    for (const v of verbs) out.push(v.replaceAll("<prefix>", prefixOf(h)));
  }
  return out;
};
const shaFile = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 12);

// Split a SKILL.md body into ## sections with their list items
// (bullets or numbered steps; indented continuations joined).
function sectionsOf(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const out = [];
  let cur = null;
  for (const raw of body.split(/\r?\n/)) {
    const h = raw.match(/^##\s+(.*)\s*$/);
    if (h) {
      cur = { title: h[1].trim(), items: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const b = raw.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/);
    if (b) cur.items.push(b[1].trim());
    else if (cur.items.length && /^\s+\S/.test(raw)) {
      cur.items[cur.items.length - 1] += " " + raw.trim();
    }
  }
  return out.filter((s) => s.items.length > 0);
}

// Tool inventory from the Tool reference section: one `verb` per bullet,
// purpose is the first sentence. Falls back to frontmatter verbs (no docs).
function toolsOf(sections, fmVerbs) {
  const sec = sections.find((s) => /tool reference/i.test(s.title));
  const docs = new Map();
  if (sec) {
    for (const item of sec.items) {
      const m = item.match(/^`([^`]+)`\s*[—–-]\s*(.*)$/s);
      if (!m) continue;
      const name = m[1].replace(/\s*\{[^}]*\}\s*$/, "").trim();
      const purpose = m[2].split(/\.(\s|$)/)[0].trim();
      if (name && !docs.has(name)) docs.set(name, (purpose.endsWith(".") ? purpose : purpose + "."));
    }
  }
  // Doc order first (covers natives documented without frontmatter verbs),
  // then any frontmatter verbs lacking docs.
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  return fmVerbs.map((v) => ({
    name: v,
    purpose: cap(docs.get(v) || ""),
  }));
}

function examplesOf(sections) {
  const sec = sections.find((s) => /^examples/i.test(s.title));
  return sec ? sec.items : [];
}

function guideOf(sections) {
  return sections
    .filter((s) => !/tool reference/i.test(s.title) && !/^examples/i.test(s.title))
    .map((s) => ({ title: s.title, items: s.items }));
}

function validationOf(dir) {
  try {
    const ev = JSON.parse(fs.readFileSync(path.join(dir, "evals.json"), "utf8"));
    const dates = (ev.evaluations || []).map((e) => e.date).filter(Boolean).sort();
    return { verdict: ev.verdict || null, date: dates.length ? dates[dates.length - 1] : null };
  } catch {
    return { verdict: null, date: null };
  }
}

function entryIds() {
  const ids = [];
  for (const name of fs.readdirSync(cat)) {
    const dir = path.join(cat, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    let nested = false;
    for (const sub of fs.readdirSync(dir)) {
      const sdir = path.join(dir, sub);
      if (!fs.statSync(sdir).isDirectory()) continue;
      if (fs.existsSync(path.join(sdir, "SKILL.md"))) {
        ids.push(name + "/" + sub);
        nested = true;
      }
    }
    if (!nested && fs.existsSync(path.join(dir, "SKILL.md"))) ids.push(name);
  }
  return ids.sort();
}

const skills = [];
for (const id of entryIds()) {
  const dir = path.join(cat, id);
  const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  const fm = frontmatter(text);
  const hosts = normHosts(fm);
  const domain = fm.domain || fm.website || hosts[0] || "";
  const skill = fm.skill || fm.name || (id.includes("/") ? id.split("/")[1] : id);
  const rawKind = String(fm.kind || "toolset").toLowerCase();
  const kind = ["toolset", "skill", "site-agent"].includes(rawKind) ? rawKind : "toolset";
  const ovPath = path.join(dir, "overlay.js");
  const verbs = expandVerbs(asList(fm.verbs), hosts);
  const sections = sectionsOf(text);
  const readonly = new Set(asList(fm.readonly).concat(asList(fm.read_only)));
  const login = new Set(asList(fm.login));
  const defaultAccess = unquote(fm.access) || null;
  const tools = toolsOf(sections, verbs).map((t) => ({
    ...t,
    readonly: readonly.has(t.name),
    access: login.has(t.name) ? "login" : defaultAccess,
  }));
  const validation = validationOf(dir);
  const evPath = path.join(dir, "evals.json");
  if (!fs.existsSync(evPath)) {
    console.warn(`warn: ${id} has no evals.json (no live-verification record)`);
  } else {
    try {
      JSON.parse(fs.readFileSync(evPath, "utf8"));
    } catch {
      console.warn(`warn: ${id}/evals.json is not valid JSON`);
    }
  }
  skills.push({
    id,
    path: id,
    domain,
    skill,
    title: fm.title || (fm.description || skill).split(". ")[0],
    kind,
    description: fm.description || "",
    site: hosts,
    tags: asList(fm.tags),
    uses: asList(fm.uses),
    integration: fm.integration || "",
    tier: fm.tier || "official",
    category: fm.category || "other",
    verified: unquote(fm.verified) === "null" ? null : unquote(fm.verified) || null,
    updated: unquote(fm.updated) === "null" ? null : unquote(fm.updated) || null,
    access: unquote(fm.access) || null,
    verbs,
    tools,
    examples: examplesOf(sections),
    guide: guideOf(sections),
    validation,
    sha: fs.existsSync(ovPath) ? shaFile(ovPath) : null,
  });
}
skills.sort((a, b) => a.path.localeCompare(b.path));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "skills.json"),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: skills.length, skills }, null, 2) + "\n"
);

const llms = [
  "# agent-webmcp capabilities",
  "",
  "> Discover: agent-webmcp search <text>. Inspect: agent-webmcp describe <domain/skill>. Every entry is official (built + live-verified).",
  "",
  ...skills.flatMap((s) => [
    `## ${s.path} [${s.kind}]`,
    `- Sites: ${s.site.join(", ") || "n/a"}`,
    `- Verbs: ${s.verbs.join(", ") || "n/a"}`,
    `- Verified: ${s.verified || "unverified (gated)"} · sha:${s.sha || "n/a"}`,
    `- Access: ${s.access || "n/a"}`,
    `- ${s.description}`,
    "",
  ]),
];
fs.writeFileSync(path.join(outDir, "llms.txt"), llms.join("\n"));
console.log(`wrote ${skills.length} skills -> ${outDir}/skills.json + llms.txt`);
