/* FormPilot AI app: wires the sandbox browser, agent loop, approval gate, questions and hand-offs,
   history with replay, recipes (record + re-run), sandbox bookings, settings and profile. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s); const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const LLM = window.AgentKit.llm; const SNAP = window.FormPilotSnapshot; const GUARD = window.FormPilotGuard; const GOAL = window.FormPilotGoal; const RULES = window.FormPilotPlanner;
  const LLMP = window.FormPilotLLM; const AGENT = window.FormPilotAgent; const ENV = window.FormPilotEnv; const REC = window.FormPilotRecorder; const ICS = window.FormPilotIcs; const REPORT = window.FormPilotReport; const WEBLLM = window.FormPilotWebLLM;
  const { ls } = window.FormPilotStore; const RUNSTORE = window.FormPilotStore.runs;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const LS = { settings: 'fp.settings', keys: 'fp.keys', profile: 'fp.profile', recipes: 'fp.recipes', theme: 'fp.theme', visited: 'fp.visited', site: 'fp.site', sandbox: 'fp.sandbox.state' };
  const SITES = [
    { id: 'dental', name: 'BrightSmile Dental', host: 'brightsmile-dental.example' },
    { id: 'salon', name: 'Shear Studio (hair salon)', host: 'shearstudio.example' },
    { id: 'permit', name: 'Maplewood Permit Center', host: 'permits.maplewood.example' },
    { id: 'rsvp', name: 'Lanternfest Supper Club (RSVP)', host: 'lanternfest.example' },
    { id: 'clinic', name: 'QuickCare Clinic (tricky)', host: 'quickcare-clinic.example' },
    { id: 'runner', name: 'Real site via local runner…', host: '' }
  ];
  const SAMPLES = {
    dental: ['Book a cleaning with Dr. Patel next Tuesday after 3pm', 'First available checkup with Dr. Kim in the morning', 'Whitening consultation with Dr. Alvarez on Friday afternoon'],
    salon: ["Book a men's haircut with Theo this Saturday morning", 'Blowout with Maya on Thursday after 2pm', "Women's cut & style with any stylist the day after tomorrow"],
    permit: ['Apply for a block party permit on Elm Street for Saturday after next from 2pm to 8pm, about 40 people', 'Temporary street parking permit on Oak Lane next Friday from 8am to 6pm', 'Yard sale permit at Birch Court tomorrow from 8am to 2pm, about 30 people'],
    rsvp: ['RSVP for 4 to the Harvest Lantern Supper on Friday, one vegetarian', 'Jazz & Dumplings Night for 2 on Thursday', 'Two seats at the Candlelit Pasta Workshop on Sunday'],
    clinic: ['Save me a spot at QuickCare Maplewood Center this evening for a flu shot', 'Walk-in visit at Oak Ridge tomorrow morning for a sprained ankle'],
    runner: ['Fill in the contact form with my name and email']
  };
  const PROVIDERS = Object.assign({}, LLM.PROVIDERS, { webllm: { label: 'In-browser (WebLLM, experimental)', defaultModel: WEBLLM.MODELS[0].id, models: WEBLLM.MODELS.map((m) => m.id), needsKey: false } });
  const DEFAULTS = { mode: 'rules', provider: 'openai', models: {}, baseUrl: '', remember: true, speed: 'normal', dryRun: false, maxSteps: 60, allowlist: GUARD.SANDBOX_HOSTS.join('\n'), shareValues: false, runnerUrl: 'http://127.0.0.1:8787', runnerToken: '' };
  let settings = Object.assign({}, DEFAULTS, ls.get(LS.settings, {}));
  let keys = settings.remember ? ls.get(LS.keys, {}) : {};
  let profile = Object.assign(clone(RULES.DEFAULT_PROFILE), ls.get(LS.profile, {}));
  let recipes = ls.get(LS.recipes, []);
  let runs = []; let lastRun = null; let current = null; let recording = null; let lowerTab = 'history';
  let siteId = ls.get(LS.site, 'dental'); if (!SITES.some((s) => s.id === siteId)) siteId = 'dental';
  const pending = { ask: null, handoff: null, approve: null };
  const frame = $('#site-frame'); const stage = $('#stage');
  let env = ENV.iframeEnv({ iframe: frame, stage, speed: settings.speed });

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg, undo) {
    const t = $('#toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" id="toast-undo">Undo</button>' : '');
    t.classList.add('show');
    if (undo) $('#toast-undo').onclick = () => { t.classList.remove('show'); undo(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 8000 : 3800);
  }
  /* ---------------- modals: X, Cancel, Esc, backdrop, Back; discard prompt for unsaved edits ---------------- */
  let modal = null; let lastFocus = null;
  function openModal(title, html, o) {
    const op = o || {};
    if (modal) removeModal('replaced');
    lastFocus = document.activeElement;
    window.history.pushState({ fpModal: true }, '');
    $('#modal-host').innerHTML = '<div class="backdrop"><section class="modal ' + (op.wide ? 'wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">' + esc(title) + '</h2><button type="button" data-close="x" aria-label="Close">×</button></div><div class="modal-body">' + html + '</div><div class="modal-footer">' + (op.extraFooter || '') + '<button type="button" data-close="cancel">' + esc(op.cancelLabel || (op.save ? 'Cancel' : 'Close')) + '</button>' + (op.save ? '<button type="button" id="modal-save" class="primary">' + esc(op.saveLabel || 'Save') + '</button>' : '') + '</div></section></div>';
    modal = { dirty: false, watch: !!op.dirty, onClose: op.onClose || null, name: op.name || '' };
    document.body.style.overflow = 'hidden';
    $('.backdrop').addEventListener('mousedown', (e) => { if (e.target.classList.contains('backdrop')) closeModal(); });
    $$('[data-close]').forEach((b) => (b.onclick = () => closeModal()));
    $('.modal-body').addEventListener('input', () => { if (modal && modal.watch) modal.dirty = true; });
    if (op.save) $('#modal-save').onclick = () => op.save();
    if (op.onmount) op.onmount();
    setTimeout(() => { if (!modal) return; const first = $('.modal-body input:not([type=checkbox]):not([type=hidden]):not([readonly]),.modal-body textarea,.modal-body select'); const el = op.focusFirst && first ? first : op.focusSel ? $(op.focusSel) : $('.modal [data-close=x]'); if (el) el.focus(); }, 0);
  }
  function removeModal(reason) { const m = modal; modal = null; $('#modal-host').innerHTML = ''; document.body.style.overflow = ''; if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); if (m && m.onClose) m.onClose(reason || 'cancel'); }
  function closeModal(force, reason) { if (!modal || modal.closing) return; if (!force && modal.dirty && !confirm('Discard unsaved changes?')) return; modal.dirty = false; modal.closing = true; modal.reason = reason; const m = modal; window.history.back(); setTimeout(() => { if (modal === m) removeModal(m.reason); }, 800); }
  addEventListener('popstate', () => { if (!modal) return; if (!modal.closing && modal.dirty && !confirm('Discard unsaved changes?')) { window.history.pushState({ fpModal: true }, ''); return; } removeModal(modal.reason); });
  addEventListener('keydown', (e) => {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab') { const els = $$('.modal button,.modal input,.modal select,.modal textarea,.modal a[href]').filter((x) => !x.disabled && x.offsetParent !== null); if (!els.length) return; const first = els[0]; const last = els[els.length - 1]; if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); } }
  });
  function download(name, data, type) { const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }

  /* ---------------- site / browser ---------------- */
  function site() { return SITES.find((s) => s.id === siteId); }
  function renderSites() { $('#site').innerHTML = SITES.map((s) => '<option value="' + s.id + '"' + (s.id === siteId ? ' selected' : '') + '>' + esc(s.name) + '</option>').join(''); }
  function renderSamples() { $('#samples').innerHTML = (SAMPLES[siteId] || []).map((q) => '<button type="button" class="chip">' + esc(q) + '</button>').join(''); $$('#samples .chip').forEach((b) => (b.onclick = () => { $('#goal').value = b.textContent; $('#goal').focus(); })); }
  const RUNNER_HELP = '<h3 style="margin-top:0">Real sites through the local runner</h3><p>The optional runner (in <code>/runner</code> of the repo) drives a real Chromium window on your computer with Playwright. This page sends it the same snapshot / act protocol the sandbox uses. It is dry-run by default, stops before any final submit, refuses to type passwords or card numbers, and only opens sites on its allowlist.</p><ol><li>In the repo: <code>cd runner && npm install && npm start</code></li><li>Copy the token it prints into Settings → Local runner.</li><li>Add the real site\u2019s domain to your allowlist in Settings (and start the runner with <code>--allow</code> for it).</li><li>Enter the start page above and a goal, then Run.</li></ol><p class="muted small">Your browser may ask to allow this site to access devices on your local network (Chrome and Firefox now ask before a public page can reach localhost). Allow it for this site only.</p>';
  function loadSite(id, opts) {
    siteId = id; ls.set(LS.site, id); renderSites(); renderSamples();
    const isRunner = id === 'runner';
    $('#runner-box').hidden = !isRunner; $('#runner-view').hidden = !isRunner; frame.hidden = isRunner; $('#rec-btn').disabled = isRunner || !!current;
    $('#sandbox-badge').textContent = isRunner ? 'local runner' : 'sandbox';
    if (isRunner) { setAddr($('#runner-url').value || 'runner: not connected'); $('#runner-view').innerHTML = RUNNER_HELP; return Promise.resolve(); }
    const url = './sandbox/' + id + '/index.html' + (opts && opts.bust ? '?r=' + Date.now() : '');
    const loaded = new Promise((res) => { const on = () => { frame.removeEventListener('load', on); try { frame.contentWindow.addEventListener('hashchange', updateAddr); updateAddr(); } catch (e) { setAddr('(left the sandbox)'); } res(); }; frame.addEventListener('load', on); });
    frame.src = url;
    return loaded.then(() => new Promise((r) => setTimeout(r, 120)));
  }
  function setAddr(t) { $('#addr-text').textContent = t; }
  function updateAddr() { try { const d = frame.contentDocument; const m = d.querySelector('meta[name="fp-host"]'); setAddr('https://' + (m ? m.content : location.host) + '/' + (frame.contentWindow.location.hash || '').replace(/^#\/?/, '')); } catch (e) { setAddr('(left the sandbox)'); } }
  $('#site').onchange = (e) => { if (current || recording) { renderSites(); return; } const g = $('#goal').value.trim(); const isSample = !g || Object.values(SAMPLES).some((l) => l.includes(g)); loadSite(e.target.value).then(() => { if (isSample) $('#goal').value = (SAMPLES[siteId] || [''])[0]; }); };
  $('#b-reload').onclick = () => { if (current) { toast('Stop the agent before reloading.'); return; } if (recording) stopRecording(true); loadSite(siteId, { bust: true }); };
  $('#b-snap').onclick = () => showSnapshot();

  /* ---------------- mode / pills ---------------- */
  function provLabel() { const p = PROVIDERS[settings.provider]; return p.label + ' · ' + (settings.models[settings.provider] || p.defaultModel); }
  function renderMode() {
    $('#mode-rules').setAttribute('aria-pressed', String(settings.mode === 'rules')); $('#mode-llm').setAttribute('aria-pressed', String(settings.mode === 'llm'));
    $('#mode-pill').textContent = settings.mode === 'rules' ? 'Demo planner · no key' : 'Your AI · ' + provLabel();
    $('#mode-pill').className = 'pill' + (settings.mode === 'llm' && PROVIDERS[settings.provider].needsKey && !keys[settings.provider] ? ' warn' : '');
    $('#dry-run').checked = !!settings.dryRun; $('#dry-pill').hidden = !settings.dryRun; $('#speed').value = settings.speed;
  }
  function saveSettings() { ls.set(LS.settings, settings); if (settings.remember) ls.set(LS.keys, keys); else ls.del(LS.keys); renderMode(); }
  $('#mode-rules').onclick = () => { settings.mode = 'rules'; saveSettings(); };
  $('#mode-llm').onclick = () => { settings.mode = 'llm'; saveSettings(); if (PROVIDERS[settings.provider].needsKey && !keys[settings.provider]) { toast('Add your ' + PROVIDERS[settings.provider].label + ' key in Settings to use your AI.'); openSettings(); } };
  $('#dry-run').onchange = (e) => { settings.dryRun = e.target.checked; saveSettings(); };
  $('#speed').onchange = (e) => { settings.speed = e.target.value; if (env.setSpeed) env.setSpeed(settings.speed); saveSettings(); };
  $('#btn-theme').onclick = () => { const dark = document.documentElement.classList.toggle('dark'); ls.set(LS.theme, dark ? 'dark' : 'light'); };
  function online() { $('#offline-pill').hidden = navigator.onLine; }
  addEventListener('online', online); addEventListener('offline', online);

  /* ---------------- step log ---------------- */
  const KIND = { flag: 'flag', replan: 'replan', gate: 'gate', blocked: 'bad', fail: 'bad', declined: 'bad', stopped: 'bad', done: 'ok-step', approved: 'ok-step' };
  const ICON = { action: '•', flag: '⚠', replan: '↺', gate: '✋', blocked: '⛔', fail: '✕', declined: '✕', stopped: '■', done: '✓', approved: '✓', ask: '?', answer: '↳', handoff: '👤', note: 'i' };
  function clearLog() { $('#log').innerHTML = ''; }
  function logLine(html, cls) { const d = document.createElement('div'); d.className = 'step ' + (cls || ''); d.innerHTML = html; $('#log').appendChild(d); scrollLog(d); return d; }
  function scrollLog(el) { const log = $('#log'); log.scrollTop = el.offsetTop - log.offsetTop - log.clientHeight + el.offsetHeight + 20; }
  function stepHtml(s) {
    const what = s.kind === 'action' ? esc(s.action) + (s.value != null && s.value !== '' ? ' <span class="val">' + esc(s.value) + '</span>' : '') : esc(s.text || s.kind);
    return '<span class="n">' + (s.kind === 'action' ? s.n : ICON[s.kind] || '·') + '</span><div><div class="what">' + what + '</div>' + (s.thought ? '<div class="why">' + esc(s.thought) + '</div>' : '') + (s.result && s.result !== 'ok' ? '<div class="why" style="color:var(--bad)">' + esc(s.result) + '</div>' : '') + '</div>';
  }
  function onStep(s) { $$('.step.active').forEach((x) => x.classList.remove('active')); const d = logLine(stepHtml(s), (KIND[s.kind] || '') + ' k-' + s.kind); d.id = 'st-' + s.n; if (s.kind === 'action') d.classList.add('active'); }
  function onStepUpdate(s) { const d = $('#st-' + s.n); if (d) { d.innerHTML = stepHtml(s); if (!s.ok) d.classList.add('bad'); } }
  function ribbon(text, cls) { const r = $('#ribbon'); if (!text) { r.hidden = true; return; } r.hidden = false; r.className = 'ribbon ' + (cls || ''); r.textContent = text; }
  const DRIVING = 'Agent is driving · Stop halts it immediately';

  /* ---------------- hooks: ask, hand-off, approval ---------------- */
  function askHook(a) {
    return new Promise((resolve) => {
      ribbon('The agent has a question for you', 'human');
      const card = document.createElement('div'); card.className = 'card'; card.id = 'ask-card';
      const choices = (a.choices || []).filter(Boolean);
      card.innerHTML = '<h3>Question</h3><div>' + esc(a.question) + '</div>' + (choices.length ? '<div class="choices">' + choices.map((c, i) => '<button type="button" class="small-btn" data-choice="' + i + '">' + esc(c) + '</button>').join('') + '</div>' : '') +
        '<div class="field" style="margin:0"><label for="ask-input" class="sr-only">Your answer</label>' + (a.multiline ? '<textarea id="ask-input" rows="3" placeholder="Type your answer"></textarea>' : '<input id="ask-input" type="text" autocomplete="off" placeholder="' + (choices.length ? 'Or type your own answer' : 'Type your answer') + '"' + (a.current ? ' value="' + esc(a.current) + '"' : '') + '>') + '</div>' +
        (a.saveAs ? '<label class="inline"><input type="checkbox" id="ask-save"> Save to my profile as “' + esc(a.saveAs) + '”</label>' : '') +
        '<div class="actions"><button type="button" class="primary small-btn" id="ask-ok">Answer</button><button type="button" class="small-btn danger" id="ask-stop">Stop the run</button></div>';
      $('#log').appendChild(card); scrollLog(card);
      const done = (v) => { if (!pending.ask) return; pending.ask = null; card.remove(); ribbon(DRIVING); resolve(v); };
      pending.ask = () => done(null);
      const submit = (val) => { val = String(val == null ? '' : val).trim(); if (!val) { $('#ask-input').focus(); $('#ask-input').setAttribute('aria-invalid', 'true'); return; } done({ value: val, saveAs: a.saveAs && $('#ask-save') && $('#ask-save').checked ? a.saveAs : null }); };
      $$('[data-choice]', card).forEach((b) => (b.onclick = () => submit(choices[+b.dataset.choice])));
      $('#ask-ok').onclick = () => submit($('#ask-input').value);
      $('#ask-stop').onclick = () => stopRun();
      $('#ask-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !a.multiline) { e.preventDefault(); submit(e.target.value); } });
      setTimeout(() => { const el = $('#ask-input'); if (el) el.focus({ preventScroll: true }); }, 30);
    });
  }
  function handoffHook(h) {
    return new Promise((resolve) => {
      ribbon('Your turn: fill the highlighted field' + ((h.fields || []).length > 1 ? 's' : '') + ' in the page', 'human');
      const kinds = Array.from(new Set((h.kinds || [h.kind]).filter(Boolean).map(GUARD.labelSensitive)));
      const card = document.createElement('div'); card.className = 'card human'; card.id = 'handoff-card';
      card.innerHTML = '<h3>👤 Your turn</h3><div>Please fill <b>' + esc((h.fields || []).join(', ')) + '</b> yourself in the page (highlighted). ' + esc(kinds.join(' and ')) + ' fields are never typed, read or stored by FormPilot.</div><div class="err" id="handoff-err" role="alert"></div><div class="actions"><button type="button" class="primary small-btn" id="handoff-ok">Done, continue</button><button type="button" class="small-btn danger" id="handoff-stop">Stop the run</button></div>';
      $('#log').appendChild(card); scrollLog(card);
      const done = (v) => { if (!pending.handoff) return; pending.handoff = null; card.remove(); ribbon(DRIVING); resolve(v); };
      pending.handoff = () => done(false);
      $('#handoff-stop').onclick = () => stopRun();
      $('#handoff-ok').onclick = async () => {
        try { const snap = await current.env.snapshot(); const left = (h.refs || []).map((r) => snap.items.find((x) => x.ref === r)).filter((x) => x && x.sensitive && !x.filled); if (left.length) { $('#handoff-err').textContent = 'Still empty: ' + left.map((x) => x.name).join(', ') + '.'; return; } } catch (e) { /* runner without refs: trust the user */ }
        done(true);
      };
    });
  }
  function summaryHtml(s) {
    const rows = s.fields.map((f) => '<tr><th>' + esc(f.label) + '</th><td>' + esc(f.value) + '</td><td class="src">' + esc(f.source || '') + '</td></tr>').join('');
    const page = s.pagePairs.length ? '<h3 style="font-size:14px;margin:14px 0 6px">The site\u2019s own review</h3><table class="kv">' + s.pagePairs.map(([k, v]) => '<tr><th>' + esc(k) + '</th><td colspan="2">' + esc(v) + '</td></tr>').join('') + '</table>' : '';
    return '<p class="small" style="margin-top:0">Site: <b>' + esc(s.host) + '</b> · ' + esc(s.title || '') + '</p>' + (s.flags ? '<div class="warn-box">⚠ ' + s.flags + ' instruction' + (s.flags > 1 ? 's' : '') + ' hidden in this site\u2019s pages ' + (s.flags > 1 ? 'were' : 'was') + ' flagged and ignored. Nothing was sent anywhere else.</div>' : '') + '<h3 style="font-size:14px;margin:6px 0">Everything the agent entered or chose</h3>' + (rows ? '<table class="kv" id="approve-fields"><tr><th>Field</th><td><b>Value</b></td><td class="src"><b>From</b></td></tr>' + rows + '</table>' : '<p class="muted small">No fields.</p>') + page;
  }
  function approveHook(s) {
    return new Promise((resolve) => {
      ribbon('Waiting for your approval before "' + s.button + '"', 'gate');
      let decided = false;
      const finish = (v) => { if (decided) return; decided = true; pending.approve = null; ribbon(v ? DRIVING : ''); resolve(v); };
      openModal('Approve: ' + s.button + '?', '<div class="note-box">The agent has filled everything in and stopped <b>before</b> clicking “' + esc(s.button) + '”. Nothing has been submitted. Check the details, then approve or decline. Closing this window counts as declining.</div>' + summaryHtml(s), {
        name: 'approve', wide: true, save: () => { finish(true); closeModal(true, 'approved'); }, saveLabel: 'Approve & ' + s.button.toLowerCase(), cancelLabel: 'Decline', focusSel: '#modal-save',
        onClose: (why) => finish(why === 'approved')
      });
      pending.approve = () => { finish(false); if (modal && modal.name === 'approve') closeModal(true); };
    });
  }
  function dryRunHook(s) { return new Promise((resolve) => { openModal('Dry run: review only', '<div class="note-box">Dry run is on, so the agent stopped before “' + esc(s.button) + '”. Nothing was submitted. This is what it would have sent:</div>' + summaryHtml(s), { wide: true, name: 'dry', onClose: () => resolve() }); }); }
  function saveToProfile(label, value) { profile.custom = profile.custom || []; const ex = profile.custom.find((c) => c.label.toLowerCase() === String(label).toLowerCase()); if (ex) ex.value = value; else profile.custom.push({ label, value }); ls.set(LS.profile, profile); toast('Saved “' + label + '” to your profile.'); }

  /* ---------------- run ---------------- */
  function plannerFor(recipe, vars) {
    if (recipe) return AGENT.recipePlanner(recipe, vars);
    if (settings.mode === 'llm') {
      const p = settings.provider; const model = settings.models[p] || PROVIDERS[p].defaultModel;
      const call = p === 'webllm' ? (msg) => WEBLLM.call(model, msg, (r) => ribbon('Loading in-browser model: ' + Math.round((r.progress || 0) * 100) + '%')) : (msg) => LLM.call({ provider: p, key: keys[p] || '', model, baseUrl: p === 'compatible' ? settings.baseUrl : '' }, msg, { timeoutMs: 90000 });
      return LLMP.create({ call, label: 'Your AI · ' + provLabel(), shareProfileValues: settings.shareValues, todayLabel: new Date().toDateString() });
    }
    return RULES.create();
  }
  function allowlist() { return String(settings.allowlist || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean); }
  async function startRun(opts) {
    const o = opts || {};
    if (current) return null;
    if (recording) stopRecording(true);
    const goalText = o.recipe ? 'Recipe: ' + o.recipe.name : $('#goal').value.trim();
    if (!goalText) { toast('Type a goal first, or pick one of the samples.'); $('#goal').focus(); return null; }
    if (o.recipe && o.recipe.site !== siteId) await loadSite(o.recipe.site);
    if (!o.recipe && siteId !== 'runner') { const det = GOAL.SITES.find((s) => s.re.test(goalText)); const mine = GOAL.SITES.find((s) => s.id === siteId); if (det && det.id !== siteId && !(mine && mine.re.test(goalText))) { await loadSite(det.id); toast('Switched to ' + site().name + ' to match your goal.'); } }
    if (!o.recipe && settings.mode === 'llm' && PROVIDERS[settings.provider].needsKey && !keys[settings.provider]) { toast('Add your ' + PROVIDERS[settings.provider].label + ' key in Settings first, or switch to the demo planner.'); openSettings(); return null; }
    const isRunner = siteId === 'runner';
    let runEnv;
    if (isRunner) {
      const url = $('#runner-url').value.trim();
      if (!/^https?:\/\//i.test(url)) { toast('Enter the start page (https://…) for the real site.'); $('#runner-url').focus(); return null; }
      if (!GUARD.hostAllowed(GUARD.hostOf(url), allowlist())) { toast(GUARD.hostOf(url) + ' is not on your allowlist. Add it in Settings first.'); return null; }
      runEnv = ENV.runnerEnv({ url: settings.runnerUrl, token: settings.runnerToken });
      try { await runEnv.open(url); setAddr(url); } catch (e) { toast(e.message); $('#runner-status').textContent = e.message; return null; }
    } else { await loadSite(siteId, { bust: true }); env = ENV.iframeEnv({ iframe: frame, stage, speed: settings.speed }); runEnv = env; }
    const goal = GOAL.parse(goalText, new Date(), isRunner ? null : siteId);
    const planner = plannerFor(o.recipe, o.vars);
    const controller = new AbortController();
    current = { controller, env: runEnv, planner, goalText };
    setRunning(true); clearLog();
    const d = o.recipe ? o.recipe.steps.length + ' recorded steps' : GOAL.describe(goal);
    logLine('<span class="n">→</span><div><div class="what">' + (o.recipe ? '' : 'Goal: ') + esc(goalText) + '</div><div class="why">' + esc(planner.label) + (d ? ' · ' + (o.recipe ? '' : 'I read this as: ') + esc(d) : '') + (settings.dryRun ? ' · dry run (nothing will be submitted)' : '') + '</div></div>');
    ribbon(DRIVING);
    const out = await AGENT.run({ env: runEnv, planner, goalText, goal, profile, answers: {}, signal: controller.signal, settings: { dryRun: settings.dryRun, maxSteps: settings.maxSteps, allowlist: allowlist() },
      hooks: { onStep, onStepUpdate, ask: askHook, handoff: handoffHook, approve: approveHook, dryRunReview: dryRunHook, saveToProfile } });
    if (runEnv.hideCursor) runEnv.hideCursor();
    ribbon('');
    const run = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), goal: goalText, site: siteId, host: isRunner ? GUARD.hostOf($('#runner-url').value) : site().host, sandbox: !isRunner, mode: o.recipe ? 'recipe' : settings.mode, plannerLabel: planner.label, dryRun: !!settings.dryRun, status: out.status, reason: out.reason, startedAt: out.startedAt, endedAt: out.endedAt,
      steps: out.steps.map((s) => { const c = Object.assign({}, s); delete c.summary; if (c.snapshot) c.snapshot = String(c.snapshot).slice(0, 5000); return c; }), flags: out.flags, filled: out.filled, confirmation: out.confirmation || null, approvedSummary: out.approvedSummary || out.summary || null, usage: planner.usage && planner.usage.calls ? planner.usage : null, recipeId: o.recipe ? o.recipe.id : null };
    lastRun = run; runs.unshift(run); await RUNSTORE.put(run);
    current = null; setRunning(false); resultCard(run); renderLower();
    if (isRunner) { try { const s = await runEnv.snapshot(); $('#runner-view').innerHTML = '<pre>' + esc(SNAP.render(s)) + '</pre>'; } catch (e) { /* ignore */ } }
    return run;
  }
  function setRunning(on) {
    $('#run-btn').disabled = on; $('#stop-btn').disabled = !on; $('#rec-btn').disabled = on || siteId === 'runner'; $('#site').disabled = on; $('#b-reload').disabled = on;
    document.body.classList.toggle('running', on);
  }
  function stopRun() {
    if (!current) return;
    current.controller.abort();
    if (current.env.stop) current.env.stop();
    if (pending.ask) pending.ask(); if (pending.handoff) pending.handoff(); if (pending.approve) pending.approve();
  }
  $('#stop-btn').onclick = stopRun;
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && current && !modal && !pending.ask && !pending.handoff) stopRun(); });
  $('#goal-form').onsubmit = (e) => { e.preventDefault(); startRun(); };
  $('#goal').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startRun(); } });
  const STATUS_TEXT = { success: 'Done', declined: 'Declined: nothing was submitted', stopped: 'Stopped', failed: 'Could not finish', error: 'Error', 'dry-run': 'Dry run finished: nothing was submitted' };
  function icsFor(run) {
    const c = run.confirmation; if (!c || !c.date || c.start == null) return null;
    const [y, m, d] = c.date.split('-').map(Number); const start = new Date(y, m - 1, d, Math.floor(c.start / 60), c.start % 60);
    let minutes = c.end != null && c.end > c.start ? c.end - c.start : 0;
    if (!minutes) { const txt = (run.filled || []).map((f) => f.value).join(' ') + ' ' + (c.pairs || []).map((p) => p.join(' ')).join(' '); const mm = /(\d{2,3})\s*min/.exec(txt); minutes = mm ? +mm[1] : 60; }
    return ICS.build({ uid: (c.code || run.id) + '@' + (run.host || 'formpilot.example'), title: c.title || c.heading || run.goal, start, minutes, location: c.location || c.siteTitle, description: 'Booked by FormPilot AI on ' + run.host + (run.sandbox ? ' (fictional sandbox)' : '') + '.' + (c.code ? ' Confirmation: ' + c.code : '') });
  }
  function resultCard(run) {
    const ok = run.status === 'success'; const c = run.confirmation;
    const card = document.createElement('div'); card.className = 'card ' + (ok ? 'result-ok' : run.status === 'dry-run' ? '' : 'result-bad'); card.id = 'result-card';
    card.innerHTML = '<h3>' + (ok ? '✓ ' : run.status === 'dry-run' ? '◌ ' : '✕ ') + esc(STATUS_TEXT[run.status] || run.status) + '</h3>' + (ok && c ? '<div>' + esc(c.heading) + (c.code ? ' · <span class="code-pill">' + esc(c.code) + '</span>' : '') + '</div>' : '<div class="small">' + esc(run.reason || '') + '</div>') +
      (run.flags.length ? '<div class="small" style="color:var(--bad)">⚠ ' + run.flags.length + ' prompt-injection attempt' + (run.flags.length > 1 ? 's' : '') + ' flagged and ignored.</div>' : '') +
      '<div class="actions">' + (icsFor(run) ? '<button type="button" class="small-btn primary" data-a="ics">📅 Add to calendar (.ics)</button>' : '') + '<button type="button" class="small-btn" data-a="md">Report (.md)</button><button type="button" class="small-btn" data-a="json">Report (.json)</button><button type="button" class="small-btn" data-a="replay">Replay steps</button>' + (ok && run.mode !== 'recipe' && run.sandbox ? '<button type="button" class="small-btn" data-a="recipe">Save as recipe</button>' : '') + '</div>';
    $('#log').appendChild(card); scrollLog(card);
    bindRunActions(card, run);
  }
  function bindRunActions(host, run) {
    $$('[data-a]', host).forEach((b) => (b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'ics') { const t = icsFor(run); if (t) { download(REPORT.fileSafe((run.confirmation && run.confirmation.code) || run.goal) + '.ics', t, 'text/calendar'); toast('Calendar file downloaded.'); } }
      if (a === 'md') { download('formpilot-' + REPORT.fileSafe(run.goal) + '.md', REPORT.markdown(run, (r) => REPORT.thumbnail(r)), 'text/markdown'); toast('Markdown report downloaded.'); }
      if (a === 'json') { download('formpilot-' + REPORT.fileSafe(run.goal) + '.json', REPORT.json(run), 'application/json'); toast('JSON report downloaded.'); }
      if (a === 'replay') openReplay(run);
      if (a === 'recipe') recipeFromRun(run);
      if (a === 'rerun') { if (current) return; if (run.recipeId) { const r = recipes.find((x) => x.id === run.recipeId); if (r) { closeModal(true); setTimeout(() => runRecipe(r), 300); return; } } closeModal(true); loadSite(run.site).then(() => { $('#goal').value = run.goal.replace(/^Recipe: /, ''); setTimeout(() => startRun(), 200); }); }
      if (a === 'del') deleteRun(run.id);
    }));
  }

  /* ---------------- replay ---------------- */
  function openReplay(run) {
    const steps = run.steps;
    let i = Math.max(0, steps.findIndex((s) => s.kind === 'action')); let timer = null;
    openModal('Replay: ' + run.goal, '<p class="small" style="margin-top:0"><span class="badge ' + run.status + '">' + esc(REPORT.STATUS[run.status] || run.status) + '</span> · ' + esc(run.host) + ' · ' + esc(new Date(run.startedAt).toLocaleString('en-US')) + ' · ' + esc(run.plannerLabel || '') + '</p><div class="replay"><div class="steps-list" id="rp-list">' + steps.map((s, k) => '<button type="button" data-k="' + k + '">' + (s.kind === 'action' ? s.n + '. ' + esc(s.action) : (ICON[s.kind] || '·') + ' ' + esc((s.text || s.kind).slice(0, 90))) + '</button>').join('') + '</div><div id="rp-view"></div></div>', {
      wide: true, name: 'replay', extraFooter: '<button type="button" id="rp-prev">‹ Prev</button><button type="button" id="rp-play">▶ Play</button><button type="button" id="rp-next">Next ›</button><button type="button" data-a="md">Report (.md)</button><button type="button" data-a="json">JSON</button><button type="button" data-a="rerun">Run again</button>',
      onClose: () => clearInterval(timer),
      onmount: () => {
        const show = () => { const s = steps[i]; if (!s) { $('#rp-view').innerHTML = '<p class="muted">This run has no recorded steps. ' + esc(run.reason || '') + '</p>'; return; } $$('#rp-list button').forEach((b) => b.setAttribute('aria-current', String(+b.dataset.k === i))); const img = s.rects ? REPORT.thumbnail(s.rects, { width: 360 }) : null; $('#rp-view').innerHTML = '<div style="font-weight:700">' + (s.kind === 'action' ? 'Step ' + s.n + ': ' + esc(s.action) + (s.value ? ' <span class="val">' + esc(s.value) + '</span>' : '') : esc(s.text || s.kind)) + '</div>' + (s.thought ? '<p class="small muted">' + esc(s.thought) + '</p>' : '') + (s.result && s.result !== 'ok' ? '<p class="small" style="color:var(--bad)">' + esc(s.result) + '</p>' : '') + (img ? '<img class="thumb" id="rp-thumb" alt="Wireframe of the page at this step, with the target outlined" src="' + img + '">' : '') + (s.snapshot ? '<details' + (img ? '' : ' open') + '><summary class="small">What the agent saw (accessibility snapshot)</summary><pre class="snap-pre">' + esc(s.snapshot) + '</pre></details>' : ''); const cur = $('#rp-list [aria-current=true]'); if (cur) cur.scrollIntoView({ block: 'nearest' }); };
        $$('#rp-list button').forEach((b) => (b.onclick = () => { i = +b.dataset.k; show(); }));
        $('#rp-prev').onclick = () => { i = Math.max(0, i - 1); show(); }; $('#rp-next').onclick = () => { i = Math.min(steps.length - 1, i + 1); show(); };
        $('#rp-play').onclick = () => { if (timer) { clearInterval(timer); timer = null; $('#rp-play').textContent = '▶ Play'; return; } $('#rp-play').textContent = '❚❚ Pause'; timer = setInterval(() => { if (i >= steps.length - 1 || !modal) { clearInterval(timer); timer = null; if ($('#rp-play')) $('#rp-play').textContent = '▶ Play'; return; } i++; show(); }, 900); };
        bindRunActions($('.modal-footer'), run); show();
      }
    });
  }

  /* ---------------- recording + recipes ---------------- */
  $('#rec-btn').onclick = () => { if (recording) stopRecording(); else startRecording(); };
  async function startRecording() {
    if (current || siteId === 'runner') return;
    await loadSite(siteId, { bust: true });
    const doc = frame.contentDocument; let count = 0;
    recording = { site: siteId, rec: REC.start(doc, (st) => { count++; ribbon('● Recording · ' + count + ' step' + (count > 1 ? 's' : '') + ' · last: ' + st.type + ' “' + (st.target.name || '').slice(0, 40) + '”', 'rec'); }) };
    const onLeave = () => { if (recording) stopRecording(); }; frame.addEventListener('load', onLeave, { once: true }); recording.onLeave = onLeave;
    $('#rec-btn').textContent = '■ Stop recording'; $('#run-btn').disabled = true; $('#site').disabled = true;
    ribbon('● Recording: use the site yourself. Sensitive fields are recorded as “your turn” steps, never their values.', 'rec');
    clearLog(); logLine('<span class="n">●</span><div><div class="what">Recording on ' + esc(site().name) + '</div><div class="why">Click and type in the page as you normally would. Press “Stop recording” to save it as a recipe.</div></div>');
  }
  function stopRecording(silent) {
    if (!recording) return; const r = recording; recording = null; frame.removeEventListener('load', r.onLeave);
    const steps = r.rec.stop(); $('#rec-btn').textContent = '● Record'; $('#run-btn').disabled = false; $('#site').disabled = false; ribbon('');
    if (silent) return;
    if (!steps.length) { toast('Nothing was recorded.'); return; }
    const sug = REC.suggest(steps, profile);
    editRecipe({ id: null, name: 'My ' + SITES.find((s) => s.id === r.site).name.split(' (')[0] + ' booking', site: r.site, steps: sug.steps, vars: sug.vars, createdAt: new Date().toISOString() }, true);
  }
  function recipeFromRun(run) { const sug = REC.suggest(REC.fromRun(run), profile); editRecipe({ id: null, name: run.goal.slice(0, 60), site: run.site, steps: sug.steps, vars: sug.vars, createdAt: new Date().toISOString() }, true); }
  function stepLabel(st) { return ({ click: 'Click', type: 'Type into', select: 'Choose in', check: 'Tick', uncheck: 'Untick', handoff: 'Your turn:' }[st.type] || st.type) + ' ' + st.target.role + ' “' + st.target.name + '”'; }
  function editRecipe(r, isNew) {
    const draft = clone(r); draft.vars = draft.vars || {};
    const body = () => '<div class="field"><label for="rc-name">Recipe name</label><input id="rc-name" value="' + esc(draft.name) + '" maxlength="80"><div class="err" id="rc-err" role="alert"></div></div><p class="small muted">Site: ' + esc((SITES.find((s) => s.id === draft.site) || {}).name || draft.site) + '. Values can use <code>{{profile.email}}</code>-style placeholders or your own <code>{{variables}}</code>. The final submit still needs your approval when the recipe runs.</p>' +
      '<div class="rec-steps">' + draft.steps.map((st, i) => '<div class="rec-step"><span class="muted small">' + (i + 1) + '</span><div style="min-width:0"><div class="small" style="overflow-wrap:anywhere">' + esc(stepLabel(st)) + '</div>' + (st.type === 'type' || st.type === 'select' ? '<label class="sr-only" for="rv-' + i + '">Value for step ' + (i + 1) + '</label><input id="rv-' + i + '" data-i="' + i + '" value="' + esc(st.value || '') + '">' : '') + '</div><button type="button" class="small-btn danger" data-rm="' + i + '" aria-label="Remove step ' + (i + 1) + '">✕</button></div>').join('') + '</div>' +
      (Object.keys(draft.vars).length ? '<h3 style="font-size:14px;margin:12px 0 6px">Variables asked for at run time</h3>' + Object.entries(draft.vars).map(([k, v]) => '<div class="field"><label for="vl-' + esc(k) + '">Label for {{' + esc(k) + '}}</label><input id="vl-' + esc(k) + '" data-var="' + esc(k) + '" value="' + esc(v.label) + '"></div>').join('') : '');
    const collect = () => { draft.name = $('#rc-name').value.trim(); $$('[data-i]').forEach((x) => (draft.steps[+x.dataset.i].value = x.value)); $$('[data-var]').forEach((x) => (draft.vars[x.dataset.var].label = x.value)); };
    const mount = () => { $$('[data-rm]').forEach((b) => (b.onclick = () => { collect(); draft.steps.splice(+b.dataset.rm, 1); $('.modal-body').innerHTML = body(); mount(); modal.dirty = true; })); };
    openModal(isNew ? 'Save recipe' : 'Edit recipe', body(), { wide: true, dirty: true, focusFirst: true, saveLabel: 'Save recipe', name: 'recipe', onmount: () => { mount(); if (isNew && modal) modal.dirty = true; },
      save: () => { collect(); if (!draft.name) { $('#rc-err').textContent = 'Give the recipe a name.'; $('#rc-name').focus(); return; } if (!draft.steps.length) { $('#rc-err').textContent = 'A recipe needs at least one step.'; return; }
        if (!draft.id) { draft.id = 'rc' + Date.now().toString(36); recipes.unshift(draft); } else { const i = recipes.findIndex((x) => x.id === draft.id); if (i >= 0) recipes[i] = draft; }
        ls.set(LS.recipes, recipes); modal.dirty = false; closeModal(true); lowerTab = 'recipes'; renderLower(); toast('Recipe “' + draft.name + '” saved.'); } });
  }
  function runRecipe(r) {
    const vars = Object.entries(r.vars || {});
    if (!vars.length) { startRun({ recipe: r, vars: REC.varsFor(r, {}, profile) }); return; }
    openModal('Run “' + r.name + '”', '<p class="small muted" style="margin-top:0">Fill in the values for this run. Profile placeholders come from your profile automatically.</p>' + vars.map(([k, v]) => '<div class="field"><label for="rvv-' + esc(k) + '">' + esc(v.label || k) + '</label><input id="rvv-' + esc(k) + '" data-v="' + esc(k) + '" type="' + (v.type === 'date' ? 'date' : 'text') + '" ' + (v.type !== 'date' && v.example ? 'placeholder="e.g. ' + esc(v.example) + '"' : '') + '></div>').join('') + '<div class="err" id="rvv-err" role="alert"></div>', {
      saveLabel: '▶ Run recipe', focusFirst: true, dirty: true, name: 'recipe-vars',
      save: () => { const vals = {}; let miss = null; $$('[data-v]').forEach((x) => { vals[x.dataset.v] = x.value.trim(); if (!vals[x.dataset.v] && !miss) miss = x; }); if (miss) { $('#rvv-err').textContent = 'Fill in every value (or Cancel).'; miss.focus(); return; } modal.dirty = false; closeModal(true); setTimeout(() => startRun({ recipe: r, vars: REC.varsFor(r, vals, profile) }), 250); }
    });
  }

  /* ---------------- lower tabs ---------------- */
  ['history', 'recipes', 'bookings'].forEach((t) => ($('#tab-' + t).onclick = () => { lowerTab = t; renderLower(); }));
  function sandboxState() { try { return Object.assign({ bookings: [], taken: {}, seq: 1 }, JSON.parse(localStorage.getItem(LS.sandbox) || 'null') || {}); } catch (e) { return { bookings: [], taken: {}, seq: 1 }; } }
  function setSandbox(s) { try { localStorage.setItem(LS.sandbox, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  function fmtWhen(b) { if (!b.date) return ''; const [y, m, d] = b.date.split('-').map(Number); const dt = new Date(y, m - 1, d); return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + (b.time != null ? ' · ' + GOAL.timeLabel(b.time) : ''); }
  function renderLower() {
    const sb = sandboxState();
    $('#c-history').textContent = runs.length; $('#c-recipes').textContent = recipes.length; $('#c-bookings').textContent = sb.bookings.length;
    ['history', 'recipes', 'bookings'].forEach((t) => { $('#tab-' + t).setAttribute('aria-pressed', String(t === lowerTab)); $('#tab-' + t).setAttribute('aria-selected', String(t === lowerTab)); });
    const tools = $('#lower-tools'); const body = $('#lower-body');
    if (lowerTab === 'history') {
      tools.innerHTML = runs.length ? '<button type="button" class="small-btn danger" id="runs-clear">Clear runs</button>' : '';
      body.innerHTML = runs.length ? '<div class="list">' + runs.map((r) => '<div class="item" data-id="' + r.id + '"><span class="badge ' + r.status + '">' + esc(REPORT.STATUS[r.status] || r.status) + '</span><div class="grow">' + esc(r.goal) + '<div class="meta">' + esc(r.host) + ' · ' + esc(new Date(r.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + ' · ' + r.steps.filter((s) => s.kind === 'action').length + ' actions' + (r.flags.length ? ' · ⚠ ' + r.flags.length + ' flagged' : '') + (r.confirmation && r.confirmation.code ? ' · ' + esc(r.confirmation.code) : '') + '</div></div><button type="button" class="small-btn" data-a="replay">Replay</button><button type="button" class="small-btn" data-a="md">.md</button><button type="button" class="small-btn danger" data-a="del" aria-label="Delete run">✕</button></div>').join('') + '</div>' : '<div class="empty">Runs appear here with every step, so you can replay them, export a report or turn them into a recipe.</div>';
      $$('.item', body).forEach((el) => bindRunActions(el, runs.find((r) => r.id === el.dataset.id)));
      const c = $('#runs-clear'); if (c) c.onclick = async () => { const old = runs.slice(); runs = []; await RUNSTORE.clear(); renderLower(); toast('Cleared ' + old.length + ' run' + (old.length > 1 ? 's' : '') + '.', async () => { runs = old; for (const r of old) await RUNSTORE.put(r); renderLower(); }); };
    } else if (lowerTab === 'recipes') {
      tools.innerHTML = '<label class="button small-btn" for="rc-import">Import</label><input type="file" id="rc-import" accept=".json,application/json" hidden>' + (recipes.length ? '<button type="button" class="small-btn" id="rc-export">Export all</button>' : '');
      body.innerHTML = recipes.length ? '<div class="list">' + recipes.map((r) => '<div class="item" data-id="' + r.id + '"><div class="grow">' + esc(r.name) + '<div class="meta">' + esc((SITES.find((s) => s.id === r.site) || {}).name || r.site) + ' · ' + r.steps.length + ' steps' + (Object.keys(r.vars || {}).length ? ' · asks for ' + esc(Object.values(r.vars).map((v) => v.label).join(', ')) : '') + '</div></div><button type="button" class="small-btn primary" data-r="run">▶ Run</button><button type="button" class="small-btn" data-r="edit">Edit</button><button type="button" class="small-btn danger" data-r="del" aria-label="Delete recipe">✕</button></div>').join('') + '</div>' : '<div class="empty">Press <b>● Record</b> and use a sandbox site yourself, or save a successful run, to make a reusable recipe with variables.</div>';
      $$('.item', body).forEach((el) => { const r = recipes.find((x) => x.id === el.dataset.id); $$('[data-r]', el).forEach((b) => (b.onclick = () => { if (b.dataset.r === 'run') { if (!current) runRecipe(r); } if (b.dataset.r === 'edit') editRecipe(r); if (b.dataset.r === 'del') { const i = recipes.indexOf(r); recipes.splice(i, 1); ls.set(LS.recipes, recipes); renderLower(); toast('Deleted recipe “' + r.name + '”.', () => { recipes.splice(i, 0, r); ls.set(LS.recipes, recipes); renderLower(); }); } })); });
      const ex = $('#rc-export'); if (ex) ex.onclick = () => { download('formpilot-recipes.json', JSON.stringify({ app: 'FormPilot AI', kind: 'recipes', recipes }, null, 2), 'application/json'); toast('Recipes exported (no keys, no profile values).'); };
      $('#rc-import').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const j = JSON.parse(await f.text()); const list = (j.recipes || (Array.isArray(j) ? j : [])).filter((r) => r && r.name && Array.isArray(r.steps) && SITES.some((s) => s.id === r.site && s.id !== 'runner') && r.steps.every((s) => s && s.target && typeof s.target.name === 'string')); if (!list.length) throw new Error('No valid recipes in that file.'); for (const r of list) { r.id = 'rc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); r.vars = r.vars || {}; recipes.unshift(r); } ls.set(LS.recipes, recipes); renderLower(); toast('Imported ' + list.length + ' recipe' + (list.length > 1 ? 's' : '') + '.'); } catch (er) { toast('Could not import: ' + er.message); } };
    } else {
      tools.innerHTML = sb.bookings.length || Object.keys(sb.taken).length ? '<button type="button" class="small-btn danger" id="sb-reset">Reset sandbox</button>' : '';
      body.innerHTML = sb.bookings.length ? '<div class="list">' + sb.bookings.slice().reverse().map((b) => '<div class="item" data-id="' + esc(b.id) + '"><div class="grow"><b>' + esc(b.title) + '</b><div class="meta">' + esc(fmtWhen(b)) + ' · ' + esc(b.code) + ' · ' + esc(b.name) + ' · ' + esc((SITES.find((s) => s.id === b.site) || {}).host || b.site) + '</div></div>' + (b.date && b.time != null ? '<button type="button" class="small-btn" data-b="ics">.ics</button>' : '') + '<button type="button" class="small-btn danger" data-b="cancel">Cancel</button></div>').join('') + '</div><p class="small muted">These live only in this browser’s storage for the fictional sandbox sites.</p>' : '<div class="empty">Bookings made on the sandbox sites (by the agent or by you) appear here. They are fictional and stored only in this browser.</div>';
      $$('.item', body).forEach((el) => { const b = sb.bookings.find((x) => x.id === el.dataset.id); $$('[data-b]', el).forEach((btn) => (btn.onclick = () => {
        if (btn.dataset.b === 'ics') { const [y, m, d] = b.date.split('-').map(Number); download(REPORT.fileSafe(b.code) + '.ics', ICS.build({ uid: b.code + '@' + ((SITES.find((s) => s.id === b.site) || {}).host || 'sandbox.example'), title: b.title, start: new Date(y, m - 1, d, Math.floor(b.time / 60), b.time % 60), minutes: b.minutes || 60, location: b.location, description: 'Fictional sandbox booking ' + b.code }), 'text/calendar'); toast('Calendar file downloaded.'); }
        if (btn.dataset.b === 'cancel') { const before = sandboxState(); const s = clone(before); s.bookings = s.bookings.filter((x) => x.id !== b.id); for (const k of Object.keys(s.taken)) if (s.taken[k] === b.id) delete s.taken[k]; setSandbox(s); renderLower(); toast('Cancelled ' + b.code + '.', () => { setSandbox(before); renderLower(); }); }
      })); });
      const rs = $('#sb-reset'); if (rs) rs.onclick = () => { const before = localStorage.getItem(LS.sandbox); const cookies = localStorage.getItem('fp.sandbox.clinic.cookies'); localStorage.removeItem(LS.sandbox); localStorage.removeItem('fp.sandbox.clinic.cookies'); renderLower(); if (!current && !recording) loadSite(siteId, { bust: true }); toast('Sandbox reset: bookings and taken slots cleared.', () => { if (before) localStorage.setItem(LS.sandbox, before); if (cookies) localStorage.setItem('fp.sandbox.clinic.cookies', cookies); renderLower(); }); };
    }
  }
  async function deleteRun(id) { const i = runs.findIndex((r) => r.id === id); if (i < 0) return; const [r] = runs.splice(i, 1); await RUNSTORE.del(id); if (modal && modal.name === 'replay') closeModal(true); renderLower(); toast('Deleted the run.', async () => { runs.splice(i, 0, r); await RUNSTORE.put(r); renderLower(); }); }

  /* ---------------- snapshot viewer ---------------- */
  async function showSnapshot() {
    let snap = null; try { snap = current && current.env.kind === 'runner' ? await current.env.snapshot() : siteId === 'runner' ? null : SNAP.take(frame.contentDocument); } catch (e) { toast(e.message); return; }
    if (!snap) { toast('Connect the runner and start a run to see a real page.'); return; }
    const flags = GUARD.scanInjection(snap);
    openModal('What the agent sees', '<p class="small muted" style="margin-top:0">This compact accessibility snapshot (roles, names, values, numbered refs) is all the planner reads. Sensitive fields only say whether they are filled. Hidden text is included because attackers hide instructions there.</p>' + (flags.length ? '<div class="warn-box"><b>' + flags.length + ' possible prompt injection' + (flags.length > 1 ? 's' : '') + ' on this page</b> (treated as data, never followed):<ul style="margin:6px 0 0;padding-left:18px">' + flags.map((f) => '<li>' + esc(f.why) + ' (' + esc(f.where) + '): “' + esc(f.text.slice(0, 160)) + '”</li>').join('') + '</ul></div>' : '') + '<pre class="snap-pre">' + esc(SNAP.render(snap, { includeHidden: true })) + '</pre>', { wide: true, name: 'snapshot' });
  }

  /* ---------------- profile ---------------- */
  function openProfile() {
    const draft = clone(profile); draft.custom = draft.custom || [];
    const f = (k, label, type) => '<div class="field"><label for="pf-' + k + '">' + esc(label) + '</label><input id="pf-' + k + '" data-k="' + k + '" type="' + (type || 'text') + '" value="' + esc(draft[k] || '') + '" autocomplete="off"></div>';
    const customHtml = () => draft.custom.map((c, i) => '<div class="custom-row"><input aria-label="Custom field ' + (i + 1) + ' label" data-cl="' + i + '" value="' + esc(c.label) + '" placeholder="Label, e.g. License plate"><input aria-label="Custom field ' + (i + 1) + ' value" data-cv="' + i + '" value="' + esc(c.value) + '" placeholder="Value"><button type="button" class="small-btn danger" data-crm="' + i + '">Remove</button></div>').join('');
    const collect = () => { $$('[data-k]').forEach((x) => (draft[x.dataset.k] = x.value.trim())); $$('[data-cl]').forEach((x) => (draft.custom[+x.dataset.cl].label = x.value.trim())); $$('[data-cv]').forEach((x) => (draft.custom[+x.dataset.cv].value = x.value.trim())); };
    const mountCustom = () => { $('#pf-custom').innerHTML = customHtml(); $$('[data-crm]').forEach((b) => (b.onclick = () => { collect(); const i = +b.dataset.crm; const [old] = draft.custom.splice(i, 1); mountCustom(); modal.dirty = true; toast('Removed “' + (old.label || 'field') + '”. Save to keep the change.', () => { if (!modal) return; collect(); draft.custom.splice(i, 0, old); mountCustom(); }); })); };
    openModal('Your profile', '<div class="note-box">Stored only in this browser. The agent fills forms from these values and asks you for anything else. Defaults are fictional; use .example emails while trying the sandbox. FormPilot never stores passwords, card numbers or SSNs.</div><div class="prof-grid">' + f('firstName', 'First name') + f('lastName', 'Last name') + f('email', 'Email', 'email') + f('phone', 'Phone', 'tel') + f('dob', 'Date of birth', 'date') + f('street', 'Street address') + f('city', 'City') + f('state', 'State (e.g. TX)') + f('zip', 'ZIP code') + f('insuranceProvider', 'Insurance provider') + f('insuranceMemberId', 'Insurance member ID') + f('emergencyName', 'Emergency contact name') + f('emergencyPhone', 'Emergency contact phone', 'tel') + '</div><h3 style="font-size:14px;margin:6px 0">Custom fields</h3><div id="pf-custom"></div><button type="button" class="small-btn" id="pf-add">+ Add field</button><div class="err" id="pf-err" role="alert"></div>', {
      wide: true, dirty: true, focusFirst: true, saveLabel: 'Save profile', name: 'profile', extraFooter: '<button type="button" id="pf-reset" class="danger">Reset to fictional defaults</button>',
      onmount: () => { mountCustom(); $('#pf-add').onclick = () => { collect(); draft.custom.push({ label: '', value: '' }); mountCustom(); modal.dirty = true; const l = $$('[data-cl]'); l[l.length - 1].focus(); }; $('#pf-reset').onclick = () => { const old = clone(profile); profile = clone(RULES.DEFAULT_PROFILE); ls.set(LS.profile, profile); modal.dirty = false; closeModal(true); toast('Profile reset to the fictional defaults.', () => { profile = old; ls.set(LS.profile, profile); }); }; },
      save: () => { collect(); if (draft.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(draft.email)) { $('#pf-err').textContent = 'That email does not look valid.'; $('#pf-email').focus(); return; } draft.custom = draft.custom.filter((c) => c.label || c.value); profile = draft; ls.set(LS.profile, profile); modal.dirty = false; closeModal(true); toast('Profile saved.'); }
    });
  }
  $('#btn-profile').onclick = openProfile;

  /* ---------------- settings ---------------- */
  function openSettings() {
    const d = clone(settings); const dk = Object.assign({}, keys);
    const provOpts = Object.entries(PROVIDERS).map(([id, p]) => '<option value="' + id + '"' + (id === d.provider ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('');
    openModal('Settings', '<div class="note-box">Your key is stored only in this browser (or only in memory if you untick “Remember”). It is sent only to the provider you pick, in a request header, and never appears in prompts, reports, recipes or exports. The provider receives your goal, the page snapshot and the <i>names</i> of your profile fields; values are filled in locally unless you allow sharing them.</div>' +
      '<h3 style="font-size:14px;margin:0 0 8px">Your AI</h3><div class="row2"><div class="field"><label for="st-prov">Provider</label><select id="st-prov">' + provOpts + '</select></div><div class="field"><label for="st-model">Model</label><input id="st-model" list="st-models" autocomplete="off"><datalist id="st-models"></datalist></div></div>' +
      '<div class="field" id="st-base-f"><label for="st-base">Base URL</label><input id="st-base" type="url" value="' + esc(d.baseUrl || '') + '" placeholder="http://localhost:11434/v1"><div class="help">Presets: ' + LLM.PRESETS.map((p) => '<button type="button" class="small-btn" data-preset="' + p.id + '">' + esc(p.label) + '</button>').join(' ') + '</div></div>' +
      '<div class="field" id="st-key-f"><label for="st-key">API key</label><input id="st-key" type="password" autocomplete="off" spellcheck="false"><div class="help" id="st-key-help"></div></div>' +
      '<label class="inline"><input type="checkbox" id="st-remember"' + (d.remember ? ' checked' : '') + '> Remember keys in this browser</label><br><label class="inline" style="white-space:normal"><input type="checkbox" id="st-share"' + (d.shareValues ? ' checked' : '') + '> Share profile values with the AI (off: it only sees placeholders)</label>' +
      '<div class="row" style="margin:10px 0"><button type="button" class="small-btn" id="st-test">Test connection</button><span id="st-test-out" class="small" role="status"></span></div>' +
      '<h3 style="font-size:14px;margin:14px 0 8px">Agent</h3><div class="row2"><div class="field"><label for="st-max">Maximum steps per run</label><input id="st-max" type="number" min="5" max="200" value="' + d.maxSteps + '"></div><div class="field"><label for="st-speed">Default speed</label><select id="st-speed">' + ['slow', 'normal', 'fast'].map((s) => '<option' + (s === d.speed ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div></div>' +
      '<div class="field"><label for="st-allow">Allowlist of sites (one domain per line; *.example.com allowed)</label><textarea id="st-allow" rows="4" spellcheck="false">' + esc(d.allowlist) + '</textarea><div class="help">The agent stops if a page is not on this list and never follows links to other domains.</div></div>' +
      '<h3 style="font-size:14px;margin:14px 0 8px">Local runner (optional, for real sites)</h3><div class="row2"><div class="field"><label for="st-rurl">Runner URL</label><input id="st-rurl" type="url" value="' + esc(d.runnerUrl) + '"></div><div class="field"><label for="st-rtok">Runner token</label><input id="st-rtok" type="password" autocomplete="off" value="' + esc(d.runnerToken) + '"></div></div><div class="err" id="st-err" role="alert"></div>', {
      wide: true, dirty: true, saveLabel: 'Save settings', name: 'settings',
      onmount: () => {
        const sync = () => { const p = $('#st-prov').value; const P = PROVIDERS[p]; $('#st-model').value = d.models[p] || P.defaultModel; $('#st-models').innerHTML = P.models.map((m) => '<option value="' + esc(m) + '">').join(''); $('#st-base-f').hidden = p !== 'compatible'; $('#st-key-f').hidden = p === 'webllm'; $('#st-key').value = dk[p] || ''; $('#st-key-help').innerHTML = P.keyUrl ? 'Get a key: <a href="' + P.keyUrl + '" target="_blank" rel="noopener">' + esc(P.keyUrl.replace(/^https:\/\//, '')) + '</a>' : p === 'compatible' ? 'Optional for local servers.' : ''; };
        let prev = d.provider; sync();
        $('#st-prov').onchange = () => { d.models[prev] = $('#st-model').value.trim(); dk[prev] = $('#st-key').value.trim(); prev = $('#st-prov').value; sync(); };
        $$('[data-preset]').forEach((b) => (b.onclick = () => { const p = LLM.PRESETS.find((x) => x.id === b.dataset.preset); $('#st-base').value = p.baseUrl; $('#st-model').value = p.model; modal.dirty = true; }));
        $('#st-test').onclick = async () => { const p = $('#st-prov').value; const out = $('#st-test-out'); out.textContent = 'Testing…'; out.style.color = ''; try { if (p === 'webllm') { if (!WEBLLM.available()) throw new Error('WebGPU is not available in this browser, so the in-browser model cannot run here.'); out.textContent = 'WebGPU is available. The model downloads on first use.'; return; } const r = await LLM.call({ provider: p, key: $('#st-key').value.trim(), model: $('#st-model').value.trim() || PROVIDERS[p].defaultModel, baseUrl: p === 'compatible' ? $('#st-base').value.trim() : '' }, { system: 'Reply with the JSON {"ok":true}.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 20, json: true }, { timeoutMs: 30000 }); out.textContent = 'Connected: ' + (r.model || 'ok') + ' replied in ' + r.latencyMs + ' ms.'; out.style.color = 'var(--ok)'; } catch (e) { out.textContent = e.message; out.style.color = 'var(--bad)'; } };
      },
      save: () => {
        const max = +$('#st-max').value; if (!(max >= 5 && max <= 200)) { $('#st-err').textContent = 'Maximum steps must be between 5 and 200.'; $('#st-max').focus(); return; }
        const allow = $('#st-allow').value.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean); const bad = allow.find((x) => !/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(x)); if (bad) { $('#st-err').textContent = '“' + bad + '” is not a domain.'; $('#st-allow').focus(); return; }
        const p = $('#st-prov').value; d.models[p] = $('#st-model').value.trim(); dk[p] = $('#st-key').value.trim();
        Object.assign(settings, { provider: p, models: d.models, baseUrl: $('#st-base').value.trim(), remember: $('#st-remember').checked, shareValues: $('#st-share').checked, maxSteps: max, speed: $('#st-speed').value, allowlist: allow.join('\n'), runnerUrl: $('#st-rurl').value.trim() || DEFAULTS.runnerUrl, runnerToken: $('#st-rtok').value.trim() });
        keys = Object.fromEntries(Object.entries(dk).filter(([, v]) => v)); saveSettings(); if (env.setSpeed) env.setSpeed(settings.speed); modal.dirty = false; closeModal(true); toast('Settings saved.');
      }
    });
  }
  $('#btn-settings').onclick = openSettings;
  $('#runner-connect').onclick = async () => { const r = ENV.runnerEnv({ url: settings.runnerUrl, token: settings.runnerToken }); $('#runner-status').textContent = 'Checking…'; try { const h = await r.health(); $('#runner-status').textContent = 'Connected: runner ' + h.version + (h.dryRun ? ' · dry run on' : '') + (h.headed ? ' · headed' : '') + ' · allows ' + (h.allowlist || []).join(', '); } catch (e) { $('#runner-status').textContent = e.message; } };

  /* ---------------- about ---------------- */
  $('#btn-about').onclick = () => openModal('How FormPilot works, and its limits', '<p><b>Loop.</b> Each step it takes a compact accessibility snapshot of the page (roles, labels, values, numbered refs), plans one action, checks it with the guard, then clicks, types or picks with a visible cursor. Steps are bounded; Stop halts it mid-typing.</p><p><b>Planners.</b> <i>Demo planner</i>: deterministic rules, no key, works on well-labelled forms like the sandbox sites. <i>Your AI</i>: OpenAI, Anthropic, Gemini, any OpenAI-compatible server (OpenRouter, Ollama, LM Studio) or an experimental in-browser WebLLM model. <i>Recipes</i>: replay steps you recorded, with variables.</p><p><b>Safety.</b> It always stops before the final book / submit / pay / send click and shows you everything it will send; declining leaves nothing submitted. It never types passwords, card numbers, SSNs, one-time codes or CAPTCHAs (you do). Instructions found in pages are flagged and ignored, and typed values must come from your profile, goal or answers. It only acts on allowlisted domains. Dry-run mode stops before submitting.</p><h3 style="font-size:15px">Honest limits</h3><ul><li>A static web page cannot control other websites (browsers block cross-site access). Here the agent drives five <b>fictional sandbox sites</b> served by this app. For real sites you need the optional local Playwright runner from the repo. It was tested against the sandbox pages, not against real booking sites.</li><li>The demo planner is rules-based. It handles the sandbox sites and similar well-labelled forms; messy real-world pages need “Your AI”.</li><li>AI mode was tested with mocked replies. Real model quality varies, and small in-browser models are weaker.</li><li>In the sandbox, actions are DOM events, not operating-system input. The runner uses real Playwright input.</li><li>Prompt-injection detection is pattern-based. The main protection is structural: page text is fenced as data, typed values are checked, final steps need your approval and other domains are blocked.</li></ul>', { wide: true, name: 'about' });

  /* ---------------- boot ---------------- */
  async function boot() {
    renderSites(); renderMode(); online();
    try { runs = await RUNSTORE.all(); } catch (e) { runs = []; }
    renderLower();
    if (!$('#goal').value) $('#goal').value = (SAMPLES[siteId] || [''])[0];
    await loadSite(siteId);
    if (!ls.get(LS.visited, false)) { ls.set(LS.visited, true); setTimeout(() => toast('Welcome! Pick a site, try a sample goal and press Run. Nothing real is booked.'), 600); }
    document.body.dataset.ready = '1';
  }
  window.FormPilotApp = { get settings() { return settings; }, get profile() { return profile; }, get current() { return current; }, get lastRun() { return lastRun; }, get runs() { return runs; }, get recipes() { return recipes; }, get recording() { return recording; }, get modal() { return modal; }, get siteId() { return siteId; }, startRun, stopRun, loadSite, sandboxState, icsFor, renderLower, runRecipe, stopRecording };
  boot();
})();
