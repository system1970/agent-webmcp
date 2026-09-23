package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// observe: one atomic snapshot. Node identity (window.__jevFast) survives
// across ticks in the page; decisions reference node ids, never selectors.
// Rects are stripped before the model sees them: geometry resolves just
// before input, so animations never invalidate decisions.

const observeJS = `(() => {
  if (!document.body) return null;
  const cache = window.__jevFast ||= {ids:new WeakMap(), nodes:new Map(), next:1};
  const identity = e => {
    if (!cache.ids.has(e)) cache.ids.set(e, cache.next++);
    const id = cache.ids.get(e); cache.nodes.set(id, e); return id;
  };
  for (const [id,e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);
  const vis = e => {
    try {
      if (e.closest('[aria-hidden="true"],[inert]')) return false;
      return e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    } catch(err){ return false; }
  };
  const norm = s => ((s||'').replace(/\s+/g,' ').trim());
  const name = (e,seen=new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    try {
      const ref = (e.getAttribute('aria-labelledby')||'').split(/\s+/)
        .map(id=>name(document.getElementById(id),seen)).filter(Boolean).join(' ');
      if (ref) return ref;
      if (e.getAttribute('aria-label')) return e.getAttribute('aria-label');
      if (e.labels && e.labels.length) {
        const t = [...e.labels].map(l=>name(l,seen)).filter(Boolean).join(' ');
        if (t) return t;
      }
      if (['button','submit','reset'].includes(e.type) && e.value) return e.value;
      if (e.getAttribute('alt')) return e.getAttribute('alt');
      if (e.tagName!=='INPUT') {
        const t = [...e.childNodes].map(n=>n.nodeType===3 ? n.textContent :
          n.nodeType===1 && n.getAttribute('aria-hidden')!=='true' ? name(n,seen) : '').join(' ').trim();
        if (t) return t;
      }
      return e.getAttribute('title') || e.getAttribute('placeholder') || '';
    } catch(err){ return ''; }
  };
  const roles = ['button','link','checkbox','radio','switch','tab','menuitem','menuitemradio',
    'option','gridcell','combobox','textbox','searchbox','spinbutton'];
  const selector = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],' +
    roles.map(r=>'[role="'+r+'"]').join(',');
  const role = e => {
    const x = e.getAttribute('role');
    if (roles.includes(x)) return x;
    if (e.tagName==='BUTTON' || e.tagName==='SUMMARY') return 'button';
    if (e.tagName==='A') return 'link';
    if (e.tagName==='SELECT') return 'combobox';
    if (e.tagName==='TEXTAREA' || e.isContentEditable) return 'textbox';
    if (e.tagName==='INPUT') {
      if (['checkbox','radio'].includes(e.type)) return e.type;
      if (['button','submit','reset','image'].includes(e.type)) return 'button';
      if (e.type==='search') return 'searchbox';
      if (e.type==='number') return 'spinbutton';
      if (['text','email','url','tel'].includes(e.type)) return 'textbox';
    }
    return null;
  };
  cache.pageKey = () => [performance.timeOrigin, location.href, scrollX, scrollY,
    innerWidth, innerHeight,
    [...document.querySelectorAll('input,textarea,select')]
      .filter(e=>!['password','file','hidden'].includes(e.type))
      .map(e=>[identity(e), e.value, e.checked, e.selectedIndex, e.disabled, e.readOnly])];
  cache.guard = e => {
    if (!e || !e.isConnected || !vis(e)) return null;
    const scope = e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') || e.parentElement;
    return [identity(e), role(e), name(e), e.value ?? null, e.checked ?? null,
      e.selectedIndex ?? null, e.readOnly ?? null, e.matches(':disabled'),
      e.getAttribute('aria-disabled'), e.getAttribute('aria-expanded'),
      e.getAttribute('href'), (scope && scope.innerText || '').slice(0,6000)];
  };
  const actions = [];
  for (const e of document.querySelectorAll(selector)) {
    if (['password','file','hidden'].includes(e.type)) continue;
    if (!vis(e) || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) continue;
    const r = e.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2, rname = role(e);
    if (!rname || r.width<=0 || r.height<=0 || x<0 || y<0 || x>=innerWidth || y>=innerHeight) continue;
    if (rname==='gridcell' && e.querySelector('button,[role="button"]')) continue;
    const base = {node: identity(e), role: rname, label: name(e)||rname,
      fid: e.id || '', nm: e.name || '', ph: e.getAttribute('placeholder') || '',
      href: e.tagName==='A' ? (e.getAttribute('href') || '') : '',
      rect: {x:r.x, y:r.y, w:r.width, h:r.height}};
    if (e.tagName==='SELECT') {
      for (const o of e.options) {
        if (o.selected || o.disabled || (o.closest('optgroup[disabled]'))) continue;
        actions.push({...base, kind:'select', value:o.value,
          current_value:[...e.selectedOptions].map(o=>o.label).join(', '),
          label: base.label+' → '+o.label});
      }
    } else {
      const editable = !e.readOnly && e.getAttribute('aria-readonly')!=='true' &&
        (['textbox','searchbox','spinbutton'].includes(rname) ||
          (rname==='combobox' && ['INPUT','TEXTAREA'].includes(e.tagName)));
      const value = 'value' in e ? String(e.value) :
        (e.isContentEditable || rname==='combobox' ? e.innerText.trim() : '');
      actions.push({...base, kind: editable?'fill':'click', value});
      if (editable) actions.push({...base, kind:'click', value, label:'Open '+base.label});
    }
  }
  const words = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node, length = 0;
  while ((node = walker.nextNode()) && length < 6000) {
    const value = node.textContent.trim(), parent = node.parentElement;
    if (!value || !parent || parent.closest('script,style,noscript,template') || !vis(parent)) continue;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth) {
      words.push(value); length += value.length;
    }
  }
  const text = words.join('\n').slice(0,6000);
  const height = document.documentElement.scrollHeight;
  const page_key = cache.pageKey(), guards = {};
  for (const a of actions) if (!(a.node in guards)) guards[a.node] = cache.guard(cache.nodes.get(a.node));
  const semantics = actions.map(({rect,...a}) => a);
  const marker = [performance.timeOrigin, location.href, scrollX, scrollY,
    innerWidth, innerHeight, document.title, text, semantics, page_key[6]];
  const omitted = Math.max(0, actions.length - 250);
  actions.splice(250);
  actions.forEach((a,i) => a.id = 'e'+(i+1));
  if (scrollY + innerHeight < height - 2)
    actions.push({id:'scroll_down', kind:'scroll', label:'Scroll down', delta:560});
  if (scrollY > 0)
    actions.push({id:'scroll_up', kind:'scroll', label:'Scroll up', delta:-560});
  actions.push({id:'wait', kind:'wait', label:'Wait for the page to update'});
  return JSON.stringify({url: location.href, title: document.title, text,
    scroll: {y: scrollY, height}, actions, marker, page_key, guards,
    omitted_actions: omitted});
})()`

