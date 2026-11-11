/* FormPilot runner policy: pure checks shared by server.mjs and the Node tests.
   The runner drives a real browser, so it re-checks everything itself instead of trusting the web page. */
'use strict';
const SENSITIVE_TYPES = ['password'];
const SENSITIVE_AUTOCOMPLETE = /^(cc-|one-time-code|new-password|current-password)/i;
const SENSITIVE_NAME = /\b(password|passcode|card number|credit card|debit card|cvc|cvv|security code|expiry|expiration|social security|ssn|one[- ]time code|verification code|captcha|routing number|account number|iban)\b/i;
const FINAL_RE = /^(book|confirm|submit|send|pay|place|purchase|buy|complete|finish|finalize|reserve|rsvp|save my spot|register|apply|sign me up|sign up|subscribe|join|check ?out|schedule|request (an )?appointment|hold (my|this))\b/i;
const NOT_FINAL_RE = /\b(next|continue|review|back|edit|cancel|previous|preview|details|more|learn|close|no thanks)\b/i;
const ACTIONS = ['click', 'type', 'select', 'check', 'uncheck', 'scroll', 'wait'];

function hostOf(u) { try { return new URL(u).host.toLowerCase(); } catch (e) { return ''; } }
function hostAllowed(host, list) {
  host = String(host || '').toLowerCase(); if (!host) return false;
  return (list || []).some((p) => { p = String(p).trim().toLowerCase(); if (!p) return false; if (p.startsWith('*.')) return host === p.slice(2) || host.endsWith(p.slice(1)); return host === p; });
}
function isSensitive(el) {
  if (!el) return false;
  if (SENSITIVE_TYPES.includes(String(el.type || '').toLowerCase())) return true;
  if (SENSITIVE_AUTOCOMPLETE.test(String(el.autocomplete || ''))) return true;
  return SENSITIVE_NAME.test([el.name, el.label, el.placeholder, el.id].filter(Boolean).join(' '));
}
function isFinal(el) {
  if (!el) return false; const n = String(el.label || el.text || el.name || '').trim();
  const isButton = /^(button|a|input)$/i.test(el.tag || '') || el.role === 'button' || el.role === 'link';
  return isButton && (FINAL_RE.test(n) && !NOT_FINAL_RE.test(n) || String(el.type || '').toLowerCase() === 'submit' && !NOT_FINAL_RE.test(n) && FINAL_RE.test(n));
}
/* Decide whether an action may run.
   el: facts about the target read from the live page ({ tag, type, role, label, name, placeholder, autocomplete, href }).
   state: { dryRun, allowlist, pageUrl, stopped }. approved: the user approved this exact final step in the app. */
function check(action, el, state, approved) {
  const a = action || {}; const s = state || {};
  if (s.stopped) return { ok: false, error: 'The runner was stopped. Open a page again to continue.' };
  if (!ACTIONS.includes(a.type)) return { ok: false, error: 'The runner does not allow "' + a.type + '" actions.' };
  if (!hostAllowed(hostOf(s.pageUrl), s.allowlist)) return { ok: false, error: 'The page is on ' + (hostOf(s.pageUrl) || 'an unknown site') + ', which is not on the runner allowlist.' };
  if (a.type === 'wait' || a.type === 'scroll') return { ok: true };
  if (!el) return { ok: false, error: 'Element [' + (a.ref || '?') + '] is not on the page.' };
  if (a.type === 'type' && isSensitive(el)) return { ok: false, sensitive: true, error: 'Refused: "' + (el.label || el.name || 'this field') + '" looks like a password, card, SSN or code field. Fill it yourself in the runner window.' };
  if (a.type === 'click' && el.href) { const h = hostOf(el.href); if (h && h !== hostOf(s.pageUrl) && !hostAllowed(h, s.allowlist)) return { ok: false, error: 'Refused: that link goes to ' + h + ', which is not on the runner allowlist.' }; }
  if (a.type === 'select' && /https?:\/\//i.test(String(a.value || ''))) return { ok: false, error: 'Refused: that option looks like a link.' };
  if ((a.type === 'click' || a.type === 'check') && isFinal(el)) {
    if (s.dryRun) return { ok: false, dryRun: true, error: 'Dry run: the runner stopped before "' + (el.label || el.text || 'submit') + '". Nothing was submitted. Start the runner with --live to allow approved submits.' };
    if (!approved) return { ok: false, error: 'Refused: "' + (el.label || el.text || 'submit') + '" submits the form and was not approved in FormPilot.' };
  }
  return { ok: true };
}
function parseArgs(argv) {
  const o = { port: 8787, allow: [], headed: false, live: false, token: '', origins: ['https://shaikbasha1437.github.io'] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const v = argv[i + 1];
    if (k === '--port') { o.port = +v; i++; } else if (k === '--allow') { o.allow.push(...String(v).split(',').map((x) => x.trim()).filter(Boolean)); i++; } else if (k === '--headed') o.headed = true; else if (k === '--live') o.live = true; else if (k === '--token') { o.token = v; i++; } else if (k === '--origin') { o.origins.push(v); i++; }
  }
  return o;
}
function corsHeaders(origin, allowedOrigins) {
  const ok = origin && (allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return ok ? { 'access-control-allow-origin': origin, 'vary': 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-formpilot-token', 'access-control-allow-private-network': 'true', 'access-control-max-age': '600' } : { vary: 'Origin' };
}
module.exports = { hostOf, hostAllowed, isSensitive, isFinal, check, parseArgs, corsHeaders, ACTIONS };
