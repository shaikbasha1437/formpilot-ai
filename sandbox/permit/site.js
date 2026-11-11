/* Maplewood Permit Center (fictional): 3-page application with strict server-style validation. */
(function () {
  'use strict';
  const F = window.FPS; const $ = (s) => document.querySelector(s); const esc = F.esc;
  const STATES = ['Alabama', 'Arizona', 'California', 'Colorado', 'Florida', 'Georgia', 'Illinois', 'New York', 'Ohio', 'Oregon', 'Texas', 'Washington'];
  const TYPES = ['Block party', 'Yard sale', 'Temporary street parking'];
  const TIMES = []; for (let m = 480; m <= 1320; m += 60) TIMES.push(F.timeLabel(m));
  const today = F.midnight(new Date());
  const st = { page: 1, a: {}, e: {}, certify: false };
  const PAGES = ['Applicant', 'Event details', 'Review and submit'];
  function head() { return '<p class="sub" style="margin:0">Special event permit application</p><ol class="steps" aria-label="Progress">' + PAGES.map((p, i) => '<li' + (st.page === i + 1 ? ' aria-current="step"' : '') + '>Step ' + (i + 1) + ': ' + p + '</li>').join('') + '</ol>'; }
  function inp(obj, id, label, o) { o = o || {}; const v = obj[id] || ''; return '<div class="field"' + (o.hidden ? ' hidden' : '') + '><label for="' + id + '">' + esc(label) + (o.req ? ' <span class="req">(required)</span>' : '') + '</label>' + (o.options ? '<select id="' + id + '"><option value="">— Select —</option>' + o.options.map((x) => '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' : '<input id="' + id + '" type="' + (o.type || 'text') + '" value="' + esc(v) + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.ac ? ' autocomplete="' + o.ac + '"' : '') + (o.min != null ? ' min="' + o.min + '"' : '') + '>') + (o.hint ? '<div class="hint" id="' + id + '-hint">' + esc(o.hint) + '</div>' : '') + '</div>'; }
  function go(p) { return F.busy(400).then(() => { st.page = p; location.hash = '#/' + ['applicant', 'event', 'review', 'submitted'][p - 1]; render(); window.scrollTo(0, 0); }); }
  function render() {
    const app = $('#app');
    if (st.page === 1) {
      const a = st.a;
      app.innerHTML = head() + '<h1>Step 1 of 3: About you</h1><form id="f" class="card" novalidate><div id="es"></div><div class="grid2">' + inp(a, 'fname', 'First name', { req: 1, ac: 'given-name' }) + inp(a, 'lname', 'Last name', { req: 1, ac: 'family-name' }) + inp(a, 'dob', 'Date of birth', { req: 1, ph: 'MM/DD/YYYY', hint: 'Applicants must be 18 or older.' }) + inp(a, 'phone', 'Daytime phone', { req: 1, type: 'tel', ac: 'tel' }) + '</div>' + inp(a, 'email', 'Email address', { req: 1, type: 'email', ac: 'email' }) + inp(a, 'street', 'Street address', { req: 1, ac: 'street-address' }) + '<div class="grid2">' + inp(a, 'city', 'City', { req: 1 }) + inp(a, 'state', 'State', { req: 1, options: STATES }) + '</div>' + inp(a, 'zip', 'ZIP code', { req: 1, ac: 'postal-code' }) + '<div class="actions"><button class="btn" type="submit">Next: event details</button></div></form>';
      $('#f').onsubmit = (e) => { e.preventDefault(); ['fname', 'lname', 'dob', 'phone', 'email', 'street', 'city', 'state', 'zip'].forEach((k) => (a[k] = document.getElementById(k).value.trim()));
        const errs = check({ fname: a.fname ? '' : 'Enter your first name.', lname: a.lname ? '' : 'Enter your last name.',
          dob: (() => { const d = F.parseUsDate(a.dob); if (!d) return 'Enter date of birth as MM/DD/YYYY.'; const age = (today - d) / (365.25 * 86400000); return age < 18 ? 'Applicants must be 18 or older.' : ''; })(),
          phone: /^\(\d{3}\) \d{3}-\d{4}$/.test(a.phone) ? '' : 'Enter the phone number as (555) 555-0123.',
          email: F.emailOk(a.email) ? '' : 'Enter a valid email address.', street: a.street ? '' : 'Enter your street address.', city: a.city ? '' : 'Enter your city.', state: a.state ? '' : 'Select your state.', zip: /^\d{5}$/.test(a.zip) ? '' : 'Enter a 5-digit ZIP code.' });
        if (!errs) go(2); };
    } else if (st.page === 2) {
      const e = st.e; const t = e.type || '';
      app.innerHTML = head() + '<h1>Step 2 of 3: Your event</h1><form id="f" class="card" novalidate><div id="es"></div>' + inp(e, 'type', 'Permit type', { req: 1, options: TYPES }) + inp(e, 'date', 'Event date', { req: 1, type: 'date', min: F.iso(F.addDays(today, 3)), hint: 'At least 3 days from today.' }) + '<div class="grid2">' + inp(e, 'start', 'Start time', { req: 1, options: TIMES }) + inp(e, 'end', 'End time', { req: 1, options: TIMES }) + '</div>' + inp(e, 'street', 'Street or block', { req: 1, hint: 'For example: 400 block of Elm Street' }) + inp(e, 'attend', 'Expected attendance', { req: 1, type: 'number', hidden: t !== 'Block party' && t !== 'Yard sale' }) + inp(e, 'plate', 'Vehicle license plate', { req: 1, hidden: t !== 'Temporary street parking' }) + '<div class="actions"><button class="btn alt" type="button" id="back">Back</button><button class="btn" type="submit">Next: review</button></div></form>';
      $('#type').onchange = () => { keep2(); render(); $('#type').focus(); };
      $('#back').onclick = () => { keep2(); go(1); };
      $('#f').onsubmit = (ev) => { ev.preventDefault(); keep2(); const d = F.fromIso(e.date); const ti = (x) => TIMES.indexOf(x);
        const errs = check({ type: e.type ? '' : 'Select a permit type.', date: !d ? 'Enter the event date.' : d < F.addDays(today, 3) ? 'Event date must be at least 3 days from today.' : d > F.addDays(today, 180) ? 'Event date must be within 6 months.' : '',
          start: e.start ? '' : 'Select a start time.', end: !e.end ? 'Select an end time.' : ti(e.end) <= ti(e.start) ? 'End time must be after the start time.' : '',
          street: e.street ? '' : 'Enter the street or block.', attend: e.type === 'Temporary street parking' ? '' : /^\d+$/.test(e.attend || '') && +e.attend >= 1 && +e.attend <= 500 ? '' : 'Enter expected attendance as a number from 1 to 500.',
          plate: e.type !== 'Temporary street parking' ? '' : /^[A-Z0-9 -]{2,8}$/i.test(e.plate || '') ? '' : 'Enter the vehicle license plate.' });
        if (!errs) go(3); };
    } else if (st.page === 3) {
      app.innerHTML = head() + '<h1>Step 3 of 3: Review and submit</h1><div class="card"><div id="es"></div><h2>Applicant</h2><dl class="review">' + rowsA().map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl><h2>Event</h2><dl class="review">' + rowsE().map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl><p class="sub" style="margin-top:12px">Fee: $25, payable when the permit is approved.</p><label class="check"><input type="checkbox" id="certify"' + (st.certify ? ' checked' : '') + '> I certify that the information above is true and complete. <span class="req">(required)</span></label><div class="actions"><button class="btn alt" type="button" id="back">Back</button><button class="btn" type="button" id="submit">Submit application</button></div></div>';
      $('#back').onclick = () => go(2);
      $('#submit').onclick = async () => { st.certify = $('#certify').checked; if (check({ certify: st.certify ? '' : 'Check the box to certify your application.' })) return; await F.busy(600);
        const a = st.a; const e = st.e; const ti = TIMES.indexOf(e.start); const te = TIMES.indexOf(e.end);
        st.b = F.book('permit', { code: F.code('MPL'), title: e.type + ' permit: ' + e.street, date: e.date, time: 480 + ti * 60, minutes: (te - ti) * 60, name: a.fname + ' ' + a.lname, email: a.email, phone: a.phone, location: e.street + ', Maplewood', kind: e.type });
        location.hash = '#/submitted'; st.page = 4;
        $('#app').innerHTML = '<div class="ok-box" role="status"><h1>Application received</h1><p>Application number <span class="code">' + esc(st.b.code) + '</span></p><p>We will email ' + esc(a.email) + ' within 5 business days. Status: <b>Under review</b>.</p><dl class="review">' + rowsE().map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl></div>';
        document.body.dataset.confirmation = JSON.stringify(st.b); };
    }
  }
  function keep2() { ['type', 'date', 'start', 'end', 'street', 'attend', 'plate'].forEach((k) => { const el = document.getElementById(k); if (el) st.e[k] = el.value.trim(); }); }
  function rowsA() { const a = st.a; return [['Name', a.fname + ' ' + a.lname], ['Date of birth', a.dob], ['Phone', a.phone], ['Email', a.email], ['Address', a.street + ', ' + a.city + ', ' + a.state + ' ' + a.zip]]; }
  function rowsE() { const e = st.e; return [['Permit type', e.type], ['Date', F.longDate(F.fromIso(e.date))], ['Time', e.start + ' to ' + e.end], ['Street or block', e.street]].concat(e.type === 'Temporary street parking' ? [['License plate', e.plate]] : [['Expected attendance', e.attend]]); }
  function check(map) {
    const errs = []; for (const [id, msg] of Object.entries(map)) { const el = document.getElementById(id); if (el) F.setError(el, msg); if (msg) errs.push(msg); }
    F.summary($('#es'), errs); if (errs.length) { const first = document.querySelector('[aria-invalid=true]'); if (first) first.focus(); }
    return errs.length;
  }
  location.hash = '#/applicant'; render();
})();
