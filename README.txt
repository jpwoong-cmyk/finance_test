NEON FINANCE — MONTHLY UI UPDATE

Files in this package:
  fetch/statement-import.js
  fetch/monthly-performance.js

Keep your existing:
  fetch/ledger-tools.js
  app.js
  style.css
  index.html

INSTALL
1. Replace your existing fetch/statement-import.js with the one in this ZIP.
2. Add fetch/monthly-performance.js to the same /fetch folder.
3. Keep index.html unchanged.
4. Hard refresh the page with Ctrl + F5.

WHAT CHANGED
- Visible "Credit Cards" wording is changed back to "Expenses".
- The existing "Money Mix" heading becomes:
    FINANCIAL POSITION
    Current Distribution
- Adds a new full-width section:
    MONTHLY PERFORMANCE
    Savings & Spending Trend
- Shows the last 12 months.
- Net Savings = net dated movement in Savings accounts for each month.
- Spending counts:
    • positive movements added to Expenses accounts
    • direct unlinked money leaving Current or Savings
- Linked internal movements and card payments are excluded from Spending
  so moving money or paying an already-recorded expense is not counted twice.
- Includes this-month values and comparison against last month.
- Hover/tap the chart to inspect a month.
- Backdated ledger entries automatically appear in the correct historical month.

NOTE
Historical months cannot be reconstructed from old balances alone. The chart uses
dated Balance Trace ledger movements. As you enter/backdate transactions, those
months populate automatically.
