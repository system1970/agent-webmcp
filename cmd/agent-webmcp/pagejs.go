package main

const scanJS = `(() => {
  var SEL = 'button,a,input,select,textarea,summary,[contenteditable=true],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=slider],[role=spinbutton],[role=combobox],[role=listbox],[role=searchbox],[role=treeitem],[role=textbox]';
  var INTER = {button:1,link:1,tab:1,menuitem:1,menuitemcheckbox:1,menuitemradio:1,checkbox:1,radio:1,switch:1,option:1,slider:1,spinbutton:1,combobox:1,listbox:1,searchbox:1,treeitem:1,textbox:1};
  var vis = function(el){ try { var r = el.getBoundingClientRect(); if (!(r.width > 2 && r.height > 2)) return false; var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; if (parseFloat(cs.opacity || '1') === 0) return false; return true; } catch(e){ return false; } };
  var collapse = function(s){ return (s||'').replace(/\s+/g,' ').trim(); };
  var dedup = function(s){ var m = s.match(/^([\s\S]+?)\s+\1$/); return m ? m[1] : s; };
  var firstLine = function(el){ try { var it = el.innerText || ''; var lines = it.split('\n'); for (var i=0;i<lines.length;i++){ var l = collapse(lines[i]); if (l) return l; } } catch(e){} return ''; };
  var label = function(el, root){ try {
    var g = el.getAttribute ? function(k){ return el.getAttribute(k) || ''; } : function(){ return ''; };
    var al = collapse(g('aria-label')); if (al) return al.slice(0,80);
    var lb = g('aria-labelledby');
    if (lb && root && root.querySelector) { var parts = [], ids = lb.split(/\s+/); for (var i=0;i<ids.length;i++){ if(!ids[i]) continue; var n = null; try { if (root.getElementById) n = root.getElementById(ids[i]); if (!n) n = root.querySelector('#' + ids[i].replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g,'\\$1')); } catch(e){} if (n) parts.push(collapse(n.innerText || n.textContent || '')); } var joined = collapse(parts.join(' ')); if (joined) return dedup(joined).slice(0,80); }
    var tag0 = (el.tagName || '').toLowerCase();
    if (tag0 === 'select' && el.options && el.options.length) { var so = el.options[el.selectedIndex < 0 ? 0 : el.selectedIndex]; var st = collapse(so.text || ''); if (st) return st.slice(0,80); }
    if (root && root.querySelector) { var lab = null; try { if (el.id) lab = root.querySelector('label[for="' + el.id.replace(/"/g,'') + '"]'); } catch(e){ lab = null; } if (!lab && el.closest) { try { lab = el.closest('label'); } catch(e){} } if (lab) { var lt = firstLine(lab); if (lt) return dedup(lt).slice(0,80); } }
    var fl = firstLine(el);
    if (!fl) { try { var alts = []; var imgs = el.querySelectorAll('img[alt],svg title'); for (var k=0;k<imgs.length;k++){ var a = collapse(imgs[k].getAttribute ? (imgs[k].getAttribute('alt') || imgs[k].textContent || '') : ''); if (a) alts.push(a); } if (alts.length) fl = collapse(alts.join(' ')); } catch(e){} }
    if (!fl) { var tc = ''; try { tc = (el.textContent || '').replace(/>\s*</g, '> <'); } catch(e){} fl = collapse(el.value || tc); }
    if (!fl && el.placeholder) fl = collapse(el.placeholder);
    if (!fl && g('title')) fl = collapse(g('title'));
    if (!fl && g('alt')) fl = collapse(g('alt'));
    if (!fl && el.type) fl = '(' + el.type + ')';
    if (!fl) fl = '(no label)';
    return dedup(fl).slice(0,80);
  } catch(e){ return '(no label)'; } };
  var roleOf = function(el){ var t = (el.tagName||'').toLowerCase(); if (t==='summary') return 'button'; if (t==='a') return 'link'; if (t==='button') return 'button'; if (t==='select') return 'select'; if (t==='textarea') return 'textbox'; if (t==='input'){ var ty=((el.type||'text')+'').toLowerCase(); if (ty==='checkbox') return 'checkbox'; if (ty==='radio') return 'radio'; if (ty==='submit'||ty==='button'||ty==='image') return 'button'; if (ty==='file'||ty==='color') return 'button'; if (ty==='range') return 'slider'; if (ty==='hidden') return 'hidden'; return 'textbox'; } if (el.isContentEditable) return 'textbox'; var r = el.getAttribute && el.getAttribute('role'); r = (r||t||'el').toLowerCase(); return INTER[r] ? r : t; };
  var selOf = function(el){ try { var dt = el.getAttribute && el.getAttribute('data-testid'); if (dt && dt.length < 60 && /^[a-zA-Z0-9-_:.]+$/.test(dt)) return '[data-testid="'+dt+'"]'; var id = el.id; if (id && id.length < 60 && /^[a-zA-Z][a-zA-Z0-9-_:.]*$/.test(id)) return '#'+id; } catch(e){} return ''; };
  var hrefOf = function(el){ try { if ((el.tagName||'').toLowerCase()!=='a') return ''; var h = el.getAttribute && el.getAttribute('href'); return (h||'').slice(0,120); } catch(e){ return ''; } };
  var landmark = function(el){ try { var a = el.closest('main,nav,aside,header,footer,form,dialog,[role="main"],[role="navigation"],[role="complementary"],[role="dialog"],[role="search"],section[aria-label],article[aria-label]'); if (!a) return ''; var t = (a.tagName||'').toLowerCase(); var lb = a.getAttribute && (a.getAttribute('aria-label')||''); return (t + (lb ? ' ' + lb : '')).slice(0,28); } catch(e){ return ''; } };
  var eachRoot = function(doc, fn){ var stack = [doc]; while (stack.length) { var r = stack.pop(); if (fn(r) === false) continue; var all = null; try { all = r.querySelectorAll('*'); } catch(e){ continue; } for (var i = all.length - 1; i >= 0; i--) { try { var s = all[i].shadowRoot; if (s) stack.push(s); } catch(e){} } } };
  var sameFrames = function(doc){ var o = []; try { var fs = doc.querySelectorAll('iframe'); for (var i=0;i<fs.length;i++){ try { if (fs[i].contentDocument) o.push(fs[i].contentDocument); } catch(e){} } } catch(e){} return o; };
  var idx = {}, out = [], order = 0, framesSame = 0, framesBlocked = 0;
  var walkDoc = function(doc, fp, depth){
    eachRoot(doc, function(root){
      var inShadow = root !== doc;
      var els = null; try { els = root.querySelectorAll(SEL); } catch(e){ return; }
      for (var i=0;i<els.length;i++){ var el = els[i];
        var role = roleOf(el); if (role === 'hidden') continue;
        var name = label(el, root);
        var key = fp + '|' + role + '|' + name;
        var v = vis(el), en = !el.disabled && (!el.getAttribute || el.getAttribute('aria-disabled') !== 'true');
        var lm = landmark(el);
        if (idx[key] === undefined) { idx[key] = out.length; out.push({role:role, name:name, vis:v, en:en, n:1, sel:selOf(el), href:hrefOf(el), fp:fp, sh:inShadow, ctx:lm ? [lm] : [], o:order++}); }
        else { var e = out[idx[key]]; e.n++; if (v) e.vis = true; if (en) e.en = true; if (!e.sel) e.sel = selOf(el); if (!e.href) e.href = hrefOf(el); if (inShadow) e.sh = true; if (lm && e.ctx.indexOf(lm) < 0 && e.ctx.length < 3) e.ctx.push(lm); }
      }
    });
    if (depth >= 2) return;
    var total = 0; try { total = doc.querySelectorAll('iframe').length; } catch(e){}
    var sf = sameFrames(doc), k = 0;
    framesBlocked += total - sf.length;
    for (var j=0;j<sf.length;j++){ framesSame++; walkDoc(sf[j], fp ? fp + '/' + (k++) : '' + (k++), depth + 1); }
  };
  walkDoc(document, '', 0);
  out.sort(function(a,b){ return a.o - b.o; });
  var items = out.map(function(e){ var o = {role:e.role, name:e.name, vis:e.vis, en:e.en, n:e.n}; if (e.sel) o.sel = e.sel; if (e.href) o.href = e.href; if (e.fp) o.fp = e.fp; if (e.sh) o.sh = true; if (e.n > 1 && e.ctx.length) o.ctx = e.ctx; return o; });
  var res = {url:location.href, title:(document.title||'').slice(0,80), count:items.length, items:items};
  if (framesSame + framesBlocked > 0) res.frames = {same:framesSame, blocked:framesBlocked};
  return res;
})()`

