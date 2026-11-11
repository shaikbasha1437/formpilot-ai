/* Shear Studio (fictional): one-page booking with a card hold. */
(function () {
  'use strict';
  const F = window.FPS; const $ = (s) => document.querySelector(s); const esc = F.esc;
  const SERVICES = [
    { id: 'womens', name: "Women's cut & style", min: 60, price: 68 }, { id: 'mens', name: "Men's cut", min: 30, price: 38 },
    { id: 'kids', name: "Kids' cut (under 12)", min: 30, price: 25 }, { id: 'color', name: 'Color & gloss', min: 120, price: 140 }, { id: 'blowout', name: 'Blowout', min: 45, price: 45 }
  ];
  const today = F.midnight(new Date());
  const st = { service: '', who: '', date: null, min: null, f: {} };
  function svc() { return SERVICES.find((s) => s.id === st.service); }
  function render() {
    const days = []; for (let i = 0; i < 14; i++) days.push(F.addDays(today, i));
    const stylists = F.STYLISTS.concat([{ id: 'any', name: 'Any stylist' }]);
    const whoIds = st.who === 'any' ? F.STYLISTS.map((s) => s.id) : st.who ? [st.who] : [];
    const slotFor = (dIso, min) => { let full = false; for (const id of whoIds) { const s = F.salonSlot(id, dIso, min, today); if (s === 'open') return { status: 'open', who: id }; if (s === 'full') full = true; } return full ? { status: 'full' } : null; };
    const dayOpen = (dIso) => F.SALON_TIMES.some((m) => { const s = slotFor(dIso, m); return s && s.status === 'open'; });
    let html = '<h1>Book an appointment</h1><p class="sub">Closed Mondays. A card holds your booking; you are only charged if you miss it.</p><form id="f" class="card" novalidate><div id="es"></div>' +
      '<div class="field"><label for="service">Service <span class="req" aria-hidden="true">*</span></label><select id="service" required><option value="">Choose a service…</option>' + SERVICES.map((s) => '<option value="' + s.id + '"' + (st.service === s.id ? ' selected' : '') + '>' + esc(s.name) + ' · ' + s.min + ' min · $' + s.price + '</option>').join('') + '</select></div>' +
      '<fieldset><legend>Stylist</legend>' + stylists.map((s) => '<label class="opt"><input type="radio" name="who" value="' + s.id + '"' + (st.who === s.id ? ' checked' : '') + '><span>' + esc(s.name) + (s.days ? '<small>' + s.days.map((x) => F.DAYS[x].slice(0, 3)).join(', ') + '</small>' : '<small>First available</small>') + '</span></label>').join('') + '</fieldset>';
    if (st.service && st.who) {
      html += '<h2 id="day-h">Day</h2><div class="strip" role="group" aria-labelledby="day-h">' + days.map((d) => { const dIso = F.iso(d); const ok = dayOpen(dIso); return '<button type="button" data-date="' + dIso + '" aria-label="' + esc(F.longDate(d)) + (ok ? '' : ', unavailable') + '" aria-pressed="' + (st.date === dIso) + '"' + (ok ? '' : ' disabled') + '>' + F.DAYS[d.getDay()].slice(0, 3) + '<br><b>' + F.MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + '</b></button>'; }).join('') + '</div>';
      if (st.date) html += '<h2 id="time-h">Time on ' + esc(F.shortDate(F.fromIso(st.date))) + '</h2><div class="slots" role="group" aria-labelledby="time-h">' + F.SALON_TIMES.map((m) => { const s = slotFor(st.date, m); if (!s) return ''; return '<button type="button" data-min="' + m + '" data-who="' + (s.who || '') + '" aria-pressed="' + (st.min === m) + '"' + (s.status === 'full' ? ' disabled aria-label="' + F.timeLabel(m) + ', booked"' : '') + '>' + F.timeLabel(m) + '</button>'; }).join('') + '</div>';
    }
    const f = st.f; const v = (k) => esc(f[k] || '');
    html += '<h2>Your info</h2><div class="field"><label for="name">Full name <span class="req" aria-hidden="true">*</span></label><input id="name" type="text" autocomplete="name" value="' + v('name') + '"></div><div class="grid2"><div class="field"><label for="phone">Phone <span class="req" aria-hidden="true">*</span></label><input id="phone" type="tel" autocomplete="tel" value="' + v('phone') + '"></div><div class="field"><label for="email">Email <span class="req" aria-hidden="true">*</span></label><input id="email" type="email" autocomplete="email" value="' + v('email') + '"></div></div>' +
      '<h2>Card to hold your booking</h2><p class="sub" style="font-size:13px">No charge today. Sandbox: use a test number like 4242 4242 4242 4242.</p><div class="field"><label for="cc">Card number <span class="req" aria-hidden="true">*</span></label><input id="cc" type="text" inputmode="numeric" autocomplete="cc-number" value="' + v('cc') + '"></div><div class="grid2"><div class="field"><label for="exp">Expiry (MM/YY) <span class="req" aria-hidden="true">*</span></label><input id="exp" type="text" autocomplete="cc-exp" placeholder="MM/YY" value="' + v('exp') + '"></div><div class="field"><label for="cvc">Security code (CVC) <span class="req" aria-hidden="true">*</span></label><input id="cvc" type="text" inputmode="numeric" autocomplete="cc-csc" value="' + v('cvc') + '"></div></div>' +
      '<label class="check"><input type="checkbox" id="offers"' + (f.offers ? ' checked' : '') + '> Email me offers and new-stylist news (optional)</label>' +
      '<div class="actions"><button class="btn" type="submit">Confirm booking</button></div></form>';
    $('#app').innerHTML = html;
    $('#service').onchange = (e) => { keep(); st.service = e.target.value; st.min = null; render(); $('#service').focus(); };
    document.querySelectorAll('input[name=who]').forEach((r) => (r.onchange = () => { keep(); st.who = r.value; st.date = null; st.min = null; render(); }));
    document.querySelectorAll('[data-date]').forEach((b) => (b.onclick = async () => { keep(); st.date = b.dataset.date; st.min = null; await F.busy(200); render(); }));
    document.querySelectorAll('[data-min]').forEach((b) => (b.onclick = () => { keep(); st.min = +b.dataset.min; st.slotWho = b.dataset.who; render(); }));
    $('#f').onsubmit = submit;
  }
  function keep() { ['name', 'phone', 'email', 'cc', 'exp', 'cvc'].forEach((k) => { const el = document.getElementById(k); if (el) st.f[k] = el.value; }); const o = $('#offers'); if (o) st.f.offers = o.checked; }
  async function submit(e) {
    e.preventDefault(); keep(); const f = st.f; const errs = [];
    const chk = (id, msg) => { const el = document.getElementById(id); if (el) F.setError(el, msg); if (msg) errs.push(msg); };
    chk('service', st.service ? '' : 'Choose a service.');
    if (!st.who) errs.push('Choose a stylist.'); else if (!st.date || st.min == null) errs.push('Choose a day and time.');
    chk('name', f.name.trim() ? '' : 'Enter your name.'); chk('phone', F.digits(f.phone).length >= 10 ? '' : 'Enter a phone number we can text.'); chk('email', F.emailOk(f.email) ? '' : 'Enter a valid email.');
    chk('cc', F.luhn(f.cc) ? '' : 'That card number does not look right.');
    const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(f.exp.trim()); const expOk = m && +m[1] >= 1 && +m[1] <= 12 && new Date(2000 + +m[2], +m[1], 1) > new Date();
    chk('exp', expOk ? '' : 'Enter a future expiry as MM/YY.'); chk('cvc', /^\d{3,4}$/.test(f.cvc.trim()) ? '' : 'Enter the 3 or 4 digit code.');
    F.summary($('#es'), errs); if (errs.length) { window.scrollTo(0, 0); return; }
    await F.busy(600);
    const who = st.slotWho || st.who; const s = svc(); const stylist = F.STYLISTS.find((x) => x.id === who);
    if (F.salonSlot(who, st.date, st.min, today) !== 'open') { st.min = null; render(); F.summary($('#es'), ['That time was just taken. Please pick another.']); return; }
    const b = F.book('salon', { code: F.code('SHR'), title: s.name + ' with ' + stylist.name, service: s.id, who, date: st.date, time: st.min, minutes: s.min, name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), card: '•••• ' + F.digits(f.cc).slice(-4), location: 'Shear Studio, 48 Linden St, Maplewood', slotKey: ['salon', who, st.date, st.min].join('|') });
    location.hash = '#/confirmed';
    $('#app').innerHTML = '<div class="ok-box" role="status"><h1>See you soon, ' + esc(f.name.trim().split(' ')[0]) + '!</h1><p>Booking reference <span class="code">' + esc(b.code) + '</span></p><dl class="review"><dt>Service</dt><dd>' + esc(s.name) + '</dd><dt>Stylist</dt><dd>' + esc(stylist.name) + '</dd><dt>Date</dt><dd>' + esc(F.longDate(F.fromIso(st.date))) + '</dd><dt>Time</dt><dd>' + F.timeLabel(st.min) + '</dd><dt>Card on hold</dt><dd>' + esc(b.card) + '</dd><dt>Where</dt><dd>' + esc(b.location) + '</dd></dl></div>';
    document.body.dataset.confirmation = JSON.stringify(b);
  }
  location.hash = '#/book'; render();
})();
