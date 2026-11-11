/* Environments the agent can drive.
   - iframeEnv: the built-in sandbox sites, same-origin in an <iframe>, with a visible fake cursor
     and highlight. Actions are DOM events, checked for "is something covering this element?" first.
   - runnerEnv: the optional self-hosted Playwright runner on localhost (real browser, real sites). */
(function (root) {
  'use strict';
  const SNAP = root.FormPilotSnapshot;
  function stopErr() { const e = new Error('Stopped by you.'); e.stopped = true; return e; }
  const sleep = (ms, signal) => new Promise((res, rej) => { if (signal && signal.aborted) return rej(stopErr()); const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(stopErr()); }, { once: true }); });
  const SPEED = { slow: { move: 650, key: 55, pause: 450 }, normal: { move: 380, key: 22, pause: 220 }, fast: { move: 90, key: 3, pause: 40 } };

  function iframeEnv(o) {
    const frame = o.iframe; const stage = o.stage; let speed = SPEED[o.speed] || SPEED.normal;
    const cursor = stage.querySelector('.fp-cursor'); const hl = stage.querySelector('.fp-hl');
    const doc = () => { try { const d = frame.contentDocument; if (!d || !d.body) throw new Error('not ready'); return d; } catch (e) { throw new Error('The page left the sandbox (cross-site pages cannot be read). FormPilot stopped.'); } };
    function frameRect(el) { const fr = frame.getBoundingClientRect(); const sr = stage.getBoundingClientRect(); const r = el.getBoundingClientRect(); const sc = fr.width / (frame.contentWindow.innerWidth || fr.width); return { x: fr.left - sr.left + r.left * sc, y: fr.top - sr.top + r.top * sc, w: r.width * sc, h: r.height * sc }; }
    async function moveTo(el, signal, mode) {
      const r = frameRect(el);
      cursor.hidden = false; cursor.style.transitionDuration = speed.move + 'ms'; cursor.style.transform = 'translate(' + Math.round(r.x + Math.min(r.w / 2, 40)) + 'px,' + Math.round(r.y + r.h / 2) + 'px)';
      hl.hidden = false; hl.className = 'fp-hl' + (mode ? ' ' + mode : ''); hl.style.transform = 'translate(' + Math.round(r.x - 3) + 'px,' + Math.round(r.y - 3) + 'px)'; hl.style.width = Math.round(r.w + 6) + 'px'; hl.style.height = Math.round(r.h + 6) + 'px';
      await sleep(speed.move + 20, signal);
    }
    async function waitIdle(signal, max) {
      const d = doc(); const t0 = Date.now(); let last = Date.now();
      const mo = new MutationObserver(() => { last = Date.now(); }); mo.observe(d.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      try { while (Date.now() - t0 < (max || 6000)) { await sleep(60, signal); const b = doc().body; if (b && b.getAttribute('aria-busy') === 'true') { last = Date.now(); continue; } if (Date.now() - last > 140) break; } } finally { mo.disconnect(); }
    }
    function covering(el) {
      const d = el.ownerDocument; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null;
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + Math.min(8, r.width / 2), r.top + r.height / 2]];
      for (const [x, y] of pts) { if (x < 0 || y < 0 || x > d.defaultView.innerWidth || y > d.defaultView.innerHeight) continue; const hit = d.elementFromPoint(x, y); if (!hit) continue; if (hit === el || el.contains(hit) || hit.contains(el) && hit.tagName === 'LABEL') return null; const lab = hit.closest('label'); if (lab && (lab.control === el || lab.contains(el))) return null; const dlg = hit.closest('[role=dialog],[role=alertdialog],dialog'); return dlg ? 'the "' + (dlg.getAttribute('aria-label') || (dlg.getAttribute('aria-labelledby') && d.getElementById(dlg.getAttribute('aria-labelledby')) ? d.getElementById(dlg.getAttribute('aria-labelledby')).textContent.trim() : 'pop-up')) + '" dialog' : 'another element (' + hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : hit.className ? '.' + String(hit.className).split(' ')[0] : '') + ')'; }
      return null;
    }
    function fire(el, type, init) { const W = el.ownerDocument.defaultView; const Ctor = /^pointer/.test(type) && W.PointerEvent ? W.PointerEvent : /^key/.test(type) ? W.KeyboardEvent : /^(input|beforeinput)$/.test(type) && W.InputEvent ? W.InputEvent : /^(change|submit)$/.test(type) ? W.Event : W.MouseEvent; el.dispatchEvent(new Ctor(type, Object.assign({ bubbles: true, cancelable: true, composed: true }, init || {}))); }
    function setValue(el, v) { const W = el.ownerDocument.defaultView; const proto = el.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? W.HTMLSelectElement.prototype : W.HTMLInputElement.prototype; const desc = Object.getOwnPropertyDescriptor(proto, 'value'); desc.set.call(el, v); }
    function clickEl(el) { fire(el, 'pointerdown'); fire(el, 'mousedown'); if (el.focus) el.focus({ preventScroll: true }); fire(el, 'pointerup'); fire(el, 'mouseup'); el.click(); }
    async function act(a, opts) {
      const signal = opts && opts.signal; const d = doc();
      if (a.type === 'wait') { await sleep(a.ms || 300, signal); return { ok: true }; }
      if (a.type === 'navigate') return { ok: false, error: 'Navigation is not available inside the sandbox.' };
      const el = a.ref ? d.querySelector('[data-fp-ref="' + a.ref + '"]') : null;
      if (a.type === 'scroll') { if (el) el.scrollIntoView({ block: 'center' }); else d.defaultView.scrollBy(0, d.defaultView.innerHeight * 0.8); await sleep(speed.pause, signal); return { ok: true }; }
      if (!el || !el.isConnected) return { ok: false, error: 'Element [' + a.ref + '] is no longer on the page (it changed).' };
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      await sleep(30, signal);
      await moveTo(el, signal);
      const cov = covering(el);
      if (cov) return { ok: false, error: 'It is covered by ' + cov + '.' };
      if (a.type === 'click' || a.type === 'check' || a.type === 'uncheck') {
        if ((a.type === 'check' && el.checked) || (a.type === 'uncheck' && !el.checked)) return { ok: true };
        cursor.classList.add('down'); await sleep(Math.min(120, speed.pause), signal); cursor.classList.remove('down');
        if (el.tagName === 'A') { const href = el.getAttribute('href') || ''; if (/^https?:/i.test(href) && new URL(href, d.baseURI).origin !== d.defaultView.location.origin) return { ok: false, error: 'Link leaves the sandbox; not followed.' }; }
        clickEl(el);
      } else if (a.type === 'type') {
        clickEl(el);
        const ty = (el.type || '').toLowerCase(); const v = String(a.value == null ? '' : a.value);
        if (ty === 'date' || ty === 'time' || ty === 'month' || ty === 'color' || ty === 'range') { setValue(el, v); fire(el, 'input'); }
        else {
          if (a.clear !== false && el.value) { setValue(el, ''); fire(el, 'input', { inputType: 'deleteContentBackward' }); }
          let cur = el.value;
          for (const ch of v) { if (signal && signal.aborted) throw stopErr(); fire(el, 'keydown', { key: ch }); cur += ch; setValue(el, cur); fire(el, 'input', { data: ch, inputType: 'insertText' }); fire(el, 'keyup', { key: ch }); if (speed.key) await sleep(speed.key, signal); }
        }
        fire(el, 'change');
      } else if (a.type === 'select') {
        const want = String(a.value || '').toLowerCase().trim();
        const opt = Array.from(el.options || []).find((x) => x.textContent.trim().toLowerCase() === want) || Array.from(el.options || []).find((x) => x.value.toLowerCase() === want) || Array.from(el.options || []).find((x) => x.textContent.trim().toLowerCase().startsWith(want));
        if (!opt) return { ok: false, error: 'No option "' + a.value + '" in that list.' };
        clickEl(el); await sleep(speed.pause, signal);
        setValue(el, opt.value); fire(el, 'input'); fire(el, 'change');
      } else return { ok: false, error: 'Unknown action ' + a.type };
      await sleep(speed.pause, signal);
      await waitIdle(signal);
      return { ok: true };
    }
    return {
      kind: 'sandbox',
      setSpeed(s) { speed = SPEED[s] || SPEED.normal; },
      async snapshot() { const d = doc(); if (d.readyState !== 'complete') await new Promise((r) => setTimeout(r, 150)); await waitIdle(null, 3000); return SNAP.take(doc()); },
      act,
      async highlight(refs, mode) { const d = doc(); const els = (refs || []).map((r) => d.querySelector('[data-fp-ref="' + r + '"]')).filter(Boolean); if (!els.length) return; els[0].scrollIntoView({ block: 'center' }); await sleep(60); await moveTo(els[0], null, mode); els.forEach((e) => e.classList.add('fp-human-target')); if (!d.getElementById('fp-human-style')) { const st = d.createElement('style'); st.id = 'fp-human-style'; st.textContent = '.fp-human-target{outline:3px dashed #f59e0b!important;outline-offset:3px!important}'; d.head.appendChild(st); } },
      clearHighlight() { try { doc().querySelectorAll('.fp-human-target').forEach((e) => e.classList.remove('fp-human-target')); } catch (e) { /* ignore */ } },
      hideCursor() { cursor.hidden = true; hl.hidden = true; },
      waitIdle
    };
  }

  /* The optional local runner speaks the same protocol over HTTP. Token in a header, never in URLs. */
  function runnerEnv(o) {
    const base = String(o.url || 'http://127.0.0.1:8787').replace(/\/+$/, ''); const f = o.fetch || fetch.bind(globalThis);
    async function call(path, body, signal) {
      let res;
      try { res = await f(base + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ 'x-formpilot-token': o.token || '' }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal }); }
      catch (e) { if (e && e.name === 'AbortError') throw stopErr(); throw new Error('Could not reach the FormPilot runner at ' + base + '. Is it running (npm start in /runner)? Your browser may also ask you to allow access to devices on your local network; allow it for this site.'); }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j && j.error) || 'Runner error ' + res.status);
      return j;
    }
    return {
      kind: 'runner',
      health: () => call('/health'),
      open: (url) => call('/open', { url }),
      async snapshot() { const j = await call('/snapshot'); return j.snapshot; },
      async act(a, opts) { try { const j = await call('/act', { action: a, approved: !!(opts && opts.approved) }, opts && opts.signal); return j; } catch (e) { if (e.stopped) throw e; return { ok: false, error: e.message }; } },
      async highlight(refs) { try { await call('/highlight', { refs }); } catch (e) { /* optional */ } },
      clearHighlight() { call('/highlight', { refs: [] }).catch(() => {}); },
      stop: () => call('/stop', {}).catch(() => {})
    };
  }
  root.FormPilotEnv = { iframeEnv, runnerEnv, SPEED };
})(typeof self !== 'undefined' ? self : this);
