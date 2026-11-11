const test = require('node:test'); const assert = require('node:assert');
const ICS = require('../js/ics.js'); const REPORT = require('../js/report.js'); const REC = require('../js/recorder.js'); const P = require('../js/planner.js'); const F = require('../sandbox/common.js'); const { TODAY } = require('./helpers.cjs');

test('ics: valid calendar with CRLF, folding, UTC times and an alarm', () => {
  const t = ICS.build({ uid: 'BSD-ABC123@brightsmile-dental.example', title: 'Cleaning with Dr. Asha Patel; bring X-rays, please', start: new Date(2026, 10, 17, 16, 0), minutes: 45, location: 'BrightSmile Dental, 120 Harbor Way, Maplewood', description: 'Booked by FormPilot AI on brightsmile-dental.example (fictional sandbox). Confirmation: BSD-ABC123. '.repeat(3) });
  assert.ok(t.startsWith('BEGIN:VCALENDAR\r\n')); assert.ok(t.trim().endsWith('END:VCALENDAR'));
  assert.ok(!/[^\r]\n/.test(t), 'only CRLF line endings');
  for (const line of t.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'line too long: ' + line);
  assert.match(t, /DTSTART:\d{8}T\d{6}Z/); assert.match(t, /BEGIN:VALARM/); assert.match(t, /SUMMARY:Cleaning with Dr\. Asha Patel\\; bring X-rays\\, please/);
  const ev = ICS.parse(t).event; assert.equal(ev.SUMMARY, 'Cleaning with Dr. Asha Patel; bring X-rays, please');
  const start = new Date(2026, 10, 17, 16, 0); assert.equal(ICS.utc(start), start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')); assert.equal(ev.DTSTART, ICS.utc(start)); assert.equal(ev.DTEND, ICS.utc(new Date(start.getTime() + 45 * 60000)));
});
const RUN = { id: 'r1', goal: 'Book a cleaning | with Dr. Patel', host: 'brightsmile-dental.example', sandbox: true, mode: 'rules', plannerLabel: 'Demo planner', status: 'success', reason: "You're booked!", startedAt: '2026-11-11T15:00:00.000Z', endedAt: '2026-11-11T15:01:00.000Z',
  steps: [{ n: 1, kind: 'action', action: 'Click "Cleaning"', thought: 'goal mentions cleaning', ok: true, type: 'click', role: 'radio', target: 'Cleaning · 45 min', rects: { w: 800, h: 600, y: 0, boxes: [[10, 10, 100, 20, 'b', 1]] } }, { n: 2, kind: 'flag', text: 'Ignored instructions' }, { n: 3, kind: 'action', action: 'Type into "Card number"', value: '(payment card entered by you, not recorded)', ok: true, type: 'handoff' }],
  flags: [{ text: 'ignore previous instructions', where: 'hidden text', why: 'tries to override' }], filled: [{ label: 'Email', value: 'jordan.rivera@mail.example', source: 'profile' }], confirmation: { heading: "You're booked!", code: 'BSD-ABC123', pairs: [['Date', 'Tuesday, November 17, 2026']] } };
test('report: markdown has steps, flags, confirmation and escapes table pipes; JSON round-trips', () => {
  const md = REPORT.markdown(RUN, () => 'data:image/png;base64,AAAA');
  assert.match(md, /BSD-ABC123/); assert.match(md, /Click "Cleaning"/); assert.match(md, /hidden text/i); assert.match(md, /Book a cleaning \\\| with/);
  assert.match(md, /!\[[^\]]*\]\(data:image\/png;base64,AAAA\)/);
  const j = JSON.parse(REPORT.json(RUN)); assert.equal(j.confirmation.code, 'BSD-ABC123');
  assert.ok(!/sk-|apiKey|"key"/i.test(REPORT.json(RUN) + md), 'no key fields in exports');
  assert.equal(REPORT.fileSafe('Book a cleaning | with Dr. Patel!'), 'book-a-cleaning-with-dr-patel');
});
test('recorder: profile values, dates and slots become variables', () => {
  const steps = [{ type: 'click', target: { role: 'button', name: 'Tuesday, November 17, 2026, 10 openings' } }, { type: 'click', target: { role: 'button', name: '4:00 PM' } }, { type: 'type', target: { role: 'textbox', name: 'Email' }, value: 'jordan.rivera@mail.example' }, { type: 'type', target: { role: 'textbox', name: 'Date of birth' }, value: '03/08/1994' }, { type: 'type', target: { role: 'textbox', name: 'Notes' }, value: 'side entrance' }];
  const s = REC.suggest(steps, P.DEFAULT_PROFILE);
  assert.equal(s.steps[0].target.name, '{{date}}'); assert.equal(s.steps[1].target.name, '{{time}}');
  assert.equal(s.steps[2].value, '{{profile.email}}'); assert.equal(s.steps[3].value, '{{profile.dobUS}}'); assert.equal(s.steps[4].value, 'side entrance');
  assert.deepEqual(Object.keys(s.vars).sort(), ['date', 'time']);
  const v = REC.varsFor({ vars: s.vars }, { date: '2026-11-24', time: '10:00 AM' }, P.DEFAULT_PROFILE);
  assert.equal(v.date, 'Tuesday, November 24, 2026'); assert.equal(v['profile.email'], 'jordan.rivera@mail.example'); assert.equal(v['profile.fullName'], 'Jordan Rivera');
});
test('recorder: a run becomes recipe steps (successful actions only, no hand-off values)', () => {
  const st = REC.fromRun({ steps: [{ kind: 'action', ok: true, type: 'click', role: 'radio', target: 'Cleaning · 45 min · routine hygiene visit' }, { kind: 'action', ok: false, type: 'click', role: 'button', target: 'Continue' }, { kind: 'flag', text: 'x' }, { kind: 'action', ok: true, type: 'type', role: 'textbox', target: 'Email *', value: 'a@b.example' }] });
  assert.equal(st.length, 2); assert.equal(st[1].value, 'a@b.example');
});
test('sandbox: Dr. Patel Tuesday slots — 3:00 full, 3:30 a ghost slot, 4:00 open; closed on Thanksgiving', () => {
  assert.equal(F.dentalSlot('patel', '2026-11-17', 900, TODAY), 'full');
  assert.equal(F.dentalSlot('patel', '2026-11-17', 930, TODAY), 'ghost');
  assert.equal(F.dentalSlot('patel', '2026-11-17', 960, TODAY), 'open');
  assert.equal(F.dentalSlot('patel', '2026-11-26', 960, TODAY), 'closed');
  assert.equal(F.closedReason('2026-11-26'), 'Closed for Thanksgiving');
});
test('sandbox: Theo is full Saturday 9:00 and 9:30; salon closed Mondays', () => {
  assert.equal(F.salonSlot('theo', '2026-11-14', 540, TODAY), 'full'); assert.equal(F.salonSlot('theo', '2026-11-14', 570, TODAY), 'full');
  assert.equal(F.salonSlot('theo', '2026-11-16', 600, TODAY), 'closed');
});
test('sandbox: Harvest supper Friday 6 PM has 2 seats, 8:30 PM has room, Saturday sold out', () => {
  const s = F.sessions(TODAY).filter((x) => x.eventId === 'harvest' || /harvest/.test(x.id));
  const fri6 = s.find((x) => x.date === '2026-11-13' && x.min === 1080); const fri830 = s.find((x) => x.date === '2026-11-13' && x.min === 1230);
  assert.ok(fri6 && fri830, 'sessions exist'); assert.equal(fri6.left, 2); assert.ok(fri830.left >= 4);
  const sat = s.find((x) => x.date === '2026-11-14'); assert.equal(sat.left, 0);
});
test('sandbox: Luhn check for the test card', () => { assert.ok(F.luhn('4242 4242 4242 4242')); assert.ok(!F.luhn('4242 4242 4242 4241')); });
