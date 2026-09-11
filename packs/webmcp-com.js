// agent-webmcp overlay: directory search/list tools for webmcp.com.
//
// Inject with: agent-webmcp eval @overlays/webmcp-com.js --session <name>
// (run while the webmcp.com tab is active; registrations live until navigation.)
// All tools are read-only GETs against https://webmcp.com/api/v1 (no auth,
// CORS open) and labeled [agent overlay] so agents can tell injected tools
// apart from the site's native registrations.
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  async function get(path) {
    const r = await fetch('https://webmcp.com' + path);
    if (!r.ok) throw new Error('directory API HTTP ' + r.status + ' for ' + path);
    return r.json();
  }
  const trimSite = (s) => ({
    host: s.host, desc: s.desc, type: s.type, toolCount: s.toolCount,
    tools: (s.tools || []).map((t) => t.name),
  });
  async function reg(tool) {
    try { await mc.registerTool(tool); out.push('ok:' + tool.name); }
    catch (e) { out.push('fail:' + tool.name + ':' + ((e && e.message) || e)); }
  }

  await reg({
    name: 'search_directory_sites',
    description: '[agent overlay — read-only] Search the WebMCP directory for sites matching free text. Use this to find an agent-capable site for a goal before opening anything. Returns trimmed records {host, desc, type, toolCount, tools:[names]}.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring search across host, description, URL, tool names' },
        kind: { type: 'string', enum: ['answer', 'act', 'transact'], description: 'Filter by tool category' },
        type: { type: 'string', enum: ['live', 'demo'], description: 'Filter by site type' },
        limit: { type: 'number', description: 'Max sites (default 10, capped at 50)' },
      },
      required: ['query'],
    },
    execute: async ({ query, kind, type, limit }) => {
      const q = new URLSearchParams({ q: query, fields: 'minimal', limit: String(Math.min(limit || 10, 50)) });
      if (kind) q.set('kind', kind);
      if (type) q.set('type', type);
      const d = await get('/api/v1/sites?' + q.toString());
      const sites = d.sites || d.results || d.data || [];
      return J({ sites: sites.map(trimSite) });
    },
  });

  await reg({
    name: 'lookup_site_support',
    description: '[agent overlay — read-only] Probe whether an arbitrary URL is agent-capable per the directory. Start any cross-site chain here: unsupported means hand off to a DOM-driving tool instead.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Any URL on the page being probed' },
      },
      required: ['url'],
    },
    execute: async ({ url }) => {
      const d = await get('/api/v1/lookup?url=' + encodeURIComponent(url));
      if (!d.supported) return J({ supported: false, host: d.host, message: d.message });
      const s = d.site || {};
      return J({ supported: true, host: d.host, toolCount: s.toolCount, tools: (s.tools || []).map((t) => t.name) });
    },
  });

  await reg({
    name: 'list_site_tools',
    description: '[agent overlay — read-only] List one directory site\'s tools as {name, kind, description} plus the per-tool schema URL. Fetch a full inputSchema from https://webmcp.com/api/v1/sites/{host}/tools/{tool} before invoking anything unfamiliar.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Directory host key, e.g. render.com (www. stripped)' },
      },
      required: ['host'],
    },
    execute: async ({ host }) => {
      const h = String(host).replace(/^www\./, '');
      const d = await get('/api/v1/sites/' + encodeURIComponent(h) + '/tools');
      const tools = d.tools || [];
      return J({
        host: h,
        tools: tools.map((t) => ({
          name: t.name, kind: t.kind, description: t.description,
          schema: 'https://webmcp.com/api/v1/sites/' + h + '/tools/' + t.name,
        })),
      });
    },
  });

  return out.join('\n');
})()
