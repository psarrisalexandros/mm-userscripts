// ==UserScript==
// @name         MM helper – Αρχείο Ιατρείου
// @namespace    psarris.mymedical
// @version      1.0.7
// @description  Εντολές window.MM για ελεγχόμενη καταχώριση εργαστηριακών και ΙΣΤΟΡΙΚΟΥ (ομάδα αίματος, ηλεκτροφόρηση, κυστική ίνωση, δρεπάνωση) στο MyMedical, έλεγχο ήδη περασμένων τιμών και ανάγνωση ΠΗΤ εγκύων. Καμία λειτουργία διαγραφής.
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
  - MM.have() και MM.hist() μόνο ΔΙΑΒΑΖΟΥΝ.
  - ΙΣΤΟΡΙΚΟ: MM.histSet() συμπληρώνει ΜΟΝΟ κενά πεδία του εγκεκριμένου πλάνου (MM.histPlan) από λίστα 11 επιτρεπτών πεδίων·
    αν κάποιο πεδίο του πλάνου έχει ήδη άλλη τιμή, δεν αλλάζει τίποτα. MM.histSave() πατά την κανονική αποθήκευση της καρτέλας
    ΜΟΝΟ αν, σε σχέση με το στιγμιότυπο πριν από το histSet, άλλαξαν μόνο τα πεδία του πλάνου και έχουν ακριβώς τις τιμές του.
  - Αποθήκευση αρχείων (Αρχεία) δεν γίνεται από εδώ· το MM.attSet μόνο συμπληρώνει πεδία.
  - Το MM.pht() μόνο ΔΙΑΒΑΖΕΙ (λίστα εγκύων, banner, ΙΣΤΟΡΙΚΟ, ΕΓΚΥΜΟΣΥΝΗ)· δεν πατά ποτέ αποθήκευση.