type snapAction struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Node         int    `json:"node"`
	Role         string `json:"role"`
	Label        string `json:"label"`
	Value        string `json:"value"`
	CurrentValue string `json:"current_value"`
	// Stable keys for act-time re-resolution when the observed node is
	// gone (hydrating widgets replace nodes mid-loop). Resolution order:
	// node identity -> id -> href -> placeholder -> name -> label text
	// -> snapshot index.
	FID  string `json:"fid"`
	PH   string `json:"ph"`
	NM   string `json:"nm"`
	Href string `json:"href"`
}

type snapshot struct {
	URL     string           `json:"url"`
	Title   string           `json:"title"`
	Text    string           `json:"text"`
	Actions []snapAction     `json:"actions"`
	Marker  []any            `json:"marker"`
	PageKey []any            `json:"page_key"`
	Guards  map[string][]any `json:"guards"`
	Scroll  struct {
		Y      float64 `json:"y"`
		Height float64 `json:"height"`
	} `json:"scroll"`
}

func fingerprintSnap(snap *snapshot) string {
	h := sha256.New()
	h.Write([]byte(snap.URL + "\x00" + snap.Text + "\x00" + fmt.Sprintf("%d", int(snap.Scroll.Y)) + "\x00"))
	for _, a := range snap.Actions {
		// Values included: a re-type that lands must read as a change,
		// and a dropped value (hydration) must read as one too.
		h.Write([]byte(a.ID + "\x00" + a.Kind + "\x00" + a.Label + "\x00" + a.Value + "\x00"))
	}
	sum := h.Sum(nil)
	return fmt.Sprintf("%x", sum)[:16]
}

func scanCachePath(session string) string {
	return filepath.Join(sessionDir(session), "scan-cache.json")
}

func scanCacheSave(session, url string, snap *snapshot) {
	items := make([]map[string]any, 0, len(snap.Actions))
	for _, a := range snap.Actions {
		items = append(items, map[string]any{"id": a.ID, "kind": a.Kind, "node": a.Node, "role": a.Role, "label": a.Label,
			"fid": a.FID, "ph": a.PH, "nm": a.NM, "href": a.Href})
	}
	b, _ := json.Marshal(map[string]any{"url": url, "items": items})
	_ = os.MkdirAll(sessionDir(session), 0o755)
	_ = os.WriteFile(scanCachePath(session), b, 0o644)
}

func captureSnapshot(ctx context.Context, session string, timeout time.Duration) (*snapshot, string, error) {
	t, err := sessionTarget(session, timeout)
	if err != nil {
		return nil, "", err
	}
	out, err := evalScript(ctx, t.WebSocketDebuggerURL, observeJS, timeout)
	if err != nil {
		return nil, "", err
	}
	var snap snapshot
	if err := json.Unmarshal([]byte(out), &snap); err != nil {
		return nil, "", err
	}
	return &snap, fingerprintSnap(&snap), nil
}

func observeCmd(ctx context.Context, g *globals, rest []string) int {
	snap, fp, err := captureSnapshot(ctx, g.session, time.Duration(g.timeoutMs)*time.Millisecond)
	if err != nil {
		return failErr("observe_failed", err)
	}
	scanCacheSave(g.session, snap.URL, snap)
	if g.json {
		els := make([]map[string]any, 0, len(snap.Actions))
		for _, a := range snap.Actions {
			els = append(els, map[string]any{"id": a.ID, "kind": a.Kind, "role": a.Role, "label": a.Label, "value": a.Value,
				"fid": a.FID, "ph": a.PH, "nm": a.NM, "href": a.Href})
		}
		ok(map[string]any{
			"session": g.session, "url": snap.URL, "title": snap.Title,
			"text": snap.Text, "count": len(snap.Actions),
			"elements": els, "fingerprint": fp,
		})
		return 0
	}
	fmt.Printf("%s  (%d actions)\n", snap.URL, len(snap.Actions))
	for _, a := range snap.Actions {
		fmt.Printf("  @%-6s [%s] %s\n", a.ID, a.Kind, a.Label)
	}
	return 0
}
