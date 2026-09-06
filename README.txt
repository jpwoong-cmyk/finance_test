NEON FINANCE — LEDGER / BALANCE TRACE UPGRADE
=============================================

INSTALL
-------
Your existing index.html already loads:

  <script src="fetch/statement-import.js"></script>

So no HTML or CSS change is required.

1. Open your repo's /fetch folder.
2. ADD: ledger-tools.js
3. REPLACE the existing statement-import.js with the statement-import.js in this package.
4. Commit both files.
5. Refresh the site. A hard refresh may help after deployment.

WHAT CHANGES
------------
1. UI name "Expenses" becomes "Credit Cards" while the internal key remains
   "expenses" so your existing HSBC / Standard Chartered data remains intact.

2. Every Current, Savings and Credit Card drawer gets:
   + Add
   - Subtract
   = Set exact

3. Transaction date is available for all three account types.
   - Defaults to today.
   - Backdating is allowed.
   - Future dates are blocked.

4. Optional Category field for movements.
   Examples include Salary, Food, Transport, Shopping, Bills, Subscriptions,
   Savings Transfer, Card Payment, Refund, Interest and Unknown.

5. = SET EXACT reconciliation
   Example:
     Previous balance: $450
     Set exact:        $500
     Difference:       +$50

   The +$50 is recorded as Unknown. It does NOT change the balance again when
   you later categorise it.

6. BALANCE TRACE pill appears inside every account drawer.
   - Opens a neon radial movement chart.
   - Shows Recorded In / Recorded Out / Unknown.
   - Unknown segment can be clicked.
   - Unknown records can be reclassified individually.
   - Reclassification only changes the explanation/category, never the balance.

7. Optional linked movement when SUBTRACTING FROM CURRENT.

   Current -> Savings
     Current: -amount
     Selected Savings account: +amount

   Current -> Credit Card
     Current: -amount
     Selected Credit Card: -amount outstanding

   Direct spending
     Leave "Link this subtraction" OFF.
     Only Current changes. You can categorise it as Food, Transport, etc.

8. Linked movements use a shared transfer ID internally.

9. Credit Cards model
   + Add       = increase outstanding card balance / new card spend
   - Subtract  = reduce outstanding card balance / payment or refund
   = Set exact = reconcile current outstanding balance

10. Existing account balances are NOT rewritten or migrated.
    Balance Trace begins tracking new ledger movements from this upgrade onward.

LOCAL DATA / BACKUPS
--------------------
The new ledger is stored locally in the browser under:
  neon-finance-ledger-v1

The existing Export Backup / Import Backup controls are intercepted by the new
module so the ledger is included as ledgerV1 in future .nfinance backups.

PDF STATEMENT PARSER
--------------------
The old PDF statement parser is intentionally retired/hidden by this upgrade.
The compatibility statement-import.js file now only loads ledger-tools.js.