*/
(function () {
  'use strict';
  const W = window;
  if (W.MM && W.MM.v && W.MM.v >= '1.0.7') return;

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

  // ---------- Έλεγχος ήδη περασμένων τιμών (ΜΟΝΟ ανάγνωση) ----------
  // Μετά από MM.exams(τύπος). MM.have([{date:'ΗΗ-ΜΜ-ΕΕΕΕ', field:19, value:'12,5'}, ...]) →
  //   ✓ υπάρχει ίδια τιμή στην ίδια ημ/νία · ≠(τιμή) άλλη τιμή στην ίδια ημ/νία · ~(ημ/νία) ίδια τιμή σε άλλη στήλη · ✗ λείπει
  // MM.have() χωρίς όρισμα: όλες οι συμπληρωμένες τιμές του τύπου, ανά στήλη.
  const vnorm = s => norm(s).replace(/\s/g, '').replace(',', '.').toLowerCase();
  const isNum = s => /^[-+]?\d+(\.\d+)?$/.test(s);
  const sameVal = (a, b) => { const x = vnorm(a), y = vnorm(b); return x === y || (isNum(x) && isNum(y) && parseFloat(x) === parseFloat(y)); };
  function have(list) {
    const c = ctxCheck(); if (c) return c;
    if (dupCols()) return 'ΣΦΑΛΜΑ: διπλές στήλες — reload και ξανά MM.exams';
    const type = typeSel() && typeSel().value;
    const ids = cols().map(x => x.split(':')[0]);
    if (!Array.isArray(list)) return `τύπος ${type} :: ` + (ids.map(read).join(' ; ').replace(/=/g, ':') || 'καμία στήλη');
    const maps = ids.map(id => ({ date: colDate(id), m: cellMap(id) }));
    const out = list.map(e => {
      const f = String(e.field), v = norm(e.value), d = e.date;
      const col = maps.find(x => x.date === d);
      const here = col ? col.m[f] || '' : '';
      let s;
      if (here && sameVal(here, v)) s = '✓';
      else if (here) s = `≠(${here})`;
      else { const o = maps.find(x => x.m[f] && sameVal(x.m[f], v)); s = o ? `~(${o.date})` : '✗'; }
      return `${s} f${f} ${v} ${d}`;
    });
    const n = k => out.filter(x => x.startsWith(k)).length;
    return `τύπος ${type} | ✓${n('✓')} ≠${n('≠')} ~${n('~')} ✗${n('✗')} :: ` + out.join('; ');
  }

  // ---------- ΙΣΤΟΡΙΚΟ (ομάδα αίματος, Rh, ηλεκτροφόρηση, κυστική ίνωση, δρεπάνωση — γυναίκα και σύζυγος) ----------
  const HK = ['omada_aimatos', 'rhesus', 'ilektroforisi_custom', 'ilektroforisi_comments', 't31', 'drepanosi',
    'omada_aimatos_sizigou', 'rhesus_sizigou', 'ilektroforisi_sizigou', 'ilektroforisi_comments_s', 't32'];
  const HL = { omada_aimatos: 'ΟΑ', rhesus: 'Rh', ilektroforisi_custom: 'ΗλΦ', ilektroforisi_comments: 'ΗλΦσχ', t31: 'ΚΙ', drepanosi: 'Δρεπ',
    omada_aimatos_sizigou: 'ΟΑσ', rhesus_sizigou: 'Rhσ', ilektroforisi_sizigou: 'ΗλΦσ', ilektroforisi_comments_s: 'ΗλΦσχσ', t32: 'ΚΙσ' };
  const hEl = k => document.querySelector('#AirGynaikology-form [name="AirGynaikology[' + k + ']"]');
  const hVal = el => !el ? null : el.tagName === 'SELECT'
    ? (el.value && el.value !== '0' && el.selectedIndex >= 0 ? norm(el.options[el.selectedIndex].text) : '')
    : norm(el.value);
  const bEl = k => document.querySelector('#basic_derma_form [name="AirPelates[' + k + ']"]');
  async function histReady() {
    const t = document.getElementById('ginaikologiko-istoriko-tab'); if (t) t.click();
    return !!(await waitFor(() => hEl('t31') && hEl('t32') && document.getElementById('basic_derma_form'), 15000));
  }
  // MM.hist([ΑΜΚΑ από την εξέταση του συζύγου]) — μία γραμμή· με όρισμα ελέγχει και το «ΑΜΚΑ Συζύγου» των ΒΑΣΙΚΩΝ
  async function hist(amkaS) {
    const c = ctxCheck(); if (c) return c;
    if (!await histReady()) return 'ΣΦΑΛΜΑ: δεν φόρτωσε το ΙΣΤΟΡΙΚΟ — reload';
    const s = HK.map(k => `${HL[k]} ${hVal(hEl(k)) || '—'}`).join(' | ');
    const sn = [bEl('sizigou'), bEl('c_t_142')].map(e => e ? norm(e.value) : '').join(' ').trim();
    const sa = bEl('c_t_143') ? bEl('c_t_143').value.replace(/\D/g, '') : '';
    let m = '';
    if (amkaS) m = !sa ? ' | ΑΜΚΑ συζύγου ΚΕΝΟ στα ΒΑΣΙΚΑ' : sa === String(amkaS) ? ' | ΑΜΚΑ συζύγου ταιριάζει' : ' | ΑΜΚΑ συζύγου ΔΙΑΦΕΡΕΙ';
    return `${s} || σύζυγος: ${sn || '—'} ΑΜΚΑ …${sa ? sa.slice(-4) : '—'}${m}`;
  }
  // MM.histPlan({amka:'ΑΜΚΑ ασθενούς', set:{omada_aimatos:'Α', rhesus:'Θετικό (+)', t32:'CFTR 90% αρνητικό'}}) — ακριβώς η εγκεκριμένη λίστα
  // (τιμές = το ΚΕΙΜΕΝΟ της επιλογής όπως φαίνεται στο MyMedical)
  function histPlan(o) {
    if (o === undefined) {
      const h = ss.get('hplan', null);
      return h ? `ΙΣΤΟΡΙΚΟ πλάνο …${h.amka.slice(-4)}: ` + Object.keys(h.set).map(k => `${HL[k]} ${h.set[k]}`).join(' | ') : 'κανένα πλάνο ΙΣΤΟΡΙΚΟΥ';
    }
    if (!o || !/^\d{11}$/.test(String(o.amka)) || !o.set || !Object.keys(o.set).length) return 'ΣΦΑΛΜΑ: {amka, set:{πεδίο:τιμή}}';
    const bad = Object.keys(o.set).filter(k => !HK.includes(k) || !norm(o.set[k]));
    if (bad.length) return 'ΣΦΑΛΜΑ: μη επιτρεπτά ή κενά πεδία ' + bad.join(',');
    const set = {}; Object.keys(o.set).forEach(k => { set[k] = norm(o.set[k]); });
    ss.set('hplan', { amka: String(o.amka), set });
    ss.set('hsnap', null);
    return `OK πλάνο ΙΣΤΟΡΙΚΟΥ ${Object.keys(set).length} πεδίων`;
  }
  function snapAll() {
    const o = {};
    document.querySelectorAll('#basic_derma_form [name], #AirGynaikology-form [name]').forEach((e, i) => {
      if (e.type === 'file') return;
      o[e.name + '#' + i] = (e.type === 'checkbox' || e.type === 'radio') ? String(e.checked) : String(e.value);
    });
    return o;
  }
  async function histSet() {
    const c = ctxCheck(); if (c) return c;
    const h = ss.get('hplan', null);
    if (!h || h.amka !== pat().amka) return 'ΣΦΑΛΜΑ: κανένα εγκεκριμένο πλάνο ΙΣΤΟΡΙΚΟΥ για αυτή την ασθενή';
    if (!await histReady()) return 'ΣΦΑΛΜΑ: δεν φόρτωσε το ΙΣΤΟΡΙΚΟ — reload';
    await sleep(500);
    const before = snapAll();
    const res = [], todo = [];
    for (const k of Object.keys(h.set)) {
      const el = hEl(k), want = h.set[k], cur = hVal(el);
      if (!el) { res.push(`${HL[k]} ΣΦΑΛΜΑ: δεν βρέθηκε πεδίο`); continue; }
      if (cur) { res.push(cur === want ? `${HL[k]} ✓ υπήρχε ήδη` : `${HL[k]} ΑΡΝΗΣΗ: έχει ήδη «${cur}»`); continue; }
      if (el.tagName === 'SELECT') {
        const op = [...el.options].find(x => norm(x.text) === want && x.value !== '0' && x.value !== '');
        if (!op) { res.push(`${HL[k]} ΣΦΑΛΜΑ: δεν υπάρχει επιλογή «${want}»`); continue; }
        todo.push({ el, v: op.value, k });
      } else todo.push({ el, v: want, k });
    }
    if (res.some(r => /ΣΦΑΛΜΑ|ΑΡΝΗΣΗ/.test(r))) return 'ΣΤΟΠ — τίποτα δεν άλλαξε :: ' + res.join(' | ');
    if (!todo.length) return 'τίποτα για συμπλήρωση :: ' + res.join(' | ');
    todo.forEach(t => { jq()(t.el).val(t.v).trigger('change'); t.el.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(400);
    const after = snapAll();
    const names = todo.map(t => t.el.name);
    const other = Object.keys(after).filter(k => after[k] !== before[k] && !names.includes(k.split('#')[0]));
    if (other.length || Object.keys(after).length !== Object.keys(before).length)
      return 'ΠΡΟΣΟΧΗ: άλλαξαν και άλλα πεδία (' + other.join(',') + ') — ΜΗΝ αποθηκεύσεις· reload';
    ss.set('hsnap', { id: pat().id, before, names });
    return 'OK συμπληρώθηκαν (ΔΕΝ αποθηκεύτηκαν): ' + todo.map(t => `${HL[t.k]} ${hVal(t.el)}`).concat(res).join(' | ') + ' → MM.histSave()';
  }
  function histSave() {
    const c = ctxCheck(); if (c) return c;
    const s = ss.get('hsnap', null), h = ss.get('hplan', null);
    if (!s || s.id !== pat().id || !h || h.amka !== pat().amka) return 'ΣΦΑΛΜΑ: πρώτα MM.histSet()';
    const now = snapAll();
    const extra = Object.keys(now).filter(k => now[k] !== s.before[k] && !s.names.includes(k.split('#')[0]));
    if (extra.length || Object.keys(now).length !== Object.keys(s.before).length)
      return 'ΠΡΟΣΟΧΗ: η σελίδα διαφέρει από το στιγμιότυπο (' + extra.join(',') + ') — ΔΕΝ αποθηκεύτηκε';
    const wrong = s.names.filter(n => { const k = (n.match(/\[(.+)\]/) || [])[1]; return hVal(hEl(k)) !== h.set[k]; });
    if (wrong.length) return 'ΠΡΟΣΟΧΗ: τιμές διαφορετικές από το πλάνο (' + wrong.join(',') + ') — ΔΕΝ αποθηκεύτηκε';
    const b = document.getElementById('air-pelates-save');
    if (!visible(b)) return 'ΣΦΑΛΜΑ: δεν βρέθηκε ορατό κουμπί αποθήκευσης';
    ss.set('hsnap', null);
    b.click();
    return 'αποθήκευση… η σελίδα θα ξαναφορτώσει → μετά await MM.histCheck()';
  }
  // Μετά από reload: σύγκριση ΙΣΤΟΡΙΚΟΥ με το πλάνο
  async function histCheck() {
    const c = ctxCheck(); if (c) return c;
    const h = ss.get('hplan', null);
    if (!h || h.amka !== pat().amka) return 'κανένα πλάνο ΙΣΤΟΡΙΚΟΥ για αυτή την ασθενή';
    if (!await histReady()) return 'ΣΦΑΛΜΑ: δεν φόρτωσε το ΙΣΤΟΡΙΚΟ — reload';
    await sleep(500);
    return Object.keys(h.set).map(k => { const got = hVal(hEl(k)); return `${got === h.set[k] ? 'OK' : 'ΛΑΘΟΣ'} ${HL[k]}: αναμ. ${h.set[k]}, βρέθηκε ${got || 'κενό'}`; }).join('; ');
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
    return S('OK συμπληρώθηκε (ΔΕΝ αποθηκεύτηκε) | ' + attForm() + ' | αποθήκευση: native κλικ στο ' + attSaveXY());
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


  // ================= 1.0.7: λιγότερες κλήσεις =================
  const S = x => String(x).replace(/[=&?]/g, ':');
  const btnXY = el => { if (!el) return '—'; const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2) + ',' + Math.round(r.top + r.height / 2); };

  // MM.find('ΕΠΩΝΥΜΟ', 'ΗΗ/ΜΜ/ΕΕΕΕ') — ΜΟΝΟ ανάγνωση: ασθενείς με αυτό το επώνυμο· με ημ. γέννησης κρατά όσους το ΑΜΚΑ αρχίζει με ΗΗΜΜΕΕ
  async function find(lastname, dob) {
    const up = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const res = await fetch('/airPelates/admin?' + encodeURIComponent('AirPelates[lastname]') + '=' + encodeURIComponent(lastname) + '&gridPageSize=300', { credentials: 'same-origin' });
    if (!res.ok) return 'ΣΦΑΛΜΑ HTTP ' + res.status;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const hdr = [...doc.querySelectorAll('table thead tr')].map(r => [...r.children].map(c => norm(c.textContent))).find(r => r.includes('ΑΜΚΑ'));
    if (!hdr) return 'ΣΦΑΛΜΑ: δεν βρέθηκε στήλη ΑΜΚΑ';
    const ai = hdr.indexOf('ΑΜΚΑ'), li = hdr.indexOf('Επώνυμο'), fi = hdr.indexOf('Όνομα');
    let rows = [...doc.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('a[href*="/airPelates/update/"]')).map(tr => ({
      amka: tr.children[ai] ? tr.children[ai].textContent.replace(/\D/g, '') : '',
      last: norm(tr.children[li] && tr.children[li].textContent), first: norm(tr.children[fi] && tr.children[fi].textContent)
    })).filter(r => up(r.last) === up(lastname));
    if (dob) {
      const m = String(dob).match(/(\d{1,2})\D(\d{1,2})\D(\d{2,4})/);
      if (m) { const pre = m[1].padStart(2, '0') + m[2].padStart(2, '0') + m[3].slice(-2); rows = rows.filter(r => r.amka.startsWith(pre)); }
    }
    return `${rows.length} ασθενείς: ` + rows.map(r => `${r.last} ${r.first} ΑΜΚΑ ${r.amka}`).join(' ; ');
  }

  // MM.batch({amka, type, date:'ΗΗ-ΜΜ-ΕΕΕΕ', set:[[πεδίο,'τιμή'],…], dry})
  // = MM.plan(ακριβώς αυτές) + exams(type) + have + (αν όχι dry) addColumn + setCell μία-μία, στοπ στο 1ο μη-OK.
  // ΠΡΕΠΕΙ να αντιστοιχεί ακριβώς στον εγκεκριμένο πίνακα. Κελιά με τιμή ΔΕΝ αλλάζουν (setCell αρνείται).
  async function batch(o) {
    const c = ctxCheck(); if (c) return S(c);
    if (!o || !Array.isArray(o.set) || !o.set.length) return 'ΣΦΑΛΜΑ: {amka,type,date,set:[[πεδίο,τιμή]]}';
    if (o.amka !== pat().amka) return 'ΣΦΑΛΜΑ: το ΑΜΚΑ δεν είναι της ασθενούς του MM.patient';
    const r0 = await exams(o.type); if (!r0.startsWith('OK')) return S(r0);
    const h = have(o.set.map(([f, v]) => ({ date: o.date, field: f, value: v })));
    if (o.dry) return S('DRY ' + h);
    const todo = o.set.filter(([f, v]) => h.includes(`✗ f${f} ${norm(v)} `));
    const skip = o.set.length - todo.length;
    if (!todo.length) return S('τίποτα για καταχώριση :: ' + h);
    const pr = plan(todo.map(([f, v]) => ({ amka: o.amka, date: o.date, type: o.type, field: f, value: v })));
    if (!pr.startsWith('OK')) return S(pr);
    const col = await addColumn(o.date); if (!col.startsWith('OK')) return S(col);
    const tid = (col.match(/testId=(\d+)/) || [])[1];
    const out = [];
    for (const [f, v] of todo) {
      const r = await setCell(tid, f, v); out.push(r);
      if (!r.startsWith('OK')) return S(`ΣΤΟΠ στο f${f} :: ` + out.join(' ; ') + ' → reload, MM.read(' + tid + '), ενημέρωση ιατρού');
    }
    return S(`OK ${todo.length} τιμές στη στήλη ${tid} (${o.date})` + (skip ? ` · ${skip} παραλείφθηκαν (✓/≠/~ — δες have)` : '') + ' → reload και MM.verify(' + o.type + ')');
  }

  // Μετά από reload: περιμένει τη σελίδα, ξαναδοκιμάζει, συγκρίνει με το πλάνο
  async function verify(type) {
    const t0 = Date.now();
    for (let i = 0; i < 4 && Date.now() - t0 < 30000; i++) {
      await sleep(i ? 2500 : 1500);
      const c = ctxCheck(); if (c) continue;
      const r = await exams(type); if (!r.startsWith('OK')) continue;
      const k = check();
      if (!/καμία εγγραφή|—|κενό/.test(k)) return S(k);
      if (i === 3) return S(k);
    }
    return 'ΑΝΑΜΟΝΗ: η σελίδα δεν σταθεροποιήθηκε σε 30″ — ξανά MM.verify(' + type + ')';
  }

  // ---- ΒΑΣΙΚΑ (μόνο στοιχεία συζύγου, μόνο κενά πεδία) ----
  const BK = ['sizigou', 'c_t_142', 'c_t_143', 'c_t_144'];
  function basicSet(o) {
    const c = ctxCheck(); if (c) return S(c);
    const bad = Object.keys(o || {}).filter(k => !BK.includes(k) || !norm(o[k]));
    if (!o || !Object.keys(o).length || bad.length) return 'ΣΦΑΛΜΑ: επιτρέπονται μόνο ' + BK.join(',');
    const before = snapAll(), res = [];
    for (const k of Object.keys(o)) {
      const el = bEl(k);
      if (!el) return 'ΣΦΑΛΜΑ: δεν βρέθηκε ' + k;
      if (norm(el.value)) { res.push(norm(el.value) === norm(o[k]) ? `${k} ✓ υπήρχε` : `${k} ΑΡΝΗΣΗ έχει «${norm(el.value)}»`); }
    }
    if (res.some(r => /ΑΡΝΗΣΗ/.test(r))) return S('ΣΤΟΠ — τίποτα δεν άλλαξε :: ' + res.join(' | '));
    const keys = Object.keys(o).filter(k => !norm(bEl(k).value));
    if (!keys.length) return S('τίποτα για συμπλήρωση :: ' + res.join(' | '));
    keys.forEach(k => { const el = bEl(k); el.value = norm(o[k]); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    const after = snapAll(), names = keys.map(k => 'AirPelates[' + k + ']');
    const other = Object.keys(after).filter(k => after[k] !== before[k] && !names.includes(k.split('#')[0]));
    if (other.length) return S('ΠΡΟΣΟΧΗ: άλλαξαν και άλλα πεδία (' + other.join(',') + ') — ΜΗΝ αποθηκεύσεις· reload');
    ss.set('bsnap', { id: pat().id, before, names, want: o });
    return S('OK συμπληρώθηκαν (ΔΕΝ αποθηκεύτηκαν): ' + keys.map(k => k + ' ' + o[k]).concat(res).join(' | ') + ' → MM.basicSave()');
  }
  function basicSave() {
    const c = ctxCheck(); if (c) return S(c);
    const s = ss.get('bsnap', null);
    if (!s || s.id !== pat().id) return 'ΣΦΑΛΜΑ: πρώτα MM.basicSet()';
    const now = snapAll();
    const extra = Object.keys(now).filter(k => now[k] !== s.before[k] && !s.names.includes(k.split('#')[0]));
    if (extra.length) return S('ΠΡΟΣΟΧΗ: η σελίδα διαφέρει (' + extra.join(',') + ') — ΔΕΝ αποθηκεύτηκε');
    const b = document.getElementById('air-pelates-save');
    if (!visible(b)) return 'ΣΦΑΛΜΑ: δεν βρέθηκε κουμπί αποθήκευσης';
    ss.set('bsnap', null); b.click();
    return 'αποθήκευση… μετά reload και MM.hist()';
  }

  // ---- Αρχεία: νέα φόρμα ----
  // await MM.attNew(): ανοίγει ΝΕΑ φόρμα αρχείου (κόκκινο «+») και ελέγχει ότι είναι νέα (κενή ονομασία, χωρίς αρχείο,
  // σημερινή ημ/νία). Περιμένει πρώτα να φορτώσει το panel της 1ης γραμμής (αλλιώς το αντικαθιστά), έως 3 προσπάθειες.
  function attIsNew() {
    const nm = attField('AirAttachments[onoma]'), f = document.getElementById('AirAttachments_attach'), d = document.getElementById('AirAttachments_imnia');
    const t = new Date(), today = String(t.getDate()).padStart(2, '0') + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + t.getFullYear();
    return !!(nm && !norm(nm.value) && f && !f.files.length && d && d.value === today);
  }
  async function attNew() {
    if (!/attachments/.test(location.pathname)) return 'ΣΦΑΛΜΑ: πρώτα MM.go("files")';
    await sleep(2500);
    for (let i = 0; i < 3; i++) {
      if (attIsNew()) return 'OK νέα φόρμα';
      const b = document.getElementById('add-file-button');
      if (!b) return 'ΣΦΑΛΜΑ: δεν βρέθηκε το κόκκινο «+»';
      b.click();
      await sleep(2000);
    }
    return attIsNew() ? 'OK νέα φόρμα' : 'ΣΦΑΛΜΑ: δεν άνοιξε νέα φόρμα — native κλικ στο ' + btnXY(document.getElementById('add-file-button')) + ', μετά ξανά await MM.attNew()';
  }
  function attSaveXY() {
    const b = [...document.querySelectorAll('button, input[type=submit], a')].find(e => visible(e) && /αποθήκευση αλλαγών/i.test(norm(e.textContent || e.value)));
    return btnXY(b);
  }

  const help = () => 'MM 1.0.7: find(επώνυμο,ημ.γέννησης) · batch({amka,type,date,set,dry}) · verify(τύπος) · basicSet({sizigou,c_t_142,…}) · basicSave() · attNew() · plan(list) · patient(επώνυμο, ΑΜΚΑ) · go() / go("files") · exams(τύπος) · have([{date,field,value}]) · addColumn("ΗΗ-ΜΜ-ΕΕΕΕ") · setCell(testId, field, τιμή) · read(testId) · check() · hist([ΑΜΚΑ συζύγου]) · histPlan({amka,set}) · histSet() · histSave() · histCheck() · attForm() · attSet({...}) · attList([κείμενο]) · pht([αρχή|"new"])';

  W.MM = { v: '1.0.7', help, find, batch, verify, basicSet, basicSave, attNew, plan, patient, go, exams, cols, have, addColumn, setCell, read, check, hist, histPlan, histSet, histSave, histCheck, attForm, attSet, attList, pht };
})();
