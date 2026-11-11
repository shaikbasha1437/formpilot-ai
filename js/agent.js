/* FormPilot agent loop: snapshot -> plan -> guard -> (ask | hand off | approve) -> act, step by step.
   Planner- and environment-agnostic: the same loop drives the sandbox iframe and the optional local
   runner, with the rules planner, a model, or a saved recipe. Bounded steps; Stop halts immediately. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./snapshot.js'), require('./guard.js'), require('./planner.js'), require('./goal.js'));
  else root.FormPilotAgent = factory(root.FormPilotSnapshot, root.FormPilotGuard, root.FormPilotPlanner, root.FormPilotGoal);
})(typeof self !== 'undefined' ? self : this, function (SNAP, GUARD, RULES, G) {
  'use strict';
  /* Waiting on the human (question, hand-off, approval) still ends the moment Stop is pressed. */
  const untilStop = (p, signal) => !signal ? Promise.resolve(p) : new Promise((res, rej) => { if (signal.aborted) return rej(stopErr()); const on = () => rej(stopErr()); signal.addEventListener('abort', on, { once: true }); Promise.resolve(p).then((v) => { signal.removeEventListener('abort', on); res(v); }, (e) => { signal.removeEventListener('abort', on); rej(e); }); });
  const sleep = (ms, signal) => new Promise((res, rej) => { if (signal && signal.aborted) return rej(stopErr()); const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(stopErr()); }, { once: true }); });
  function stopErr() { const e = new Error('Stopped by you.'); e.stopped = true; return e; }
  function describe(a, it) {
    const n = it ? '"' + it.name + '"' : a.ref ? '[' + a.ref + ']' : '';
    switch (a.type) {
      case 'click': case 'submit': return 'Click ' + n; case 'type': return 'Type into ' + n; case 'select': return 'Choose "' + a.value + '" in ' + n;
      case 'check': return 'Tick ' + n; case 'uncheck': return 'Untick ' + n; case 'scroll': return 'Scroll' + (n ? ' to ' + n : ''); case 'wait': return 'Wait';
      case 'ask': return 'Ask you'; case 'handoff': return 'Hand over to you'; case 'done': return 'Done'; case 'fail': return 'Give up'; case 'navigate': return 'Go to ' + a.url; default: return a.type;
    }
  }
  function sourcesFor(ctx) {
    const p = ctx.profile || {}; const out = [ctx.goalText];
    for (const [k, v] of Object.entries(p)) if (k !== 'custom' && v) out.push(String(v));
    for (const c of p.custom || []) if (c.value) out.push(String(c.value));
    if (p.firstName || p.lastName) out.push([p.firstName, p.lastName].filter(Boolean).join(' '));
    const dates = [p.dob]; const g = ctx.goal || {}; if (g.date && g.date.iso) dates.push(g.date.iso); if (g.date && g.date.from) dates.push(g.date.from);
    for (const d of dates.filter(Boolean)) { const [y, m, dd] = String(d).split('-'); if (dd) out.push(d, m + '/' + dd + '/' + y, dd + '/' + m + '/' + y, m + dd + y); }
    if (g.count) out.push(String(g.count));
    for (const v of Object.values(ctx.answers || {})) out.push(String(v));
    return out;
  }
  /* Data for the canvas thumbnail: element boxes, with the target marked. */
  function rects(snap, ref) {
    const vy = snap.viewport ? snap.viewport.scrollY : 0;
    return { w: snap.viewport ? snap.viewport.w : 800, h: snap.viewport ? snap.viewport.h : 600, y: vy, boxes: (snap.items || []).filter((x) => x.bbox && x.bbox.w > 0).slice(0, 160).map((x) => [x.bbox.x, x.bbox.y, x.bbox.w, x.bbox.h, x.ref ? (x.role === 'button' || x.role === 'link' ? 'b' : x.role === 'textbox' || x.role === 'combobox' ? 'f' : x.role === 'radio' || x.role === 'checkbox' ? 'c' : 'o') : x.role === 'heading' ? 'h' : x.role === 'alert' ? 'a' : 't', x.ref && x.ref === ref ? 1 : 0]) };
  }
  function pairs(snap) { return (snap.items || []).filter((x) => x.pair).map((x) => x.pair); }
  /* What the user approves: every value the agent entered or chose, plus the site's own review list. */
  function buildSummary(ctx, snap, target) {
    const fields = Object.values(ctx.filled);
    for (const h of ctx.handedOff || []) fields.push({ label: h, value: '(entered by you, not seen or stored by FormPilot)', source: 'you' });
    return { host: snap.host, url: snap.url, title: snap.title, button: target ? target.name : 'Submit', fields, pagePairs: pairs(snap), flags: ctx.flags.length, dryRun: !!ctx.dryRun };
  }
  function confirmationFrom(snap, goal) {
    const texts = (snap.items || []).filter((x) => !x.ref).map((x) => x.name);
    const heading = texts.find((t) => RULES.DONE_RE.test(t)) || (snap.items || []).find((x) => x.role === 'heading') && (snap.items || []).find((x) => x.role === 'heading').name || '';
    let code = null; for (const t of texts) { const m = /\b([A-Z]{2,4}-[A-Z0-9]{4,10})\b/.exec(t); if (m) { code = m[1]; break; } }
    const pr = pairs(snap); const get = (re) => { const p = pr.find(([k]) => re.test(k)); return p ? p[1] : null; };
    const dateIso = RULES.parseLongDate(get(/^date$|^when$|^day$/i) || '', goal && goal.today);
    const tStr = get(/^time$|^arrival|^when$/i); const times = tStr ? RULES.timesIn(tStr) : [];
    const title = get(/service|event|reason|permit type|appointment/i);
    const who = get(/dentist|stylist|doctor|provider|with/i);
    return { heading, code, pairs: pr, url: snap.url, host: snap.host, siteTitle: snap.title, date: dateIso, start: times.length ? times[0] : null, end: times.length > 1 ? times[1] : null, title: title ? title + (who ? ' with ' + who : '') : null, location: get(/^where$|location|address/i), at: new Date().toISOString() };
  }
  /* opts: { env, planner, goalText, goal, profile, settings:{dryRun,maxSteps,allowlist}, hooks, signal } */
  async function run(opts) {
    const o = opts; const s = o.settings || {}; const hooks = o.hooks || {}; const signal = o.signal;
    const ctx = { goalText: o.goalText, goal: o.goal || G.parse(o.goalText, new Date()), profile: o.profile, answers: Object.assign({}, o.answers || {}), filled: {}, flags: [], history: [], events: [], handedOff: [], dryRun: !!s.dryRun };
    const out = { status: 'running', steps: [], flags: ctx.flags, ctx, startedAt: new Date().toISOString() };
    const seenFlags = new Set(); let lastSig = ''; let same = 0; let blocked = 0; let waits = 0;
    const log = (entry) => { entry.n = out.steps.length + 1; entry.at = Date.now(); out.steps.push(entry); if (hooks.onStep) hooks.onStep(entry, out); return entry; };
    const finish = (status, reason, extra) => { out.status = status; out.reason = reason || ''; out.endedAt = new Date().toISOString(); Object.assign(out, extra || {}); out.filled = Object.values(ctx.filled); out.answers = Object.keys(ctx.answers); if (hooks.onEnd) hooks.onEnd(out); return out; };
    const maxSteps = Math.max(5, Math.min(200, s.maxSteps || 60));
    try {
      for (let i = 0; i < maxSteps + 40; i++) {
        if (signal && signal.aborted) throw stopErr();
        if (out.steps.filter((x) => x.kind === 'action').length >= maxSteps) return finish('failed', 'Reached the limit of ' + maxSteps + ' steps without finishing.');
        const snap = await o.env.snapshot();
        if (signal && signal.aborted) throw stopErr();
        if (!GUARD.hostAllowed(snap.host, s.allowlist)) return finish('failed', 'The page is on ' + (snap.host || 'an unknown site') + ', which is not on your allowlist. FormPilot stopped.');
        for (const f of GUARD.scanInjection(snap)) { if (seenFlags.has(f.text)) continue; seenFlags.add(f.text); ctx.flags.push(f); log({ kind: 'flag', text: 'Ignored instructions found in the page (' + f.where + '): "' + f.text.slice(0, 220) + '" — ' + f.why + '. FormPilot treats page text as data only.', flag: f }); }
        let d;
        try { d = await untilStop(o.planner.next(snap, ctx), signal); } catch (e) { if (e && e.stopped) throw e; return finish('error', e.message || String(e)); }
        if (signal && signal.aborted) throw stopErr();
        for (const ev of ctx.events.splice(0)) log({ kind: ev.type === 'replan' ? 'replan' : 'note', text: ev.text });
        const a = d.action || { type: 'fail', reason: 'No action.' };
        const it = a.ref ? (snap.items || []).find((x) => x.ref === a.ref) : null;
        if (a.type === 'wait') { if (++waits > 40) return finish('failed', 'The page never finished loading.'); await sleep(a.ms || 300, signal); continue; }
        if (a.type === 'done') { const conf = confirmationFrom(snap, ctx.goal); log({ kind: 'done', thought: d.thought, text: 'Confirmation captured' + (conf.code ? ': ' + conf.code : '') + '.', snapshot: SNAP.render(snap), rects: rects(snap) }); return finish('success', conf.heading, { confirmation: conf }); }
        if (a.type === 'fail') { log({ kind: 'fail', thought: d.thought, text: a.reason || 'Could not continue.', snapshot: SNAP.render(snap), rects: rects(snap) }); return finish('failed', a.reason || d.thought); }
        if (a.type === 'ask') {
          log({ kind: 'ask', thought: d.thought, text: a.question });
          const ans = await untilStop(hooks.ask ? hooks.ask(a, ctx) : null, signal);
          if (signal && signal.aborted) throw stopErr();
          if (ans == null || ans === false) return finish('stopped', 'You stopped the run at a question.');
          const val = typeof ans === 'object' ? ans.value : ans;
          ctx.answers[a.key || a.question] = val; log({ kind: 'answer', text: 'You answered: ' + (String(val).length > 120 ? String(val).slice(0, 120) + '…' : val) });
          if (typeof ans === 'object' && ans.saveAs && hooks.saveToProfile) hooks.saveToProfile(ans.saveAs, val);
          ctx.history.push('asked the user: ' + a.question + ' → answered');
          continue;
        }
        if (a.type === 'handoff') {
          log({ kind: 'handoff', thought: d.thought, text: 'Your turn: ' + (a.fields || []).join(', ') });
          if (o.env.highlight) await o.env.highlight(a.refs || [a.ref], 'human');
          const ok = await untilStop(hooks.handoff ? hooks.handoff(a, ctx) : false, signal);
          if (o.env.clearHighlight) o.env.clearHighlight();
          if (signal && signal.aborted) throw stopErr();
          if (!ok) return finish('stopped', 'You stopped the run instead of filling the sensitive field.');
          for (const f of a.fields || []) if (!ctx.handedOff.includes(f)) ctx.handedOff.push(f);
          log({ kind: 'note', text: 'You filled ' + (a.fields || []).join(', ') + '. FormPilot did not read or store it.' });
          ctx.history.push('handed ' + (a.fields || []).join(', ') + ' to the user → filled');
          continue;
        }
        const chk = GUARD.checkAction(a, snap, { allowlist: s.allowlist, sources: sourcesFor(ctx) });
        if (!chk.ok) {
          log({ kind: 'blocked', thought: d.thought, text: chk.reason, action: describe(a, it) });
          ctx.lastResult = 'BLOCKED by FormPilot: ' + chk.reason; ctx.history.push(describe(a, it) + ' → blocked: ' + chk.reason);
          if (chk.kind === 'sensitive') { const h = { type: 'handoff', ref: a.ref, refs: [a.ref], fields: [it.name], kinds: [chk.sensitive] }; log({ kind: 'handoff', text: 'Your turn: ' + it.name }); if (o.env.highlight) await o.env.highlight([a.ref], 'human'); const ok = await untilStop(hooks.handoff ? hooks.handoff(h, ctx) : false, signal); if (o.env.clearHighlight) o.env.clearHighlight(); if (!ok) return finish('stopped', 'You stopped the run instead of filling the sensitive field.'); ctx.handedOff.push(it.name); }
          if (++blocked > 6) return finish('failed', 'Too many blocked actions; stopping for safety.');
          continue;
        }
        if (chk.kind === 'final' || a.type === 'submit') {
          const summary = buildSummary(ctx, snap, it);
          log({ kind: 'gate', thought: d.thought, text: (s.dryRun ? 'Dry run: would click ' : 'Waiting for your approval to click ') + '"' + (it ? it.name : 'submit') + '".', summary });
          if (s.dryRun) { if (hooks.dryRunReview) await untilStop(hooks.dryRunReview(summary), signal).catch(() => {}); return finish('dry-run', 'Dry run finished before "' + (it ? it.name : 'submit') + '". Nothing was submitted.', { summary }); }
          const ok = await untilStop(hooks.approve ? hooks.approve(summary, ctx) : false, signal);
          if (signal && signal.aborted) throw stopErr();
          if (!ok) { log({ kind: 'declined', text: 'You declined. Nothing was submitted.' }); return finish('declined', 'You declined the final step. Nothing was submitted.', { summary }); }
          log({ kind: 'approved', text: 'You approved "' + (it ? it.name : 'submit') + '".' });
          out.approvedSummary = summary;
        }
        const sig = a.type + '|' + (it ? it.name : a.ref) + '|' + (a.value || '') + '|' + snap.url;
        same = sig === lastSig ? same + 1 : 0; lastSig = sig;
        if (same >= 3) return finish('failed', 'The agent repeated the same action 4 times without progress: ' + describe(a, it) + '.');
        const step = log({ kind: 'action', thought: d.thought, action: describe(a, it), type: a.type, target: it ? it.name : null, role: it ? it.role : null, group: it && it.group ? it.group : undefined, value: a.type === 'type' || a.type === 'select' ? GUARD.mask(it, a.value) : undefined, snapshot: SNAP.render(snap), rects: rects(snap, a.ref), url: snap.url });
        const res = await o.env.act(Object.assign({}, a, { type: a.type === 'submit' ? 'click' : a.type }), { signal, approved: chk.kind === 'final' });
        step.result = res.ok ? 'ok' : res.error; step.ok = !!res.ok;
        if (!res.ok && res.dryRun) { if (hooks.onStepUpdate) hooks.onStepUpdate(step, out); return finish('dry-run', res.error || 'The runner is in dry-run mode, so nothing was submitted.'); }
        if (hooks.onStepUpdate) hooks.onStepUpdate(step, out);
        ctx.lastResult = res.ok ? 'ok' : 'error: ' + res.error;
        ctx.history.push(describe(a, it) + (a.value && !(it && it.sensitive) ? ' = "' + String(a.value).slice(0, 60) + '"' : '') + ' → ' + (res.ok ? 'ok' : res.error));
        if (res.ok && d.meta && d.meta.key) ctx.filled[d.meta.key] = { label: d.meta.label, value: d.meta.value, source: d.meta.source };
      }
      return finish('failed', 'Too many steps.');
    } catch (e) {
      if (e && e.stopped) { log({ kind: 'stopped', text: 'Stopped by you. The agent took no further actions.' }); return finish('stopped', 'Stopped by you.'); }
      return finish('error', e && e.message ? e.message : String(e));
    }
  }
  /* Recipe planner: replays recorded steps by role + accessible name (with {{variables}}). */
  function recipePlanner(recipe, vars) {
    let i = 0; let misses = 0;
    const sub = (s) => String(s == null ? '' : s).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    const low = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return {
      name: 'recipe', label: 'Recipe: ' + recipe.name,
      async next(snap, ctx) {
        if (i >= recipe.steps.length) { const doneText = (snap.items || []).find((x) => !x.ref && RULES.DONE_RE.test(x.name)); return doneText ? { thought: 'All recipe steps ran and the site confirms.', action: { type: 'done' } } : misses++ < 6 ? { thought: 'Waiting for the confirmation page.', action: { type: 'wait', ms: 300 } } : { thought: 'Recipe finished.', action: { type: 'done' } }; }
        const st = recipe.steps[i];
        const name = low(sub(st.target.name));
        const cands = (snap.items || []).filter((x) => x.ref && x.role === st.target.role && !x.dialog === !st.target.dialog && (low(x.name) === name || low(x.name).startsWith(name + ',') || low(x.name).startsWith(name + ' ·') || (name.length > 6 && low(x.name).startsWith(name))) && (!st.target.group || low(x.group) === low(st.target.group) || /\{\{/.test(st.target.group || '')));
        const it = cands.find((x) => !x.disabled) || cands[0];
        if (!it) { if (misses++ < 12) return { thought: 'Waiting for "' + sub(st.target.name) + '" (step ' + (i + 1) + ').', action: { type: 'wait', ms: 250 } }; return { thought: 'Step ' + (i + 1) + ' target not found.', action: { type: 'fail', reason: 'Recipe step ' + (i + 1) + ': could not find ' + st.target.role + ' "' + sub(st.target.name) + '" on the page.' } }; }
        misses = 0; i++;
        if (st.type === 'handoff') return { thought: 'Recorded as a sensitive field: your turn.', action: { type: 'handoff', ref: it.ref, refs: [it.ref], fields: [it.name], kinds: [it.sensitive || st.kind] } };
        const val = sub(st.value);
        const meta = st.type === 'type' || st.type === 'select' ? { key: RULES.fieldKey(it), label: it.name, value: val, source: /\{\{/.test(st.value || '') ? 'recipe variable' : 'recipe' } : it.role === 'radio' ? { key: 'choice:' + (it.group || it.field), label: it.group || it.field || 'Option', value: it.name, source: 'recipe' } : st.type === 'check' ? { key: RULES.fieldKey(it), label: it.name, value: 'Yes (ticked)', source: 'recipe' } : {};
        return { thought: 'Recipe step ' + i + ' of ' + recipe.steps.length + '.', action: { type: st.type, ref: it.ref, value: val, clear: true }, meta };
      }
    };
  }
  return { run, recipePlanner, buildSummary, confirmationFrom, sourcesFor, rects, describe, sleep };
});
