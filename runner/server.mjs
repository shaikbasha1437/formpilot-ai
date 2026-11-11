#!/usr/bin/env node
/* FormPilot local runner: lets the FormPilot web app drive a real Chromium window on YOUR computer.
   - Listens on 127.0.0.1 only, and every request needs the token printed at start-up.
   - Dry run by default: it stops before any final submit/book/pay click. Use --live to allow
     final clicks, and even then only ones the user approved in the app.
   - Refuses to type into password, card, SSN, one-time-code or CAPTCHA fields.
   - Only opens and acts on pages whose host is on the --allow list.
   Usage: node server.mjs --allow example.com[,*.example.org] [--headed] [--live] [--port 8787] [--token T] */
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const policy = require('./policy.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_JS = path.join(here, '..', 'js', 'snapshot.js');
const VERSION = '1.0.0';

const opts = policy.parseArgs(process.argv.slice(2));
const token = opts.token || crypto.randomBytes(18).toString('base64url');
const state = { dryRun: !opts.live, allowlist: opts.allow, pageUrl: '', stopped: false };
if (!opts.allow.length) { console.error('Add at least one site, e.g.  npm start -- --allow example.com'); process.exit(1); }

let chromium;
try { ({ chromium } = await import('playwright')); } catch (e) { console.error('Playwright is not installed. Run: npm install && npx playwright install chromium'); process.exit(1); }
const browser = await chromium.launch({ headless: !opts.headed, executablePath: process.env.FORMPILOT_CHROME_PATH || undefined, args: process.env.FORMPILOT_NO_SANDBOX ? ['--no-sandbox'] : [] });
const context = await browser.newContext({ viewport: { width: 1100, height: 860 } });
let page = await context.newPage();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (res, code, body, cors) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, cors)); res.end(JSON.stringify(body)); };
const tokenOk = (t) => { const a = Buffer.from(String(t || '')); const b = Buffer.from(token); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const readBody = (req) => new Promise((resolve, reject) => { let n = 0; const chunks = []; req.on('data', (c) => { n += c.length; if (n > 64 * 1024) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); }); req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('Body is not JSON')); } }); });