const actJS = `(async function(){
  var VERB=@VERB@, TEXT=@TEXT@, MATCH=@MATCH@, SUBMIT=@SUBMIT@, CSSMODE=@CSSMODE@, CSS=@CSS@, ROLE=@ROLE@, NAME=@NAME@, FP=@FP@;
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var SEL = 'button,a,input,select,textarea,summary,[contenteditable=true],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=slider],[role=spinbutton],[role=combobox],[role=listbox],[role=searchbox],[role=treeitem],[role=textbox]';
  var INTER = {button:1,link:1,tab:1,menuitem:1,menuitemcheckbox:1,menuitemradio:1,checkbox:1,radio:1,switch:1,option:1,slider:1,spinbutton:1,combobox:1,listbox:1,searchbox:1,treeitem:1,textbox:1};
  var vis = function(el){ try { var r = el.getBoundingClientRect(); if (!(r.width > 2 && r.height > 2)) return false; var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; if (parseFloat(cs.opacity || '1') === 0) return false; return true; } catch(e){ return false; } };
  var collapse = function(s){ return (s||'').replace(/\s+/g,' ').trim(); };
  var dedup = function(s){ var m = s.match(/^([\s\S]+?)\s+\1$/); return m ? m[1] : s; };
  var firstLine = function(el){ try { var it = el.innerText || ''; var lines = it.split('\n'); for (var i=0;i<lines.length;i++){ var l = collapse(lines[i]); if (l) return l; } } catch(e){} return ''; };
  var label = function(el, root){ try {
    var g = el.getAttribute ? function(k){ return el.getAttribute(k) || ''; } : function(){ return ''; };
    var al = collapse(g('aria-label')); if (al) return al.slice(0,80);
    var lb = g('aria-labelledby');
    if (lb && root && root.querySelector) { var parts = [], ids = lb.split(/\s+/); for (var i=0;i<ids.length;i++){ if(!ids[i]) continue; var n = null; try { if (root.getElementById) n = root.getElementById(ids[i]); if (!n) n = root.querySelector('#' + ids[i].replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g,'\\$1')); } catch(e){} if (n) parts.push(collapse(n.innerText || n.textContent || '')); } var joined = collapse(parts.join(' ')); if (joined) return dedup(joined).slice(0,80); }
    var tag0 = (el.tagName || '').toLowerCase();
    if (tag0 === 'select' && el.options && el.options.length) { var so = el.options[el.selectedIndex < 0 ? 0 : el.selectedIndex]; var st = collapse(so.text || ''); if (st) return st.slice(0,80); }
    if (root && root.querySelector) { var lab = null; try { if (el.id) lab = root.querySelector('label[for="' + el.id.replace(/"/g,'') + '"]'); } catch(e){ lab = null; } if (!lab && el.closest) { try { lab = el.closest('label'); } catch(e){} } if (lab) { var lt = firstLine(lab); if (lt) return dedup(lt).slice(0,80); } }
    var fl = firstLine(el);
    if (!fl) { try { var alts = []; var imgs = el.querySelectorAll('img[alt],svg title'); for (var k=0;k<imgs.length;k++){ var a = collapse(imgs[k].getAttribute ? (imgs[k].getAttribute('alt') || imgs[k].textContent || '') : ''); if (a) alts.push(a); } if (alts.length) fl = collapse(alts.join(' ')); } catch(e){} }
    if (!fl) { var tc = ''; try { tc = (el.textContent || '').replace(/>\s*</g, '> <'); } catch(e){} fl = collapse(el.value || tc); }
    if (!fl && el.placeholder) fl = collapse(el.placeholder);
    if (!fl && g('title')) fl = collapse(g('title'));
    if (!fl && g('alt')) fl = collapse(g('alt'));
    if (!fl && el.type) fl = '(' + el.type + ')';
    if (!fl) fl = '(no label)';
    return dedup(fl).slice(0,80);
  } catch(e){ return '(no label)'; } };
  var roleOf = function(el){ var t = (el.tagName||'').toLowerCase(); if (t==='summary') return 'button'; if (t==='a') return 'link'; if (t==='button') return 'button'; if (t==='select') return 'select'; if (t==='textarea') return 'textbox'; if (t==='input'){ var ty=((el.type||'text')+'').toLowerCase(); if (ty==='checkbox') return 'checkbox'; if (ty==='radio') return 'radio'; if (ty==='submit'||ty==='button'||ty==='image') return 'button'; if (ty==='file'||ty==='color') return 'button'; if (ty==='range') return 'slider'; if (ty==='hidden') return 'hidden'; return 'textbox'; } if (el.isContentEditable) return 'textbox'; var r = el.getAttribute && el.getAttribute('role'); r = (r||t||'el').toLowerCase(); return INTER[r] ? r : t; };
  var sameFrames = function(doc){ var o = []; try { var fs = doc.querySelectorAll('iframe'); for (var i=0;i<fs.length;i++){ try { if (fs[i].contentDocument) o.push(fs[i].contentDocument); } catch(e){} } } catch(e){} return o; };
  var docByFp = function(fp){ var d = document; if (!fp) return d; var parts = fp.split('/'); for (var i=0;i<parts.length;i++){ var idx = parseInt(parts[i], 10); var fr = sameFrames(d); if (!(idx >= 0 && idx < fr.length)) return null; d = fr[idx]; } return d; };
  var eachRoot = function(doc, fn){ var stack = [doc]; while (stack.length) { var r = stack.pop(); if (fn(r) === false) continue; var all = null; try { all = r.querySelectorAll('*'); } catch(e){ continue; } for (var i = all.length - 1; i >= 0; i--) { try { var s = all[i].shadowRoot; if (s) stack.push(s); } catch(e){} } } };
  var collectRoots = function(doc){ var roots = [doc]; eachRoot(doc, function(r){ if (r !== doc) roots.push(r); }); return roots; };
  var pool = [];
  if (CSSMODE) {
    var docs = [document];
    var q = [document];
    while (q.length) { var dd = q.shift(); var sf = sameFrames(dd); for (var fi=0;fi<sf.length;fi++){ docs.push(sf[fi]); q.push(sf[fi]); } }
    for (var di=0;di<docs.length;di++){ var roots = collectRoots(docs[di]); for (var ri=0;ri<roots.length;ri++){ try { var found = roots[ri].querySelectorAll(CSS); for (var fk=0;fk<found.length;fk++) pool.push(found[fk]); } catch(e){ return {done:false, error:'bad selector: '+e.message}; } } }
  } else {
    var targetDoc = docByFp(FP);
    if (!targetDoc) return {done:false, error:'frame gone (re-scan?)'};
    var troots = collectRoots(targetDoc);
    for (var ti=0;ti<troots.length;ti++){ var els = null; try { els = troots[ti].querySelectorAll(SEL); } catch(e){ continue; } for (var ei=0;ei<els.length;ei++){ var ce = els[ei]; if (roleOf(ce) === ROLE && label(ce, troots[ti]) === NAME) pool.push(ce); } }
  }
  pool.sort(function(a,b){ return (vis(b)?1:0)-(vis(a)?1:0); });
  var el = pool[MATCH-1] || null;
  if (VERB === 'key') {
    var tgt = el;
    if (!tgt) tgt = document.activeElement || document.body;
    try { tgt.focus(); } catch(e){}
    var opts = {key:TEXT, bubbles:true, cancelable:true, composed:true};
    try { tgt.dispatchEvent(new KeyboardEvent('keydown', opts)); tgt.dispatchEvent(new KeyboardEvent('keypress', opts)); tgt.dispatchEvent(new KeyboardEvent('keyup', opts)); } catch(e){ return {done:false, error:'key failed: '+e.message}; }
    await sleep(250);
    return {done:true, verb:VERB, url:location.href};
  }
  if (!el) return {done:false, error:'no match (re-scan?)'};
  var tag = (el.tagName||'').toLowerCase();
  if (VERB === 'click') { try { el.scrollIntoView({block:'center'}); } catch(e){} await sleep(120); el.click(); }
  else if (VERB === 'hover') { el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true, composed:true})); }
  else if (VERB === 'focus') { el.focus(); }
  else if (VERB === 'clear') { el.focus(); try { document.execCommand && document.execCommand('selectAll',false,null); } catch(e){} try { var p = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value'); if (p && p.set) p.set.call(el,''); else el.value=''; } catch(e){ el.value=''; } el.dispatchEvent(new Event('input',{bubbles:true, composed:true})); el.dispatchEvent(new Event('change',{bubbles:true, composed:true})); }
  else if (VERB === 'type') {
    if (tag==='select') return {done:false, error:'use select verb for dropdowns'};
    var rt = roleOf(el);
    if (rt==='checkbox' || rt==='radio') { el.click(); }
    else {
      el.focus();
      try { var pr = (window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype) || Object.getPrototypeOf(el); var st = Object.getOwnPropertyDescriptor(pr,'value') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value'); if (st && st.set) st.set.call(el,TEXT); else el.value=TEXT; } catch(e){ el.value=TEXT; }
      el.dispatchEvent(new Event('input',{bubbles:true, composed:true}));
      if (SUBMIT) { var o2 = {key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true,composed:true}; el.dispatchEvent(new KeyboardEvent('keydown',o2)); el.dispatchEvent(new KeyboardEvent('keypress',o2)); el.dispatchEvent(new KeyboardEvent('keyup',o2)); }
    }
  }
  else if (VERB === 'select') {
    if (tag!=='select') return {done:false, error:'not a dropdown'};
    var want = TEXT.toLowerCase(), picked = -1;
    for (var i=0;i<el.options.length;i++){ if ((el.options[i].text||'').toLowerCase().indexOf(want)>=0) { picked=i; break; } }
    if (picked<0) return {done:false, error:'no such option'};
    el.selectedIndex = picked;
    el.dispatchEvent(new Event('input',{bubbles:true, composed:true})); el.dispatchEvent(new Event('change',{bubbles:true, composed:true}));
  }
  else { return {done:false, error:'unknown verb '+VERB}; }
  await sleep(350);
  return {done:true, verb:VERB, url:location.href};
})()`

