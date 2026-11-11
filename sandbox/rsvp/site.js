/* Lanternfest Supper Club (fictional): session + party size (seat check) -> guest details -> review -> RSVP. */
(function () {
  'use strict';
  const F = window.FPS; const $ = (s) => document.querySelector(s); const esc = F.esc;
  const today = F.midnight(new Date());
  const st = { step: 1, session: '', party: '', f: {} };
  const label = (s) => F.DAYS[F.fromIso(s.date).getDay()] + ', ' + F.MONTHS[F.fromIso(s.date).getMonth()] + ' ' + F.fromIso(s.date).getDate() + ' · ' + F.timeLabel(s.min);
  const avail = (s) => (s.left === 0 ? 'sold out' : s.left <= 4 ? 'few seats left' : 'seats available');
  function go(n) { return F.busy(350).then(() => { st.step = n; location.hash = '#/' + ['events', 'guests', 'review', 'confirmed'][n - 1]; render(); window.scrollTo(0, 0); }); }
  function render() {
    const app = $('#app'); const all = F.sessions(today);
    if (st.step === 1) {
      app.innerHTML = '<h1>Upcoming suppers</h1><p class="sub">Seats are limited. RSVP is free; pay at the door.</p><form id="f" novalidate><div id="es"></div>' + F.EVENTS.map((ev) => '<div class="card"><fieldset><legend>' + esc(ev.name) + '</legend><p class="sub" style="margin:0 0 6px">' + esc(ev.blurb) + '</p>' + all.filter((s) => s.event === ev.id).map((s) => '<label class="opt' + (s.left ? '' : ' off') + '"><input type="radio" name="session" value="' + s.id + '"' + (s.left ? '' : ' disabled') + (st.session === s.id ? ' checked' : '') + '><span>' + esc(label(s)) + '<small>' + avail(s) + '</small></span></label>').join('') + '</fieldset></div>').join('') +
        '<div class="card"><div class="field"><label for="party">Party size (including you)</label><input id="party" type="number" min="1" max="12" value="' + esc(st.party) + '"></div><div class="actions"><button class="btn" type="submit">Continue</button></div></div></form>';
      $('#f').onsubmit = async (e) => { e.preventDefault(); st.session = (document.querySelector('input[name=session]:checked') || {}).value || ''; st.party = $('#party').value.trim();
        const errs = []; const s = all.find((x) => x.id === st.session); const n = +st.party;
        if (!s) errs.push('Choose a supper and time.');
        const pe = !/^\d+$/.test(st.party) || n < 1 || n > 12 ? 'Enter a party size from 1 to 12.' : ''; F.setError($('#party'), pe); if (pe) errs.push(pe);
        if (!errs.length) { await F.busy(400); if (s.left < n) { const m = 'Only ' + s.left + ' seat' + (s.left === 1 ? '' : 's') + ' left for ' + s.eventName + ' on ' + label(s) + '. Choose another time or a smaller party.'; F.setError($('#party'), m); errs.push(m); } }
        F.summary($('#es'), errs); if (errs.length) { window.scrollTo(0, 0); return; } go(2); };
    } else if (st.step === 2) {
      const f = st.f; const n = +st.party; const v = (k) => esc(f[k] || '');
      app.innerHTML = '<h1>Who is coming?</h1><p class="sub">' + esc(sel().eventName + ' · ' + label(sel())) + ' · party of ' + n + '</p><form id="f" class="card" novalidate><div id="es"></div><div class="field"><label for="name">Your name</label><input id="name" type="text" autocomplete="name" value="' + v('name') + '"></div><div class="grid2"><div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" value="' + v('email') + '"></div><div class="field"><label for="phone">Phone (for day-of updates)</label><input id="phone" type="tel" autocomplete="tel" value="' + v('phone') + '"></div></div>' +
        (n > 1 ? '<div class="field"><label for="guests">Guest names (one per line)</label><textarea id="guests" rows="' + Math.min(6, n) + '">' + v('guests') + '</textarea><div class="hint">We need ' + (n - 1) + ' name' + (n > 2 ? 's' : '') + ' for the seating cards.</div></div>' : '') +
        '<div class="field"><label for="diet">Dietary needs (optional)</label><textarea id="diet" rows="2">' + v('diet') + '</textarea></div><label class="check"><input type="checkbox" id="news"' + (f.news ? ' checked' : '') + '> Add me to the Lanternfest newsletter (optional)</label><div class="actions"><button class="btn alt" type="button" id="back">Back</button><button class="btn" type="submit">Review RSVP</button></div></form>';
      $('#back').onclick = () => { keep(); go(1); };
      $('#f').onsubmit = (e) => { e.preventDefault(); keep(); const errs = []; const chk = (id, m) => { const el = document.getElementById(id); if (el) F.setError(el, m); if (m) errs.push(m); };
        chk('name', f.name ? '' : 'Enter your name.'); chk('email', F.emailOk(f.email) ? '' : 'Enter a valid email.');
        if (n > 1) { const names = (f.guests || '').split(/\n|,/).map((x) => x.trim()).filter(Boolean); chk('guests', names.length === n - 1 ? '' : 'List exactly ' + (n - 1) + ' guest name' + (n > 2 ? 's' : '') + ', one per line (you listed ' + names.length + ').'); }
        F.summary($('#es'), errs); if (!errs.length) go(3); };
    } else if (st.step === 3) {
      app.innerHTML = '<h1>Review your RSVP</h1><div class="card"><dl class="review">' + rows().map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl><div id="es"></div><div class="actions"><button class="btn alt" type="button" id="back">Back</button><button class="btn" type="button" id="send">Send RSVP</button></div></div>';
      $('#back').onclick = () => go(2);
      $('#send').onclick = async () => { await F.busy(500); const s = F.sessions(today).find((x) => x.id === st.session); if (!s || s.left < +st.party) { st.step = 1; render(); F.summary($('#es'), ['Those seats were just taken. Please choose again.']); return; }
        const b = F.book('rsvp', { code: F.code('LNT'), title: s.eventName + ' (party of ' + st.party + ')', sessionId: s.id, party: +st.party, date: s.date, time: s.min, minutes: 150, name: st.f.name, email: st.f.email, phone: st.f.phone, guests: st.f.guests || '', diet: st.f.diet || '', location: 'Lanternfest Supper Club, 9 Wharf Lane, Maplewood' });
        location.hash = '#/confirmed'; st.step = 4;
        $('#app').innerHTML = '<div class="ok-box" role="status"><h1>Your RSVP is confirmed</h1><p>Reservation <span class="code">' + esc(b.code) + '</span></p><dl class="review">' + rows().map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl></div>';
        document.body.dataset.confirmation = JSON.stringify(b); };
    }
  }
  function sel() { return F.sessions(today).find((x) => x.id === st.session); }
  function keep() { ['name', 'email', 'phone', 'guests', 'diet'].forEach((k) => { const el = document.getElementById(k); if (el) st.f[k] = el.value.trim(); }); const n = $('#news'); if (n) st.f.news = n.checked; }
  function rows() { const s = sel(); const f = st.f; return [['Event', s.eventName], ['Date', F.longDate(F.fromIso(s.date))], ['Time', F.timeLabel(s.min)], ['Party size', st.party], ['Name', f.name], ['Email', f.email], ['Phone', f.phone || '—'], ['Guests', (f.guests || '—').split(/\n/).join(', ')], ['Dietary needs', f.diet || '—']]; }
  location.hash = '#/events'; render();
})();
