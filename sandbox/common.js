/* FormPilot sandbox "backend": shared by the five fictional sites. Everything lives in this browser's
   localStorage under fp.sandbox.*; nothing is sent anywhere. Pure date/availability helpers are
   exported for Node tests too. All businesses, people and domains (*.example) are fictional. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FPS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function midnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return midnight(x); }
  function iso(d) { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
  function fromIso(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function longDate(d) { const x = new Date(d); return DAYS[x.getDay()] + ', ' + MONTHS[x.getMonth()] + ' ' + x.getDate() + ', ' + x.getFullYear(); }
  function shortDate(d) { const x = new Date(d); return DAYS[x.getDay()].slice(0, 3) + ', ' + MONTHS[x.getMonth()].slice(0, 3) + ' ' + x.getDate(); }
  function timeLabel(min) { const h = Math.floor(min / 60); const m = min % 60; return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function nextWeekday(from, wd) { let d = addDays(from, 1); while (d.getDay() !== wd) d = addDays(d, 1); return d; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function thanksgiving(y) { let d = new Date(y, 10, 1); let n = 0; while (true) { if (d.getDay() === 4 && ++n === 4) return iso(d); d = addDays(d, 1); } }
  function closedReason(dateIso) { const d = fromIso(dateIso); const y = d.getFullYear(); if (dateIso === thanksgiving(y)) return 'Closed for Thanksgiving'; if (/-12-25$|-01-01$/.test(dateIso)) return 'Closed for the holiday'; return ''; }

  /* ---------------- persistent state ---------------- */
  const KEY = 'fp.sandbox.state';
  function blank() { return { bookings: [], taken: {}, seq: 1 }; }
  function load() { try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || 'null') || {}); } catch (e) { return blank(); } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  function takenKey(site, who, date, time) { return [site, who, date, time].join('|'); }
  function isTaken(site, who, date, time) { return !!load().taken[takenKey(site, who, date, time)]; }
  function markTaken(site, who, date, time, by) { const s = load(); s.taken[takenKey(site, who, date, time)] = by || 'someone-else'; save(s); }
  function code(prefix) { const s = load(); const n = s.seq++; save(s); const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r = ''; let h = hash(prefix + n + Date.now()); for (let i = 0; i < 6; i++) { r += c[h % c.length]; h = Math.floor(h / c.length) || hash(r + i); } return prefix + '-' + r; }
  function book(site, rec) {
    const s = load();
    const b = Object.assign({ site, id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString() }, rec);
    s.bookings.push(b);
    if (rec.slotKey) s.taken[rec.slotKey] = b.id;
    save(s); return b;
  }
  function bookings(site) { return load().bookings.filter((b) => !site || b.site === site); }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  /* ---------------- availability (deterministic, depends only on the date + stored bookings) ---------------- */
  const DENTISTS = [
    { id: 'patel', name: 'Dr. Asha Patel', blurb: 'General dentistry', days: [1, 2, 3, 4, 5] },
    { id: 'kim', name: 'Dr. Ben Kim', blurb: 'Family & kids', days: [1, 3, 4, 6] },
    { id: 'alvarez', name: 'Dr. Lucia Alvarez', blurb: 'Cosmetic & whitening', days: [2, 3, 4, 5, 6] }
  ];
  const DENTAL_TIMES = [540, 570, 600, 630, 660, 690, 780, 810, 840, 870, 900, 930, 960, 990];
  /* status: 'open' | 'full' | 'ghost' (looks open, but someone else grabs it when you try to hold it) */
  function dentalSlot(who, dateIso, min, today) {
    const d = fromIso(dateIso); const t0 = midnight(today || new Date());
    if (!d || d <= t0 || d > addDays(t0, 92) || closedReason(dateIso)) return 'closed';
    const doc = DENTISTS.find((x) => x.id === who); if (!doc || !doc.days.includes(d.getDay())) return 'closed';
    if (isTakenSafe('dental', who, dateIso, min)) return 'full';
    if (who === 'patel' && d.getDay() === 2) { if (min === 900) return 'full'; if (min === 930) return 'ghost'; if (min >= 960) return 'open'; }
    return hash(who + dateIso + min) % 10 < 3 ? 'full' : 'open';
  }
  function dentalDay(who, dateIso, today) {
    const ids = who === 'any' ? DENTISTS.map((d) => d.id) : [who];
    const out = [];
    for (const min of DENTAL_TIMES) { let best = null; for (const id of ids) { const s = dentalSlot(id, dateIso, min, today); if (s === 'open' || s === 'ghost') { best = { min, status: s, who: id }; break; } if (s === 'full' && !best) best = { min, status: 'full', who: id }; } if (best) out.push(best); }
    return out;
  }
  const STYLISTS = [
    { id: 'maya', name: 'Maya Okafor', days: [2, 3, 4, 5, 6] },
    { id: 'theo', name: 'Theo Lindqvist', days: [0, 3, 4, 5, 6] },
    { id: 'priya', name: 'Priya Raman', days: [2, 4, 5, 6, 0] }
  ];
  const SALON_TIMES = []; for (let m = 540; m <= 1050; m += 30) SALON_TIMES.push(m);
  function salonSlot(who, dateIso, min, today) {
    const d = fromIso(dateIso); const t0 = midnight(today || new Date());
    if (!d || d < t0 || d > addDays(t0, 13) || d.getDay() === 1 || closedReason(dateIso)) return 'closed';
    const s = STYLISTS.find((x) => x.id === who); if (!s || !s.days.includes(d.getDay())) return 'closed';
    if (iso(t0) === dateIso) { const now = new Date(); if (min <= now.getHours() * 60 + now.getMinutes() + 60) return 'full'; }
    if (isTakenSafe('salon', who, dateIso, min)) return 'full';
    if (who === 'theo' && d.getDay() === 6 && (min === 540 || min === 570)) return 'full';
    return hash('s' + who + dateIso + min) % 10 < 3 ? 'full' : 'open';
  }
  /* Lanternfest sessions: generated for the next two weeks relative to today. */
  const EVENTS = [
    { id: 'harvest', name: 'Harvest Lantern Supper', blurb: 'Five-course seasonal menu by lantern light, family-style tables.', sessions: [{ wd: 5, min: 1080, cap: 2 }, { wd: 5, min: 1230, cap: 24 }, { wd: 6, min: 1140, cap: 0 }] },
    { id: 'jazz', name: 'Jazz & Dumplings Night', blurb: 'Live trio, hand-folded dumplings, small plates.', sessions: [{ wd: 4, min: 1170, cap: 16 }, { wd: 6, min: 1200, cap: 10 }] },
    { id: 'pasta', name: 'Candlelit Pasta Workshop', blurb: 'Learn to roll three shapes, then eat them.', sessions: [{ wd: 0, min: 1020, cap: 8 }] }
  ];
  function sessions(today) {
    const t0 = midnight(today || new Date()); const out = [];
    for (const ev of EVENTS) for (const s of ev.sessions) { let d = nextWeekday(t0, s.wd); for (let w = 0; w < 2; w++) { const dIso = iso(d); const id = ev.id + '-' + dIso + '-' + s.min; const booked = bookings('rsvp').filter((b) => b.sessionId === id).reduce((a, b) => a + (+b.party || 0), 0); const cap = w === 0 ? s.cap : Math.max(s.cap, 12); out.push({ id, event: ev.id, eventName: ev.name, date: dIso, min: s.min, left: Math.max(0, cap - booked) }); d = addDays(d, 7); } }
    return out.sort((a, b) => (a.date + String(a.min).padStart(4, '0')).localeCompare(b.date + String(b.min).padStart(4, '0')));
  }
  function isTakenSafe(site, who, date, time) { try { return typeof localStorage !== 'undefined' && isTaken(site, who, date, time); } catch (e) { return false; } }

  /* ---------------- tiny DOM helpers for the sites ---------------- */
  function busy(ms) { return new Promise((r) => { if (typeof document === 'undefined') return r(); document.body.setAttribute('aria-busy', 'true'); setTimeout(() => { document.body.removeAttribute('aria-busy'); r(); }, ms || 350); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function setError(input, msg) {
    const id = input.id + '-err'; let el = document.getElementById(id);
    if (!msg) { input.removeAttribute('aria-invalid'); if (el) el.remove(); const d = (input.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== id); if (d.length) input.setAttribute('aria-describedby', d.join(' ')); else input.removeAttribute('aria-describedby'); return; }
    input.setAttribute('aria-invalid', 'true');
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'err'; (input.closest('.field') || input.parentNode).appendChild(el); }
    el.textContent = msg;
    const d = (input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean); if (!d.includes(id)) d.push(id); input.setAttribute('aria-describedby', d.join(' '));
  }
  function summary(host, errs) { host.innerHTML = errs.length ? '<div class="err-summary" role="alert"><b>Please fix ' + errs.length + ' problem' + (errs.length > 1 ? 's' : '') + ':</b><ul>' + errs.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></div>' : ''; }
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v).trim());
  const digits = (v) => String(v || '').replace(/\D/g, '');
  function parseUsDate(v) { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v).trim()); if (!m) return null; const d = new Date(+m[3], +m[1] - 1, +m[2]); return d.getMonth() === +m[1] - 1 && d.getDate() === +m[2] ? d : null; }
  function luhn(n) { const s = digits(n); if (s.length < 13 || s.length > 19) return false; let sum = 0; for (let i = 0; i < s.length; i++) { let x = +s[s.length - 1 - i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } sum += x; } return sum % 10 === 0; }
  return { DAY, DAYS, MONTHS, midnight, addDays, iso, fromIso, longDate, shortDate, timeLabel, nextWeekday, hash, thanksgiving, closedReason, load, save, isTaken, markTaken, code, book, bookings, reset, DENTISTS, DENTAL_TIMES, dentalSlot, dentalDay, STYLISTS, SALON_TIMES, salonSlot, EVENTS, sessions, busy, esc, setError, summary, emailOk, digits, parseUsDate, luhn };
});
