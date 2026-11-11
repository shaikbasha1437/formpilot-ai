/* FormPilot goal parser (demo mode): turns "Book a cleaning with Dr. Patel next Tuesday after 3pm"
   into structured hints: which sandbox site, date (exact or range), time window, party size, names,
   free-text notes. Everything is resolved against a given "today" so it is unit-testable. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormPilotGoal = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const WD3 = WD.map((d) => d.slice(0, 3));
  const MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const SITES = [
    { id: 'dental', host: 'brightsmile-dental.example', re: /\b(dental|dentist|teeth|tooth|cleaning|checkup|check-up|x-?rays?|whitening|filling|brightsmile|dr\.? (patel|kim|alvarez))\b/i },
    { id: 'salon', host: 'shearstudio.example', re: /\b(hair|haircut|salon|stylist|blowout|blow-out|color|colour|trim|shear studio|men'?s cut|women'?s cut|kids'? cut)\b/i },
    { id: 'permit', host: 'permits.maplewood.example', re: /\b(permit|block party|yard sale|street parking|maplewood permit|city of maplewood)\b/i },
    { id: 'rsvp', host: 'lanternfest.example', re: /\b(rsvp|supper|lanternfest|dumplings?|jazz|pasta workshop|seats? for)\b/i },
    { id: 'clinic', host: 'quickcare-clinic.example', re: /\b(clinic|walk-?in|quickcare|flu shot|urgent care|sore throat|sprain|physical|save (me )?a spot|place in line)\b/i }
  ];
  function midnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return midnight(x); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fromIso(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function nice(d) { return WD[d.getDay()][0].toUpperCase() + WD[d.getDay()].slice(1, 3) + ', ' + MON[d.getMonth()][0].toUpperCase() + MON[d.getMonth()].slice(1, 3) + ' ' + d.getDate(); }
  function timeLabel(min) { const h = Math.floor(min / 60); const m = min % 60; return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); }
  /* "3", "3pm", "3:30 pm", "15:00", "noon" -> minutes. Bare hours 1-7 are PM, 8-11 AM. */
  function parseClock(s, hintPm) {
    s = String(s).toLowerCase().trim();
    if (/^noon|^midday/.test(s)) return 720; if (/^midnight/.test(s)) return 0;
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(s); if (!m) return null;
    let h = +m[1]; const mm = +(m[2] || 0); if (h > 23 || mm > 59) return null;
    const ap = m[3] ? m[3][0] : null;
    if (ap === 'p' && h < 12) h += 12; else if (ap === 'a' && h === 12) h = 0; else if (!ap && h <= 12) { if (hintPm === true && h < 12) h += 12; else if (hintPm == null && h >= 1 && h <= 7) h += 12; }
    return h * 60 + mm;
  }
  const CLOCK = '(\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?|noon|midday)';
  function parseTime(t) {
    let m;
    if ((m = new RegExp('\\bfrom\\s+' + CLOCK + '\\s*(?:to|until|till|-|–)\\s*' + CLOCK, 'i').exec(t))) { const b = parseClock(m[2]); let a = parseClock(m[1], /pm/i.test(m[2]) && !/am/i.test(m[1]) ? (parseInt(m[1], 10) < 12 && parseInt(m[1], 10) < parseInt(m[2], 10) ? true : null) : null); if (a != null && b != null) return { from: a, to: b, span: true, label: timeLabel(a) + ' to ' + timeLabel(b) }; }
    if ((m = new RegExp('\\bbetween\\s+' + CLOCK + '\\s*(?:and|-|–|to)\\s*' + CLOCK, 'i').exec(t))) { const b = parseClock(m[2]); const a = parseClock(m[1], /pm/i.test(m[2]) && parseInt(m[1], 10) < parseInt(m[2], 10) ? true : null); if (a != null && b != null) return { from: a, to: b, label: 'between ' + timeLabel(a) + ' and ' + timeLabel(b) }; }
    if ((m = new RegExp('\\b(?:after|from|later than|no earlier than)\\s+' + CLOCK, 'i').exec(t))) { const a = parseClock(m[1]); if (a != null) return { from: a, to: 24 * 60, label: 'after ' + timeLabel(a) }; }
    if ((m = new RegExp('\\b(?:before|by|earlier than|no later than)\\s+' + CLOCK, 'i').exec(t))) { const b = parseClock(m[1]); if (b != null) return { from: 0, to: b - 1, label: 'before ' + timeLabel(b) }; }
    if ((m = new RegExp('\\b(?:around|about|approximately|~)\\s*' + CLOCK, 'i').exec(t))) { const a = parseClock(m[1]); if (a != null) return { from: a - 60, to: a + 60, label: 'around ' + timeLabel(a) }; }
    if ((m = new RegExp('\\bat\\s+' + CLOCK + '(?!\\s*(?:people|guests|persons))', 'i').exec(t)) && /\d|noon/.test(m[1])) { const a = parseClock(m[1]); if (a != null) return { from: a, to: a, exact: true, label: 'at ' + timeLabel(a) }; }
    if (/\bmorning\b/i.test(t)) return { from: 0, to: 719, label: 'in the morning' };
    if (/\b(lunch|lunchtime|midday)\b/i.test(t)) return { from: 690, to: 810, label: 'around lunch' };
    if (/\bafternoon\b/i.test(t)) return { from: 720, to: 1019, label: 'in the afternoon' };
    if (/\b(evening|tonight|after work)\b/i.test(t)) return { from: 1020, to: 1440, label: 'in the evening' };
    return null;
  }
  function parseDate(t, today) {
    const T = midnight(today); let m;
    const lower = t.toLowerCase();
    const wdRe = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|r?sday)?';
    const wdIdx = (s) => WD3.indexOf(s.slice(0, 3).toLowerCase());
    if (/\b(first available|earliest|soonest|asap|as soon as possible|next available)\b/.test(lower) && !new RegExp('\\b(next available)\\s+' + wdRe + '\\b').test(lower)) return { type: 'range', from: iso(addDays(T, 0)), to: iso(addDays(T, 90)), label: 'the first available day' };
    if ((m = new RegExp('\\b(?:any|a|next available|the first)\\s+' + wdRe + '\\b', 'i').exec(lower))) { const w = wdIdx(m[1]); if (w >= 0) return { type: 'range', from: iso(addDays(T, 1)), to: iso(addDays(T, 60)), weekdays: [w], label: 'the first available ' + WD[w][0].toUpperCase() + WD[w].slice(1) }; }
    if (/\bday after tomorrow\b/.test(lower)) { const d = addDays(T, 2); return { type: 'exact', iso: iso(d), label: nice(d) }; }
    if (/\btomorrow\b/.test(lower)) { const d = addDays(T, 1); return { type: 'exact', iso: iso(d), label: nice(d) + ' (tomorrow)' }; }
    if (/\b(today|tonight|this evening)\b/.test(lower)) return { type: 'exact', iso: iso(T), label: nice(T) + ' (today)' };
    if ((m = /\bin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week)s?\b/.exec(lower))) { const n = NUM[m[1]] || +m[1]; const d = addDays(T, m[2] === 'week' ? n * 7 : n); return { type: 'exact', iso: iso(d), label: nice(d) }; }
    if (/\bthis weekend\b/.test(lower)) { let d = addDays(T, 0); while (d.getDay() !== 6) d = addDays(d, 1); return { type: 'range', from: iso(d), to: iso(addDays(d, 1)), label: 'this weekend (' + nice(d) + ' – ' + nice(addDays(d, 1)) + ')' }; }
    if (/\bnext week\b/.test(lower) && !new RegExp('next week\\s+(on\\s+)?' + wdRe).test(lower)) { let d = addDays(T, 1); while (d.getDay() !== 1) d = addDays(d, 1); return { type: 'range', from: iso(d), to: iso(addDays(d, 6)), label: 'next week (' + nice(d) + ' – ' + nice(addDays(d, 6)) + ')' }; }
    if (/\bthis week\b/.test(lower)) { let e = addDays(T, 0); while (e.getDay() !== 0) e = addDays(e, 1); return { type: 'range', from: iso(addDays(T, 1)), to: iso(e), label: 'this week' }; }
    // explicit dates: 2026-11-20, 11/20(/2026), Nov 20(th)(, 2026), 20 November
    if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower))) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return { type: 'exact', iso: iso(d), label: nice(d) }; }
    const fix = (mo, da, yr) => { let d = new Date(yr || T.getFullYear(), mo, da); if (!yr && d < T) d = new Date(T.getFullYear() + 1, mo, da); return d; };
    if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower))) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0; const d = fix(+m[1] - 1, +m[2], y); if (d.getMonth() === +m[1] - 1) return { type: 'exact', iso: iso(d), label: nice(d) }; }
    const monRe = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
    if ((m = new RegExp('\\b' + monRe + '\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b').exec(lower))) { const d = fix(MON.findIndex((x) => x.startsWith(m[1].slice(0, 3))), +m[2], m[3] ? +m[3] : 0); return { type: 'exact', iso: iso(d), label: nice(d) }; }
    if ((m = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + monRe + '(?:,?\\s*(\\d{4}))?\\b').exec(lower))) { const d = fix(MON.findIndex((x) => x.startsWith(m[2].slice(0, 3))), +m[1], m[3] ? +m[3] : 0); return { type: 'exact', iso: iso(d), label: nice(d) }; }
    // weekday words: "next tuesday", "this friday", "on saturday", "tuesday after next"
    if ((m = new RegExp('\\b(next|this|on|coming|upcoming)?\\s*' + wdRe + '\\b(\\s+after next)?', 'i').exec(lower))) {
      const w = wdIdx(m[2]);
      if (w >= 0 && !/^(sat|sun)$/.test('') ) { let d = addDays(T, 1); while (d.getDay() !== w) d = addDays(d, 1); if (m[3]) d = addDays(d, 7); if (/next week/.test(lower)) { let mon = addDays(T, 1); while (mon.getDay() !== 1) mon = addDays(mon, 1); d = mon; while (d.getDay() !== w) d = addDays(d, 1); } return { type: 'exact', iso: iso(d), label: nice(d), phrase: norm(m[0]) }; }
    }
    return null;
  }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function parseCount(t) {
    let m;
    if ((m = /\b(?:party of|table for|group of|for a group of|seats? for|rsvp for|tickets? for|spots? for|reservation for)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?!\s*(?::|am|pm|a\.m|p\.m|o'?clock))/i.exec(t))) return NUM[m[1].toLowerCase()] || +m[1];
    if ((m = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:people|persons|guests|adults|of us|attendees|neighbors|neighbours|seats|tickets|spots|places)\b/i.exec(t))) return NUM[m[1].toLowerCase()] || +m[1];
    if ((m = /\bfor\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?!\s*(?::|am|pm|a\.m|p\.m|o'?clock|min|hour|day|week))/i.exec(t))) return NUM[m[1].toLowerCase()] || +m[1];
    if (/\b(me and my|my (wife|husband|partner|friend) and (i|me)|the two of us|for two)\b/i.test(t)) return 2;
    if (/\b(just me|only me|for one|for myself|for me)\b/i.test(t)) return 1;
    return null;
  }
  const STOP = new Set('a an the and or but for to of in on at by with my me i we our us please book make get schedule reserve rsvp find want would like need can could appointment appointments next this that some any after before around about from between until till via online one up it is be am pm do let s visit people person persons guests'.split(' '));
  function tokens(t) { return String(t || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w) && !/^\d+(am|pm)$/.test(w)); }
  function parse(text, today, siteHint) {
    const t = norm(text);
    const T = midnight(today || new Date());
    const site = siteHint || (SITES.find((s) => s.re.test(t)) || {}).id || null;
    const time = parseTime(t);
    const date = parseDate(t, T);
    const count = parseCount(t);
    const names = []; let m; const nameRe = /\b(?:Dr\.?|Doctor)\s+([A-Z][a-z]+)|\bwith\s+(?!Dr\b|Doctor\b)([A-Z][a-z]+)\b/g;
    while ((m = nameRe.exec(t))) names.push(m[1] || m[2]);
    let notes = null; if ((m = /\b(?:note|notes|mention|tell them|add a note)\s*[:,-]?\s*(?:that\s+)?["“]?([^"”]+?)["”]?\s*(?:$|\.(?:\s|$))/i.exec(t))) notes = m[1].trim();
    let diet = null; if ((m = /\b((?:one |two |\d )?(?:vegetarian|vegan|gluten[- ]free|nut allergy|dairy[- ]free|pescatarian|halal|kosher)[^,.;]*)/i.exec(t))) diet = m[1].trim();
    let street = null; if ((m = /\b(?:on|at|for)\s+((?:the\s+)?(?:\d+\s+block of\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Way|Place|Pl))\b\.?/.exec(t))) street = m[1].replace(/^the\s+/i, '');
    let plate = null; if ((m = /\bplate\s*(?:number|#)?\s*(?:is\s*)?([A-Z0-9]{2,4}[- ]?[A-Z0-9]{2,4})\b/i.exec(t))) plate = m[1].toUpperCase();
    const wantsReminders = /\b(text|sms) (me )?reminders?\b|\bremind me\b/i.test(t);
    const span = time && time.span ? { start: time.from, end: time.to } : null;
    return { raw: t, site, date, time, count, names, notes, diet, street, plate, wantsReminders, span, tokens: tokens(t), today: iso(T) };
  }
  function describe(g) {
    const parts = [];
    if (g.date) parts.push(g.date.type === 'exact' ? 'date ' + g.date.label : g.date.label + (g.date.weekdays ? '' : ''));
    if (g.time) parts.push('time ' + g.time.label);
    if (g.count) parts.push(g.count + (g.count === 1 ? ' person' : ' people'));
    if (g.names.length) parts.push('with ' + g.names.join(', '));
    if (g.street) parts.push('at ' + g.street);
    if (g.diet) parts.push('dietary: ' + g.diet);
    if (g.notes) parts.push('note: "' + g.notes + '"');
    return parts.join(' · ');
  }
  return { SITES, parse, parseDate, parseTime, parseClock, parseCount, tokens, describe, iso, fromIso, addDays, midnight, timeLabel, nice, WD, MON };
});