// Closed-shadow variants. Page JS cannot touch closed roots, so these run
// inside a single closed root via Runtime.callFunctionOn (`this` = the
// ShadowRoot, resolved from its CDP backendNodeId). Helper logic (SEL,
// INTER, vis, collapse, dedup, firstLine, label, roleOf, selOf, hrefOf,
// landmark, eachRoot) is intentionally mirrored from scanJS/actJS —
// TestJSParity below fails the build if the copies drift.
const scanClosedJS = `function(){
  var SEL = 'button,a,input,select,textarea,summary,[contenteditable=true],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=slider],[role=spinbutton],[role=combobox],[role=listbox],[role=searchbox],[role=treeitem],[role=textbox]';
  var INTER = {button:1,link:1,tab:1,menuitem:1,menuitemcheckbox:1,menuitemradio:1,checkbox:1,radio:1,switch:1,option:1,slider:1,spinbutton:1,combobox:1,listbox:1,searchbox:1,treeitem:1,textbox:1};
  var vis = function(el){ try { var r = el.getBoundingClientRect(); if (!(r.width > 2 && r.height > 2)) return false; var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; if (parseFloat(cs.opacity || '1') === 0) return false; return true; } catch(e){ return false; } };
  var collapse = function(s){ return (s||'').replace(/\s+/g,' ').trim(); };
  var dedup = function(s){ var m = s.match(/^([\s\S]+?)\s+\1$/); return m ? m[1] : s; };
  var firstLine = function(el){ try { var it = el.innerText || ''; var lines = it.split('\n'); for (var i=0;i<lines.length;i++){ var l = collapse(lines[i]); if (l) return l; } } catch(e){} return ''; };
  var label = function(el, root){ try {
    var g = el.getAttribute ? function(k){ return el.getAttribute(k) || ''; } : function(){ return ''; };
    var al = collapse(g('aria-label')); if (al) return al.slice(0,80);
    var lb = g('aria-labelledby');
    if (lb && root && root.querySelector) { var parts = [], ids = lb.split(/\s+/); for (var i=0;i<ids.length;i++){ if(!ids[i]) continue; var n = null; try { if (root.getElementById) n = root.getElementById(ids[i]); if (!n) n = root.querySelector('#' + ids[i].replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g,'\\$1')); } catch(e){} if (n) parts.push(collapse(n.innerText || n.textContent || '')); } var joined = collapse(parts.join(' ')); if (joined) return dedup(joined).slice(0,80); }
    var tag0 = (el.tagName || '').toLowerCase();
    if (tag0 === 'select' && el.options && el.options.length) { var so = el.options[el.selectedIndex < 0 ? 0 : el.selectedIndex]; var st = collapse(so.text || ''); if (st) return st.slice(0,80); }
    if (root && root.querySelector) { var lab = null; try { if (el.id) lab = root.querySelector('label[for="' + el.id.replace(/"/g,'') + '"]'); } catch(e){ lab = null; } if (!lab && el.closest) { try { lab = el.closest('label'); } catch(e){} } if (lab) { var lt = firstLine(lab); if (lt) return dedup(lt).slice(0,80); } }
    var fl = firstLine(el);
    if (!fl) { try { var alts = []; var imgs = el.querySelectorAll('img[alt],svg title'); for (var k=0;k<imgs.length;k++){ var a = collapse(imgs[k].getAttribute ? (imgs[k].getAttribute('alt') || imgs[k].textContent || '') : ''); if (a) alts.push(a); } if (alts.length) fl = collapse(alts.join(' ')); } catch(e){} }
    if (!fl) { var tc = ''; try { tc = (el.textContent || '').replace(/>\s*</g, '> <'); } catch(e){} fl = collapse(el.value || tc); }
    if (!fl && el.placeholder) fl = collapse(el.placeholder);
    if (!fl && g('title')) fl = collapse(g('title'));
    if (!fl && g('alt')) fl = collapse(g('alt'));
    if (!fl && el.type) fl = '(' + el.type + ')';
    if (!fl) fl = '(no label)';
    return dedup(fl).slice(0,80);
  } catch(e){ return '(no label)'; } };
  var roleOf = function(el){ var t = (el.tagName||'').toLowerCase(); if (t==='summary') return 'button'; if (t==='a') return 'link'; if (t==='button') return 'button'; if (t==='select') return 'select'; if (t==='textarea') return 'textbox'; if (t==='input'){ var ty=((el.type||'text')+'').toLowerCase(); if (ty==='checkbox') return 'checkbox'; if (ty==='radio') return 'radio'; if (ty==='submit'||ty==='button'||ty==='image') return 'button'; if (ty==='file'||ty==='color') return 'button'; if (ty==='range') return 'slider'; if (ty==='hidden') return 'hidden'; return 'textbox'; } if (el.isContentEditable) return 'textbox'; var r = el.getAttribute && el.getAttribute('role'); r = (r||t||'el').toLowerCase(); return INTER[r] ? r : t; };
  var selOf = function(el){ try { var dt = el.getAttribute && el.getAttribute('data-testid'); if (dt && dt.length < 60 && /^[a-zA-Z0-9-_:.]+$/.test(dt)) return '[data-testid="'+dt+'"]'; var id = el.id; if (id && id.length < 60 && /^[a-zA-Z][a-zA-Z0-9-_:.]*$/.test(id)) return '#'+id; } catch(e){} return ''; };
  var hrefOf = function(el){ try { if ((el.tagName||'').toLowerCase()!=='a') return ''; var h = el.getAttribute && el.getAttribute('href'); return (h||'').slice(0,120); } catch(e){ return ''; } };
  var eachRoot = function(doc, fn){ var stack = [doc]; while (stack.length) { var r = stack.pop(); if (fn(r) === false) continue; var all = null; try { all = r.querySelectorAll('*'); } catch(e){ continue; } for (var i = all.length - 1; i >= 0; i--) { try { var s = all[i].shadowRoot; if (s) stack.push(s); } catch(e){} } } };
  var idx = {}, out = [];
  var roots = [this];
  eachRoot(this, function(r){ if (r !== this) roots.push(r); });
  for (var ri=0;ri<roots.length;ri++){
    var els = null; try { els = roots[ri].querySelectorAll(SEL); } catch(e){ continue; }
    for (var i=0;i<els.length;i++){ var el = els[i];
      var role = roleOf(el); if (role === 'hidden') continue;
      var name = label(el, roots[ri]);
      var key = role + '|' + name;
      var v = vis(el), en = !el.disabled && (!el.getAttribute || el.getAttribute('aria-disabled') !== 'true');
      if (idx[key] === undefined) { idx[key] = out.length; out.push({role:role, name:name, vis:v, en:en, n:1, sel:selOf(el), href:hrefOf(el), sh:true}); }
      else { var e = out[idx[key]]; e.n++; if (v) e.vis = true; if (en) e.en = true; if (!e.sel) e.sel = selOf(el); if (!e.href) e.href = hrefOf(el); }
    }
  }
  return out;
}`

