const test = require('node:test'); const assert = require('node:assert');
const LLM = require('../js/llm.js'); const LLMP = require('../js/llmplanner.js'); const G = require('../js/goal.js'); const P = require('../js/planner.js'); const { fixture, TODAY } = require('./helpers.cjs');
const FAKE_KEY = 'sk-test-FAKE-0000-not-a-real-key';
const ctxFor = (goalText, site) => ({ goalText, goal: G.parse(goalText, TODAY, site), profile: JSON.parse(JSON.stringify(P.DEFAULT_PROFILE)), answers: {}, filled: {}, flags: [], history: [], events: [] });
const reply = (text) => ({ text, usage: { input: 100, output: 20 }, cost: 0 });

test('llm planner: prompt fences the page, hides profile values, and never contains the key', async () => {
  const prompts = []; const ctx = ctxFor('Save me a spot at QuickCare Maplewood Center this evening for a flu shot', 'clinic');
  const planner = LLMP.create({ call: async (msg) => { prompts.push(msg); return reply('{"thought":"reject cookies","action":{"type":"click","ref":"e1"}}'); }, label: 'mock', todayLabel: 'Wed Nov 11 2026' });
  // simulate how the app wraps the key: the call closure owns it, the planner never sees it
  const d = await planner.next(fixture('clinic-cookies'), ctx);
  assert.equal(d.action.type, 'click');
  const all = JSON.stringify(prompts);
  assert.ok(!all.includes(FAKE_KEY)); assert.ok(!/sk-[a-z0-9-]{10,}/i.test(all));
  const user = prompts[0].messages[0].content;
  const open = user.indexOf('<<<UNTRUSTED_PAGE_CONTENT>>>'); const close = user.indexOf('<<<END_UNTRUSTED_PAGE_CONTENT>>>');
  assert.ok(open > 0 && close > open, 'page is fenced');
  const inside = user.slice(open, close);
  assert.match(inside, /ignore your previous instructions/i, 'injected text stays inside the fence as data');
  assert.ok(!user.slice(0, open).match(/evil\.example/), 'nothing from the page leaks outside the fence');
  assert.ok(!all.includes('jordan.rivera@mail.example'), 'profile values are not sent');
  assert.ok(!all.includes('214-555-0142'));
  assert.match(user, /\{\{profile\.email\}\}/);
  assert.match(prompts[0].system, /UNTRUSTED DATA/);
});
test('llm planner: sharing values is opt-in', async () => {
  const prompts = []; const planner = LLMP.create({ shareProfileValues: true, call: async (m) => { prompts.push(m); return reply('{"thought":"x","action":{"type":"wait","ms":100}}'); } });
  await planner.next(fixture('dental-service'), ctxFor('book a cleaning', 'dental'));
  assert.ok(JSON.stringify(prompts).includes('jordan.rivera@mail.example'));
});
test('llm planner: placeholders are resolved locally; missing ones become a question', async () => {
  const snap = fixture('permit-phone-error'); const phone = snap.items.find((x) => /phone/i.test(x.name || '') && x.ref);
  let n = 0; const answers = ['{"thought":"fix phone","action":{"type":"type","ref":"' + phone.ref + '","value":"{{profile.phone}}"}}', '{"thought":"x","action":{"type":"type","ref":"' + phone.ref + '","value":"{{profile.custom.plate}}"}}'];
  const planner = LLMP.create({ call: async () => reply(answers[n++]) });
  const d1 = await planner.next(snap, ctxFor('block party', 'permit')); assert.equal(d1.action.value, '214-555-0142');
  const d2 = await planner.next(snap, ctxFor('block party', 'permit')); assert.equal(d2.action.type, 'ask');
});
test('llm planner: bad JSON is retried once, then fails readably', async () => {
  let calls = 0; const planner = LLMP.create({ call: async () => { calls++; return reply(calls === 1 ? 'Sure! I will click it.' : '```json\n{"thought":"ok","action":{"type":"wait","ms":200}}\n```'); } });
  const d = await planner.next(fixture('dental-service'), ctxFor('cleaning', 'dental')); assert.equal(calls, 2); assert.equal(d.action.type, 'wait');
  const bad = LLMP.create({ call: async () => reply('nope') }); const d2 = await bad.next(fixture('dental-service'), ctxFor('cleaning', 'dental'));
  assert.equal(d2.action.type, 'fail'); assert.match(d2.action.reason, /JSON/);
  assert.throws(() => LLMP.parseReply('{"thought":"x","action":{"type":"rm -rf"}}'));
});

/* fake keys against each provider (mocked fetch with the real error shapes) give readable errors */
const ERR = {
  openai: { status: 401, body: { error: { message: 'Incorrect API key provided: sk-test***key.', type: 'invalid_request_error' } } },
  anthropic: { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
  gemini: { status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } } },
  compatible: { status: 401, body: { error: { message: 'No auth credentials found', code: 401 } } }
};
for (const [prov, e] of Object.entries(ERR)) {
  test('provider error (' + prov + '): fake key gives a readable message and the key is only in the header', async () => {
    let seen = null; const fetch = async (url, init) => { seen = { url, init }; return { ok: false, status: e.status, text: async () => JSON.stringify(e.body) }; };
    const cfg = { provider: prov, key: FAKE_KEY, model: LLM.PROVIDERS[prov].defaultModel, baseUrl: prov === 'compatible' ? 'https://openrouter.ai/api/v1' : '' };
    await assert.rejects(LLM.call(cfg, { system: 's', messages: [{ role: 'user', content: 'hi' }] }, { fetch }), (err) => { assert.match(err.message, /key was rejected/i); assert.ok(!err.message.includes(FAKE_KEY)); return true; });
    assert.ok(!String(seen.init.body).includes(FAKE_KEY), 'key not in the body');
    if (prov === 'anthropic') { assert.equal(seen.init.headers['x-api-key'], FAKE_KEY); assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true'); }
    if (prov === 'gemini') assert.ok(seen.init.headers['x-goog-api-key'] === FAKE_KEY || /key=/.test(seen.url));
  });
}
test('provider: network failure for OpenAI explains the CORS-less key error', async () => {
  const fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(LLM.call({ provider: 'openai', key: FAKE_KEY }, { system: 's', messages: [] }, { fetch }), /CORS|key/i);
});
test('provider: missing key is caught before any request', async () => {
  let called = false; await assert.rejects(LLM.call({ provider: 'anthropic', key: '' }, { system: 's', messages: [] }, { fetch: async () => { called = true; } }), /Add your Anthropic key/);
  assert.equal(called, false);
});
