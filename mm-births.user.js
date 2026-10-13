// ==UserScript==
// @name         MM τοκετοί – Αρχείο Ιατρείου
// @namespace    psarris.mymedical
// @version      1.0.1
// @description  window.MMT: ΜΟΝΟ ανάγνωση της αναφοράς «Αναζήτηση Όλων των Τοκετών» και της λίστας εγκύων, για την ενημέρωση του ημερολογίου. Καμία αποθήκευση, καμία διαγραφή.
// @match        https://ju1938.my-medical.online/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/psarrisalexandros/mm-userscripts/main/mm-births.user.js
// @downloadURL  https://raw.githubusercontent.com/psarrisalexandros/mm-userscripts/main/mm-births.user.js
// ==/UserScript==
/*
  ΚΑΝΟΝΕΣ ΑΣΦΑΛΕΙΑΣ
  - Μόνο GET fetch σε δύο σελίδες λίστας/αναφοράς. Κανένα κλικ, καμία φόρμα, καμία αποθήκευση ή διαγραφή.
  - Ξεχωριστό namespace (MMT), ώστε να μη συγκρούεται με το MM helper.
  - Η έξοδος δεν περιέχει = & ? και κρύβει αριθμούς 9+ ψηφίων (ΑΜΚΑ/τηλέφωνα).

  MMT.preg()                         τρέχουσες έγκυες: ΕΠΩΝΥΜΟ ΟΝΟΜΑ ΠΗΤ (μία κλήση, χωρίς iframes)
  MMT.births('ΗΗ-ΜΜ-ΕΕΕΕ'[, 'ΗΗ-ΜΜ-ΕΕΕΕ'])   κυήσεις που έκλεισαν στο διάστημα (έως σήμερα αν λείπει το 2ο)
  MMT.births(10)                     επόμενες γραμμές (10 ανά κλήση)
*/
(function () {
  'use strict';
  const W = window;
  if (W.MMT && W.MMT.v >= '1.0.1') return;

  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const clean = s => String(s).replace(/[=&?]/g, ' ').replace(/\d{9,}/g, '#');
  const okDate = s => /^\d{2}-\d{2}-\d{4}$/.test(String(s));
  const today = () => {
    const d = new Date();
    return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
  };
  const dkey = s => { const m = String(s).match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/); return m ? m[3] + m[2] + m[1] : '99999999'; };
  async function getDoc(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    if (/name="LoginForm|id="login-form"|type="password"/i.test(html) && !/<tbody/i.test(html)) throw new Error('δεν είστε συνδεδεμένοι στο MyMedical');
    return new DOMParser().parseFromString(html, 'text/html');
  }
  const S = { births: null };

  async function preg() {
    let d;
    try { d = await getDoc('/airPelates/admin?' + encodeURIComponent('AirPelates[is_pregnant]') + '=1&gridPageSize=300'); }
    catch (e) { return 'ΣΦΑΛΜΑ: ' + e.message; }
    const hdr = [...d.querySelectorAll('table thead tr')].map(r => [...r.children].map(c => norm(c.textContent))).find(r => r.includes('ΠΗΤ'));
    if (!hdr) return 'ΣΦΑΛΜΑ: δεν βρέθηκε στήλη ΠΗΤ';
    const ip = hdr.indexOf('ΠΗΤ'), il = hdr.indexOf('Επώνυμο'), ifn = hdr.indexOf('Όνομα');
    const P = [...d.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('a[href*="/airPelates/update/"]')).map(tr => ({
      pet: norm(tr.children[ip] && tr.children[ip].textContent),
      n: norm((tr.children[il] || {}).textContent) + ' ' + norm((tr.children[ifn] || {}).textContent)
    }));
    P.sort((a, b) => dkey(a.pet).localeCompare(dkey(b.pet)));
    return clean(`${P.length} έγκυες :: ` + P.map(p => `${p.n} ${dkey(p.pet) === '99999999' ? 'ΠΗΤ-ΑΚΥΡΗ' : p.pet}`).join(' ; '));
  }

  function show(from) {
    const b = S.births;
    if (!b) return 'ΣΦΑΛΜΑ: πρώτα MMT.births(ΗΗ-ΜΜ-ΕΕΕΕ)';
    const head = from === 0 ? `${b.rows.length} κυήσεις ${b.apo}…${b.eos} | στήλες: ${b.hdr.join('|')} :: ` : `από ${from + 1} :: `;
    const body = b.rows.slice(from, from + 10).map(r => {
      const cells = r.cells.map(c => c.slice(0, 45)).join('|');
      return cells + (r.mass ? ' ⚠ΜΑΖΙΚΟ-ΚΛΕΙΣΙΜΟ' : '');
    }).join(' ; ');
    const more = b.rows.length > from + 10 ? ` … (+${b.rows.length - from - 10}: MMT.births(${from + 10}))` : '';
    return clean(head + (body || '—') + more);
  }

  async function births(apo, eos) {
    if (typeof apo === 'number') return show(apo);
    if (!okDate(apo) || (eos && !okDate(eos))) return 'ΣΦΑΛΜΑ: ημερομηνίες σε μορφή ΗΗ-ΜΜ-ΕΕΕΕ';
    eos = eos || today();
    let d;
    try {
      d = await getDoc('/pregnancy/stats/getAllPregnancies?imnia_apo=' + apo + '&imnia_eos=' + eos + '&yt0=' + encodeURIComponent('ΕΚΤΕΛΕΣΗ'));
    } catch (e) { return 'ΣΦΑΛΜΑ: ' + e.message; }
    const t = [...d.querySelectorAll('table')].find(x => x.querySelector('tbody tr td'));
    if (!t) { S.births = { apo, eos, hdr: [], rows: [] }; return `0 κυήσεις ${apo}…${eos}`; }
    const hdr = [...t.querySelectorAll('thead tr')].map(r => [...r.children].map(c => norm(c.textContent)))
      .sort((a, b) => b.length - a.length)[0] || [];
    const raw = [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => norm(c.textContent)))
      .filter(r => r.length > 1 && r.some(Boolean));
    // στήλη ημ/νίας τοκετού/κλεισίματος: επικεφαλίδα με «Ημ» που δεν είναι ΤΕΡ· αλλιώς η 5η στήλη (όπως στην αναφορά του 13-10-2026)
    let di = hdr.findIndex(h => /Ημ/i.test(h) && !/ΤΕΡ|τελευτ|έμμην/i.test(h));
    if (di < 0) di = 4;
    const cnt = {};
    raw.forEach(r => { const k = r[di] || ''; cnt[k] = (cnt[k] || 0) + 1; });
    const rows = raw.map(r => ({ cells: r, mass: !!r[di] && cnt[r[di]] >= 4 }))
      .sort((a, b) => dkey(a.cells[di]).localeCompare(dkey(b.cells[di])));
    S.births = { apo, eos, hdr, rows };
    return show(0);
  }

  const help = () => 'MMT (μόνο ανάγνωση): preg() · births("ΗΗ-ΜΜ-ΕΕΕΕ"[, "ΗΗ-ΜΜ-ΕΕΕΕ"]) · births(αρχή)';
  W.MMT = { v: '1.0.1', help, preg, births };
})();
