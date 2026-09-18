// agent-webmcp custom tools for news.ycombinator.com.
// Synthesized from a live recon inventory (no ids/testids on HN —
// match by the classic table structure, which has been stable for years).
// Install: agent-webmcp tools add hn.js --for news.ycombinator.com
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });

  function stories() {
    const rows = [...document.querySelectorAll('tr.athing')];
    return rows.map((r) => {
      const id = r.getAttribute('id');
      const link = r.querySelector('span.titleline > a');
      const sub = r.nextElementSibling;
      const comments = sub ? [...sub.querySelectorAll('a')].find((a) => /comment|discuss/i.test(a.innerText || '')) : null;
      const age = sub ? (sub.querySelector('.age') || {}).innerText || '' : '';
      return {
        id: id || null,
        title: link ? (link.innerText || '').trim() : '',
        url: link ? link.href : '',
        comments_url: comments ? comments.href : '',
        comments_label: comments ? (comments.innerText || '').trim() : '',
        age: (age || '').trim(),
      };
    }).filter((s) => s.title);
  }

  const tools = [
    {
      name: 'hn_top_stories',
      description: '[custom] Read the Hacker News front page story list: rank, title, url, comments link and age. Read-only.',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
      execute: async ({ limit }) => {
        const all = stories();
        if (!all.length) throw new Error('no stories found — not on an HN listing page?');
        const n = Math.max(1, Math.min(30, limit || 10));
        return J({ stories: all.slice(0, n).map((s, i) => ({ rank: i + 1, ...s })) });
      },
    },
    {
      name: 'hn_open_comments',
      description: '[custom] Navigate to the comments page of a front-page story by rank (1-based, as returned by hn_top_stories) or exact item id.',
      inputSchema: { type: 'object', properties: { rank: { type: 'number' }, id: { type: 'string' } } },
      execute: async ({ rank, id }) => {
        const all = stories();
        let s = null;
        if (id) s = all.find((x) => x.id === String(id));
        if (!s && rank) s = all[Number(rank) - 1];
        if (!s || !s.comments_url) throw new Error('story not found on this page');
        location.href = s.comments_url;
        return J({ opened: s.title, url: s.comments_url });
      },
    },
  ];

  for (const t of tools) {
    try { await mc.registerTool(t); out.push('ok:' + t.name); }
    catch (e) { out.push('fail:' + t.name + ':' + ((e && e.message) || e)); }
  }
  return out.join('\n');
})()
