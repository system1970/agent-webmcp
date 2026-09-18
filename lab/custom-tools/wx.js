// agent-webmcp custom tools for weather.gov + forecast.weather.gov.
// Synthesized from a Jev ultrafast-loop trace (traces/wx-search.jsonl):
// the trace showed location search ("City, ST" + "Get Weather") routing
// through search.usa.gov to office pages, and point forecasts rendering
// the Seven-day container. Search flow replayed from trace observations;
// reader grounded in a live recon inventory of a MapClick page.
// Install: agent-webmcp tools add wx.js --for weather.gov,forecast.weather.gov
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!el && el.offsetParent !== null;

  function cityInput() {
    const ins = [...document.querySelectorAll('input')].filter(vis);
    return ins.find((e) => /city/i.test(e.placeholder || e.getAttribute('aria-label') || '')) || null;
  }
  function getWeatherBtn() {
    return [...document.querySelectorAll('button,input[type=submit]')].filter(vis)
      .find((b) => /get weather/i.test((b.value || b.innerText || b.getAttribute('aria-label') || '').trim())) || null;
  }

  const tools = [
    {
      name: 'wx_search_location',
      description: '[custom] Search weather.gov for a location ("City, ST"). Fills the location box and submits; results route via site search to office pages.',
      inputSchema: { type: 'object', properties: { where: { type: 'string' } }, required: ['where'] },
      execute: async ({ where }) => {
        const inp = cityInput();
        if (!inp) throw new Error('no location search box on this page (open weather.gov/search first)');
        inp.focus();
        inp.value = where;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        const btn = getWeatherBtn();
        if (btn) { btn.click(); return J({ submitted: where }); }
        inp.form ? inp.form.requestSubmit() : inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return J({ submitted: where });
      },
    },
    {
      name: 'wx_read_seven_day',
      description: '[custom] Read the 7-day forecast periods from a forecast.weather.gov point page: period name, short description, temperatures. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const scope = document.getElementById('seven-day-forecast');
        if (!scope) throw new Error('no seven-day container — not on a point forecast page?');
        const cards = [...scope.querySelectorAll('.tombstone-container')];
        const periods = cards.map((c) => ({
          period: ((c.querySelector('.period-name') || {}).innerText || '').trim(),
          short: ((c.querySelector('.short-desc') || {}).innerText || '').trim(),
          temp: ((c.querySelector('.temp') || {}).innerText || '').trim(),
        })).filter((p) => p.period);
        if (!periods.length) throw new Error('seven-day container present but empty');
        const head = (document.querySelector('h2.pane-title') || {}).innerText || '';
        await sleep(0);
        return J({ for: head.trim(), periods });
      },
    },
    {
      name: 'wx_open_point',
      description: '[custom] Open a point forecast directly by latitude/longitude (bypasses the search detour the trace showed).',
      inputSchema: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'] },
      execute: async ({ lat, lon }) => {
        const url = `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`;
        location.href = url;
        return J({ opened: url });
      },
    },
  ];

  for (const t of tools) {
    try { await mc.registerTool(t); out.push('ok:' + t.name); }
    catch (e) { out.push('fail:' + t.name + ':' + ((e && e.message) || e)); }
  }
  return out.join('\n');
})()
