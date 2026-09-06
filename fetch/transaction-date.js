(() => {
  'use strict';

  const app = window.NeonFinanceApp;
  if (!app) {
    console.error('NeonTransactionDate: NeonFinanceApp API is not available. Load app.js first.');
    return;
  }

  const { getState, persist, render, showToast, makeId, money } = app;
  const $ = selector => document.querySelector(selector);

  const form = $('#amountForm');
  const drawer = $('#accountDrawer');
  const drawerAccountMode = $('#drawerAccountMode');
  const noteInput = $('#drawerNote');

  if (!form || !drawer || !noteInput) {
    console.error('NeonTransactionDate: Required finance drawer elements were not found.');
    return;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function timestampForTransactionDate(dateKey) {
    const now = new Date();
    return `${dateKey}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  function isValidTransactionDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);

    return parsed.getFullYear() === year
      && parsed.getMonth() === month - 1
      && parsed.getDate() === day;
  }

  function injectDateField() {
    if ($('#drawerTransactionDate')) return $('#drawerTransactionDate');

    const noteLabel = noteInput.closest('label');
    if (!noteLabel) return null;

    const label = document.createElement('label');
    label.className = 'transaction-date-field';
    label.innerHTML = `
      <span class="transaction-date-label">
        Transaction date
        <span class="muted">default: today</span>
      </span>
      <input
        id="drawerTransactionDate"
        type="date"
        required
        aria-label="Transaction date"
      />
    `;

    form.insertBefore(label, noteLabel);

    const style = document.createElement('style');
    style.textContent = `
      #drawerTransactionDate {
        color-scheme: dark;
      }

      .transaction-date-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      #drawerTransactionDate::-webkit-calendar-picker-indicator {
        cursor: pointer;
        opacity: .82;
        filter: invert(1);
      }
    `;
    document.head.appendChild(style);

    return $('#drawerTransactionDate');
  }

  const dateInput = injectDateField();
  if (!dateInput) return;

  function resetTransactionDate() {
    const today = localDateKey();
    dateInput.max = today;
    dateInput.value = today;
  }

  function syncMonthSnapshotToLiveTotals(state) {
    const total = section =>
      state[section].variables.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    state.periodSnapshots = state.periodSnapshots || {};
    state.periodSnapshots.month = {
      expenses: total('expenses'),
      savings: total('savings'),
      current: total('current')
    };
  }

  resetTransactionDate();

  // Whenever an existing account drawer is opened, begin from today's date again.
  const drawerObserver = new MutationObserver(() => {
    const accountModeOpen =
      drawer.classList.contains('open') &&
      drawerAccountMode.hidden === false;

    if (accountModeOpen) resetTransactionDate();
  });

  drawerObserver.observe(drawer, {
    attributes: true,
    attributeFilter: ['class']
  });

  /*
    app.js already owns the normal amountForm submit handler.
    This capture-phase handler intentionally intercepts that submit first,
    then performs the same update while using the selected transaction date.
  */
  document.addEventListener('submit', event => {
    if (event.target !== form) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const state = getState();
    const section = $('#drawerSection').value;
    const id = $('#drawerVariableId').value;
    const operation = $('#drawerOperation').value;
    const amount = Number($('#drawerAmount').value);
    const note = noteInput.value.trim();
    const transactionDate = dateInput.value;
    const today = localDateKey();
    const item = state?.[section]?.variables?.find(variable => variable.id === id);

    if (!item || !Number.isFinite(amount) || amount < 0) return;

    if (!isValidTransactionDate(transactionDate)) {
      showToast('Choose a valid transaction date.', true);
      return;
    }

    if (transactionDate > today) {
      showToast('Transaction date cannot be in the future.', true);
      return;
    }

    if (operation === 'add') {
      item.amount = Number(item.amount) + amount;
    } else if (operation === 'set') {
      item.amount = amount;
    } else {
      return;
    }

    state.activity.push({
      id: makeId('txn'),
      section,
      variableId: item.id,
      variableName: item.name,
      operation,
      amount,
      note,
      // app.js already persists and renders this field everywhere.
      // We anchor it to the chosen calendar date while keeping the entry time.
      timestamp: timestampForTransactionDate(transactionDate)
    });

    syncMonthSnapshotToLiveTotals(state);
    persist();
    render();

    $('#drawerCurrentAmount').textContent = money.format(item.amount);

    if (operation === 'add') {
      $('#drawerAmount').value = '';
    } else {
      $('#drawerAmount').value = item.amount;
    }

    // Keep the chosen date after save so several historical transactions
    // can be entered for the same day without reselecting it.
    dateInput.max = today;
  }, true);
})();
