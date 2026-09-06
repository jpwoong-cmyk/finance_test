NEON FINANCE — RESET DATA UPDATE

FILES
  fetch/reset-data.js              NEW
  fetch/statement-import.js        REPLACE EXISTING LOADER

KEEP
  fetch/ledger-tools.js
  fetch/monthly-performance.js
  app.js
  style.css
  index.html

INSTALL
1. Add fetch/reset-data.js
2. Replace fetch/statement-import.js with this ZIP's version.
3. No index.html change is required.
4. Hard refresh with Ctrl + F5.

BEHAVIOUR
A "Reset Data" button appears beside the existing Export/Import controls.

Reset removes only keys belonging to Neon Finance, not all localStorage for
the website/domain.

It removes:
- Accounts and balances
- Expenses / Savings / Current variable cards
- Activity and transaction history
- Balance Trace ledger data
- Categories and linked movements
- Monthly snapshots
- Imported statement metadata
- Any current/future localStorage or sessionStorage keys beginning with:
    neon-finance-

Exported .nfinance backup files already saved on the user's device are not touched.

After reset the page reloads and app.js creates a fresh empty state.
