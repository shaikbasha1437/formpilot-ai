/* FormPilot snapshot: a compact accessibility-style view of a page (roles, accessible names, values,
   states, numbered refs). The same file runs inside the in-app sandbox iframe and, injected by the
   optional local runner, inside a real Playwright page. Values of password, card, SSN, one-time-code
   and human-check fields are never read: the snapshot only says whether they are filled. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormPilotSnapshot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const INTERACTIVE = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[contenteditable=""],[contenteditable=true]';
  const SKIP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, SVG: 1, CANVAS: 0 };
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const clip = (s, n) => { s = norm(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* Which fields an agent must never type into. Shared with guard.js through the export. */
  function sensitiveKind(info) {
    const label = String(info.name || '') + ' ' + String(info.placeholder || '');
    const ac = String(info.autocomplete || '').toLowerCase();
    if (info.type === 'password' || /\bpass(word|code|phrase)\b/i.test(label)) return 'password';
    if (/^cc-/.test(ac) || /card number|credit card|debit card|\bcvc\b|\bcvv\b|security code|card (expir|exp\b)|expiry|expiration/i.test(label)) return 'card';
    if (/social security|\bssn\b|\bsin\b number|tax(payer)? id|\bitin\b/i.test(label)) return 'ssn';
    if (info.humanCheck || /captcha|are you (a )?human|characters (you see|shown)|security check|not a robot/i.test(label)) return 'captcha';
    if (ac === 'one-time-code' || /one[- ]time (pass)?code|verification code|\botp\b|2fa|two-factor/i.test(label)) return 'otp';
    if (/bank account|routing number|\biban\b/i.test(label)) return 'bank';
    return null;
  }

  function take(doc, opts) {
    const o = opts || {};
    const win = doc.defaultView;
    let counter = +(doc.documentElement.getAttribute('data-fp-next') || 1);
    const items = []; const hiddenText = []; const seenText = new Set();
    const vw = win.innerWidth; const vh = win.innerHeight; const sx = win.scrollX; const sy = win.scrollY;
    function styleOf(el) { try { return win.getComputedStyle(el); } catch (e) { return null; } }
    function isRendered(el) {
      if (el.closest('[hidden],[aria-hidden=true]')) return false;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = styleOf(e); if (!cs) continue; if (cs.display === 'none' || cs.visibility === 'hidden') return false; }
      const r = el.getBoundingClientRect(); if (r.width < 1 && r.height < 1 && el.tagName !== 'OPTION') return false;
      return true;
    }
    function visuallyHidden(el) {
      const r = el.getBoundingClientRect(); const cs = styleOf(el);
      if (r.right + sx < 0 || r.bottom + sy < 0 || r.width <= 1 || r.height <= 1) return true;
      if (cs && (parseFloat(cs.opacity) === 0 || parseFloat(cs.fontSize) < 6)) return true;
      if (cs && cs.clip && /rect\(0(px)?,? 0(px)?/.test(cs.clip)) return true;
      return false;
    }
    function textOf(el) { if (!el) return ''; const t = el.innerText != null && el.isConnected ? el.innerText : el.textContent; return norm(String(t).split(/\n+/).map((x) => x.trim()).filter(Boolean).join(' · ')); }
    function byIds(ids) { return norm(String(ids || '').split(/\s+/).filter(Boolean).map((id) => textOf(doc.getElementById(id))).join(' ')); }
    function labelText(el) {
      if (el.getAttribute('aria-labelledby')) { const t = byIds(el.getAttribute('aria-labelledby')); if (t) return t; }
      if (el.getAttribute('aria-label')) return norm(el.getAttribute('aria-label'));
      if (el.id) { const l = doc.querySelector('label[for="' + (win.CSS && win.CSS.escape ? win.CSS.escape(el.id) : el.id) + '"]'); if (l) return textOf(l); }
      const wrap = el.closest('label'); if (wrap) { const c = wrap.cloneNode(true); c.querySelectorAll('input,select,textarea').forEach((x) => x.remove()); const t = norm(c.textContent); if (t) { const lines = (wrap.innerText || '').split(/\n+/).map((x) => x.trim()).filter(Boolean); return lines.length > 1 ? norm(lines.join(' · ')) : t; } }
      return '';
    }
    function roleOf(el) {
      const r = el.getAttribute('role'); if (r) return r;
      const t = el.tagName;
      if (t === 'A') return 'link'; if (t === 'BUTTON') return 'button'; if (t === 'SELECT') return 'combobox'; if (t === 'TEXTAREA') return 'textbox';
      if (t === 'INPUT') { const ty = (el.type || 'text').toLowerCase(); if (ty === 'checkbox') return 'checkbox'; if (ty === 'radio') return 'radio'; if (/^(submit|button|reset|image)$/.test(ty)) return 'button'; if (ty === 'range') return 'slider'; if (ty === 'file') return 'file'; return 'textbox'; }
      if (el.isContentEditable) return 'textbox';
      return 'generic';
    }
    function nameOf(el, role) {
      let n = labelText(el);
      if (!n && (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' || role === 'option')) n = el.tagName === 'INPUT' ? el.value : textOf(el);
      if (!n) n = el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
      return clip(n, 160);
    }
    function groupOf(el) {
      const fs = el.closest('fieldset'); if (fs) { const lg = fs.querySelector('legend'); if (lg) return clip(textOf(lg), 80); }
      const g = el.closest('[role=group],[role=radiogroup],[role=region]'); if (g) { const n = g.getAttribute('aria-label') || byIds(g.getAttribute('aria-labelledby')); if (n) return clip(n, 80); }
      return '';
    }
    function dialogOf(el) { const d = el.closest('[role=dialog],[role=alertdialog],dialog'); if (!d) return ''; return clip(d.getAttribute('aria-label') || byIds(d.getAttribute('aria-labelledby')) || 'dialog', 80); }
    function rect(el) { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) }; }
    function ensureRef(el) { let ref = el.getAttribute('data-fp-ref'); if (!ref) { ref = 'e' + counter++; el.setAttribute('data-fp-ref', ref); } return ref; }

    const interactive = new Set(doc.querySelectorAll(INTERACTIVE));
    // dialogs first, so the agent sees what is on top
    const dialogs = [];
    doc.querySelectorAll('[role=dialog],[role=alertdialog],dialog[open]').forEach((d) => { if (!isRendered(d)) return; const name = clip(d.getAttribute('aria-label') || byIds(d.getAttribute('aria-labelledby')) || 'dialog', 80); dialogs.push({ name, modal: d.getAttribute('aria-modal') === 'true' || d.tagName === 'DIALOG', text: clip(textOf(d), 300) }); });

    function pushText(role, text, el, extra) {
      text = clip(text, 400); if (!text) return;
      const key = role + '|' + text; if (seenText.has(key)) return; seenText.add(key);
      items.push(Object.assign({ role, name: text, bbox: el ? rect(el) : null, dialog: el ? dialogOf(el) : '' }, extra || {}));
    }
    function walk(node) {
      if (items.length > (o.maxItems || 500)) return;
      if (node.nodeType !== 1) return;
      const el = node; const tag = String(el.tagName).toUpperCase();
      if (SKIP[tag]) return;
      if (tag === 'IFRAME') return;
      if (!isRendered(el)) { const t = norm(el.textContent); if (t && t.length > 12 && !interactive.has(el) && !el.querySelector('input,select,textarea,button')) hiddenText.push(clip(t, 400)); return; }
      if (interactive.has(el)) { addControl(el); if (tag !== 'LABEL') return; }
      const role = el.getAttribute('role');
      if (/^H[1-6]$/.test(tag) || role === 'heading') { pushText('heading', textOf(el), el, { level: +(tag[1] || el.getAttribute('aria-level') || 2), hidden: visuallyHidden(el) }); return; }
      if (role === 'alert' || role === 'status' || el.classList.contains('err') || el.classList.contains('alert')) { const t = textOf(el); if (t) { if (el.querySelector('dl,h1,h2,h3')) { const h = el.querySelector('h1,h2,h3'); pushText('status', h ? textOf(h) : t.slice(0, 120), el); } else { pushText(role === 'status' ? 'status' : 'alert', t, el); if (!el.querySelector(INTERACTIVE)) return; } } }
      if (tag === 'DL') { const kids = Array.from(el.children); let term = ''; for (const k of kids) { if (k.tagName === 'DT') term = textOf(k); else if (k.tagName === 'DD') pushText('text', (term ? term + ': ' : '') + textOf(k), k, { pair: term ? [term, textOf(k)] : null }); } return; }
      if (tag === 'LEGEND') return;
      if (tag === 'LABEL') { el.querySelectorAll(INTERACTIVE).forEach((c) => { if (isRendered(c)) addControl(c); }); if (el.control || el.htmlFor || el.querySelector('input,select,textarea')) return; }
      if (tag === 'CANVAS' || tag === 'IMG' || role === 'img') { const n = el.getAttribute('aria-label') || el.getAttribute('alt'); if (n) pushText('img', n, el); return; }
      // leaf-ish text blocks
      let ownText = '';
      for (const c of el.childNodes) if (c.nodeType === 3) ownText += c.nodeValue;
      ownText = norm(ownText);
      const hasBlockKids = Array.from(el.children).some((c) => { const cs = styleOf(c); return cs && /block|flex|grid|list-item|table/.test(cs.display); });
      if (ownText && !hasBlockKids && !el.querySelector(INTERACTIVE)) { const t = textOf(el); const vh2 = visuallyHidden(el); if (vh2) hiddenText.push(clip(t, 400)); pushText('text', t, el, vh2 ? { hidden: true } : null); return; }
      if (ownText) pushText('text', ownText, el, visuallyHidden(el) ? { hidden: true } : null);
      Array.from(el.children).forEach(walk);
    }
    function addControl(el) {
      const role = roleOf(el); if (role === 'generic') return;
      const ref = ensureRef(el);
      const it = { ref, role, name: nameOf(el, role) };
      const ty = el.tagName === 'INPUT' ? (el.type || 'text').toLowerCase() : el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : '';
      if (ty) it.type = ty;
      if (el.getAttribute('placeholder')) it.placeholder = clip(el.getAttribute('placeholder'), 60);
      if (el.getAttribute('autocomplete')) it.autocomplete = el.getAttribute('autocomplete');
      if (el.getAttribute('data-human-check')) it.humanCheck = true;
      if (el.name) it.field = el.name;
      const g = groupOf(el); if (g) it.group = g;
      const dlg = dialogOf(el); if (dlg) it.dialog = dlg;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') it.disabled = true;
      const lab = (el.id && doc.querySelector('label[for="' + el.id + '"]')) || el.closest('label');
      const labTxt = lab ? lab.textContent : '';
      if (el.required || el.getAttribute('aria-required') === 'true' || /\*|\(required\)/i.test(labTxt)) it.required = true;
      if (/\(optional\b|optional\)/i.test(labTxt + ' ' + it.name)) it.optional = true;
      if (el.getAttribute('aria-invalid') === 'true') it.invalid = true;
      if (el.getAttribute('aria-pressed')) it.pressed = el.getAttribute('aria-pressed') === 'true';
      if (el.getAttribute('aria-expanded')) it.expanded = el.getAttribute('aria-expanded') === 'true';
      if (el.readOnly) it.readonly = true;
      if (el.min) it.min = el.min; if (el.max) it.max = el.max;
      const desc = byIds(el.getAttribute('aria-describedby')); if (desc) it.description = clip(desc, 200);
      if (it.invalid) { const errEls = String(el.getAttribute('aria-describedby') || '').split(/\s+/).map((id) => doc.getElementById(id)).filter((x) => x && /err/i.test(x.className + ' ' + x.id)); it.error = clip(errEls.length ? errEls.map(textOf).join(' ') : desc, 200); }
      if (role === 'link') { const h = el.getAttribute('href') || ''; try { it.href = new URL(h, doc.baseURI).href; } catch (e) { it.href = h; } }
      it.sensitive = sensitiveKind({ name: it.name, placeholder: it.placeholder, autocomplete: it.autocomplete, type: ty, humanCheck: it.humanCheck });
      if (!it.sensitive) delete it.sensitive;
      if (role === 'checkbox' || role === 'radio' || role === 'switch') it.checked = el.getAttribute('aria-checked') ? el.getAttribute('aria-checked') === 'true' : !!el.checked;
      else if (el.tagName === 'SELECT') { const opt = el.selectedOptions && el.selectedOptions[0]; it.value = opt && opt.value !== '' ? norm(opt.textContent) : ''; it.options = Array.from(el.options).filter((x) => x.value !== '' || norm(x.textContent) && !/^(—|-|choose|select)/i.test(norm(x.textContent))).slice(0, 60).map((x) => clip(x.textContent, 100)); }
      else if (role === 'textbox' || ty) { const v = el.isContentEditable ? el.textContent : el.value; if (it.sensitive) it.filled = !!String(v || '').length; else it.value = clip(v || '', 300); }
      it.bbox = rect(el);
      const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) it.offscreen = true;
      items.push(it);
    }
    if (doc.body) walk(doc.body);
    doc.documentElement.setAttribute('data-fp-next', String(counter));
    const meta = doc.querySelector('meta[name="fp-host"]');
    let host = meta ? meta.content : ''; try { if (!host) host = new URL(doc.URL).host; } catch (e) { /* ignore */ }
    const path = (() => { try { const u = new URL(doc.URL); return meta ? (u.hash ? u.hash.replace(/^#/, '') : '/') : u.pathname + u.search + u.hash; } catch (e) { return ''; } })();
    return { url: (meta ? 'https://' + host + path : doc.URL), host, title: clip(doc.title, 120), busy: !!(doc.body && doc.body.getAttribute('aria-busy') === 'true'), dialogs, items, hiddenText: Array.from(new Set(hiddenText)).slice(0, 20), viewport: { w: vw, h: vh, scrollY: Math.round(sy), docH: doc.documentElement.scrollHeight }, at: Date.now() };
  }

  /* Compact text form for logs and for the model prompt. */
  function render(snap, opts) {
    const o = opts || {};
    const out = ['Page: ' + (snap.title || '') + ' — ' + (snap.url || '')];
    if (snap.dialogs && snap.dialogs.length) out.push('Open dialogs: ' + snap.dialogs.map((d) => '"' + d.name + '"' + (d.modal ? ' (modal)' : '')).join(', '));
    let group = null;
    for (const it of snap.items) {
      if (it.hidden && !o.includeHidden) continue;
      const g = it.group || '';
      if (g !== group) { if (g) out.push('group "' + g + '":'); group = g; }
      const ind = g ? '  ' : '';
      if (!it.ref) { const pre = it.role === 'heading' ? '#'.repeat(Math.min(it.level || 2, 4)) + ' ' : it.role === 'alert' ? 'ALERT: ' : it.role === 'status' ? 'STATUS: ' : it.role === 'img' ? 'image: ' : ''; out.push(ind + pre + (it.hidden ? '(hidden text) ' : '') + it.name); continue; }
      let line = ind + '[' + it.ref + '] ' + it.role + ' "' + it.name + '"';
      const st = [];
      if (it.type && !/^(text|textarea|select|radio|checkbox|submit|button)$/.test(it.type)) st.push('type=' + it.type);
      if (it.required) st.push('required'); if (it.optional) st.push('optional'); if (it.disabled) st.push('disabled'); if (it.checked) st.push('checked'); if (it.pressed) st.push('selected'); if (it.readonly) st.push('readonly');
      if (it.sensitive) st.push('SENSITIVE:' + it.sensitive + (it.filled ? ' (filled by human)' : ' (empty)'));
      if (it.placeholder && it.role === 'textbox') st.push('placeholder="' + it.placeholder + '"');
      if (it.invalid) st.push('INVALID: ' + (it.error || 'error'));
      else if (it.description && it.role !== 'button') st.push('hint: ' + it.description);
      if (it.href && o.showHref !== false) st.push('href=' + it.href);
      if (it.dialog) st.push('in dialog "' + it.dialog + '"');
      if (st.length) line += ' (' + st.join('; ') + ')';
      if (it.value != null && it.value !== '' && !it.sensitive) line += ' value="' + (o.mapValue ? o.mapValue(it.value, it) : it.value) + '"';
      if (it.options && it.options.length) line += ' options=[' + it.options.map((x) => '"' + x + '"').join(', ') + ']';
      out.push(line);
    }
    if (o.includeHidden && snap.hiddenText && snap.hiddenText.length) for (const t of snap.hiddenText) out.push('(hidden text) ' + t);
    return out.join('\n');
  }
  return { take, render, sensitiveKind, norm };
});
