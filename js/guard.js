/* FormPilot guard: everything that keeps the agent safe, independent of who plans (rules or a model).
   - flags instructions hidden in page content (prompt injection) and never treats them as instructions
   - classifies final submit / book / pay buttons so the agent stops for human approval
   - refuses to type into password, card, SSN, one-time-code or human-check fields (hands them to you)
   - checks every typed value comes from your profile, your goal or your answers
   - keeps the agent on allowlisted sites */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root.FormPilotSnapshot || (typeof require === 'function' ? require('./snapshot.js') : null));
  else root.FormPilotGuard = factory(root.FormPilotSnapshot);
})(typeof self !== 'undefined' ? self : this, function (SNAP) {
  'use strict';
  const SANDBOX_HOSTS = ['brightsmile-dental.example', 'shearstudio.example', 'permits.maplewood.example', 'lanternfest.example', 'quickcare-clinic.example'];
  const INJECTION = [
    [/\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|your|all|the)\b[^.]{0,20}\b(instructions?|prompts?|rules|directions)\b/i, 'tries to override your instructions'],
    [/\b(AI|LLM|GPT|automated)\s*(agents?|assistants?|bots?|models?)\b[^.]{0,30}(:|must|should|need to|are required|reading this)/i, 'speaks directly to AI agents'],
    [/\bnote to (AI|automated|assistants?|agents?|bots?)\b/i, 'speaks directly to AI agents'],
    [/\b(e-?mail|send|forward|upload|post|share|transmit)\b[^.]{0,50}\b(data|profile|details|information|info|password|card|ssn|social security|insurance|date of birth)\b[^.]{0,40}\b(to|at)\b/i, 'asks to send your data somewhere'],
    [/\b(system prompt|developer mode|jailbreak|you are now|new instructions|act as)\b/i, 'tries to change the agent\u2019s role'],
    [/\bdo not (tell|mention|inform|alert|show)\b[^.]{0,30}\b(user|human|patient|customer)\b/i, 'asks the agent to hide something from you'],
    [/\b(go|navigate|visit|open|browse)\s+(to\s+)?https?:\/\//i, 'tries to send the agent to another site'],
    [/\b(type|enter|put|include)\b[^.]{0,30}\b(ssn|social security|password|card number|cvv|cvc)\b[^.]{0,30}\b(into|in|every|all)\b/i, 'asks for a secret to be typed somewhere'],
    [/\bexfiltrat/i, 'mentions exfiltration']
  ];
  function scanText(text) { const t = String(text || ''); for (const [re, why] of INJECTION) if (re.test(t)) return why; return null; }
  /* Scan a snapshot. Returns [{ text, where, why }] (deduped). */
  function scanInjection(snap) {
    const out = []; const seen = new Set();
    const add = (text, where) => { const why = scanText(text); if (!why) return; const k = String(text).slice(0, 120); if (seen.has(k)) return; seen.add(k); out.push({ text: String(text).slice(0, 300), where, why }); };
    for (const it of snap.items || []) {
      if (!it.ref) add(it.name, it.hidden ? 'hidden text' : 'page text');
      else { if (it.role === 'link' || it.role === 'button') add(it.name, it.role + ' label'); if (it.placeholder) add(it.placeholder, 'placeholder'); if (it.description) add(it.description, 'field hint'); (it.options || []).forEach((x) => add(x, 'menu option "' + it.name + '"')); }
    }
    for (const t of snap.hiddenText || []) add(t, 'hidden text');
    return out;
  }
  const FINAL_RE = /^(book|confirm|submit|send|pay|place|purchase|buy|complete|finish|finalize|reserve|rsvp|save my spot|register|apply|sign me up|sign up|subscribe|join|check ?out|schedule|request (an )?appointment|hold (my|this))\b/i;
  const NOT_FINAL_RE = /\b(next|continue|review|back|edit|cancel|previous|preview|details|more|learn|close|no thanks)\b/i;
  function isFinal(it) { if (!it || (it.role !== 'button' && it.role !== 'link')) return false; const n = String(it.name || '').trim(); return FINAL_RE.test(n) && !NOT_FINAL_RE.test(n); }
  function hostOf(u) { try { return new URL(u).host.toLowerCase(); } catch (e) { return ''; } }
  function hostAllowed(host, list) { host = String(host || '').toLowerCase(); return (list || SANDBOX_HOSTS).some((p) => { p = String(p).trim().toLowerCase(); if (!p) return false; if (p.startsWith('*.')) return host === p.slice(2) || host.endsWith(p.slice(1)); return host === p; }); }
  function sensitiveOf(it) { if (!it) return null; return it.sensitive || (SNAP ? SNAP.sensitiveKind({ name: it.name, placeholder: it.placeholder, autocomplete: it.autocomplete, type: it.type, humanCheck: it.humanCheck }) : null); }
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi; const URL_RE = /\b(?:https?:\/\/|www\.)[^\s"'<>]+/gi;
  const digits = (s) => String(s || '').replace(/\D/g, '');
  /* Values the agent may type: must be traceable to profile, goal or the user's answers. */
  function provenance(value, sources) {
    const v = String(value || ''); const pool = (sources || []).map((x) => String(x == null ? '' : x)).join('\n'); const lower = pool.toLowerCase();
    for (const e of v.match(EMAIL_RE) || []) if (!lower.includes(e.toLowerCase())) return 'the email address ' + e + ' is not in your profile, goal or answers';
    for (const u of v.match(URL_RE) || []) if (!lower.includes(u.toLowerCase())) return 'the link ' + u + ' is not in your profile, goal or answers';
    const runs = v.match(/\d[\d\s().-]{6,}\d/g) || [];
    const poolDigits = (sources || []).map((x) => digits(x)).filter((d) => d.length >= 7);
    for (const r of runs) { const d = digits(r); if (d.length >= 7 && !poolDigits.some((p) => p.includes(d) || d.includes(p) && p.length >= d.length - 1)) return 'the number ' + r.trim() + ' is not in your profile, goal or answers'; }
    return null;
  }
  /* Check one proposed action against a snapshot. ctx: { allowlist, sources:[...], profileValues } */
  function checkAction(action, snap, ctx) {
    const c = ctx || {}; const a = action || {};
    const needsRef = ['click', 'type', 'select', 'check', 'uncheck', 'submit', 'handoff'];
    const it = a.ref ? (snap.items || []).find((x) => x.ref === a.ref) : null;
    if (needsRef.includes(a.type) && !it) return { ok: false, kind: 'missing', reason: 'There is no element [' + (a.ref || '?') + '] on the page.' };
    if (!hostAllowed(snap.host, c.allowlist)) return { ok: false, kind: 'allowlist', reason: snap.host + ' is not on your allowlist of sites.' };
    if (a.type === 'navigate') { const h = hostOf(a.url); return hostAllowed(h, c.allowlist) ? { ok: true } : { ok: false, kind: 'allowlist', reason: 'Navigation to ' + (h || a.url) + ' was blocked: it is not on your allowlist.' }; }
    if (it && it.disabled && /click|type|select|check|submit/.test(a.type)) return { ok: false, kind: 'disabled', reason: '"' + it.name + '" is disabled.' };
    if ((a.type === 'click' || a.type === 'submit') && it.role === 'link' && it.href) { const h = hostOf(it.href); if (h && h !== snap.host && !/^(javascript:|#)/.test(it.href) && !hostAllowed(h, c.allowlist) && !(c.sameOriginHost && h === c.sameOriginHost)) return { ok: false, kind: 'allowlist', reason: 'The link "' + it.name + '" goes to ' + h + ', which is not on your allowlist.' }; }
    if (a.type === 'type') {
      const s = sensitiveOf(it); if (s) return { ok: false, kind: 'sensitive', sensitive: s, reason: '"' + it.name + '" is a ' + labelSensitive(s) + ' field. FormPilot never types those; you will be asked to fill it yourself.' };
      const why = provenance(a.value, c.sources); if (why) return { ok: false, kind: 'provenance', reason: 'Blocked typing into "' + it.name + '": ' + why + '.' };
      if (scanText(a.value)) return { ok: false, kind: 'provenance', reason: 'Blocked: the value looks like instructions copied from the page.' };
    }
    if (a.type === 'select' && (/https?:\/\//i.test(a.value || '') || scanText(a.value))) return { ok: false, kind: 'provenance', reason: 'Blocked choosing an option that looks like injected instructions or a link.' };
    if ((a.type === 'click' || a.type === 'submit') && isFinal(it)) return { ok: true, kind: 'final', reason: '"' + it.name + '" submits the form. Your approval is needed first.' };
    if ((a.type === 'click' || a.type === 'check') && it && it.dialog && /subscribe|newsletter|offers/i.test(it.dialog + ' ' + it.name) && /subscribe|sign up|join|yes/i.test(it.name)) return { ok: true, kind: 'final', reason: '"' + it.name + '" signs you up for something. Your approval is needed first.' };
    return { ok: true };
  }
  function labelSensitive(s) { return { password: 'password', card: 'payment card', ssn: 'Social Security number', captcha: 'human check (CAPTCHA)', otp: 'one-time code', bank: 'bank account' }[s] || 'sensitive'; }
  /* Fence untrusted page text for a model prompt: markers inside the page are neutralised. */
  const FENCE_OPEN = '<<<UNTRUSTED_PAGE_CONTENT>>>'; const FENCE_CLOSE = '<<<END_UNTRUSTED_PAGE_CONTENT>>>';
  function fence(text) { return FENCE_OPEN + '\n' + String(text || '').replace(/<<<|>>>/g, (m) => (m === '<<<' ? '‹‹‹' : '›››')) + '\n' + FENCE_CLOSE; }
  function mask(it, value) { const s = sensitiveOf(it); return s ? '(' + labelSensitive(s) + ' entered by you, not recorded)' : value; }
  return { SANDBOX_HOSTS, INJECTION, scanText, scanInjection, isFinal, hostOf, hostAllowed, sensitiveOf, labelSensitive, provenance, checkAction, fence, FENCE_OPEN, FENCE_CLOSE, mask };
});
