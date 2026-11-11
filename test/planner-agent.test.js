const test = require('node:test'); const assert = require('node:assert');
const G = require('../js/goal.js'); const P = require('../js/planner.js'); const AGENT = require('../js/agent.js'); const { fixture, TODAY } = require('./helpers.cjs');
const ctxFor = (goalText, site, extra) => Object.assign({ goalText, goal: G.parse(goalText, TODAY, site), profile: JSON.parse(JSON.stringify(P.DEFAULT_PROFILE)), answers: {}, filled: {}, flags: [], history: [], events: [] }, extra || {});
const nameOf = (snap, ref) => (snap.items.find((x) => x.ref === ref) || {}).name;

test('planner: dental first step picks the cleaning service from the goal', async () => {
  const snap = fixture('dental-service'); const d = P.decide(snap, ctxFor('Book a cleaning with Dr. Patel next Tuesday after 3pm', 'dental'));
  assert.equal(d.action.type, 'click'); assert.match(nameOf(snap, d.action.ref), /^Cleaning/);
});
test('planner: cookie wall is rejected before anything else', () => {
  const snap = fixture('clinic-cookies'); const d = P.decide(snap, ctxFor('Save me a spot at QuickCare Maplewood Center this evening for a flu shot', 'clinic'));
  assert.equal(d.action.type, 'click'); assert.match(nameOf(snap, d.action.ref), /reject/i);
});
test('planner: RSVP picks a Friday session that matches the goal', () => {
  const snap = fixture('rsvp-sessions'); const d = P.decide(snap, ctxFor('RSVP for 4 to the Harvest Lantern Supper on Friday, one vegetarian', 'rsvp'));
  assert.equal(d.action.type, 'click'); assert.match(nameOf(snap, d.action.ref), /Friday, November 13/);
});
test('planner: a full session (seat error) triggers a re-plan to another matching session', () => {
  const snap = JSON.parse(JSON.stringify(fixture('rsvp-sessions'))); const ctx = ctxFor('RSVP for 4 to the Harvest Lantern Supper on Friday, one vegetarian', 'rsvp');
  const first = snap.items.find((x) => x.ref === P.decide(snap, ctx).action.ref);
  first.checked = true; snap.items.push({ role: 'alert', name: 'Only 2 seats left for Harvest Lantern Supper on ' + first.name.split(' · ').slice(0, 2).join(' · ') + '. Choose another time or a smaller party.' });
  let d = P.decide(snap, ctx); let guard = 0;
  while (d.action.type !== 'click' || !/Friday/.test(nameOf(snap, d.action.ref) || '')) { if (++guard > 5) break; const it = snap.items.find((x) => x.ref === d.action.ref); if (it && d.action.type === 'type') it.value = d.action.value; d = P.decide(snap, ctx); }
  const pick = nameOf(snap, d.action.ref);
  assert.match(pick, /Friday, November 13/); assert.notEqual(pick, first.name);
});
test('planner: validation error with an example gets reformatted (phone)', () => {
  const snap = fixture('permit-phone-error'); const ctx = ctxFor('Apply for a block party permit on Elm Street for Saturday after next from 2pm to 8pm, about 40 people', 'permit');
  const d = P.decide(snap, ctx);
  assert.equal(d.action.type, 'type'); assert.equal(d.action.value, '(214) 555-0142');
  // after the fix is typed the stale error is ignored until the form is re-submitted
  const phone = snap.items.find((x) => x.ref === d.action.ref); const snap2 = JSON.parse(JSON.stringify(snap)); snap2.items.find((x) => x.ref === phone.ref).value = '(214) 555-0142';
  const d2 = P.decide(snap2, ctx); assert.equal(d2.action.type, 'click'); assert.match(nameOf(snap2, d2.action.ref), /Next/);
});
test('planner: fixByError handles dates, ZIPs and upper case', () => {
  assert.equal(P.fixByError('1994-03-08', { error: 'Use MM/DD/YYYY.' }), '03/08/1994');
  assert.equal(P.fixByError('75099-1234', { error: 'Enter a 5-digit ZIP code.' }), '75099');
  assert.equal(P.fixByError('tx 12ab', { error: 'Use capital letters.' }), 'TX 12AB');
  assert.equal(P.fixByError('2145550142', { error: 'Enter the phone number as (555) 555-0123.' }), '(214) 555-0142');
});
test('planner: salon card fields become one grouped hand-off', () => {
  const snap = JSON.parse(JSON.stringify(fixture('salon-form'))); const ctx = ctxFor("Book a men's haircut with Theo this Saturday morning", 'salon');
  // pretend everything non-sensitive is already done
  for (const it of snap.items) if (it.ref && it.role === 'textbox' && !it.sensitive) it.value = 'x';
  for (const it of snap.items) if (it.ref && it.role === 'combobox') it.value = it.options[1];
  for (const it of snap.items) if (it.ref && it.role === 'radio') it.checked = /Theo/.test(it.name);
  for (const it of snap.items) if (it.ref && it.role === 'button' && /AM|PM/.test(it.name)) it.pressed = true;
  for (const it of snap.items) if (it.ref && it.role === 'button' && /day|, 20\d\d/i.test(it.name)) it.pressed = true;
  ctx.tried = {}; const d = P.decide(snap, ctx);
  if (d.action.type === 'handoff') { assert.ok(d.action.fields.length >= 3, d.action.fields.join(', ')); assert.ok(d.action.kinds.every((k) => k === 'card')); }
  else assert.notEqual(d.action.type, 'type', 'never types into a card field');
});
test('planner: required field with no source asks instead of inventing', () => {
  const snap = { url: 'https://x.example/', host: 'brightsmile-dental.example', title: 't', items: [{ ref: 'e1', role: 'textbox', name: 'Emergency contact name *', required: true, value: '' }, { ref: 'e2', role: 'button', name: 'Continue' }] };
  const ctx = ctxFor('book a checkup', 'dental'); ctx.profile.emergencyName = '';
  const d = P.decide(snap, ctx); assert.equal(d.action.type, 'ask'); assert.match(d.action.question, /Emergency contact name/);
});

