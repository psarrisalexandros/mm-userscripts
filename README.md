# mm-userscripts

Tampermonkey userscripts για το «Αρχείο Ιατρείου» (MyMedical). Περιέχουν **μόνο κώδικα**: κανένα στοιχείο ασθενών, κανέναν κωδικό.

| Script | Τι κάνει | Εγκατάσταση |
|---|---|---|
| `mm-helper.user.js` | `window.MM`: ελεγχόμενη καταχώριση εργαστηριακών, ανάγνωση ΠΗΤ. Καμία διαγραφή. | [εγκατάσταση](https://raw.githubusercontent.com/psarrisalexandros/mm-userscripts/main/mm-helper.user.js) |
| `mm-births.user.js` | `window.MMT`: μόνο ανάγνωση εγκύων και τοκετών για το ημερολόγιο. | [εγκατάσταση](https://raw.githubusercontent.com/psarrisalexandros/mm-userscripts/main/mm-births.user.js) |

Σε κάθε υπολογιστή ανοίγεις μία φορά τον σύνδεσμο εγκατάστασης με ενεργό το Tampermonkey και πατάς **Install** ή **Update**. Από εκεί και πέρα το Tampermonkey ελέγχει μόνο του για νέες εκδόσεις μέσω του `@updateURL`.

Κάθε αλλαγή κώδικα ανεβάζει τον αριθμό `@version`, αλλιώς το Tampermonkey δεν τη βλέπει ως ενημέρωση.
