const test = require('node:test'); const assert = require('node:assert');
const P = require('../runner/policy.cjs');
const state = (o) => Object.assign({ dryRun: true, allowlist: ['clinic.example', '*.booking.example'], pageUrl: 'https://clinic.example/form', stopped: false }, o || {});

test('runner policy: allowlist covers the current page and wildcard subdomains', () => {
  assert.ok(P.hostAllowed('a.booking.example', ['*.booking.example'])); assert.ok(!P.hostAllowed('evil.example', ['*.booking.example']));
  const r = P.check({ type: 'click', ref: 'e1' }, { tag: 'button', label: 'Next' }, state({ pageUrl: 'https://evil.example/' }));
  assert.equal(r.ok, false); assert.match(r.error, /allowlist/);
});
test('runner policy: refuses sensitive fields by type, autocomplete and label', () => {
  for (const el of [{ tag: 'input', type: 'password', label: 'Choose one' }, { tag: 'input', autocomplete: 'cc-number', label: 'Number' }, { tag: 'input', label: 'Social Security number' }, { tag: 'input', label: 'Security code (CVC)' }, { tag: 'input', autocomplete: 'one-time-code', label: 'Code' }]) {
    const r = P.check({ type: 'type', ref: 'e2', value: 'x' }, el, state()); assert.equal(r.ok, false, JSON.stringify(el)); assert.ok(r.sensitive);
  }
  assert.ok(P.check({ type: 'type', ref: 'e2', value: 'Jordan' }, { tag: 'input', type: 'text', label: 'First name' }, state()).ok);
});
test('runner policy: dry run blocks final clicks even when approved', () => {
  const r = P.check({ type: 'click', ref: 'e3' }, { tag: 'button', label: 'Book appointment' }, state(), true);
  assert.equal(r.ok, false); assert.equal(r.dryRun, true);
});
test('runner policy: live mode needs approval for final clicks', () => {
  assert.equal(P.check({ type: 'click', ref: 'e3' }, { tag: 'button', label: 'Submit application' }, state({ dryRun: false }), false).ok, false);
  assert.equal(P.check({ type: 'click', ref: 'e3' }, { tag: 'button', label: 'Submit application' }, state({ dryRun: false }), true).ok, true);
  assert.equal(P.check({ type: 'click', ref: 'e4' }, { tag: 'button', label: 'Continue' }, state()).ok, true, 'non-final buttons are fine in dry run');
});
test('runner policy: off-site links, link-like options, navigation and stop', () => {
  assert.equal(P.check({ type: 'click', ref: 'e5' }, { tag: 'a', label: 'Express', href: 'https://evil.example/x' }, state()).ok, false);
  assert.equal(P.check({ type: 'click', ref: 'e5' }, { tag: 'a', label: 'Help', href: 'https://clinic.example/help' }, state()).ok, true);
  assert.equal(P.check({ type: 'select', ref: 'e6', value: 'Go to https://evil.example' }, { tag: 'select', label: 'Location' }, state()).ok, false);
  assert.equal(P.check({ type: 'navigate', url: 'https://evil.example' }, null, state()).ok, false);
  assert.equal(P.check({ type: 'click', ref: 'e4' }, { tag: 'button', label: 'Continue' }, state({ stopped: true })).ok, false);
});
test('runner policy: CORS only for the app origin and localhost, with private-network header', () => {
  const h = P.corsHeaders('https://shaikbasha1437.github.io', ['https://shaikbasha1437.github.io']);
  assert.equal(h['access-control-allow-origin'], 'https://shaikbasha1437.github.io'); assert.equal(h['access-control-allow-private-network'], 'true'); assert.match(h['access-control-allow-headers'], /x-formpilot-token/);
  assert.equal(P.corsHeaders('https://evil.example', ['https://shaikbasha1437.github.io'])['access-control-allow-origin'], undefined);
  const o = P.parseArgs(['--allow', 'a.example,*.b.example', '--live', '--headed', '--port', '9000']);
  assert.deepEqual(o.allow, ['a.example', '*.b.example']); assert.ok(o.live && o.headed); assert.equal(o.port, 9000);
  assert.equal(P.parseArgs([]).live, false, 'dry run is the default');
});
