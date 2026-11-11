/* FormPilot rules planner (demo mode, no key). It reads only the accessibility snapshot, never the page's
   scripts, and works on well-labelled forms: obstacles first (cookie walls, pop-ups), then choices,
   calendars and time slots, then fields from your profile / goal / answers, then the forward button.
   It asks you for anything it cannot source, hands sensitive fields to you, and re-plans when a
   slot or session is taken. Page text is only ever data to it: it never follows instructions found there. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./goal.js'), require('./guard.js'));
  else root.FormPilotPlanner = factory(root.FormPilotGoal, root.FormPilotGuard);
})(typeof self !== 'undefined' ? self : this, function (G, GUARD) {
  'use strict';
  const MONTHS = G.MON; const WD = G.WD;
  const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia' };
  const PROFILE_FIELDS = [
    { key: 'firstName', label: 'First name' }, { key: 'lastName', label: 'Last name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
    { key: 'dob', label: 'Date of birth', type: 'date' }, { key: 'street', label: 'Street address' }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'zip', label: 'ZIP code' },
    { key: 'insuranceProvider', label: 'Insurance provider' }, { key: 'insuranceMemberId', label: 'Insurance member ID' }, { key: 'emergencyName', label: 'Emergency contact name' }, { key: 'emergencyPhone', label: 'Emergency contact phone' }
  ];
  const DEFAULT_PROFILE = { firstName: 'Jordan', lastName: 'Rivera', email: 'jordan.rivera@mail.example', phone: '214-555-0142', dob: '1994-03-08', street: '742 Maple Ave', city: 'Maplewood', state: 'TX', zip: '75099', insuranceProvider: 'Northwind Health', insuranceMemberId: 'NWH-4821-0097', emergencyName: '', emergencyPhone: '', custom: [] };
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const low = (s) => norm(s).toLowerCase();
  const fullName = (p) => norm((p.firstName || '') + ' ' + (p.lastName || ''));
  function fieldKey(it) { return low((it.group ? it.group + ' › ' : '') + (it.field && (it.role === 'radio') ? it.field : it.name)); }

  /* ---------- dates and times inside page text ---------- */
  function parseLongDate(s, todayIso) {
    const t = low(s); const m = new RegExp('\\b(' + MONTHS.join('|') + '|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\.?\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?').exec(t);
    if (!m) return null;
    const mo = MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3))); const today = G.fromIso(todayIso) || new Date();
    let d = new Date(m[3] ? +m[3] : today.getFullYear(), mo, +m[2]);
    if (!m[3] && d < G.addDays(today, -30)) d = new Date(today.getFullYear() + 1, mo, +m[2]);
    return G.iso(d);
  }
  function timesIn(s) {
    const out = []; const re = /\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/gi; let m; const raw = [];
    while ((m = re.exec(s))) raw.push({ h: +m[1], mm: +m[2], ap: m[3] ? m[3][0].toLowerCase() : null });
    for (let i = 0; i < raw.length; i++) { let ap = raw[i].ap; if (!ap) for (let j = i + 1; j < raw.length; j++) if (raw[j].ap) { ap = raw[j].ap; break; } let h = raw[i].h; if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0; out.push(h * 60 + raw[i].mm); }
    return out;
  }
  function timeOk(min, goal) { const t = goal.time; if (!t) return true; return min >= t.from && min <= t.to; }
  function dateOk(dIso, goal) {
    const d = goal.date; if (!d) return true;
    if (d.type === 'exact') return dIso === d.iso;
    if (dIso < d.from || dIso > d.to) return false;
    if (d.weekdays && !d.weekdays.includes(G.fromIso(dIso).getDay())) return false;
    return true;
  }
  /* ---------- value formatting ---------- */
  function formatDate(isoStr, it) {
    const d = G.fromIso(isoStr); if (!d) return isoStr;
    if (it.type === 'date') return isoStr;
    const hint = (it.placeholder || '') + ' ' + (it.description || '') + ' ' + (it.error || '');
    const mm = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
    if (/DD\/MM\/YYYY/i.test(hint)) return dd + '/' + mm + '/' + d.getFullYear();
    if (/YYYY-MM-DD/i.test(hint)) return isoStr;
    return mm + '/' + dd + '/' + d.getFullYear();
  }
  /* Use an example in the site's error message ("Enter the phone number as (555) 555-0123") as a template. */
  function fixByError(value, it) {
    const err = String(it.error || ''); const v = String(value || ''); const digits = v.replace(/\D/g, '');
    if (/MM\/DD\/YYYY|DD\/MM\/YYYY|YYYY-MM-DD/i.test(err)) { const iso = toIso(v); if (iso) return formatDate(iso, Object.assign({}, it, { placeholder: err })); }
    const ex = /[(+\d][\d() .\/-]{5,}\d/.exec(err.replace(/\b(19|20)\d{2}\b(?=\.?$)/, ''));
    if (ex && digits.length >= 7) {
      const tpl = ex[0].trim(); const need = (tpl.match(/\d/g) || []).length;
      let ds = digits; if (ds.length === need + 1 && ds[0] === '1') ds = ds.slice(1);
      if (ds.length === need) { let i = 0; const out = tpl.replace(/\d/g, () => ds[i++]); if (out !== v) return out; }
    }
    if (/5-digit|five-digit/i.test(err) && digits.length >= 5) return digits.slice(0, 5) !== v ? digits.slice(0, 5) : null;
    if (/\bas a number\b|digits only|numbers only/i.test(err) && digits && digits !== v) return digits;
    if (/upper ?case|capital letters/i.test(err) && v.toUpperCase() !== v) return v.toUpperCase();
    if (/letters and (numbers|digits)/i.test(err)) { const x = v.replace(/[^A-Za-z0-9]/g, ''); if (x !== v) return x; }
    return null;
  }
  function toIso(v) {
    const s = String(v || '').trim(); let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return s;
    if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
    return null;
  }
  function matchOption(options, want) {
    if (want == null || want === '') return null; const w = low(want);
    const opts = options || [];
    let hit = opts.find((o) => low(o) === w); if (hit) return hit;
    const full = STATES[String(want).toUpperCase()]; if (full) { hit = opts.find((o) => low(o) === low(full)); if (hit) return hit; }
    const abbr = Object.keys(STATES).find((k) => low(STATES[k]) === w); if (abbr) { hit = opts.find((o) => low(o) === low(abbr)); if (hit) return hit; }
    hit = opts.find((o) => low(o).startsWith(w + ' ') || low(o).startsWith(w + ' ·') || low(o).startsWith(w + ',')); if (hit) return hit;
    return null;
  }
  /* ---------- where a field's value comes from ---------- */
  function sourceFor(it, ctx) {
    const label = low(it.name); const p = ctx.profile || {}; const g = ctx.goal; const key = fieldKey(it);
    if (ctx.answers[key] != null) return { value: ctx.answers[key], source: 'your answer' };
    const custom = (p.custom || []).find((c) => c.label && (low(c.label) === label || label.includes(low(c.label)) || low(c.label).includes(label.replace(/\s*\(.*\)$/, ''))));
    if (custom && custom.value) return { value: custom.value, source: 'profile: ' + custom.label };
    const P = (k, src) => (p[k] ? { value: p[k], source: 'profile: ' + (src || k) } : { missing: k });
    if (/emergency/.test(label)) return /phone|number/.test(label) ? P('emergencyPhone', 'emergency contact phone') : P('emergencyName', 'emergency contact name');
    if (/street or block|block of|event (street|location)|street to close/.test(label)) return g.street ? { value: g.street, source: 'your goal' } : { missing: 'street' };
    if (/first name|given name/.test(label)) return P('firstName', 'first name');
    if (/last name|surname|family name/.test(label)) return P('lastName', 'last name');
    if (/date of birth|birth ?date|\bdob\b|birthday/.test(label)) return p.dob ? { value: formatDate(p.dob, it), source: 'profile: date of birth' } : { missing: 'dob' };
    if (/(full |your |patient (full )?|applicant |contact )name|^name\b|name on (the )?(booking|reservation)/.test(label) && !/card|guest|user ?name|business|company|event/.test(label)) return fullName(p) ? { value: fullName(p), source: 'profile: name' } : { missing: 'name' };
    if (/e-?mail/.test(label)) return P('email', 'email');
    if (/phone|mobile|cell|telephone/.test(label)) return P('phone', 'phone');
    if (/street address|address line 1|^address\b|home address|mailing address/.test(label)) return P('street', 'street address');
    if (/\bcity\b|\btown\b/.test(label)) return P('city', 'city');
    if (/\bstate\b|province/.test(label)) return P('state', 'state');
    if (/zip|postal/.test(label)) return P('zip', 'ZIP code');
    if (/insurance (provider|company|carrier|plan)|insurer/.test(label)) return P('insuranceProvider', 'insurance provider');
    if (/member id|policy (number|#|id)|subscriber id|insurance id/.test(label)) return P('insuranceMemberId', 'insurance member ID');
    if (/license plate|plate number|vehicle plate/.test(label)) return g.plate ? { value: g.plate, source: 'your goal' } : { missing: 'licensePlate' };
    if (/party size|number of (guests|people)|how many|guest count|attendance|attendees|headcount/.test(label)) return g.count ? { value: String(g.count), source: 'your goal' } : { missing: 'count' };
    if (/guest names|names of (your )?guests/.test(label)) return { missing: 'guests' };
    if (/dietary|allerg|food restrictions/.test(label)) return g.diet ? { value: g.diet, source: 'your goal' } : { optional: true };
    if (/notes?\b|anything (we|else)|comments?|special requests?|message|additional info/.test(label)) return g.notes ? { value: g.notes, source: 'your goal' } : { optional: true };
    if (/\bdate\b|\bday\b/.test(label) && !/birth/.test(label)) { if (g.date && g.date.type === 'exact') return { value: formatDate(g.date.iso, it), source: 'your goal (' + g.date.label + ')' }; return { missing: 'date' }; }
    if (/start time|from time|begins?/.test(label)) { const m = g.span ? g.span.start : g.time && g.time.from > 0 ? g.time.from : null; return m != null ? { value: G.timeLabel(m), source: 'your goal' } : { missing: 'start time' }; }
    if (/end time|until|finish time|ends?\b/.test(label)) { const m = g.span ? g.span.end : g.time && g.time.to < 1440 ? g.time.to : null; return m != null ? { value: G.timeLabel(m), source: 'your goal' } : { missing: 'end time' }; }
    if (/\btime\b/.test(label)) { if (g.time && g.time.exact) return { value: G.timeLabel(g.time.from), source: 'your goal' }; }
    return { unknown: true };
  }
  /* ---------- option scoring for radios / selects ---------- */
  const SYN = { haircut: ['cut'], hair: ['cut'], trim: ['cut'], cleaning: ['cleaning', 'hygiene'], checkup: ['checkup', 'check'], 'check-up': ['checkup'], xray: ['x', 'rays'], dinner: ['supper'], kids: ['kids'], child: ['kids'], son: ['kids'], daughter: ['kids'], coloring: ['color'], colour: ['color'], cough: ['cough', 'cold'], cold: ['cold', 'cough'], sprain: ['sprain', 'injury'], injury: ['injury'], toothache: ['pain'], emergency: ['emergency', 'pain'], parking: ['parking'], tonight: ['evening'], party: ['party'] };
  const stem = (w) => w.replace(/(ings?|es|s)$/, '');
  function scoreOption(text, ctx, extra) {
    const g = ctx.goal; const t = low(text + ' ' + (extra || '')); const toks = new Set(G.tokens(t).map(stem));
    if (/no preference|first available|^any\b|any stylist|any provider/.test(low(text))) return { score: 0.5, why: 'no preference' };
    let score = 0; const why = [];
    for (const n of g.names || []) if (t.includes(low(n))) { score += 6; why.push('matches "' + n + '"'); }
    for (const w of g.tokens || []) { const cands = [w].concat(SYN[w] || []); if (cands.some((c) => toks.has(stem(c)))) { score += 2; why.push('mentions "' + w + '"'); } }
    const dIso = parseLongDate(text, g.today);
    if (g.date && dIso) { if (dateOk(dIso, g)) { score += 5; why.push('on ' + G.nice(G.fromIso(dIso))); } else score -= 10; }
    else if (g.date && g.date.type === 'exact') { const wd = WD.findIndex((d) => new RegExp('\\b' + d + '\\b').test(t)); if (wd >= 0) { if (G.fromIso(g.date.iso).getDay() === wd) { score += 3; } else score -= 10; } }
    const ts = timesIn(text);
    if (g.time && ts.length) { const lo = ts[0]; const hi = ts.length > 1 && ts[1] > lo ? ts[1] : lo; const overlap = hi >= g.time.from && lo <= g.time.to; if (overlap) { score += 3; why.push('time fits ' + g.time.label); } else score -= 5; }
    if (/ignore|https?:\/\/|instructions/.test(t) || GUARD.scanText(text)) score -= 100;
    return { score, why: why.join(', ') };
  }
  function bestOption(options, ctx, extraFor) {
    const scored = options.map((o, i) => Object.assign({ o, i }, scoreOption(o.name || o, ctx, extraFor ? extraFor(o) : ''))).filter((x) => x.score > -50);
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored[0];
  }
  /* ---------- the decision ---------- */
  const TAKEN_RE = /just (been )?(booked|taken)|no longer available|only \d+ seats? left|sold out|were just taken|already (booked|taken)|is full\b|not available any ?more/i;
  const DONE_RE = /you'?re booked|booking (is )?confirmed|appointment (is )?confirmed|rsvp is confirmed|application received|you'?re in line|see you soon|thank you for (booking|your)|reservation confirmed|order (placed|confirmed)|successfully (booked|submitted)/i;
  const BACKISH = /^(back|edit|previous|cancel|‹|›|«|»|<|>|↻|×|close)\b|edit details|previous month|next month|show new|cookie|reject|accept all|no thanks|subscribe/i;
  const FORWARD = /^(continue|next|review|proceed|go on|book|confirm|submit|send|save|rsvp|apply|reserve|complete|finish|schedule|request|place|pay|check ?out|register)\b/i;
  function isDateBtn(it) { return it.role === 'button' && /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i.test(it.name) && !!parseLongDate(it.name); }
  function isSlotBtn(it) { return it.role === 'button' && /^\d{1,2}:\d{2}\s*(am|pm)\b/i.test(it.name); }
  function slotMin(it) { return timesIn(it.name)[0]; }
  function mk(thought, action, meta) { return { thought, action, meta: meta || {} }; }

  function decide(snap, ctx) {
    const g = ctx.goal; ctx.answers = ctx.answers || {}; ctx.filled = ctx.filled || {}; ctx.attempts = ctx.attempts || {}; ctx.skipped = ctx.skipped || {}; ctx.failed = ctx.failed || {}; ctx.tried = ctx.tried || {}; ctx.seenAlerts = ctx.seenAlerts || {}; ctx.handed = ctx.handed || {}; ctx.pending = ctx.pending || {}; ctx.asked = ctx.asked || {};
    const items = snap.items || [];
    if (snap.busy) return mk('The page is still loading.', { type: 'wait', ms: 300 });
    // 1. finished?
    const doneText = items.filter((x) => !x.ref && (x.role === 'heading' || x.role === 'status')).map((x) => x.name).find((t) => DONE_RE.test(t));
    if (doneText && !items.some((x) => x.ref && x.role === 'textbox' && !x.disabled && !x.dialog && !x.value && x.required)) return mk('The site shows a confirmation ("' + doneText.slice(0, 80) + '"). Done.', { type: 'done' });
    // 2. obstacles: cookie walls and pop-ups (never accept tracking, never subscribe)
    for (const d of snap.dialogs || []) {
      const inside = items.filter((x) => x.ref && x.dialog === d.name && x.role === 'button' && !x.disabled);
      if (!inside.length) continue;
      if (/cookie|consent|privacy|tracking/i.test(d.name + ' ' + d.text)) { const b = inside.find((x) => /reject|decline|only (necessary|essential)|necessary only|essential only/i.test(x.name)) || inside.find((x) => /settings|manage|preferences/i.test(x.name)) || inside.find((x) => /close|×|dismiss/i.test(x.name)); if (b) return mk('A cookie banner covers the page. I\u2019ll choose "' + b.name + '" (no optional tracking).', { type: 'click', ref: b.ref }, { obstacle: true }); }
      const b = inside.find((x) => /no thanks|not now|maybe later|dismiss|^close$|^×$|skip|continue without/i.test(x.name));
      if (b) return mk('A pop-up ("' + d.name + '") is in the way. Closing it with "' + b.name + '" without signing up for anything.', { type: 'click', ref: b.ref }, { obstacle: true });
    }
    // 3. "taken / full" alerts -> re-plan
    let replanNote = '';
    for (const a of items.filter((x) => !x.ref && (x.role === 'alert'))) {
      if (!TAKEN_RE.test(a.name) || ctx.seenAlerts[a.name]) continue;
      ctx.seenAlerts[a.name] = true; ctx.replans = (ctx.replans || 0) + 1;
      const t = timesIn(a.name)[0]; const dIso = parseLongDate(a.name, g.today) || ctx.chosenDate;
      if (t != null && dIso) ctx.failed[dIso + '|' + t] = true;
      for (const r of items.filter((x) => x.role === 'radio' && x.checked)) { const head = r.name.split(' · ').slice(0, 2).join(' · '); if (low(a.name).includes(low(head)) || (t != null && timesIn(r.name)[0] === t && (!dIso || parseLongDate(r.name, g.today) === dIso))) ctx.failed['choice|' + low(r.name)] = true; }
      replanNote = 'Re-planning: the site says "' + a.name.slice(0, 140) + '". ';
      ctx.events && ctx.events.push({ type: 'replan', text: a.name });
    }
    const usable = items.filter((x) => x.ref && !x.dialog && !x.hidden);
    // 4. walk the form in order
    const doneGroups = new Set(); let dateHandled = false;
    for (let idx = 0; idx < usable.length; idx++) {
      const it = usable[idx];
      if (it.disabled || it.readonly) continue;
      const key = fieldKey(it);
      // calendars and time slots
      if ((isDateBtn(it) || isSlotBtn(it)) && !dateHandled) { dateHandled = true; const r = pickDateTime(usable, ctx, replanNote); if (r) return r; continue; }
      if (isDateBtn(it) || isSlotBtn(it)) continue;
      if (it.role === 'radio') {
        const gk = it.field || it.group || it.name; if (doneGroups.has(gk)) continue; doneGroups.add(gk);
        const groupItems = usable.filter((x) => x.role === 'radio' && (x.field || x.group || x.name) === gk);
        const checked = groupItems.find((x) => x.checked);
        if (checked && !ctx.failed['choice|' + low(checked.name)]) continue;
        const opts = groupItems.filter((x) => !x.disabled && !ctx.failed['choice|' + low(x.name)]);
        const label = groupLabel(groupItems);
        const best = bestOption(opts, ctx, (o) => o.group || '');
        if (best && best.score > 0) return mk(replanNote + (checked ? 'Choosing another option for "' + label + '": ' : 'For "' + label + '" I\u2019ll pick ') + '"' + best.o.name + '"' + (best.why ? ' (' + best.why + ')' : '') + '.', { type: 'click', ref: best.o.ref }, { key: 'choice:' + label, label, value: best.o.name, source: best.why === 'no preference' ? 'no preference given' : 'your goal' });
        if (ctx.answers['choice:' + label]) { const pick = opts.find((o) => low(o.name) === low(ctx.answers['choice:' + label])); if (pick) return mk('Using your answer for "' + label + '": "' + pick.name + '".', { type: 'click', ref: pick.ref }, { key: 'choice:' + label, label, value: pick.name, source: 'your answer' }); }
        if (!opts.length) return mk(replanNote + 'Every option for "' + label + '" is unavailable or already failed.', { type: 'fail', reason: 'No available option left for "' + label + '".' });
        return mk(replanNote + 'Your goal does not say which "' + label + '" you want.', { type: 'ask', key: 'choice:' + label, question: 'Which "' + label + '" should I choose?', choices: opts.map((o) => o.name).slice(0, 12) });
      }
      if (it.role === 'checkbox') {
        if (it.checked) continue;
        if (it.sensitive) continue;
        const required = it.required || it.invalid;
        if (required && !it.optional) return mk('"' + it.name + '" is required to continue, so I\u2019ll tick it. It will be listed in the review before anything is submitted.', { type: 'check', ref: it.ref }, { key, label: it.name, value: 'Yes (ticked)', source: 'required by the site' });
        if (g.wantsReminders && /remind/i.test(it.name)) return mk('You asked for reminders, so I\u2019ll tick "' + it.name + '".', { type: 'check', ref: it.ref }, { key, label: it.name, value: 'Yes (ticked)', source: 'your goal' });
        continue; // optional boxes (marketing, newsletters) stay unticked
      }
      if (it.role === 'combobox') {
        if (it.value && !it.invalid) continue;
        if (ctx.skipped[key] && !it.invalid) continue;
        const src = sourceFor(it, ctx);
        let want = src.value != null ? matchOption(it.options, src.value) : null;
        let why = src.source;
        if (!want) { const best = bestOption((it.options || []).map((o) => ({ name: o })), ctx, () => it.name); if (best && best.score > 0.5 && !src.value) { want = best.o.name; why = 'your goal (' + (best.why || 'best match') + ')'; } }
        if (want) return mk(replanNote + 'Setting "' + it.name + '" to "' + want + '" from ' + why + '.', { type: 'select', ref: it.ref, value: want }, { key, label: it.name, value: want, source: why });
        if (!it.required && !it.invalid) { ctx.skipped[key] = true; continue; }
        return mk('The form needs "' + it.name + '" and I have nothing to go on.', { type: 'ask', key, question: 'What should I choose for "' + it.name + '"?' + (it.error ? ' The site says: ' + it.error : ''), choices: (it.options || []).filter((o) => !GUARD.scanText(o) && !/https?:/.test(o)).slice(0, 15) });
      }
      if (it.role === 'textbox') {
        if (it.sensitive) {
          if (it.filled && !it.invalid) continue;
          if ((it.sensitive === 'ssn' || it.sensitive === 'bank') && !it.required) { if (!ctx.skipped[key]) { ctx.skipped[key] = true; ctx.events && ctx.events.push({ type: 'skip', text: '"' + it.name + '" left blank: FormPilot never types ' + GUARD.labelSensitive(it.sensitive) + 's, and it is optional.' }); } continue; }
          if (it.optional && !it.invalid) continue;
          const group = usable.filter((x) => x.role === 'textbox' && x.sensitive && (!x.filled || x.invalid) && !x.disabled && !(((x.sensitive === 'ssn' || x.sensitive === 'bank') && !x.required) || (x.optional && !x.invalid)));
          return mk('"' + group.map((x) => x.name).join('", "') + '" ' + (group.length > 1 ? 'need you: ' + Array.from(new Set(group.map((x) => GUARD.labelSensitive(x.sensitive)))).join(' and ') + ' fields' : 'is a ' + GUARD.labelSensitive(it.sensitive) + ' field') + '. I never type those, so it\u2019s your turn.' + (it.invalid ? ' (The site says: ' + it.error + ')' : ''), { type: 'handoff', ref: it.ref, refs: group.map((x) => x.ref), fields: group.map((x) => x.name), kinds: group.map((x) => x.sensitive), kind: it.sensitive, keys: group.map(fieldKey) });
        }
        const capacity = it.invalid && TAKEN_RE.test(it.error || '');
        if (it.value && (!it.invalid || capacity)) continue;
        ctx.attempts[key] = (ctx.attempts[key] || 0);
        if (it.invalid && it.value && ctx.pending[key] != null && String(ctx.pending[key]).replace(/\s+/g, ' ').trim() === String(it.value).replace(/\s+/g, ' ').trim()) continue; // corrected value typed; the site re-checks it on the next submit
        if (it.invalid && it.value) {
          ctx.attempts[key]++;
          const fixed = ctx.attempts[key] <= 2 ? fixByError(it.value, it) : null;
          if (fixed) ctx.pending[key] = fixed;
          if (fixed) return mk('The site rejected "' + it.name + '": "' + it.error + '". Reformatting "' + it.value + '" as "' + fixed + '".', { type: 'type', ref: it.ref, value: fixed, clear: true }, { key, label: it.name, value: fixed, source: (ctx.filled[key] && ctx.filled[key].source ? ctx.filled[key].source + ', ' : '') + 'reformatted for the site', fix: true });
          if (ctx.answers[key] != null && ctx.answers[key] !== it.value && ctx.attempts[key] <= 3) ctx.pending[key] = ctx.answers[key];
          if (ctx.answers[key] != null && ctx.answers[key] !== it.value && ctx.attempts[key] <= 3) return mk('Using your corrected answer for "' + it.name + '".', { type: 'type', ref: it.ref, value: ctx.answers[key], clear: true }, { key, label: it.name, value: ctx.answers[key], source: 'your answer' });
          delete ctx.answers[key];
          if ((ctx.asked[key] = (ctx.asked[key] || 0) + 1) > 2) return mk('The site keeps rejecting "' + it.name + '".', { type: 'fail', reason: 'The site rejected "' + it.name + '" three times ("' + it.error + '"). Stopped so you can check it.' });
          return mk('The site rejected "' + it.name + '" ("' + it.error + '") and I cannot fix it from your profile.', { type: 'ask', key, question: 'The site says: "' + it.error + '" What should I enter for "' + it.name + '"?', current: it.value, saveAs: suggestSave(it) });
        }
        if (ctx.skipped[key] && !it.invalid) continue;
        const src = sourceFor(it, ctx);
        if (src.value != null && src.value !== '' && /one per line|each on (its|a) own line/i.test(it.name + ' ' + (it.description || '') + ' ' + (it.error || '')) && !/\n/.test(String(src.value)) && /[,;]/.test(String(src.value))) src.value = String(src.value).split(/\s*(?:[,;]|\band\b)\s*/).filter(Boolean).join('\n');
        if (src.value != null && src.value !== '' && it.invalid) ctx.pending[key] = String(src.value);
        if (src.value != null && src.value !== '') { if ((ctx.attempts[key + '|typed'] = (ctx.attempts[key + '|typed'] || 0) + 1) > 3) return mk('"' + it.name + '" keeps getting cleared.', { type: 'fail', reason: 'The site keeps clearing "' + it.name + '".' }); return mk('Typing ' + src.source + ' into "' + it.name + '".', { type: 'type', ref: it.ref, value: String(src.value), clear: true }, { key, label: it.name, value: String(src.value), source: src.source }); }
        if (src.optional || it.optional || (!it.required && !it.invalid && (src.unknown || src.missing))) { if (!it.required && !it.invalid) { ctx.skipped[key] = true; continue; } }
        return mk('"' + it.name + '" is required and isn\u2019t in your profile or goal. I\u2019ll ask instead of guessing.', { type: 'ask', key, question: 'The form asks for "' + it.name + '"' + (it.description ? ' (' + it.description + ')' : '') + '. What should I enter?', multiline: it.type === 'textarea', saveAs: suggestSave(it) });
      }
    }
    // 5. forward button
    const buttons = usable.filter((x) => (x.role === 'button') && !x.disabled && !isDateBtn(x) && !isSlotBtn(x) && !BACKISH.test(x.name));
    const fwd = buttons.find((x) => FORWARD.test(x.name)) || buttons[buttons.length - 1];
    if (fwd) {
      ctx.pending = {}; // the site re-validates corrected fields on this click
      const fk = 'btn|' + low(fwd.name) + '|' + snap.url;
      ctx.attempts[fk] = (ctx.attempts[fk] || 0) + 1;
      if (ctx.attempts[fk] > 4) return mk('I clicked "' + fwd.name + '" several times without getting further.', { type: 'fail', reason: 'Stuck on ' + snap.url + ' after clicking "' + fwd.name + '" 4 times.' });
      if (GUARD.isFinal(fwd)) return mk(replanNote + 'Everything is filled in. "' + fwd.name + '" will submit, so I\u2019ll show you the review and wait for your approval.', { type: 'submit', ref: fwd.ref }, { final: true });
      return mk(replanNote + 'This step is complete. Clicking "' + fwd.name + '".', { type: 'click', ref: fwd.ref });
    }
    const off = items.find((x) => x.ref && x.offscreen); if (off && !ctx.scrolled) { ctx.scrolled = true; return mk('Nothing to do in view; scrolling.', { type: 'scroll', ref: off.ref }); }
    return mk('I cannot find a next step on this page.', { type: 'fail', reason: 'No next step found on ' + snap.url + '.' });
  }
  function groupLabel(radios) { return radios[0].group || radios[0].field || 'option'; }
  function suggestSave(it) { const l = low(it.name); if (/plate/.test(l)) return 'License plate'; if (/emergency/.test(l)) return it.name; return null; }

  function pickDateTime(usable, ctx, replanNote) {
    const g = ctx.goal; const dates = usable.filter(isDateBtn); const slots = usable.filter(isSlotBtn);
    const allDates = dates.map((d) => ({ it: d, iso: parseLongDate(d.name, g.today) }));
    const chosen = allDates.find((d) => d.it.pressed);
    if (!g.date) { g.date = { type: 'range', from: g.today, to: G.iso(G.addDays(G.fromIso(g.today), 90)), label: 'the first available day', assumed: true }; ctx.events && ctx.events.push({ type: 'assume', text: 'No date in your goal, so I am looking for the first available day.' }); }
    const desc = g.time ? ' ' + g.time.label : '';
    if (chosen && dateOk(chosen.iso, g) && !ctx.tried[chosen.iso]) {
      ctx.chosenDate = chosen.iso;
      if (!slots.length) return mk('Waiting for times on ' + G.nice(G.fromIso(chosen.iso)) + '.', { type: 'wait', ms: 300 });
      const pressed = slots.find((s) => s.pressed && !s.disabled);
      if (pressed && timeOk(slotMin(pressed), g) && !ctx.failed[chosen.iso + '|' + slotMin(pressed)]) return null; // date+time done; continue with the rest of the form
      const cands = slots.filter((s) => !s.disabled && timeOk(slotMin(s), g) && !ctx.failed[chosen.iso + '|' + slotMin(s)]);
      if (cands.length) { const s = cands[0]; const full = slots.filter((x) => x.disabled && timeOk(slotMin(x), g)).length; return mk(replanNote + 'On ' + G.nice(G.fromIso(chosen.iso)) + ' the earliest open time' + desc + ' is ' + s.name + (full ? ' (' + full + ' matching time' + (full > 1 ? 's are' : ' is') + ' full)' : '') + '.', { type: 'click', ref: s.ref }, { key: 'time', label: 'Time', value: s.name, source: 'your goal' + (desc ? ' (' + g.time.label + ')' : '') }); }
      ctx.tried[chosen.iso] = true; ctx.events && ctx.events.push({ type: 'replan', text: 'No open times' + desc + ' on ' + G.nice(G.fromIso(chosen.iso)) + '.' });
      replanNote += 'No open times' + desc + ' on ' + G.nice(G.fromIso(chosen.iso)) + '. ';
    }
    if (g.date.type === 'exact') {
      const target = allDates.find((d) => d.iso === g.date.iso);
      if (target && !target.it.disabled && !ctx.tried[target.iso]) return mk(replanNote + 'Your goal says ' + g.date.label + '. Selecting ' + target.it.name.split(',').slice(0, 3).join(',') + '.', { type: 'click', ref: target.it.ref }, { key: 'date', label: 'Date', value: G.nice(G.fromIso(target.iso)), source: 'your goal' });
      if (!target) { const nav = monthNav(usable, allDates, g.date.iso); if (nav) return nav; }
      if (ctx.answers['date-fallback'] && /^yes/i.test(ctx.answers['date-fallback'])) { g.date = { type: 'range', from: g.date.iso, to: G.iso(G.addDays(G.fromIso(g.date.iso), 60)), label: 'the next available day after ' + g.date.label }; return pickDateTime(usable, ctx, replanNote); }
      if (ctx.answers['date-fallback']) return mk('You chose not to look at other days.', { type: 'fail', reason: 'No opening on ' + g.date.label + desc + ', and you chose to stop.' });
      return mk(replanNote + 'There is no opening on ' + g.date.label + desc + '.', { type: 'ask', key: 'date-fallback', question: 'No openings on ' + g.date.label + desc + '. Should I take the next available day' + desc + ' instead?', choices: ['Yes, next available day', 'No, stop here'] });
    }
    const cands = allDates.filter((d) => !d.it.disabled && dateOk(d.iso, g) && !ctx.tried[d.iso]);
    if (cands.length) { const d = cands[0]; return mk(replanNote + 'Looking for ' + g.date.label + desc + ': trying ' + G.nice(G.fromIso(d.iso)) + '.', { type: 'click', ref: d.it.ref }, { key: 'date', label: 'Date', value: G.nice(G.fromIso(d.iso)), source: 'your goal (' + g.date.label + ')' }); }
    const last = allDates.length ? allDates[allDates.length - 1].iso : null;
    if (last && last < g.date.to) { const nav = monthNav(usable, allDates, G.iso(G.addDays(G.fromIso(last), 1))); if (nav) return nav; }
    return mk(replanNote + 'No day matches ' + g.date.label + desc + ' in what the site offers.', { type: 'fail', reason: 'No opening found for ' + g.date.label + desc + '.' });
  }
  function monthNav(usable, allDates, wantIso) {
    if (!allDates.length) return null;
    const first = allDates[0].iso; const last = allDates[allDates.length - 1].iso;
    const nextB = usable.find((x) => x.role === 'button' && !x.disabled && /next month|^next$|^›$|^»$|later dates|more dates/i.test(x.name));
    const prevB = usable.find((x) => x.role === 'button' && !x.disabled && /previous month|^prev|^‹$|^«$|earlier dates/i.test(x.name));
    if (wantIso > last && nextB) return mk('The date I need is after ' + G.nice(G.fromIso(last)) + '. Going to the next month.', { type: 'click', ref: nextB.ref });
    if (wantIso < first && prevB) return mk('Going back a month.', { type: 'click', ref: prevB.ref });
    return null;
  }
  function create() { return { name: 'rules', label: 'Demo planner (rules, no key)', async next(snap, ctx) { return decide(snap, ctx); } }; }
  return { create, decide, sourceFor, fixByError, formatDate, parseLongDate, timesIn, scoreOption, bestOption, matchOption, fieldKey, DEFAULT_PROFILE, PROFILE_FIELDS, STATES, TAKEN_RE, DONE_RE, isDateBtn, isSlotBtn, toIso };
});
