/* Record your own run on a sandbox site and turn it into a reusable recipe with {{variables}}.
   Targets are stored by role + accessible name (not CSS selectors), so recipes survive re-renders.
   Sensitive fields are recorded as "hand to you" steps; their values are never captured. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./snapshot.js'), require('./planner.js'));
  else root.FormPilotRecorder = factory(root.FormPilotSnapshot, root.FormPilotPlanner);
})(typeof self !== 'undefined' ? self : this, function (SNAP, RULES) {
  'use strict';
  function target(it) { const t = { role: it.role, name: it.name }; if (it.group) t.group = it.group; if (it.dialog) t.dialog = it.dialog; return t; }
  function shortName(it) {
    // calendar/time buttons carry live counts ("..., 6 openings"); keep the stable part
    if (RULES.isDateBtn(it)) { const m = /^([A-Za-z]+day, [A-Za-z]+ \d{1,2}, \d{4})/.exec(it.name); if (m) return m[1]; }
    if (RULES.isSlotBtn(it)) return /^\d{1,2}:\d{2}\s*[AP]M/i.exec(it.name)[0];
    if (it.role === 'radio') return it.name.split(' · ')[0];
    return it.name;
  }
  function start(doc, onStep) {
    const steps = [];
    const find = (el) => { const s = SNAP.take(doc); const ref = el.getAttribute('data-fp-ref'); return s.items.find((x) => x.ref === ref); };
    const push = (st) => { const last = steps[steps.length - 1]; if (last && last.type === st.type && last.target.name === st.target.name && last.target.role === st.target.role && (st.type === 'type' || st.type === 'select')) { last.value = st.value; } else steps.push(st); if (onStep) onStep(st, steps); };
    function onClick(e) {
      const el = e.target.closest('button,a[href],[role=button],input[type=radio],input[type=checkbox],input[type=submit]'); if (!el || !e.isTrusted) return;
      const it = find(el); if (!it) return;
      if (it.role === 'checkbox') return; // handled on change
      const t = target(it); t.name = shortName(it);
      push({ type: 'click', target: t });
    }
    function onChange(e) {
      const el = e.target; if (!e.isTrusted && !el.matches('select')) return;
      const it = find(el); if (!it) return;
      if (it.role === 'checkbox') { push({ type: el.checked ? 'check' : 'uncheck', target: target(it) }); return; }
      if (it.role === 'radio') return;
      if (it.sensitive) { push({ type: 'handoff', kind: it.sensitive, target: target(it) }); return; }
      if (it.role === 'combobox') { push({ type: 'select', target: target(it), value: it.value }); return; }
      if (it.role === 'textbox') push({ type: 'type', target: target(it), value: el.value });
    }
    doc.addEventListener('click', onClick, true); doc.addEventListener('change', onChange, true);
    return { steps, stop() { doc.removeEventListener('click', onClick, true); doc.removeEventListener('change', onChange, true); return steps; } };
  }
  /* Suggest variables: profile values become {{profile.x}}; dates/times become {{date}} / {{time}}. */
  function suggest(steps, profile) {
    const p = profile || {}; const vars = {}; const out = JSON.parse(JSON.stringify(steps));
    const pv = []; for (const [k, v] of Object.entries(p)) if (k !== 'custom' && v) pv.push([k, String(v)]); if (p.firstName && p.lastName) pv.push(['fullName', p.firstName + ' ' + p.lastName]);
    if (p.dob) { const [y, m, d] = p.dob.split('-'); pv.push(['dobUS', m + '/' + d + '/' + y]); }
    for (const st of out) {
      if (st.type === 'type' && st.value) { const hit = pv.find(([, v]) => v === st.value); if (hit) { st.value = '{{profile.' + hit[0] + '}}'; continue; } }
      if (st.type === 'click' && st.target.role === 'button' && RULES.isDateBtn({ role: 'button', name: st.target.name })) { vars.date = { label: 'Date', type: 'date', example: st.target.name }; st.target.name = '{{date}}'; delete st.target.group; }
      else if (st.type === 'click' && RULES.isSlotBtn({ role: 'button', name: st.target.name })) { vars.time = { label: 'Time (e.g. 4:00 PM)', type: 'text', example: st.target.name }; st.target.name = '{{time}}'; delete st.target.group; } // the slot group names the old date
    }
    return { steps: out, vars };
  }
  function longDate(isoStr) { const [y, m, d] = String(isoStr).split('-').map(Number); const dt = new Date(y, m - 1, d); return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getDay()] + ', ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear(); }
  function varsFor(recipe, values, profile) {
    const out = {}; const p = profile || {};
    for (const [k, v] of Object.entries(p)) if (k !== 'custom' && v) out['profile.' + k] = String(v);
    if (p.firstName || p.lastName) out['profile.fullName'] = [p.firstName, p.lastName].filter(Boolean).join(' ');
    if (p.dob) { const [y, m, d] = p.dob.split('-'); out['profile.dobUS'] = m + '/' + d + '/' + y; }
    for (const [k, def] of Object.entries(recipe.vars || {})) { const v = values[k]; out[k] = def.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? longDate(v) : v; }
    return out;
  }
  /* Turn a finished agent run into recipe steps (successful actions only). */
  function fromRun(run) {
    const steps = [];
    for (const s of run.steps || []) { if (s.kind !== 'action' || !s.ok || !s.target || !s.role || s.type === 'scroll') continue; const it = { role: s.role, name: s.target }; const t = { role: s.role, name: shortName(it) }; if (s.group && s.role !== 'radio') t.group = s.group; const st = { type: s.type === 'submit' ? 'click' : s.type, target: t }; if (s.type === 'type' || s.type === 'select') st.value = s.value; steps.push(st); }
    return steps;
  }
  return { start, suggest, varsFor, longDate, shortName, target, fromRun };
});
