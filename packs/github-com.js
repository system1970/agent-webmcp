// agent-webmcp custom tools: repo reader for github.com.
//
// github.com ships no native WebMCP tools. This pack adds read_github_repo,
// which returns a repo page's structured summary (description, stars,
// top-level files, README excerpt) without DOM scraping from the outside.
//
// Install: agent-webmcp tools add overlays/github-com.js --for github.com
// (run while a github.com repo tab is active; registrations live until navigation.)
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });

  function readRepo(maxReadme) {
    const bits = location.pathname.split('/').filter(Boolean);
    if (bits.length < 2) throw new Error('not a repository page (open a github.com/<owner>/<repo> URL first)');
    const meta = (n) => {
      const el = document.querySelector('meta[property="og:' + n + '"]');
      return el ? (el.getAttribute('content') || '') : '';
    };
    const files = [];
    const seen = {};
    for (const a of document.querySelectorAll('a')) {
      const h = a.getAttribute('href') || '';
      const m = h.match(/^\/[^/]+\/[^/]+\/(blob|tree)\/[^/]+\/(.+)$/);
      if (!m) continue;
      const name = m[2].split('/')[0];
      if (!seen[name]) { seen[name] = true; files.push(name); }
      if (files.length >= 40) break;
    }
    let stars = null;
    const starEl = document.getElementById('repo-stars-counter-star')
      || document.querySelector('a[href$="/stargazers"]');
    if (starEl) {
      const c = starEl.querySelector ? starEl.querySelector('.Counter') : null;
      const txt = (((c || starEl).innerText || '')).trim();
      const fromTitle = (starEl.getAttribute && starEl.getAttribute('title')) || '';
      stars = (txt || fromTitle).slice(0, 20) || null;
    }
    const readme = document.querySelector('article.markdown-body');
    const readmeText = readme ? (readme.innerText || '').trim() : '';
    return {
      owner: bits[0],
      repo: bits[1].replace(/\.git$/, ''),
      description: meta('description').slice(0, 300),
      stars: stars,
      files: files,
      readme_chars: readmeText.length,
      readme_excerpt: readmeText.slice(0, maxReadme || 2000),
    };
  }

  try {
    await mc.registerTool({
      name: 'read_github_repo',
      description: '[agent custom — read-only] Read the current GitHub repo page as structured data: description, star count, top-level files, README excerpt. Open a github.com/<owner>/<repo> URL first, then call with no params.',
      inputSchema: {
        type: 'object',
        properties: {
          maxReadme: { type: 'number', description: 'Max README excerpt chars (default 2000)' },
        },
      },
      execute: async ({ maxReadme }) => J(await readRepo(maxReadme)),
    });
    out.push('ok:read_github_repo');
  } catch (e) {
    out.push('fail:read_github_repo:' + ((e && e.message) || e));
  }

  return out.join('\n');
})()
