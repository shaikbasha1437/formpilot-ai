/* BrightSmile Dental (fictional): service -> dentist -> date & time -> details -> review -> confirmation. */
(function () {
  'use strict';
  const F = window.FPS; const $ = (s) => document.querySelector(s); const esc = F.esc;
  const SERVICES = [
    { id: 'cleaning', name: 'Cleaning', note: '45 min · routine hygiene visit' },
    { id: 'checkup', name: 'Checkup & X-rays', note: '30 min' },
    { id: 'whitening', name: 'Whitening consultation', note: '30 min' },
    { id: 'filling', name: 'Filling', note: '60 min' },
    { id: 'pain', name: 'Tooth pain / emergency', note: 'Same-week visits' }
  ];
  const INSURERS = ['Northwind Health', 'Contoso Dental', 'Fabrikam Mutual', 'Other', "I don't have insurance"];
  const today = F.midnight(new Date());
  const st = { view: 'service', service: null, who: null, month: new Date(today.getFullYear(), today.getMonth(), 1), date: null, slot: null, details: {}, error: '' };
  const STEPS = [['service', 'Service'], ['dentist', 'Dentist'], ['time', 'Date & time'], ['details', 'Your details'], ['review', 'Review']];
  function steps() { return '<ol class="steps" aria-label="Booking steps">' + STEPS.map(([id, l]) => '<li' + (id === st.view ? ' aria-current="step"' : '') + '>' + l + '</li>').join('') + '</ol>'; }
  async function go(view) { await F.busy(250); st.view = view; location.hash = '#/' + view; render(); window.scrollTo(0, 0); }
  function render() {
    const app = $('#app');
    if (st.view === 'service') {
      app.innerHTML = steps() + '<h1>Book a visit</h1><p class="sub">New and returning patients welcome. Choose what you need.</p><form id="f" class="card" novalidate><fieldset><legend>Service</legend>' +
        SERVICES.map((s) => '<label class="opt"><input type="radio" name="service" value="' + s.id + '"' + (st.service === s.id ? ' checked' : '') + '><span>' + esc(s.name) + '<small>' + esc(s.note) + '</small></span></label>').join('') +
        '</fieldset><div id="es"></div><div class="actions"><button class="btn" type="submit">Continue</button></div></form>';
      $('#f').onsubmit = (e) => { e.preventDefault(); const v = (document.querySelector('input[name=service]:checked') || {}).value; if (!v) { F.summary($('#es'), ['Choose a service to continue.']); return; } st.service = v; go('dentist'); };
    } else if (st.view === 'dentist') {
      app.innerHTML = steps() + '<h1>Choose a dentist</h1><form id="f" class="card" novalidate><fieldset><legend>Dentist</legend>' +
        F.DENTISTS.map((d) => '<label class="opt"><input type="radio" name="who" value="' + d.id + '"' + (st.who === d.id ? ' checked' : '') + '><span>' + esc(d.name) + '<small>' + esc(d.blurb) + ' · works ' + d.days.map((x) => F.DAYS[x].slice(0, 3)).join(', ') + '</small></span></label>').join('') +
        '<label class="opt"><input type="radio" name="who" value="any"' + (st.who === 'any' ? ' checked' : '') + '><span>No preference<small>First available dentist</small></span></label></fieldset><div id="es"></div><div class="actions"><button class="btn alt" type="button" id="back">Back</button><button class="btn" type="submit">Continue</button></div></form>';
      $('#back').onclick = () => go('service');
      $('#f').onsubmit = (e) => { e.preventDefault(); const v = (document.querySelector('input[name=who]:checked') || {}).value; if (!v) { F.summary($('#es'), ['Choose a dentist (or No preference) to continue.']); return; } if (v !== st.who) { st.date = null; st.slot = null; } st.who = v; go('time'); };
    } else if (st.view === 'time') renderTime();
    else if (st.view === 'details') renderDetails();
    else if (st.view === 'review') renderReview();
    else if (st.view === 'done') renderDone();
  }
  function dayInfo(dIso) { const slots = F.dentalDay(st.who, dIso, today); return { slots, open: slots.filter((s) => s.status !== 'full') }; }
  function renderTime() {
    const m = st.month; const first = new Date(m.getFullYear(), m.getMonth(), 1); const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const minMonth = new Date(today.getFullYear(), today.getMonth(), 1); const maxMonth = new Date(today.getFullYear(), today.getMonth() + 3, 1);
    let cells = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => '<div class="dow" aria-hidden="true">' + d + '</div>').join('');
    for (let i = 0; i < first.getDay(); i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const date = new Date(m.getFullYear(), m.getMonth(), d); const dIso = F.iso(date); const info = dayInfo(dIso); const closed = F.closedReason(dIso);
      const ok = info.open.length > 0;
      cells += '<button type="button" data-date="' + dIso + '" aria-label="' + esc(F.longDate(date) + (ok ? ', ' + info.open.length + ' openings' : closed ? ', ' + closed.toLowerCase() : ', no openings')) + '"' + (ok ? '' : ' disabled') + (st.date === dIso ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + d + '</button>';
    }
    let slotsHtml = '<p class="sub">Pick a highlighted day to see times.</p>';
    if (st.date) {
      const info = dayInfo(st.date);
      slotsHtml = '<h2 id="times-h">Available times on ' + esc(F.longDate(F.fromIso(st.date))) + '</h2><div class="slots" role="group" aria-labelledby="times-h">' + info.slots.map((s) => '<button type="button" data-min="' + s.min + '" data-who="' + s.who + '"' + (s.status === 'full' ? ' disabled aria-label="' + F.timeLabel(s.min) + ', full"' : '') + ' aria-pressed="' + (st.slot && st.slot.min === s.min ? 'true' : 'false') + '">' + F.timeLabel(s.min) + (s.status === 'full' ? '<span class="tag">FULL</span>' : '') + '</button>').join('') + '</div>';
    }
    const docName = st.who === 'any' ? 'first available dentist' : F.DENTISTS.find((d) => d.id === st.who).name;
    $('#app').innerHTML = steps() + '<h1>Pick a date and time</h1><p class="sub">Showing openings for ' + esc(docName) + '. Online booking starts tomorrow.</p><div class="card"><div class="cal"><div class="cal-head"><button type="button" class="btn alt" id="prev" aria-label="Previous month"' + (m <= minMonth ? ' disabled' : '') + '>‹</button><h2 id="month-h" style="margin:0">' + F.MONTHS[m.getMonth()] + ' ' + m.getFullYear() + '</h2><button type="button" class="btn alt" id="next" aria-label="Next month"' + (m >= maxMonth ? ' disabled' : '') + '>›</button></div><div class="cal-grid" role="group" aria-labelledby="month-h">' + cells + '</div></div><div id="slots" style="margin-top:14px">' + slotsHtml + '</div>' + (st.error ? '<div class="alert" role="alert">' + esc(st.error) + '</div>' : '') + '<div id="es"></div><div class="actions"><button class="btn alt" type="button" id="back">Back</button><button class="btn" type="button" id="cont">Continue</button></div></div>';
    $('#prev').onclick = () => { st.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderTime(); };
    $('#next').onclick = () => { st.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderTime(); };
    document.querySelectorAll('[data-date]').forEach((b) => (b.onclick = async () => { st.date = b.dataset.date; st.slot = null; st.error = ''; await F.busy(200); renderTime(); }));
    document.querySelectorAll('[data-min]').forEach((b) => (b.onclick = () => { st.slot = { min: +b.dataset.min, who: b.dataset.who }; st.error = ''; renderTime(); }));
    $('#back').onclick = () => { st.error = ''; go('dentist'); };
    $('#cont').onclick = async () => {
      if (!st.date || !st.slot) { F.summary($('#es'), ['Choose a day and a time to continue.']); return; }
      await F.busy(450); // "hold" the slot on the server
      const s = F.dentalSlot(st.slot.who, st.date, st.slot.min, today);
      if (s === 'ghost' || s === 'full') { F.markTaken('dental', st.slot.who, st.date, st.slot.min, 'another-patient'); st.error = 'Sorry, ' + F.timeLabel(st.slot.min) + ' on ' + F.shortDate(F.fromIso(st.date)) + ' was just booked by another patient. Please choose another time.'; st.slot = null; renderTime(); return; }
      st.error = ''; go('details');
    };
  }
  function field(id, label, type, o) { o = o || {}; const v = st.details[id] != null ? st.details[id] : ''; return '<div class="field"><label for="' + id + '">' + esc(label) + (o.req ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label>' + (type === 'textarea' ? '<textarea id="' + id + '" rows="3">' + esc(v) + '</textarea>' : type === 'select' ? '<select id="' + id + '"' + (o.req ? ' required' : '') + '><option value="">Select…</option>' + o.options.map((x) => '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' : '<input id="' + id + '" type="' + type + '" value="' + esc(v) + '"' + (o.req ? ' required aria-required="true"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.ac ? ' autocomplete="' + o.ac + '"' : '') + '>') + (o.hint ? '<div class="hint">' + esc(o.hint) + '</div>' : '') + '</div>'; }
  function renderDetails() {
    $('#app').innerHTML = steps() + '<h1>Your details</h1><p class="sub">' + esc(SERVICES.find((s) => s.id === st.service).name) + ' · ' + esc(F.longDate(F.fromIso(st.date))) + ' at ' + F.timeLabel(st.slot.min) + '</p><form id="f" class="card" novalidate><div id="es"></div><div class="grid2">' +
      field('first', 'First name', 'text', { req: 1, ac: 'given-name' }) + field('last', 'Last name', 'text', { req: 1, ac: 'family-name' }) +
      field('dob', 'Date of birth', 'text', { req: 1, ph: 'MM/DD/YYYY', hint: 'Format: MM/DD/YYYY' }) + field('phone', 'Mobile phone', 'tel', { req: 1, ac: 'tel' }) + '</div>' +
      field('email', 'Email', 'email', { req: 1, ac: 'email' }) + '<div class="grid2">' + field('ins', 'Insurance provider', 'select', { req: 1, options: INSURERS }) + field('member', 'Member ID', 'text', { hint: 'Required if you have insurance' }) + '</div>' +
      field('notes', 'Anything we should know? (optional)', 'textarea') +
      '<label class="check"><input type="checkbox" id="sms"' + (st.details.sms ? ' checked' : '') + '> Text me appointment reminders (optional)</label>' +
      '<label class="check"><input type="checkbox" id="policy" required' + (st.details.policy ? ' checked' : '') + '> I agree to the 24-hour cancellation policy <span class="req" aria-hidden="true">*</span></label>' +
      '<div class="actions"><button class="btn alt" type="button" id="back">Back</button><button class="btn" type="submit">Review booking</button></div></form>';
    $('#back').onclick = () => { collect(); go('time'); };
    $('#f').onsubmit = (e) => { e.preventDefault(); collect(); if (validate()) go('review'); };
  }
  function collect() { ['first', 'last', 'dob', 'phone', 'email', 'ins', 'member', 'notes'].forEach((k) => { const el = document.getElementById(k); if (el) st.details[k] = el.value.trim(); }); st.details.sms = $('#sms') && $('#sms').checked; st.details.policy = $('#policy') && $('#policy').checked; }
  function validate() {
    const d = st.details; const errs = [];
    const chk = (id, msg) => { F.setError(document.getElementById(id), msg); if (msg) errs.push(msg); };
    chk('first', d.first ? '' : 'Enter your first name.'); chk('last', d.last ? '' : 'Enter your last name.');
    const dob = F.parseUsDate(d.dob); chk('dob', !d.dob ? 'Enter your date of birth.' : !dob || dob >= today || dob.getFullYear() < 1900 ? 'Enter date of birth as MM/DD/YYYY, for example 04/12/1990.' : '');
    chk('phone', F.digits(d.phone).length === 10 || (F.digits(d.phone).length === 11 && F.digits(d.phone)[0] === '1') ? '' : 'Enter a 10-digit mobile number.');
    chk('email', F.emailOk(d.email) ? '' : 'Enter a valid email address.');
    chk('ins', d.ins ? '' : 'Choose your insurance provider, or "I don\'t have insurance".');
    chk('member', d.ins && d.ins !== "I don't have insurance" && !d.member ? 'Enter your member ID.' : '');
    chk('policy', d.policy ? '' : 'Please agree to the cancellation policy.');
    F.summary($('#es'), errs); if (errs.length) (document.querySelector('[aria-invalid=true]') || {}).focus && document.querySelector('[aria-invalid=true]').focus();
    return !errs.length;
  }
  function rows() { const d = st.details; const docName = F.DENTISTS.find((x) => x.id === st.slot.who).name; return [['Service', SERVICES.find((s) => s.id === st.service).name], ['Dentist', docName], ['Date', F.longDate(F.fromIso(st.date))], ['Time', F.timeLabel(st.slot.min)], ['Patient', d.first + ' ' + d.last], ['Date of birth', d.dob], ['Mobile phone', d.phone], ['Email', d.email], ['Insurance', d.ins + (d.member ? ' · ' + d.member : '')], ['Notes', d.notes || '—'], ['Text reminders', d.sms ? 'Yes' : 'No']]; }
  function renderReview() {
    $('#app').innerHTML = steps() + '<h1>Review your booking</h1><div class="card"><dl class="review">' + rows().map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl><div id="es"></div><div class="actions"><button class="btn alt" type="button" id="edit">Edit details</button><button class="btn" type="button" id="book">Book appointment</button></div></div>';
    $('#edit').onclick = () => go('details');
    $('#book').onclick = async () => {
      await F.busy(500);
      if (F.dentalSlot(st.slot.who, st.date, st.slot.min, today) === 'full') { st.error = 'That time is no longer available. Please choose another.'; st.slot = null; go('time'); return; }
      const d = st.details; const docName = F.DENTISTS.find((x) => x.id === st.slot.who).name;
      st.booking = F.book('dental', { code: F.code('BSD'), title: SERVICES.find((s) => s.id === st.service).name + ' with ' + docName, service: st.service, who: st.slot.who, date: st.date, time: st.slot.min, minutes: st.service === 'filling' ? 60 : st.service === 'cleaning' ? 45 : 30, name: d.first + ' ' + d.last, email: d.email, phone: d.phone, location: 'BrightSmile Dental, 120 Harbor Way, Maplewood', slotKey: ['dental', st.slot.who, st.date, st.slot.min].join('|') });
      go('done');
    };
  }
  function renderDone() {
    const b = st.booking;
    $('#app').innerHTML = '<div class="ok-box" role="status"><h1>You\'re booked!</h1><p>Confirmation code <span class="code" id="conf-code">' + esc(b.code) + '</span></p><dl class="review">' + rows().slice(0, 5).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '<dt>Where</dt><dd>' + esc(b.location) + '</dd></dl><p class="sub" style="margin-top:12px">We sent a confirmation to ' + esc(b.email) + ' (not really: this is a sandbox).</p></div>';
    document.body.dataset.confirmation = JSON.stringify(b);
  }
  addEventListener('hashchange', () => { const v = location.hash.replace('#/', ''); if (v === 'service' && st.view !== 'service' && st.view !== 'done') { st.view = 'service'; render(); } });
  location.hash = '#/service'; render();
})();