// closedTextJS returns visible text + length of one closed root (+ nested opens).
const closedTextJS = `function(){
  var parts = [];
  var push = function(r){ try { var kids = r.querySelectorAll('*'); for (var k=0;k<kids.length;k++){ try { var tn = (kids[k].tagName||'').toLowerCase(); if (tn==='script'||tn==='style'||tn==='noscript') continue; var t = kids[k].innerText || ''; if (t && parts.join('\n').indexOf(t) < 0) parts.push(t); } catch(e){} } } catch(e){} };
  push(this);
  var stack = [this];
  while (stack.length) { var r = stack.pop(); var all = null; try { all = r.querySelectorAll('*'); } catch(e){ continue; } for (var i=0;i<all.length;i++){ try { var s = all[i].shadowRoot; if (s) { push(s); stack.push(s); } } catch(e){} } }
  var t = parts.join('\n');
  return {text: t, len: t.length};
}`

// actClosedJS grounds + acts inside one closed root (`this`). Placeholders
// match actJS; the verb tail is the same logic (composed events included).
const actClosedJS = `async function(){
  var VERB=@VERB@, TEXT=@TEXT@, MATCH=@MATCH@, SUBMIT=@SUBMIT@;
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var SEL = 'button,a,input,select,textarea,summary,[contenteditable=true],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=slider],[role=spinbutton],[role=combobox],[role=listbox],[role=searchbox],[role=treeitem],[role=textbox]';
  var INTER = {button:1,link:1,tab:1,menuitem:1,menuitemcheckbox:1,menuitemradio:1,checkbox:1,radio:1,switch:1,option:1,slider:1,spinbutton:1,combobox:1,listbox:1,searchbox:1,treeitem:1,textbox:1};
  var vis = function(el){ try { var r = el.getBoundingClientRect(); if (!(r.width > 2 && r.height > 2)) return false; var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; if (parseFloat(cs.opacity || '1') === 0) return false; return true; } catch(e){ return false; } };
  var collapse = function(s){ return (s||'').replace(/\s+/g,' ').trim(); };
  var dedup = function(s){ var m = s.match(/^([\s\S]+?)\s+\1$/); return m ? m[1] : s; };
  var firstLine = function(el){ try { var it = el.innerText || ''; var lines = it.split('\n'); for (var i=0;i<lines.length;i++){ var l = collapse(lines[i]); if (l) return l; } } catch(e){} return ''; };
  var label = function(el, root){ try {
    var g = el.getAttribute ? function(k){ return el.getAttribute(k) || ''; } : function(){ return ''; };
    var al = collapse(g('aria-label')); if (al) return al.slice(0,80);
    var lb = g('aria-labelledby');
    if (lb && root && root.querySelector) { var parts = [], ids = lb.split(/\s+/); for (var i=0;i<ids.length;i++){ if(!ids[i]) continue; var n = null; try { if (root.getElementById) n = root.getElementById(ids[i]); if (!n) n = root.querySelector('#' + ids[i].replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g,'\\$1')); } catch(e){} if (n) parts.push(collapse(n.innerText || n.textContent || '')); } var joined = collapse(parts.join(' ')); if (joined) return dedup(joined).slice(0,80); }
    var tag0 = (el.tagName || '').toLowerCase();
    if (tag0 === 'select' && el.options && el.options.length) { var so = el.options[el.selectedIndex < 0 ? 0 : el.selectedIndex]; var st = collapse(so.text || ''); if (st) return st.slice(0,80); }
    if (root && root.querySelector) { var lab = null; try { if (el.id) lab = root.querySelector('label[for="' + el.id.replace(/"/g,'') + '"]'); } catch(e){ lab = null; } if (!lab && el.closest) { try { lab = el.closest('label'); } catch(e){} } if (lab) { var lt = firstLine(lab); if (lt) return dedup(lt).slice(0,80); } }
    var fl = firstLine(el);
    if (!fl) { try { var alts = []; var imgs = el.querySelectorAll('img[alt],svg title'); for (var k=0;k<imgs.length;k++){ var a = collapse(imgs[k].getAttribute ? (imgs[k].getAttribute('alt') || imgs[k].textContent || '') : ''); if (a) alts.push(a); } if (alts.length) fl = collapse(alts.join(' ')); } catch(e){} }
    if (!fl) { var tc = ''; try { tc = (el.textContent || '').replace(/>\s*</g, '> <'); } catch(e){} fl = collapse(el.value || tc); }
    if (!fl && el.placeholder) fl = collapse(el.placeholder);
    if (!fl && g('title')) fl = collapse(g('title'));
    if (!fl && g('alt')) fl = collapse(g('alt'));
    if (!fl && el.type) fl = '(' + el.type + ')';
    if (!fl) fl = '(no label)';
    return dedup(fl).slice(0,80);
  } catch(e){ return '(no label)'; } };
  var roleOf = function(el){ var t = (el.tagName||'').toLowerCase(); if (t==='summary') return 'button'; if (t==='a') return 'link'; if (t==='button') return 'button'; if (t==='select') return 'select'; if (t==='textarea') return 'textbox'; if (t==='input'){ var ty=((el.type||'text')+'').toLowerCase(); if (ty==='checkbox') return 'checkbox'; if (ty==='radio') return 'radio'; if (ty==='submit'||ty==='button'||ty==='image') return 'button'; if (ty==='file'||ty==='color') return 'button'; if (ty==='range') return 'slider'; if (ty==='hidden') return 'hidden'; return 'textbox'; } if (el.isContentEditable) return 'textbox'; var r = el.getAttribute && el.getAttribute('role'); r = (r||t||'el').toLowerCase(); return INTER[r] ? r : t; };
  var eachRoot = function(doc, fn){ var stack = [doc]; while (stack.length) { var r = stack.pop(); if (fn(r) === false) continue; var all = null; try { all = r.querySelectorAll('*'); } catch(e){ continue; } for (var i = all.length - 1; i >= 0; i--) { try { var s = all[i].shadowRoot; if (s) stack.push(s); } catch(e){} } } };
  var pool = [];
  var roots = [this];
  eachRoot(this, function(r){ if (r !== this) roots.push(r); });
  for (var ti=0;ti<roots.length;ti++){ var els = null; try { els = roots[ti].querySelectorAll(SEL); } catch(e){ continue; } for (var ei=0;ei<els.length;ei++){ var ce = els[ei]; if (roleOf(ce) === @ROLE@ && label(ce, roots[ti]) === @NAME@) pool.push(ce); } }
  pool.sort(function(a,b){ return (vis(b)?1:0)-(vis(a)?1:0); });
  var el = pool[MATCH-1] || null;
  if (VERB === 'key') {
    var tgt = el;
    if (!tgt) tgt = (this.ownerDocument && this.ownerDocument.activeElement) || this;
    try { tgt.focus(); } catch(e){}
    var opts = {key:TEXT, bubbles:true, cancelable:true, composed:true};
    try { tgt.dispatchEvent(new KeyboardEvent('keydown', opts)); tgt.dispatchEvent(new KeyboardEvent('keypress', opts)); tgt.dispatchEvent(new KeyboardEvent('keyup', opts)); } catch(e){ return {done:false, error:'key failed: '+e.message}; }
    await sleep(250);
    return {done:true, verb:VERB, url:location.href};
  }
  if (!el) return {done:false, error:'no match (re-scan?)'};
  var tag = (el.tagName||'').toLowerCase();
  if (VERB === 'click') { try { el.scrollIntoView({block:'center'}); } catch(e){} await sleep(120); el.click(); }
  else if (VERB === 'hover') { el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true, composed:true})); }
  else if (VERB === 'focus') { el.focus(); }
  else if (VERB === 'clear') { el.focus(); try { var p = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value'); if (p && p.set) p.set.call(el,''); else el.value=''; } catch(e){ el.value=''; } el.dispatchEvent(new Event('input',{bubbles:true, composed:true})); el.dispatchEvent(new Event('change',{bubbles:true, composed:true})); }
  else if (VERB === 'type') {
    if (tag==='select') return {done:false, error:'use select verb for dropdowns'};
    var rt = roleOf(el);
    if (rt==='checkbox' || rt==='radio') { el.click(); }
    else {
      el.focus();
      try { var st = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value'); if (st && st.set) st.set.call(el,TEXT); else el.value=TEXT; } catch(e){ el.value=TEXT; }
      el.dispatchEvent(new Event('input',{bubbles:true, composed:true}));
      if (SUBMIT) { var o2 = {key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true,composed:true}; el.dispatchEvent(new KeyboardEvent('keydown',o2)); el.dispatchEvent(new KeyboardEvent('keypress',o2)); el.dispatchEvent(new KeyboardEvent('keyup',o2)); }
    }
  }
  else if (VERB === 'select') {
    if (tag!=='select') return {done:false, error:'not a dropdown'};
    var want = TEXT.toLowerCase(), picked = -1;
    for (var i=0;i<el.options.length;i++){ if ((el.options[i].text||'').toLowerCase().indexOf(want)>=0) { picked=i; break; } }
    if (picked<0) return {done:false, error:'no such option'};
    el.selectedIndex = picked;
    el.dispatchEvent(new Event('input',{bubbles:true, composed:true})); el.dispatchEvent(new Event('change',{bubbles:true, composed:true}));
  }
  else { return {done:false, error:'unknown verb '+VERB}; }
  await sleep(350);
  return {done:true, verb:VERB, url:location.href};
}`

