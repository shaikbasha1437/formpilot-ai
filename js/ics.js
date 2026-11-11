/* RFC 5545 calendar file for a booked appointment: CRLF line endings, 75-octet line folding,
   escaped text, UTC times. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormPilotIcs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  function utc(d) { return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'; }
  function esc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function fold(line) {
    const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null; const bytes = (s) => (enc ? enc.encode(s).length : Buffer.byteLength(s));
    if (bytes(line) <= 75) return line;
    const out = []; let cur = ''; let limit = 75;
    for (const ch of line) { if (bytes(cur + ch) > limit) { out.push(cur); cur = ' ' + ch; limit = 75; } else cur += ch; }
    if (cur) out.push(cur); return out.join('\r\n');
  }
  /* ev: { uid, title, start: Date, minutes, location, description, url, alarmMinutes } */
  function build(ev, now) {
    const start = new Date(ev.start); const end = new Date(start.getTime() + (ev.minutes || 60) * 60000);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FormPilot AI//Sandbox booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + esc(ev.uid || ('fp-' + start.getTime() + '@formpilot.example')), 'DTSTAMP:' + utc(now || new Date()), 'DTSTART:' + utc(start), 'DTEND:' + utc(end),
      'SUMMARY:' + esc(ev.title || 'Appointment')];
    if (ev.location) lines.push('LOCATION:' + esc(ev.location));
    if (ev.description) lines.push('DESCRIPTION:' + esc(ev.description));
    if (ev.url) lines.push('URL:' + ev.url);
    lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE');
    if (ev.alarmMinutes !== 0) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc('Reminder: ' + (ev.title || 'Appointment')), 'TRIGGER:-PT' + (ev.alarmMinutes || 60) + 'M', 'END:VALARM');
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  /* Minimal parser used by tests and the in-app preview: unfolds lines and returns the VEVENT fields. */
  function parse(text) {
    const raw = String(text).split('\r\n'); const lines = [];
    for (const l of raw) { if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1); else if (l) lines.push(l); }
    const ev = {}; let inEv = false; let inAlarm = false; const stack = [];
    for (const l of lines) { const i = l.indexOf(':'); const k = l.slice(0, i).split(';')[0]; const v = l.slice(i + 1); if (k === 'BEGIN') { stack.push(v); if (v === 'VEVENT') inEv = true; if (v === 'VALARM') inAlarm = true; } else if (k === 'END') { if (stack.pop() !== v) throw new Error('Unbalanced ' + v); if (v === 'VEVENT') inEv = false; if (v === 'VALARM') inAlarm = false; } else if (inEv && !inAlarm) ev[k] = v.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1'); }
    if (stack.length) throw new Error('Unclosed ' + stack.join(','));
    return { lines, event: ev };
  }
  function toDate(v) { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null; }
  return { build, parse, fold, esc, utc, toDate };
});