async function snapshot() {
  if (!(await page.evaluate(() => !!window.FormPilotSnapshot).catch(() => false))) await page.addScriptTag({ path: SNAPSHOT_JS });
  return page.evaluate(() => window.FormPilotSnapshot.take(document));
}
async function facts(ref) {
  if (!/^e\d{1,5}$/.test(String(ref || ''))) return null;
  return page.evaluate((r) => {
    const el = document.querySelector('[data-fp-ref="' + r + '"]'); if (!el) return null;
    const label = (el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute('aria-label') || (el.tagName === 'INPUT' ? el.value : el.textContent) || '';
    return { tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', role: el.getAttribute('role') || (el.tagName === 'BUTTON' ? 'button' : el.tagName === 'A' ? 'link' : ''), label: label.replace(/\s+/g, ' ').trim().slice(0, 160), name: el.getAttribute('name') || '', id: el.id || '', placeholder: el.getAttribute('placeholder') || '', autocomplete: el.getAttribute('autocomplete') || '', href: el.tagName === 'A' ? el.href : '' };
  }, ref);
}
async function act(a, approved) {
  state.pageUrl = page.url();
  const el = a.ref ? await facts(a.ref) : null;
  const verdict = policy.check(a, el, state, approved);
  if (!verdict.ok) return verdict;
  const loc = a.ref ? page.locator('[data-fp-ref="' + a.ref + '"]') : null;
  try {
    if (a.type === 'wait') await sleep(Math.min(5000, a.ms || 300));
    else if (a.type === 'scroll') { if (loc) await loc.scrollIntoViewIfNeeded(); else await page.mouse.wheel(0, 600); }
    else if (a.type === 'click') { if (el.type === 'radio' || el.type === 'checkbox') await loc.check({ timeout: 5000 }).catch(() => loc.click({ timeout: 5000 })); else await loc.click({ timeout: 5000 }); }
    else if (a.type === 'check') await loc.check({ timeout: 5000 });
    else if (a.type === 'uncheck') await loc.uncheck({ timeout: 5000 });
    else if (a.type === 'select') { await loc.selectOption({ label: String(a.value) }, { timeout: 5000 }).catch(() => loc.selectOption(String(a.value), { timeout: 5000 })); }
    else if (a.type === 'type') {
      const v = String(a.value == null ? '' : a.value);
      if (/^(date|time|month|week|datetime-local|number|range|color)$/.test(el.type) || el.tag === 'textarea') await loc.fill(v, { timeout: 5000 });
      else { await loc.fill('', { timeout: 5000 }); for (const ch of v.replace(/[\r\n]+/g, ' ')) { if (state.stopped) return { ok: false, error: 'Stopped.' }; await loc.pressSequentially(ch, { delay: 12 }); } } // never press Enter: it could submit without approval
    }
  } catch (e) { return { ok: false, error: String(e.message || e).split('\n')[0].slice(0, 200) }; }
  await page.waitForLoadState('domcontentloaded').catch(() => {}); await sleep(250);
  if (!policy.hostAllowed(policy.hostOf(page.url()), state.allowlist)) { const left = policy.hostOf(page.url()); await page.goBack().catch(() => {}); return { ok: false, error: 'The page went to ' + left + ', which is not allowlisted. The runner went back.' }; }
  return { ok: true };
}
async function highlight(refs) {
  await page.evaluate((rs) => { document.querySelectorAll('[data-fp-hl]').forEach((x) => { x.style.outline = x.dataset.fpHl === '-' ? '' : x.dataset.fpHl; delete x.dataset.fpHl; }); for (const r of rs || []) { const el = document.querySelector('[data-fp-ref="' + r + '"]'); if (el) { el.dataset.fpHl = el.style.outline || '-'; el.style.outline = '3px solid #fca311'; el.style.outlineOffset = '2px'; } } }, (refs || []).filter((r) => /^e\d{1,5}$/.test(r))).catch(() => {});
}

const server = http.createServer(async (req, res) => {
  const cors = policy.corsHeaders(req.headers.origin, opts.origins);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (!tokenOk(req.headers['x-formpilot-token'])) return send(res, 401, { error: 'Wrong or missing runner token. Copy it from the runner window into FormPilot Settings.' }, cors);
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (url.pathname === '/health') return send(res, 200, { ok: true, version: VERSION, dryRun: state.dryRun, headed: opts.headed, allowlist: state.allowlist }, cors);
    if (url.pathname === '/open') {
      const target = String(body.url || ''); if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: 'Give a full http(s) URL.' }, cors);
      if (!policy.hostAllowed(policy.hostOf(target), state.allowlist)) return send(res, 403, { error: policy.hostOf(target) + ' is not on the runner allowlist. Restart it with --allow ' + policy.hostOf(target) + '.' }, cors);
      state.stopped = false; if (page.isClosed()) page = await context.newPage();
      await page.goto(target, { waitUntil: 'load', timeout: 30000 }); await sleep(800); state.pageUrl = page.url(); // late banners and pop-ups
      return send(res, 200, { ok: true, url: page.url() }, cors);
    }
    if (url.pathname === '/snapshot') { if (!policy.hostAllowed(policy.hostOf(page.url()), state.allowlist)) return send(res, 403, { error: 'No allowlisted page is open.' }, cors); return send(res, 200, { snapshot: await snapshot() }, cors); }
    if (url.pathname === '/act') return send(res, 200, await act(body.action || {}, body.approved === true), cors);
    if (url.pathname === '/highlight') { await highlight(body.refs); return send(res, 200, { ok: true }, cors); }
    if (url.pathname === '/stop') { state.stopped = true; await highlight([]); return send(res, 200, { ok: true, stopped: true }, cors); }
    return send(res, 404, { error: 'Unknown endpoint.' }, cors);
  } catch (e) { return send(res, 500, { error: String(e.message || e).split('\n')[0].slice(0, 200) }, cors); }
});
server.listen(opts.port, '127.0.0.1', () => {
  console.log('FormPilot runner ' + VERSION + ' on http://127.0.0.1:' + opts.port);
  console.log('Token: ' + token);
  console.log('Allowlist: ' + state.allowlist.join(', ') + ' · ' + (state.dryRun ? 'DRY RUN (stops before submitting; add --live to allow approved submits)' : 'LIVE: approved final clicks will be performed') + (opts.headed ? ' · headed' : ' · headless'));
});
const shutdown = async () => { server.close(); await browser.close().catch(() => {}); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