const readJS = `(() => {
  var root0 = document.body; var mode = @SCOPE_MODE@;
  if (mode === 'main') { root0 = document.querySelector('main') || document.body; }
  else if (mode === 'css') { root0 = document.querySelector(@CSS@) || document.body; }
  var collapse = function(s){ return (s||'').replace(/\s+/g,' ').trim(); };
  var shadowTexts = function(root){ var out = []; var stack = [root]; while (stack.length) { var r = stack.pop(); var all = null; try { all = r.querySelectorAll('*'); } catch(e){ continue; } for (var i=0;i<all.length;i++){ try { var s = all[i].shadowRoot; if (s) { var parts = []; try { var kids = s.querySelectorAll('*'); for (var k=0;k<kids.length;k++){ var tn = (kids[k].tagName||'').toLowerCase(); if (tn==='script'||tn==='style'||tn==='noscript') continue; var t = kids[k].innerText || ''; if (t && parts.join('\n').indexOf(t) < 0) parts.push(t); } } catch(e){} if (parts.length) out.push(parts.join('\n')); stack.push(s); } } catch(e){} } } return out; };
  var frameDocs = function(){ var docs = []; var q = [document]; var depth = 0; while (q.length && depth < 2) { var next = []; for (var i=0;i<q.length;i++){ var fs = null; try { fs = q[i].querySelectorAll('iframe'); } catch(e){ continue; } for (var j=0;j<fs.length;j++){ try { if (fs[j].contentDocument && fs[j].contentDocument.body) { docs.push(fs[j].contentDocument); next.push(fs[j].contentDocument); } } catch(e){} } } q = next; depth++; } return docs; };
  var texts = [];
  try { var mt = (root0.innerText || '').trim(); if (mt) texts.push(mt); } catch(e){}
  var sts = shadowTexts(root0);
  for (var si=0;si<sts.length;si++) texts.push(sts[si]);
  var fheads = [], flinks = [];
  if (mode === 'body') { var fds = frameDocs(); for (var fi=0;fi<fds.length;fi++){ try { var bt = (fds[fi].body.innerText || '').trim(); if (bt) texts.push('[frame] ' + bt); } catch(e){} try { var fh = fds[fi].querySelectorAll('h1,h2,h3'); for (var hi=0;hi<fh.length && fheads.length<5;hi++){ var h = collapse(fh[hi].innerText).slice(0,120); if (h) fheads.push(h); } } catch(e){} try { var fa = fds[fi].querySelectorAll('a[href]'); for (var ai=0;ai<fa.length && flinks.length<10;ai++){ var lt = collapse(fa[ai].innerText).slice(0,80); var lh = (fa[ai].getAttribute('href')||'').slice(0,120); if (lt||lh) flinks.push({text:lt, href:lh}); } } catch(e){} } }
  var combined = texts.join('\n');
  var headings = []; try {
    var hs = root0.querySelectorAll('h1,h2,h3');
    for (var i=0;i<hs.length && headings.length<15;i++){ var h=(hs[i].innerText||'').replace(/\s+/g,' ').trim().slice(0,120); if (h) headings.push(h); }
  } catch(e){}
  headings = headings.concat(fheads).slice(0,15);
  var links = []; try {
    var as = root0.querySelectorAll('a[href]');
    for (var j=0;j<as.length && links.length<30;j++){ var a=as[j]; var ltx=(a.innerText||'').replace(/\s+/g,' ').trim().slice(0,80); var lh2=(a.getAttribute('href')||'').slice(0,120); if (ltx||lh2) links.push({text:ltx,href:lh2}); }
  } catch(e){}
  links = links.concat(flinks).slice(0,30);
  var regions = []; try {
    var lms = document.querySelectorAll('main,nav,aside,header,footer,form,dialog,section[aria-label],article[aria-label],[role="main"],[role="navigation"],[role="complementary"],[role="dialog"],[role="search"]');
    for (var r2=0;r2<lms.length && regions.length<10;r2++){ var rg = {tag:((lms[r2].tagName||'').toLowerCase())}; var rl = collapse(lms[r2].getAttribute && (lms[r2].getAttribute('aria-label')||'')); var rr = collapse(lms[r2].getAttribute && (lms[r2].getAttribute('role')||'')); if (rl) rg.label = rl.slice(0,60); else if (rr && (rg.tag === 'div' || rg.tag === 'span' || rg.tag === 'section')) rg.label = '(' + rr + ')'; regions.push(rg); }
  } catch(e){}
  return {url: location.href, chars: combined.length, text: combined.slice(0, @LIMIT@), headings: headings, links: links, regions: regions};
})()`
