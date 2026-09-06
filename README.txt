# Transaction Date update

This adds a transaction date to the existing `+ Add` and `= Set exact` flow.

## Behaviour
- Works for Expenses, Savings and Current.
- Defaults to today's local date whenever an account drawer is opened.
- Allows backdated transactions.
- Blocks future dates.
- Keeps the selected backdated date after saving so multiple entries can be added for the same historical day.
- Uses the selected transaction date in Recent Changes / activity ordering.
- Existing old records still work.

## Install
1. Put `transaction-date.js` inside your existing `/fetch` folder.
2. In `index.html`, locate:

```html
<script src="app.js"></script>
<script src="fetch/statement-import.js"></script>
```

3. Change it to:

```html
<script src="app.js"></script>
<script src="fetch/transaction-date.js"></script>
<script src="fetch/statement-import.js"></script>
```

If you are removing the statement importer entirely, use:

```html
<script src="app.js"></script>
<script src="fetch/transaction-date.js"></script>
```

No CSS or app.js replacement is required.
