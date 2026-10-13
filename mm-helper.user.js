// ==UserScript==
// @name         MM helper – Αρχείο Ιατρείου
// @namespace    psarris.mymedical
// @version      1.0.5
// @description  Εντολές window.MM για ελεγχόμενη καταχώριση εργαστηριακών στο MyMedical και ανάγνωση ΠΗΤ εγκύων. Καμία λειτουργία διαγραφής.
// @match        https://ju1938.my-medical.online/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/psarrisalexandros/mm-userscripts/main/mm-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/psarrisalexandros/mm-userscripts/main/mm-helper.user.js
// ==/UserScript==
/*
  ΚΑΝΟΝΕΣ ΑΣΦΑΛΕΙΑΣ (ενσωματωμένοι στον κώδικα)
  - Δεν υπάρχει καμία εντολή διαγραφής.
  - Τιμή γράφεται ΜΟΝΟ αν υπάρχει στο εγκεκριμένο πλάνο (MM.plan) με ίδιο ΑΜΚΑ, ημ/νία στήλης, τύπο, πεδίο και τιμή.
  - Κελί που έχει ήδη τιμή δεν αλλάζει ποτέ.
  - Μετά από κάθε τιμή ελέγχεται ότι δεν άλλαξε κανένα άλλο κελί της στήλης.
  - Αποθήκευση αρχείων (Αρχεία) δεν γίνεται από εδώ· το MM.attSet μόνο συμπληρώνει πεδία.
  - Το MM.pht() μόνο ΔΙΑΒΑΖΕΙ (λίστα εγκύων, banner, ΙΣΤΟΡΙΚΟ, ΕΓΚΥΜΟΣΥΝΗ)· δεν πατά ποτέ αποθήκευση.
*/
(function () {
  'use strict';
  const W = window;
  if (W.MM && W.MM.v && W.MM.v >= '1.0.5') return;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jq = () => W.jQuery;
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  async function waitFor(fn, ms = 10000, step = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const r = fn(); if (r) return r; } catch (e) { /* συνέχεια */ }
      await sleep(step);
    }
    return null;
  }
  const ss = {
    get(k, d) { try { const v = sessionStorage.getItem('MM_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem('MM_' + k, JSON.stringify(v)); } catch (e) { /* χωρίς storage */ } }
  };
  const pat = () => ss.get('pat', {});
  const planList = () => ss.get('plan', []);
  const visible = el => !!el && el.offsetParent !== null;
  const typeSel = () => document.getElementById('test_type_id');

  // ---------- Πλάνο εγκεκριμένων τιμών ----------
  // MM.plan([{amka:'ΑΜΚΑ 11 ψηφίων', date:'10-10-2026', type:1, field:19, value:'12,5'}, ...])
  function plan(entries) {
    if (entries === undefined) {
      const p = planList();
      return `${p.filter(e => !e.done).length} εκκρεμείς / ${p.length}: ` +
        p.map(e => `${e.done ? '✓' : '·'}${e.amka.slice(-4)} ${e.date} t${e.type} f${e.field}=${e.value}`).join('; ');
    }
    if (!Array.isArray(entries) || !entries.length) return 'ΣΦΑΛΜΑ: δώστε λίστα εγγραφών';
    const bad = entries.filter(e => !/^\d{11}$/.test(String(e.amka)) || !/^\d{2}-\d{2}-\d{4}$/.test(e.date) ||
      !/^\d+$/.test(String(e.type)) || !/^\d+$/.test(String(e.field)) || !norm(e.value));
    if (bad.length) return 'ΣΦΑΛΜΑ: μη έγκυρες εγγραφές: ' + JSON.stringify(bad);
    ss.set('plan', entries.map(e => ({ amka: String(e.amka), date: e.date, type: String(e.type), field: String(e.field), value: norm(e.value), done: false })));
    return `OK πλάνο ${entries.length} τιμών`;
  }

  // ---------- Ασθενής ----------
  async function patient(lastname, amka) {
    if (!/^\d{11}$/.test(String(amka || ''))) return 'ΣΦΑΛΜΑ: απαιτείται ΑΜΚΑ 11 ψηφίων';
    // Αναζήτηση με φίλτρο ΑΜΚΑ· ταίριασμα ΑΚΡΙΒΩΣ στη στήλη ΑΜΚΑ + έλεγχος επωνύμου
    const up = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    async function rowsFor(q) {
      const res = await fetch('/airPelates/admin?' + q, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const hdr = [...doc.querySelectorAll('table thead tr')].map(r => [...r.children].map(c => norm(c.textContent))).find(r => r.includes('ΑΜΚΑ'));
      if (!hdr) throw new Error('δεν βρέθηκε στήλη ΑΜΚΑ');
      const ai = hdr.indexOf('ΑΜΚΑ'), li = hdr.indexOf('Επώνυμο'), fi = hdr.indexOf('Όνομα');
      return [...doc.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('a[href*="/airPelates/update/"]')).map(tr => ({
        id: (tr.querySelector('a[href*="/airPelates/update/"]').getAttribute('href').match(/update\/(\d+)/) || [])[1],
        amka: tr.children[ai] ? tr.children[ai].textContent.replace(/\D/g, '') : '',
        last: tr.children[li] ? norm(tr.children[li].textContent) : '',
        first: tr.children[fi] ? norm(tr.children[fi].textContent) : ''
      }));
    }
    let rows;
    try { rows = await rowsFor('AirPelates[amka]=' + amka); } catch (e) { return 'ΣΦΑΛΜΑ: ' + e.message; }
    const hits = rows.filter(r => r.amka === String(amka));
    if (hits.length !== 1) return `ΣΦΑΛΜΑ: ${hits.length} ασθενείς με αυτό το ΑΜΚΑ — έλεγχος από τον ιατρό`;
    const h = hits[0];
    if (lastname && up(h.last) !== up(lastname)) return `ΣΦΑΛΜΑ: το ΑΜΚΑ ανήκει σε «${h.last} ${h.first}», όχι σε «${lastname}» — ΣΤΟΠ`;
    if (!h.id) return 'ΣΦΑΛΜΑ: δεν βρέθηκε id';
    ss.set('pat', { id: h.id, amka: String(amka) });
    return `OK id=${h.id} | ${h.last} ${h.first}`;
  }
  function go(where) {
    const p = pat();
    if (!p.id) return 'ΣΦΑΛΜΑ: πρώτα MM.patient';
    location.href = where === 'files'
      ? '/attachments/main/main2?AirAttachments[pelatis]=' + p.id + '&gridPageSize=300'
      : '/airPelates/update/' + p.id;
    return 'μετάβαση…';
  }
  function ctxCheck() {
    const p = pat();
    const m = location.pathname.match(/\/airPelates\/update\/(\d+)/);
    if (!p.id || !m || m[1] !== p.id) return 'ΣΦΑΛΜΑ: η σελίδα δεν είναι η καρτέλα της ασθενούς του MM.patient';
    return null;
  }

  // ---------- Εργαστηριακά ----------
  function colDate(testId) {
    const th = document.getElementById('testArea_th_' + testId);
    const m = th && norm(th.textContent).match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}`;
    return ss.get('colDates', {})[testId] || null;
  }
  function cols() {
    return [...new Set([...document.querySelectorAll('th[id^="testArea_th_"]')].filter(visible).map(th => th.id.slice(12)))]
      .map(id => id + ':' + (colDate(id) || '?'));
  }
  function dupCols() {
    const ids = [...document.querySelectorAll('th[id^="testArea_th_"]')].map(t => t.id);
    return ids.length !== new Set(ids).size;
  }
  // περιμένει ώσπου ο αριθμός στηλών να μείνει σταθερός για ~1,5″
  async function stable() {
    let last = -1, same = 0;
    for (let i = 0; i < 40 && same < 3; i++) {
      const n = document.querySelectorAll('th[id^="testArea_th_"], td[class*="tf_"]').length;
      same = n === last ? same + 1 : 0; last = n;
      await sleep(500);
    }
  }
  async function exams(type) {
    const c = ctxCheck(); if (c) return c;
    const tab = document.getElementById('exams-tab');
    if (!tab) return 'ΣΦΑΛΜΑ: δεν βρέθηκε η καρτέλα ΕΡΓΑΣΤΗΡΙΑΚΑ';
    tab.click();
    const sel = await waitFor(() => { const s = typeSel(); return s && s.options.length > 1 && s; }, 25000);
    if (!sel) return 'ΣΦΑΛΜΑ: δεν φόρτωσαν οι τύποι εξετάσεων (timeout) — reload';
    // η αρχική φόρτωση πρέπει να τελειώσει πριν αλλάξει ο τύπος (αλλιώς οι στήλες διπλασιάζονται)
    await stable();
    if (type != null && sel.value !== String(type)) {
      if (![...sel.options].some(o => o.value === String(type))) return 'ΣΦΑΛΜΑ: άγνωστος τύπος ' + type;
      jq()(sel).val(String(type)).trigger('change');
      await sleep(700);
      await stable();
    }
    if (dupCols()) return 'ΣΦΑΛΜΑ: διπλές στήλες στη σελίδα — reload και ξανά MM.exams';
    return `OK τύπος ${sel.value} (${norm(sel.options[sel.selectedIndex].text)}) | στήλες: ${cols().join(', ') || '—'}`;
  }
  function cellMap(testId) {
    const out = {};
    document.querySelectorAll('td[class*="tf_' + testId + '_"]').forEach(td => {
      const m = td.className.match(/\btf_(\d+)_(\d+)\b/);
      if (m && m[1] === String(testId)) out[m[2]] = norm(td.textContent);
    });
    return out;
  }
  const cellText = (testId, field) => { const td = document.querySelector('td.tf_' + testId + '_' + field); return td ? norm(td.textContent) : null; };
  function hideInput() { const f = document.getElementById('test_input_field'); if (f) f.style.display = 'none'; }

  async function addColumn(date) {
    const c = ctxCheck(); if (c) return c;
    if (!/^\d{2}-\d{2}-\d{4}$/.test(date)) return 'ΣΦΑΛΜΑ: ημερομηνία σε μορφή ΗΗ-ΜΜ-ΕΕΕΕ';
    if (dupCols()) return 'ΣΦΑΛΜΑ: διπλές στήλες στη σελίδα — reload και ξανά MM.exams';
    const sel = typeSel();
    if (!sel || sel.options.length < 2) return 'ΣΦΑΛΜΑ: πρώτα MM.exams(τύπος)';
    const type = sel.value;
    if (!planList().some(e => !e.done && e.amka === pat().amka && e.date === date && e.type === type))
      return `ΣΦΑΛΜΑ: καμία εγκεκριμένη τιμή για ${date} στον τύπο ${type}`;
    const ex = cols().find(x => x.endsWith(':' + date));
    if (ex) return `OK testId=${ex.split(':')[0]} (υπήρχε ήδη στήλη ${date} — δεν δημιουργήθηκε νέα)`;
    const before = new Set([...document.querySelectorAll('th[id^="testArea_th_"]')].map(t => t.id));
    document.getElementById('addNewTest').click();
    const inp = await waitFor(() => { const i = document.getElementById('air_tests_imnia'); return visible(i) && i; }, 8000);
    if (!inp) return 'ΣΦΑΛΜΑ: δεν άνοιξε το παράθυρο νέας εξέτασης';
    inp.value = date;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
    if (inp.value !== date) return `ΣΦΑΛΜΑ: η ημερομηνία έγινε «${inp.value}» — δεν υποβλήθηκε· πατήστε ΑΚΥΡΟ`;
    document.getElementById('ajax_test_submit').click();
    const th = await waitFor(() => [...document.querySelectorAll('th[id^="testArea_th_"]')].find(t => !before.has(t.id)), 20000);
    if (!th) return 'ΑΓΝΩΣΤΟ: δεν εμφανίστηκε νέα στήλη σε 20″ — reload και έλεγχος πριν από οτιδήποτε άλλο';
    const id = th.id.slice(12);
    const cd = ss.get('colDates', {}); cd[id] = date; ss.set('colDates', cd);
    return `OK testId=${id} ${date} τύπος ${type}`;
  }

  async function setCell(testId, field, value) {
    const c = ctxCheck(); if (c) return c;
    testId = String(testId); field = String(field); value = norm(value);
    const sel = typeSel(); const type = sel && sel.value;
    const date = colDate(testId);
    const p = planList();
    const idx = p.findIndex(e => !e.done && e.amka === pat().amka && e.type === type && e.field === field && e.value === value && e.date === date);
    if (idx < 0) return `ΣΦΑΛΜΑ: εκτός εγκεκριμένου πλάνου (τύπος ${type}, πεδίο ${field}, τιμή ${value}, στήλη ${date}) — τίποτα δεν γράφτηκε`;
    const tds = document.querySelectorAll('td.tf_' + testId + '_' + field);
    if (tds.length !== 1 || dupCols()) return `ΣΦΑΛΜΑ: ${tds.length} κελιά ${testId}_${field} (αναμενόταν 1) — reload και ξανά MM.exams`;
    const td = tds[0];
    if (!visible(td)) return `ΣΦΑΛΜΑ: δεν υπάρχει ορατό κελί ${testId}_${field}`;
    if (norm(td.textContent)) return `ΣΦΑΛΜΑ: το κελί έχει ήδη «${norm(td.textContent)}» — δεν αλλάζω τίποτα`;
    const snap = cellMap(testId);
    jq()(td).trigger('click');
    const fi = await waitFor(() => {
      const f = document.getElementById('test_input_field');
      if (!visible(f)) return null;
      const a = f.getBoundingClientRect(), b = td.getBoundingClientRect();
      const cx = a.left + a.width / 2, cy = a.top + a.height / 2;
      return (cx >= b.left - 2 && cx <= b.right + 2 && cy >= b.top - 2 && cy <= b.bottom + 2) ? f : null;
    }, 4000);
    if (!fi) { hideInput(); return 'ΣΦΑΛΜΑ: το πεδίο εισαγωγής δεν βρέθηκε πάνω στο σωστό κελί — τίποτα δεν γράφτηκε'; }
    fi.value = value;
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
    try { Object.defineProperty(ev, 'keyCode', { get: () => 13 }); Object.defineProperty(ev, 'which', { get: () => 13 }); } catch (e) { /* ήδη 13 */ }
    fi.dispatchEvent(ev);
    await sleep(150);
    hideInput();
    const ok = await waitFor(() => cellText(testId, field) === value, 10000, 250);
    await sleep(800);
    const now = cellMap(testId);
    const changed = Object.keys(now).filter(k => k !== field && now[k] !== (snap[k] || ''));
    if (changed.length) return `ΠΡΟΣΟΧΗ: άλλαξαν και άλλα κελιά (${changed.map(k => k + '=' + now[k]).join(', ')}) — ΣΤΟΠ, ενημέρωση ιατρού`;
    if (!ok) return `ΑΓΝΩΣΤΟ: το κελί δείχνει «${cellText(testId, field)}» — reload και έλεγχος, ΟΧΙ επανάληψη`;
    p[idx].done = true; p[idx].testId = testId; ss.set('plan', p);
    return `OK ${field}=${value}`;
  }

  function read(testId) {
    const m = cellMap(testId);
    const s = Object.keys(m).filter(k => m[k]).map(k => k + '=' + m[k]).join(', ');
    return `${testId} (${colDate(testId) || '?'}): ${s || 'κενή'}`;
  }

  // Μετά από reload + MM.exams(τύπος): σύγκριση με το πλάνο
  function check() {
    const c = ctxCheck(); if (c) return c;
    const type = typeSel() && typeSel().value;
    const mine = planList().filter(e => e.amka === pat().amka && e.type === type);
    if (!mine.length) return 'καμία εγγραφή πλάνου για αυτόν τον τύπο';
    const lines = mine.map(e => {
      const id = e.testId || (cols().find(x => x.endsWith(':' + e.date)) || '').split(':')[0];
      const got = id ? cellText(id, e.field) : null;
      return `${got === e.value ? 'OK' : 'ΛΑΘΟΣ'} f${e.field}: αναμ. ${e.value}, βρέθηκε ${got == null ? '—' : got || 'κενό'}`;
    });
    return lines.join('; ');
  }

  // ---------- Αρχεία (μόνο συμπλήρωση/ανάγνωση, ΠΟΤΕ αποθήκευση) ----------
  function attField(name) {
    // το πεδίο του δεξιού panel (υπάρχει και ομώνυμο φίλτρο στη λίστα)
    let p = document.getElementById('AirAttachments_attach');
    for (let i = 0; i < 10 && p; i++) {
      p = p.parentElement;
      const c = p ? p.querySelectorAll('[name="' + name + '"]') : [];
      if (c.length === 1) return c[0];
      if (c.length > 1) return null;
    }
    return null;
  }
  function attForm() {
    const f = document.getElementById('AirAttachments_attach');
    const nm = attField('AirAttachments[onoma]');
    const tp = attField('AirAttachments[typeId]');
    const d = document.getElementById('AirAttachments_imnia');
    const pk = document.getElementById('AirAttachments_pelatis_picker_hidden');
    return `αρχείο ${f && f.files.length ? f.files[0].size + 'B' : '—'} | ονομασία «${nm ? nm.value : '?'}» | κατηγορία ${tp ? tp.value : '?'} | ημ/νία ${d ? d.value : '?'} | ασθενής ${pk ? pk.value : '?'}`;
  }
  // MM.attSet({name:'2026-10-13 Β χοριακή Ιπποκράτης', cat:29, catText:'ΕΞΕΤΑΣΕΙΣ ΕΓΚΥΜΟΣΥΝΗΣ', date:'13-10-2026'})
  function attSet(o) {
    const p = pat();
    const pick = document.getElementById('AirAttachments_pelatis_picker_hidden');
    if (!pick || pick.value !== p.id) return `ΣΦΑΛΜΑ: η ασθενής του panel (${pick ? pick.value : '—'}) ≠ ${p.id}`;
    const f = document.getElementById('AirAttachments_attach');
    if (!f || !f.files.length) return 'ΣΦΑΛΜΑ: δεν έχει επιλεγεί αρχείο (file_upload πρώτα)';
    const name = attField('AirAttachments[onoma]');
    if (!name) return 'ΣΦΑΛΜΑ: δεν βρέθηκε μοναδικό πεδίο Ονομασία στο panel';
    name.value = o.name; name.dispatchEvent(new Event('input', { bubbles: true })); name.dispatchEvent(new Event('change', { bubbles: true }));
    jq()('#AirAttachments_typeId').selectivity('data', { id: o.cat, text: o.catText });
    const d = document.getElementById('AirAttachments_imnia');
    if (d) { d.value = o.date; d.dispatchEvent(new Event('change', { bubbles: true })); }
    return 'OK συμπληρώθηκε (ΔΕΝ αποθηκεύτηκε) | ' + attForm();
  }
  // σύνοψη λίστας· με όρισμα: μόνο οι γραμμές που περιέχουν το κείμενο
  function attList(q) {
    const rows = [...document.querySelectorAll('.grid-view table tbody tr, table.items tbody tr')];
    const txt = tr => [...tr.querySelectorAll('td')].map(td => norm(td.textContent)).filter(Boolean).slice(0, 3).join(' | ');
    const sum = norm((document.querySelector('.summary') || {}).textContent || '') || rows.length + ' γραμμές';
    const sel = q ? rows.filter(tr => tr.textContent.includes(q)) : rows.slice(-3);
    return `${sum} | ${q ? 'ταιριάσματα ' + sel.length + ': ' : 'τελευταίες: '}` + sel.map(txt).join(' // ');
  }

  // ---------- ΠΗΤ εγκύων (ΜΟΝΟ ανάγνωση) ----------
  // MM.pht() → ξεκινά στο παρασκήνιο (κρυφά iframes, 3 παράλληλα)· ξανά MM.pht() μετά από ~35″ → αποτελέσματα
  // MM.pht(6) → γραμμές από την 7η και μετά (6 ανά κλήση)· MM.pht('new') → νέα ανάγνωση
  // Ανά έγκυο: ΠΗΤ (λίστα ασθενών, φίλτρο Έγκυος=ΝΑΙ), banner «Προηγ/σα καισ», ΙΣΤΟΡΙΚΟ → Χειρουργικές επεμβάσεις,
  // ΕΓΚΥΜΟΣΥΝΗ → μετρητές Κυήσεις/ΦΤ/ΚΤ + προηγούμενες κυήσεις (ημ/νία τοκετού, είδος, έκβαση)
  const PHT = { state: 'idle', done: 0, total: 0, rows: [], err: null };
  const labVals = (c, L) => [...c.querySelectorAll('label,span,div')].filter(l => norm(l.textContent) === L).map(l => {
    const b = l.parentElement; const e = b.querySelector('input');
    return norm(norm(b.textContent).replace(L, '')) || (e ? norm(e.value) : '');
  }).filter(Boolean);
  async function phtOne(p) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-5000px;top:0;width:1200px;height:900px';
    f.src = '/airPelates/update/' + p.id;
    document.body.appendChild(f);
    const r = Object.assign({}, p, { cs: null, su: null, cnt: null, past: [] });
    try {
      const doc = () => f.contentDocument;
      const b = await waitFor(() => { const d = doc(); const t = d && d.body && norm(d.body.innerText); return t && t.match(/Προηγ\/σα καισ:\s*(\S+)(?:\s*\(([^)]*)\))?/); }, 25000, 400);
      if (b) r.cs = (/N[AΑ]I|ΝΑΙ/i.test(b[1]) ? 'ΝΑΙ' : 'ΟΧΙ') + (b[2] ? ' ' + b[2] : '');
      const gt = doc().getElementById('ginaikologiko-istoriko-tab'); if (gt) gt.click();
      const su = await waitFor(() => { const q = doc().getElementById('ginaikologiko-istoriko'); const m = q && norm(q.innerText).match(/Χειρουργικές επεμβάσεις(.*?)Αλλεργίες/); return m ? [norm(m[1])] : null; }, 15000, 400);
      if (su) r.su = su[0];
      const pt = doc().getElementById('pregnancy-tab'); if (pt) pt.click();
      const pane = await waitFor(() => { const q = doc().getElementById('pregnancy'); return q && q.querySelector('.card') && q; }, 15000, 400);
      if (pane) {
        await sleep(1000);
        const v = k => { const e = pane.querySelector('[name$="[' + k + ']"]'); return e ? norm(e.value) : '–'; };
        r.cnt = v('toketoi') + '/' + v('fusiologikoi_toketoi') + '/' + v('kaisarikes');
        [...pane.querySelectorAll('.card')].filter(c => !c.parentElement.closest('.card')).forEach(c => {
          const date = labVals(c, 'Ημ/νία τοκετού').filter(x => /^\d{2}\/\d{2}\/\d{4}$/.test(x)).pop() || '';
          const kind = labVals(c, 'Είδος τοκετού').filter(x => !/Μαιευτήριο/.test(x)).join('/');
          const out = labVals(c, 'Έκβαση').filter(x => !/εμβρύων/.test(x)).join('/');
          if (kind || out || (date && date.replace(/\//g, '-') !== p.pet)) r.past.push([date || 'χωρίς ημ/νία', kind || 'είδος κενό', out].filter(Boolean).join(' '));
        });
      }
    } catch (e) { r.err = e.message; }
    f.remove();
    return r;
  }
  const dkey = s => { const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? m[3] + m[2] + m[1] : '99999999'; };
  async function phtRun() {
    PHT.state = 'running'; PHT.rows = []; PHT.done = 0; PHT.err = null;
    const res = await fetch('/airPelates/admin?' + encodeURIComponent('AirPelates[is_pregnant]') + '=1&gridPageSize=300', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = new DOMParser().parseFromString(await res.text(), 'text/html');
    const hdr = [...d.querySelectorAll('table thead tr')].map(r => [...r.children].map(c => norm(c.textContent))).find(r => r.includes('ΠΗΤ'));
    if (!hdr) throw new Error('δεν βρέθηκε στήλη ΠΗΤ');
    const ip = hdr.indexOf('ΠΗΤ'), il = hdr.indexOf('Επώνυμο'), ifn = hdr.indexOf('Όνομα');
    const P = [...d.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('a[href*="/airPelates/update/"]')).map(tr => ({
      id: (tr.querySelector('a[href*="/airPelates/update/"]').getAttribute('href').match(/update\/(\d+)/) || [])[1],
      pet: norm(tr.children[ip].textContent), ln: norm(tr.children[il].textContent), fn: norm(tr.children[ifn].textContent)
    }));
    PHT.total = P.length;
    const q = P.slice();
    await Promise.all([0, 1, 2].map(async () => { while (q.length) { const p = q.shift(); PHT.rows.push(await phtOne(p)); PHT.done++; } }));
    PHT.rows.sort((a, b) => dkey(a.pet).localeCompare(dkey(b.pet)));
    PHT.state = 'done';
  }
  function pht(arg) {
    if (PHT.state === 'running') return `… ${PHT.done}/${PHT.total} — ξανά MM.pht() σε λίγο`;
    if (PHT.state === 'idle' || arg === 'new') { phtRun().catch(e => { PHT.state = 'error'; PHT.err = e.message; }); return 'ξεκίνησε — ξανά MM.pht() σε ~35″'; }
    if (PHT.state === 'error') return 'ΣΦΑΛΜΑ: ' + PHT.err;
    const from = typeof arg === 'number' ? arg : 0;
    // χωρίς = & ? στην έξοδο (αλλιώς μπλοκάρεται από το εργαλείο JS)
    return `${PHT.rows.length} έγκυες :: ` + PHT.rows.slice(from, from + 6).map(r =>
      `${r.ln} ${r.fn} | ΠΗΤ ${dkey(r.pet) === '99999999' ? 'ΑΚΥΡΗ' : r.pet} | ΚΤ ${r.cs || '–'} | Χειρ ${r.su == null ? '–' : (r.su || '—')} | Κυ/ΦΤ/ΚΤ ${r.cnt || '–'} | Προηγ ${r.past.join(', ') || '—'}${r.err ? ' | ΣΦ ' + r.err : ''}`
    ).join(' ;; ').replace(/[=&?]/g, ' ').replace(/\d{9,}/g, '#');
  }

  const help = () => 'MM: plan(list) · patient(επώνυμο, ΑΜΚΑ) · go() / go("files") · exams(τύπος) · addColumn("ΗΗ-ΜΜ-ΕΕΕΕ") · setCell(testId, field, τιμή) · read(testId) · check() · attForm() · attSet({...}) · attList([κείμενο]) · pht([αρχή|"new"])';

  W.MM = { v: '1.0.5', help, plan, patient, go, exams, cols, addColumn, setCell, read, check, attForm, attSet, attList, pht };
})();