/* ---- agent loop against a tiny fake env ---- */
function fakeEnv() {
  const state = { name: '', submitted: false, acted: [] };
  return {
    state,
    async snapshot() {
      if (state.submitted) return { url: 'https://brightsmile-dental.example/done', host: 'brightsmile-dental.example', title: 'Done', items: [{ role: 'heading', name: "You're booked!" }, { role: 'text', name: 'Confirmation code BSD-ABC123' }] };
      return { url: 'https://brightsmile-dental.example/details', host: 'brightsmile-dental.example', title: 'Details', items: [{ ref: 'e1', role: 'textbox', name: 'First name *', required: true, value: state.name }, { ref: 'e2', role: 'button', name: 'Book appointment' }] };
    },
    async act(a, o) { state.acted.push(a.type + ':' + a.ref + (o && o.approved ? ':approved' : '')); if (a.ref === 'e1') state.name = a.value; if (a.ref === 'e2') state.submitted = true; return { ok: true }; }
  };
}
const runWith = (env, hooks, settings, signal) => AGENT.run({ env, planner: P.create(), goalText: 'book a checkup', goal: G.parse('book a checkup', TODAY, 'dental'), profile: P.DEFAULT_PROFILE, signal, settings: Object.assign({ maxSteps: 20 }, settings || {}), hooks });

test('agent: approval gate — declining submits nothing', async () => {
  const env = fakeEnv(); let summary = null;
  const r = await runWith(env, { approve: async (s) => { summary = s; return false; } });
  assert.equal(r.status, 'declined'); assert.equal(env.state.submitted, false);
  assert.ok(!env.state.acted.some((x) => x.startsWith('click:e2') || x.startsWith('submit')));
  assert.equal(summary.button, 'Book appointment'); assert.ok(summary.fields.some((f) => f.value === 'Jordan'));
});
test('agent: approving submits once and captures the confirmation', async () => {
  const env = fakeEnv();
  const r = await runWith(env, { approve: async () => true });
  assert.equal(r.status, 'success'); assert.equal(r.confirmation.code, 'BSD-ABC123'); assert.ok(env.state.acted.includes('click:e2:approved'));
});
test('agent: dry run stops before the final click', async () => {
  const env = fakeEnv(); let reviewed = false;
  const r = await runWith(env, { dryRunReview: async () => { reviewed = true; }, approve: async () => true }, { dryRun: true });
  assert.equal(r.status, 'dry-run'); assert.ok(reviewed); assert.equal(env.state.submitted, false);
});
test('agent: Stop aborts immediately', async () => {
  const env = fakeEnv(); const c = new AbortController();
  const r = await runWith(env, { approve: () => new Promise(() => {}), onStep: (s) => { if (s.kind === 'gate') c.abort(); } }, {}, c.signal);
  assert.equal(r.status, 'stopped'); assert.equal(env.state.submitted, false);
});
test('agent: pages off the allowlist stop the run', async () => {
  const env = fakeEnv(); env.snapshot = async () => ({ url: 'https://evil.example/', host: 'evil.example', title: 'x', items: [] });
  const r = await runWith(env, {}); assert.equal(r.status, 'failed'); assert.match(r.reason, /allowlist/);
});
