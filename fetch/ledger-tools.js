(() => {
  'use strict';

  const app = window.NeonFinanceApp;
  if (!app) {
    console.error('NeonLedgerTools: NeonFinanceApp API is not available. Load app.js first.');
    return;
  }

  const { getState, persist, render, showToast, money, makeId, escapeHtml } = app;
  const LEDGER_KEY = 'neon-finance-ledger-v1';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const CATEGORY_OPTIONS = [
    'Unknown',
    'Salary',
    'Food',
    'Transport',
    'Shopping',
    'Bills',
    'Subscriptions',
    'Entertainment',
    'Travel',
    'Savings Transfer',
    'Transfer In',
    'Card Payment',
    'Refund',
    'Interest',
    'Investment',
    'Fees',
    'Other'
  ];

  const CATEGORY_COLORS = [
    '#ff4d8d', '#62f6ff', '#ffb84d', '#9d7cff', '#ff6d5f', '#6ef5b4',
    '#ffd85a', '#56a7ff', '#f58cff', '#80ffd6', '#5ce1e6', '#ff7c7c',
    '#c4ff68', '#8cff8c', '#8fb1ff', '#ff9d57', '#a7afc7'
  ];

  let ledger = loadLedger();
  let activeTrace = null;
  let traceSegments = [];
  let activityObserver = null;
  let suppressActivityObserver = false;

  function loadLedger() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.map(normalizeLedgerRecord).filter(Boolean) : [];
    } catch (error) {
      console.warn('NeonLedgerTools: Ledger could not be read.', error);
      return [];
    }
  }

  function normalizeLedgerRecord(item) {
    if (!item || typeof item !== 'object') return null;
    const delta = Number(item.delta);
    if (!Number.isFinite(delta)) return null;

    return {
      id: String(item.id || makeId('ledger')),
      section: ['expenses', 'savings', 'current'].includes(item.section) ? item.section : 'current',
      variableId: String(item.variableId || ''),
      variableName: String(item.variableName || 'Account').slice(0, 80),
      operation: ['add', 'subtract', 'set'].includes(item.operation) ? item.operation : 'add',
      amount: Math.max(0, Number(item.amount) || 0),
      delta,
      balanceBefore: Math.max(0, Number(item.balanceBefore) || 0),
      balanceAfter: Math.max(0, Number(item.balanceAfter) || 0),
      transactionDate: validDateKey(item.transactionDate) ? item.transactionDate : todayKey(),
      recordedAt: validDateTime(item.recordedAt) ? item.recordedAt : new Date().toISOString(),
      category: CATEGORY_OPTIONS.includes(item.category) ? item.category : 'Unknown',
      note: String(item.note || '').slice(0, 160),
      transferId: String(item.transferId || ''),
      linkedSection: ['expenses', 'savings', 'current'].includes(item.linkedSection) ? item.linkedSection : '',
      linkedVariableId: String(item.linkedVariableId || ''),
      linkedVariableName: String(item.linkedVariableName || '').slice(0, 80),
      source: String(item.source || 'manual').slice(0, 40)
    };
  }

  function saveLedger() {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  }

  function todayKey() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function validDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function validDateTime(value) {
    return value && !Number.isNaN(new Date(value).getTime());
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function sectionLabel(section) {
    if (section === 'expenses') return 'Credit Cards';
    if (section === 'savings') return 'Savings';
    return 'Current';
  }

  function operationSymbol(operation) {
    if (operation === 'set') return '=';
    if (operation === 'subtract') return '−';
    return '+';
  }

  function signedMoney(value) {
    const abs = money.format(Math.abs(Number(value) || 0));
    if (value > 0) return `+${abs}`;
    if (value < 0) return `−${abs}`;
    return abs;
  }

  function formatLedgerDate(dateKey) {
    return new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-SG', {
      day: '2-digit',
      month: 'short'
    });
  }

  function getAccount(section, id) {
    return getState()?.[section]?.variables?.find(item => item.id === id) || null;
  }

  function accountRecords(section, id) {
    return ledger.filter(record => record.section === section && record.variableId === id);
  }

  function unknownMagnitude(section, id) {
    return roundMoney(accountRecords(section, id)
      .filter(record => record.category === 'Unknown')
      .reduce((sum, record) => sum + Math.abs(record.delta), 0));
  }

  function injectStyles() {
    if ($('#neonLedgerStyles')) return;
    const style = document.createElement('style');
    style.id = 'neonLedgerStyles';
    style.textContent = `
      .operation-tabs { grid-template-columns: repeat(3, 1fr) !important; }
      .trace-pill {
        margin-top: 12px; width: 100%; padding: 10px 12px; border: 1px solid rgba(var(--drawer-rgb), .34);
        background: rgba(var(--drawer-rgb), .045); color: var(--drawer-theme); font-weight: 900;
        font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; text-align: left;
        box-shadow: inset 0 0 16px rgba(var(--drawer-rgb), .035); transition: 170ms ease;
      }
      .trace-pill:hover, .trace-pill:focus-visible { outline: none; border-color: var(--drawer-theme); box-shadow: 0 0 18px rgba(var(--drawer-rgb), .18); }
      .trace-pill.has-unknown { color: #ff82aa; border-color: rgba(255,77,141,.55); box-shadow: 0 0 15px rgba(255,77,141,.12); }
      .transaction-date-label, .ledger-field-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      #drawerTransactionDate { color-scheme: dark; }
      .ledger-select, .link-destination {
        width: 100%; border: 1px solid rgba(var(--drawer-rgb), .2); background: #030611; color: var(--text);
        padding: 13px; outline: none;
      }
      .ledger-select:focus, .link-destination:focus { border-color: var(--drawer-theme); box-shadow: 0 0 18px rgba(var(--drawer-rgb), .14); }
      .link-movement-box {
        display: grid; gap: 12px; padding: 13px; border: 1px solid rgba(var(--drawer-rgb), .16);
        background: rgba(var(--drawer-rgb), .025);
      }
      .link-toggle-row { display: flex !important; grid-template-columns: none !important; align-items: center; gap: 10px !important; cursor: pointer; }
      .link-toggle-row input { width: 18px !important; height: 18px; accent-color: var(--drawer-theme); }
      .link-helper { color: #68758f; font-size: .7rem; line-height: 1.45; }
      .ledger-modal-backdrop {
        position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 20px;
        background: rgba(0,2,10,.82); backdrop-filter: blur(10px); opacity: 0; pointer-events: none; transition: 180ms ease;
      }
      .ledger-modal-backdrop.open { opacity: 1; pointer-events: auto; }
      .ledger-modal {
        width: min(920px, 100%); max-height: min(860px, calc(100dvh - 36px)); overflow: auto; position: relative;
        border: 1px solid rgba(0,234,255,.3); background: linear-gradient(180deg, rgba(8,12,28,.99), rgba(2,5,14,.995));
        box-shadow: 0 0 60px rgba(0,234,255,.1), 0 40px 100px rgba(0,0,0,.65); padding: 24px;
      }
      .ledger-modal::before { content:""; position:absolute; inset:0 auto 0 0; width:2px; background:linear-gradient(180deg,transparent,#00eaff,#9d7cff,transparent); box-shadow:0 0 18px #00eaff; }
      .ledger-modal-header { display:flex; justify-content:space-between; align-items:start; gap:18px; padding-bottom:18px; border-bottom:1px solid rgba(133,153,214,.16); }
      .ledger-modal-header h2 { margin-top:4px; font-size:1.45rem; }
      .ledger-modal-close { width:38px; height:38px; border:1px solid rgba(0,234,255,.28); background:transparent; color:#75f6ff; font-size:1.3rem; }
      .trace-grid { display:grid; grid-template-columns:minmax(300px,.9fr) minmax(320px,1.1fr); gap:26px; margin-top:22px; align-items:start; }
      .trace-visual { display:grid; justify-items:center; gap:14px; }
      .trace-canvas-wrap { width:min(390px,100%); aspect-ratio:1; position:relative; }
      #balanceTraceCanvas { width:100%; height:100%; display:block; cursor:pointer; }
      .trace-center { position:absolute; inset:50% auto auto 50%; transform:translate(-50%,-50%); text-align:center; pointer-events:none; }
      .trace-center span { display:block; color:#7f8baa; font-size:.62rem; letter-spacing:.14em; text-transform:uppercase; }
      .trace-center strong { display:block; margin-top:6px; font-size:1.45rem; }
      .trace-note { color:#7d89a7; font-size:.72rem; line-height:1.5; text-align:center; max-width:360px; }
      .trace-legend { display:grid; gap:8px; width:100%; }
      .trace-legend-row { width:100%; display:grid; grid-template-columns:auto 1fr auto; gap:9px; align-items:center; padding:10px 11px; border:1px solid rgba(133,153,214,.12); background:rgba(255,255,255,.018); color:#dce7ff; text-align:left; }
      .trace-legend-row.clickable { cursor:pointer; }
      .trace-legend-row.clickable:hover { border-color:rgba(255,77,141,.48); }
      .trace-dot { width:9px; height:9px; border-radius:50%; background:var(--dot); box-shadow:0 0 12px var(--dot); }
      .trace-legend-row small { color:#76829f; }
      .trace-side { display:grid; gap:18px; }
      .trace-stat-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
      .trace-stat { padding:12px; border:1px solid rgba(133,153,214,.13); background:rgba(255,255,255,.018); }
      .trace-stat span { display:block; color:#71809e; font-size:.62rem; text-transform:uppercase; letter-spacing:.1em; }
      .trace-stat strong { display:block; margin-top:5px; font-size:.96rem; }
      .unknown-panel { padding:15px; border:1px solid rgba(255,77,141,.28); background:rgba(255,77,141,.035); }
      .unknown-panel h3 { color:#ff8bb0; font-size:.9rem; }
      .unknown-panel > p { margin-top:6px; color:#8792ae; font-size:.72rem; line-height:1.45; }
      .unknown-list { display:grid; gap:9px; margin-top:13px; }
      .unknown-row { display:grid; gap:8px; padding:11px; border:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.18); }
      .unknown-row-top { display:flex; justify-content:space-between; gap:12px; align-items:start; }
      .unknown-row-top strong { color:#fff; }
      .unknown-row-top small { color:#8792ae; }
      .unknown-row-actions { display:grid; grid-template-columns:1fr auto; gap:8px; }
      .unknown-row select { min-width:0; border:1px solid rgba(255,77,141,.25); background:#050817; color:#fff; padding:9px; }
      .unknown-row button { border:1px solid rgba(255,77,141,.42); background:rgba(255,77,141,.08); color:#ff9fbd; padding:0 11px; font-weight:850; }
      .trace-history { display:grid; gap:7px; }
      .trace-history h3 { font-size:.84rem; color:#d9e5ff; }
      .trace-history-row { display:grid; grid-template-columns:auto 1fr auto; gap:10px; padding:9px 0; border-bottom:1px solid rgba(133,153,214,.09); font-size:.75rem; }
      .trace-history-row time, .trace-history-row small { color:#71809e; }
      .trace-history-copy { min-width:0; }
      .trace-history-copy strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .trace-history-copy small { display:block; margin-top:2px; }
      @media (max-width:760px) {
        .trace-grid { grid-template-columns:1fr; }
        .ledger-modal { padding:18px; }
        .trace-stat-grid { grid-template-columns:1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function renameUi() {
    const expenseSummary = $('#expenseValue')?.closest('.summary-panel');
    const summaryLabel = expenseSummary?.querySelector('.summary-topline > span:first-child');
    if (summaryLabel) summaryLabel.textContent = 'Credit Cards';

    const expensePanel = $('#expensesList')?.closest('.account-panel');
    if (expensePanel) {
      const heading = expensePanel.querySelector('.account-heading h2');
      const kicker = expensePanel.querySelector('.account-kicker');
      if (heading) heading.textContent = 'Credit Cards';
      if (kicker) kicker.textContent = 'OUTSTANDING';
    }

    const legendExpense = $('.legend-expense');
    if (legendExpense) {
      const dot = legendExpense.querySelector('.legend-dot');
      legendExpense.textContent = 'Credit Cards';
      if (dot) legendExpense.prepend(dot);
    }

    const sectionCopy = $('.accounts-section .section-heading > p');
    if (sectionCopy) sectionCopy.textContent = 'Current cash, savings, and outstanding card balances. Open any card to update or reconcile it.';

    const headerCopy = $('.header-copy');
    if (headerCopy) headerCopy.textContent = 'Current cash moves. Savings grow. Credit card balances wait to be cleared.';
  }

  function enhanceCards() {
    ['expenses', 'savings', 'current'].forEach(section => {
      document.querySelectorAll(`[data-account-card][data-section="${section}"]`).forEach(card => {
        const id = card.dataset.id;
        const meta = card.querySelector('.variable-meta');
        if (!meta) return;
        const unknown = unknownMagnitude(section, id);
        if (unknown > 0) {
          meta.textContent = `${money.format(unknown)} unknown · open to reconcile`;
        } else if (section === 'expenses') {
          meta.textContent = 'Outstanding balance · open to update';
        } else {
          meta.textContent = 'Open to update';
        }
      });
    });
  }

  function injectDrawerControls() {
    const tabs = $('.operation-tabs');
    if (tabs && !tabs.querySelector('[data-operation="subtract"]')) {
      const subtract = document.createElement('button');
      subtract.type = 'button';
      subtract.className = 'operation-tab';
      subtract.dataset.operation = 'subtract';
      subtract.textContent = '− Subtract';
      tabs.insertBefore(subtract, tabs.querySelector('[data-operation="set"]'));
      subtract.addEventListener('click', () => setSubtractOperation());
    }

    const balanceBox = $('.drawer-balance');
    if (balanceBox && !$('#balanceTraceBtn')) {
      const button = document.createElement('button');
      button.id = 'balanceTraceBtn';
      button.type = 'button';
      button.className = 'trace-pill';
      button.addEventListener('click', openTraceFromDrawer);
      balanceBox.appendChild(button);
    }

    const form = $('#amountForm');
    const noteInput = $('#drawerNote');
    const noteLabel = noteInput?.closest('label');
    if (!form || !noteLabel) return;

    if (!$('#drawerTransactionDate')) {
      const label = document.createElement('label');
      label.innerHTML = `
        <span class="transaction-date-label">Transaction date <span class="muted">default: today</span></span>
        <input id="drawerTransactionDate" type="date" required />
      `;
      form.insertBefore(label, noteLabel);
    }

    if (!$('#drawerCategory')) {
      const label = document.createElement('label');
      label.innerHTML = `
        <span class="ledger-field-head">Category <span class="muted">optional</span></span>
        <select id="drawerCategory" class="ledger-select">
          ${CATEGORY_OPTIONS.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('')}
        </select>
      `;
      form.insertBefore(label, noteLabel);
    }

    if (!$('#linkMovementBox')) {
      const box = document.createElement('div');
      box.id = 'linkMovementBox';
      box.className = 'link-movement-box';
      box.hidden = true;
      box.innerHTML = `
        <label class="link-toggle-row">
          <input id="linkMovementToggle" type="checkbox" />
          <span>Link this subtraction to another account</span>
        </label>
        <div id="linkDestinationWrap" hidden>
          <label>
            Destination
            <select id="linkDestination" class="link-destination"></select>
          </label>
          <p class="link-helper">Savings receives the same amount. Credit Cards reduce their outstanding balance by the same amount.</p>
        </div>
      `;
      form.insertBefore(box, noteLabel);
      $('#linkMovementToggle').addEventListener('change', event => {
        $('#linkDestinationWrap').hidden = !event.target.checked;
      });
    }

    form.addEventListener('submit', handleAmountSubmit, true);

    tabs?.querySelectorAll('[data-operation="add"], [data-operation="set"]').forEach(button => {
      button.addEventListener('click', () => requestAnimationFrame(syncOperationUi));
    });
  }

  function injectTraceModal() {
    if ($('#ledgerTraceBackdrop')) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'ledgerTraceBackdrop';
    wrapper.className = 'ledger-modal-backdrop';
    wrapper.innerHTML = `
      <section class="ledger-modal" role="dialog" aria-modal="true" aria-labelledby="traceTitle">
        <div class="ledger-modal-header">
          <div>
            <p class="eyebrow">BALANCE TRACE // RECONCILIATION</p>
            <h2 id="traceTitle">Account</h2>
          </div>
          <button id="closeTraceModal" class="ledger-modal-close" type="button" aria-label="Close balance trace">×</button>
        </div>
        <div class="trace-grid">
          <div class="trace-visual">
            <div class="trace-canvas-wrap">
              <canvas id="balanceTraceCanvas" width="700" height="700"></canvas>
              <div class="trace-center"><span>Current balance</span><strong id="traceBalance">S$0.00</strong></div>
            </div>
            <p class="trace-note">Ring size shows the mix of recorded account movements. Click the Unknown segment to open the reconciliation queue.</p>
            <div id="traceLegend" class="trace-legend"></div>
          </div>
          <div class="trace-side">
            <div id="traceStats" class="trace-stat-grid"></div>
            <section id="unknownPanel" class="unknown-panel">
              <h3>Unknown queue</h3>
              <p>Reclassifying an item changes its explanation only. Your account balance does not move again.</p>
              <div id="unknownList" class="unknown-list"></div>
            </section>
            <section class="trace-history">
              <h3>Recent ledger movements</h3>
              <div id="traceHistory"></div>
            </section>
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(wrapper);

    $('#closeTraceModal').addEventListener('click', closeTrace);
    wrapper.addEventListener('click', event => {
      if (event.target === wrapper) closeTrace();
    });
    $('#balanceTraceCanvas').addEventListener('click', handleTraceCanvasClick);
  }

  function setSubtractOperation() {
    $('#drawerOperation').value = 'subtract';
    $$('.operation-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.operation === 'subtract'));
    $('#drawerAmount').value = '';
    $('#amountLabel').textContent = 'Amount to subtract';
    $('#drawerSubmit').textContent = 'Subtract amount';
    syncOperationUi();
  }

  function syncOperationUi() {
    const section = $('#drawerSection')?.value;
    const operation = $('#drawerOperation')?.value;
    const category = $('#drawerCategory');
    const linkBox = $('#linkMovementBox');

    if (operation === 'set') {
      if (category) {
        category.value = 'Unknown';
        category.disabled = true;
      }
    } else if (category) {
      category.disabled = false;
    }

    const canLink = section === 'current' && operation === 'subtract';
    if (linkBox) linkBox.hidden = !canLink;
    if (!canLink) {
      if ($('#linkMovementToggle')) $('#linkMovementToggle').checked = false;
      if ($('#linkDestinationWrap')) $('#linkDestinationWrap').hidden = true;
    } else {
      populateLinkDestinations();
    }
  }

  function populateLinkDestinations() {
    const select = $('#linkDestination');
    if (!select) return;
    const state = getState();
    const savings = state.savings?.variables || [];
    const cards = state.expenses?.variables || [];

    select.innerHTML = `
      <option value="">Choose destination…</option>
      <optgroup label="Savings">
        ${savings.map(item => `<option value="savings|${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${money.format(item.amount)}</option>`).join('')}
      </optgroup>
      <optgroup label="Credit Cards">
        ${cards.map(item => `<option value="expenses|${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${money.format(item.amount)} outstanding</option>`).join('')}
      </optgroup>
    `;
  }

  function resetDrawerEnhancements() {
    const date = $('#drawerTransactionDate');
    if (date) {
      date.max = todayKey();
      date.value = todayKey();
    }
    if ($('#drawerCategory')) {
      $('#drawerCategory').disabled = false;
      $('#drawerCategory').value = 'Unknown';
    }
    if ($('#linkMovementToggle')) $('#linkMovementToggle').checked = false;
    if ($('#linkDestinationWrap')) $('#linkDestinationWrap').hidden = true;
    populateLinkDestinations();
    syncOperationUi();
    updateTracePill();
  }

  function enhanceOpenDrawer() {
    const drawer = $('#accountDrawer');
    if (!drawer?.classList.contains('open')) return;

    const accountMode = $('#drawerAccountMode');
    if (accountMode && !accountMode.hidden) {
      const section = $('#drawerSection').value;
      if (section === 'expenses') $('#drawerEyebrow').textContent = 'CREDIT // UPDATE';
      resetDrawerEnhancements();
      $('#statementTools')?.setAttribute('hidden', '');
    } else if ($('#drawerNewMode') && !$('#drawerNewMode').hidden) {
      const section = $('#newVariableSection').value;
      if (section === 'expenses') {
        $('#drawerEyebrow').textContent = 'CREDIT // NEW CARD';
        $('#drawerTitle').textContent = 'Add Credit Card';
      }
    }
  }

  function updateTracePill() {
    const button = $('#balanceTraceBtn');
    if (!button) return;
    const section = $('#drawerSection').value;
    const id = $('#drawerVariableId').value;
    if (!section || !id) return;

    const unknown = unknownMagnitude(section, id);
    button.classList.toggle('has-unknown', unknown > 0);
    button.textContent = unknown > 0
      ? `Balance Trace · ${money.format(unknown)} unknown`
      : accountRecords(section, id).length
        ? 'Balance Trace · reconciled'
        : 'Balance Trace · no movements yet';
  }

  function handleAmountSubmit(event) {
    if (event.target !== $('#amountForm')) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const state = getState();
    const section = $('#drawerSection').value;
    const id = $('#drawerVariableId').value;
    const operation = $('#drawerOperation').value;
    const amount = Number($('#drawerAmount').value);
    const note = $('#drawerNote').value.trim();
    const transactionDate = $('#drawerTransactionDate').value;
    const category = operation === 'set' ? 'Unknown' : ($('#drawerCategory').value || 'Unknown');
    const item = getAccount(section, id);

    if (!item || !['add', 'subtract', 'set'].includes(operation)) return;
    if (!Number.isFinite(amount) || amount < 0) return;
    if (!validDateKey(transactionDate)) {
      showToast('Choose a valid transaction date.', true);
      return;
    }
    if (transactionDate > todayKey()) {
      showToast('Transaction date cannot be in the future.', true);
      return;
    }

    const before = roundMoney(item.amount);
    let after = before;
    let delta = 0;

    if (operation === 'add') {
      delta = roundMoney(amount);
      after = roundMoney(before + amount);
    } else if (operation === 'subtract') {
      if (amount > before) {
        showToast(`Cannot subtract more than ${money.format(before)} from ${item.name}.`, true);
        return;
      }
      delta = roundMoney(-amount);
      after = roundMoney(before - amount);
    } else {
      after = roundMoney(amount);
      delta = roundMoney(after - before);
      if (delta === 0) {
        showToast('The exact balance is already the same. No adjustment was recorded.');
        return;
      }
    }

    let linked = null;
    let transferId = '';
    const linkEnabled = section === 'current' && operation === 'subtract' && $('#linkMovementToggle')?.checked;

    if (linkEnabled) {
      const destinationValue = $('#linkDestination')?.value || '';
      const [linkedSection, linkedId] = destinationValue.split('|');
      const linkedItem = getAccount(linkedSection, linkedId);
      if (!linkedItem || !['savings', 'expenses'].includes(linkedSection)) {
        showToast('Choose a Savings or Credit Card destination.', true);
        return;
      }

      const linkedBefore = roundMoney(linkedItem.amount);
      let linkedAfter;
      let linkedDelta;
      let linkedCategory;

      if (linkedSection === 'savings') {
        linkedDelta = roundMoney(amount);
        linkedAfter = roundMoney(linkedBefore + amount);
        linkedCategory = 'Transfer In';
      } else {
        if (amount > linkedBefore) {
          showToast(`Payment exceeds ${linkedItem.name}'s outstanding balance of ${money.format(linkedBefore)}.`, true);
          return;
        }
        linkedDelta = roundMoney(-amount);
        linkedAfter = roundMoney(linkedBefore - amount);
        linkedCategory = 'Card Payment';
      }

      transferId = makeId('transfer');
      linked = { linkedSection, linkedItem, linkedBefore, linkedAfter, linkedDelta, linkedCategory };
    }

    item.amount = after;

    const originCategory = linked
      ? linked.linkedSection === 'savings' ? 'Savings Transfer' : 'Card Payment'
      : category;

    ledger.push({
      id: makeId('ledger'),
      section,
      variableId: item.id,
      variableName: item.name,
      operation,
      amount: roundMoney(amount),
      delta,
      balanceBefore: before,
      balanceAfter: after,
      transactionDate,
      recordedAt: new Date().toISOString(),
      category: originCategory,
      note,
      transferId,
      linkedSection: linked?.linkedSection || '',
      linkedVariableId: linked?.linkedItem.id || '',
      linkedVariableName: linked?.linkedItem.name || '',
      source: linked ? 'linked-origin' : 'manual'
    });

    if (linked) {
      linked.linkedItem.amount = linked.linkedAfter;
      ledger.push({
        id: makeId('ledger'),
        section: linked.linkedSection,
        variableId: linked.linkedItem.id,
        variableName: linked.linkedItem.name,
        operation: linked.linkedDelta >= 0 ? 'add' : 'subtract',
        amount: roundMoney(Math.abs(linked.linkedDelta)),
        delta: linked.linkedDelta,
        balanceBefore: linked.linkedBefore,
        balanceAfter: linked.linkedAfter,
        transactionDate,
        recordedAt: new Date().toISOString(),
        category: linked.linkedCategory,
        note: `Linked from ${item.name}${note ? ` · ${note}` : ''}`.slice(0, 160),
        transferId,
        linkedSection: section,
        linkedVariableId: item.id,
        linkedVariableName: item.name,
        source: 'linked-destination'
      });
    }

    syncMonthSnapshot(state);
    saveLedger();
    persist();
    render();
    enhanceCards();
    renderLedgerActivity();

    $('#drawerCurrentAmount').textContent = money.format(item.amount);
    if (operation === 'set') $('#drawerAmount').value = item.amount;
    else $('#drawerAmount').value = '';
    $('#drawerNote').value = '';
    if ($('#linkMovementToggle')) $('#linkMovementToggle').checked = false;
    if ($('#linkDestinationWrap')) $('#linkDestinationWrap').hidden = true;
    updateTracePill();

    if (linked) {
      showToast(`${money.format(amount)} linked: ${item.name} → ${linked.linkedItem.name}.`);
    } else if (operation === 'set') {
      showToast(`${item.name} reconciled. ${signedMoney(delta)} recorded as Unknown.`);
    } else {
      showToast(`${operation === 'subtract' ? 'Subtracted' : 'Added'} ${money.format(amount)} on ${formatLedgerDate(transactionDate)}.`);
    }
  }

  function syncMonthSnapshot(state) {
    const total = section => state[section].variables.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    state.periodSnapshots = state.periodSnapshots || {};
    state.periodSnapshots.month = {
      expenses: total('expenses'),
      savings: total('savings'),
      current: total('current')
    };
  }

  function renderLedgerActivity() {
    const list = $('#activityList');
    if (!list) return;

    const oldActivity = (getState().activity || []).map(item => ({
      kind: 'legacy',
      id: item.id,
      section: item.section,
      variableName: item.variableName,
      operation: item.operation,
      amount: item.amount,
      note: item.note,
      date: validDateTime(item.timestamp) ? item.timestamp.slice(0, 10) : todayKey(),
      recordedAt: item.timestamp || ''
    }));

    const newActivity = ledger.map(record => ({
      kind: 'ledger',
      ...record,
      date: record.transactionDate
    }));

    const rows = [...oldActivity, ...newActivity]
      .sort((a, b) => {
        const dateCompare = String(b.date).localeCompare(String(a.date));
        if (dateCompare) return dateCompare;
        return String(b.recordedAt || '').localeCompare(String(a.recordedAt || ''));
      })
      .slice(0, 12);

    suppressActivityObserver = true;
    activityObserver?.disconnect();

    list.innerHTML = rows.length ? rows.map(item => {
      const isLedger = item.kind === 'ledger';
      const signed = isLedger ? signedMoney(item.delta) : `${operationSymbol(item.operation)} ${money.format(item.amount)}`;
      const category = isLedger ? item.category : sectionLabel(item.section);
      const linkedCopy = isLedger && item.transferId && item.linkedVariableName ? ` · linked ${item.linkedVariableName}` : '';
      return `
        <div class="activity-item ${item.section}">
          <span class="activity-beam"></span>
          <div class="activity-title">
            <span>${signed} · ${escapeHtml(item.variableName)}</span>
            <span>${formatLedgerDate(item.date)}</span>
          </div>
          <div class="activity-meta">${escapeHtml(category)}${linkedCopy}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div>
        </div>
      `;
    }).join('') : '<div class="empty-state">No changes yet.</div>';

    suppressActivityObserver = false;
    observeActivity();
  }

  function observeActivity() {
    const list = $('#activityList');
    if (!list) return;
    if (!activityObserver) {
      activityObserver = new MutationObserver(() => {
        if (!suppressActivityObserver) renderLedgerActivity();
      });
    }
    activityObserver.disconnect();
    activityObserver.observe(list, { childList: true, subtree: true });
  }

  function openTraceFromDrawer() {
    const section = $('#drawerSection').value;
    const id = $('#drawerVariableId').value;
    const item = getAccount(section, id);
    if (!item) return;

    activeTrace = { section, id };
    $('#traceTitle').textContent = `${item.name} · ${sectionLabel(section)}`;
    $('#traceBalance').textContent = money.format(item.amount);
    $('#ledgerTraceBackdrop').classList.add('open');
    document.body.style.overflow = 'hidden';
    renderTrace();
  }

  function closeTrace() {
    $('#ledgerTraceBackdrop')?.classList.remove('open');
    document.body.style.overflow = '';
    activeTrace = null;
  }

  function renderTrace() {
    if (!activeTrace) return;
    const item = getAccount(activeTrace.section, activeTrace.id);
    if (!item) return;

    const records = accountRecords(activeTrace.section, activeTrace.id)
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.recordedAt.localeCompare(a.recordedAt));

    $('#traceBalance').textContent = money.format(item.amount);
    drawTraceChart(records);
    renderTraceLegend(records);
    renderTraceStats(records);
    renderUnknownQueue(records);
    renderTraceHistory(records);
  }

  function aggregateCategories(records) {
    const map = new Map();
    records.forEach(record => {
      const magnitude = Math.abs(record.delta);
      if (magnitude <= 0) return;
      const entry = map.get(record.category) || { category: record.category, value: 0, inflow: 0, outflow: 0 };
      entry.value += magnitude;
      if (record.delta > 0) entry.inflow += record.delta;
      if (record.delta < 0) entry.outflow += Math.abs(record.delta);
      map.set(record.category, entry);
    });
    return [...map.values()].sort((a, b) => b.value - a.value);
  }

  function colorForCategory(category) {
    const index = Math.max(0, CATEGORY_OPTIONS.indexOf(category));
    return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
  }

  function drawTraceChart(records) {
    const canvas = $('#balanceTraceCanvas');
    const ctx = canvas.getContext('2d');
    const size = 700;
    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);

    const center = size / 2;
    const radius = 245;
    const lineWidth = 72;
    const aggregates = aggregateCategories(records);
    const total = aggregates.reduce((sum, item) => sum + item.value, 0);
    traceSegments = [];

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(130,150,210,.10)';
    ctx.lineWidth = lineWidth;
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (!total) {
      ctx.save();
      ctx.fillStyle = '#6f7b99';
      ctx.textAlign = 'center';
      ctx.font = '700 22px system-ui';
      ctx.fillText('No recorded movements yet', center, center + 110);
      ctx.restore();
      return;
    }

    let start = -Math.PI / 2;
    aggregates.forEach(entry => {
      const slice = (entry.value / total) * Math.PI * 2;
      const gap = Math.min(0.025, slice * 0.08);
      const color = colorForCategory(entry.category);
      const segmentStart = start + gap;
      const segmentEnd = start + slice - gap;

      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.shadowColor = color;
      ctx.shadowBlur = entry.category === 'Unknown' ? 34 : 20;
      ctx.arc(center, center, radius, segmentStart, segmentEnd);
      ctx.stroke();
      ctx.restore();

      traceSegments.push({ category: entry.category, start: segmentStart, end: segmentEnd, radius, lineWidth });
      start += slice;
    });
  }

  function renderTraceLegend(records) {
    const aggregates = aggregateCategories(records);
    const legend = $('#traceLegend');
    if (!aggregates.length) {
      legend.innerHTML = '<div class="trace-note">Use +, − or = and your movement categories will appear here.</div>';
      return;
    }

    legend.innerHTML = aggregates.map(entry => `
      <button type="button" class="trace-legend-row ${entry.category === 'Unknown' ? 'clickable' : ''}" data-trace-category="${escapeHtml(entry.category)}">
        <span class="trace-dot" style="--dot:${colorForCategory(entry.category)}"></span>
        <span>${escapeHtml(entry.category)}<small> · in ${money.format(entry.inflow)} / out ${money.format(entry.outflow)}</small></span>
        <strong>${money.format(entry.value)}</strong>
      </button>
    `).join('');

    legend.querySelectorAll('[data-trace-category="Unknown"]').forEach(button => {
      button.addEventListener('click', focusUnknownPanel);
    });
  }

  function renderTraceStats(records) {
    const inflow = roundMoney(records.filter(r => r.delta > 0).reduce((sum, r) => sum + r.delta, 0));
    const outflow = roundMoney(records.filter(r => r.delta < 0).reduce((sum, r) => sum + Math.abs(r.delta), 0));
    const unknown = roundMoney(records.filter(r => r.category === 'Unknown').reduce((sum, r) => sum + Math.abs(r.delta), 0));

    $('#traceStats').innerHTML = `
      <div class="trace-stat"><span>Recorded in</span><strong>${money.format(inflow)}</strong></div>
      <div class="trace-stat"><span>Recorded out</span><strong>${money.format(outflow)}</strong></div>
      <div class="trace-stat"><span>Unknown</span><strong>${money.format(unknown)}</strong></div>
    `;
  }

  function renderUnknownQueue(records) {
    const unknown = records.filter(record => record.category === 'Unknown');
    const list = $('#unknownList');

    if (!unknown.length) {
      list.innerHTML = '<div class="trace-note">Nothing unexplained. This account is reconciled. ✓</div>';
      return;
    }

    list.innerHTML = unknown.map(record => `
      <div class="unknown-row" data-unknown-id="${escapeHtml(record.id)}">
        <div class="unknown-row-top">
          <span><strong>${signedMoney(record.delta)}</strong><small> · ${formatLedgerDate(record.transactionDate)} · ${escapeHtml(operationSymbol(record.operation))}</small></span>
          <small>${escapeHtml(record.note || 'No note')}</small>
        </div>
        <div class="unknown-row-actions">
          <select aria-label="New category">
            ${CATEGORY_OPTIONS.filter(category => category !== 'Unknown').map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('')}
          </select>
          <button type="button">Categorise</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.unknown-row').forEach(row => {
      row.querySelector('button').addEventListener('click', () => {
        const record = ledger.find(item => item.id === row.dataset.unknownId);
        const category = row.querySelector('select').value;
        if (!record || !CATEGORY_OPTIONS.includes(category) || category === 'Unknown') return;
        record.category = category;
        saveLedger();
        renderTrace();
        renderLedgerActivity();
        updateTracePill();
        showToast(`${signedMoney(record.delta)} moved from Unknown to ${category}.`);
      });
    });
  }

  function renderTraceHistory(records) {
    const container = $('#traceHistory');
    if (!records.length) {
      container.innerHTML = '<div class="trace-note">No ledger movements recorded yet.</div>';
      return;
    }

    container.innerHTML = records.slice(0, 12).map(record => `
      <div class="trace-history-row">
        <time>${formatLedgerDate(record.transactionDate)}</time>
        <span class="trace-history-copy">
          <strong>${escapeHtml(record.category)}</strong>
          <small>${escapeHtml(record.note || `${operationSymbol(record.operation)} movement`)}</small>
        </span>
        <strong>${signedMoney(record.delta)}</strong>
      </div>
    `).join('');
  }

  function handleTraceCanvasClick(event) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX - canvas.width / 2;
    const y = (event.clientY - rect.top) * scaleY - canvas.height / 2;
    const distance = Math.sqrt(x * x + y * y);
    const angleRaw = Math.atan2(y, x);
    const angle = angleRaw < -Math.PI / 2 ? angleRaw + Math.PI * 2 : angleRaw;

    const hit = traceSegments.find(segment => {
      const radial = Math.abs(distance - segment.radius) <= segment.lineWidth / 2 + 10;
      let start = segment.start;
      let end = segment.end;
      let test = angle;
      if (end < start) end += Math.PI * 2;
      if (test < start) test += Math.PI * 2;
      return radial && test >= start && test <= end;
    });

    if (hit?.category === 'Unknown') focusUnknownPanel();
  }

  function focusUnknownPanel() {
    const panel = $('#unknownPanel');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    panel?.animate?.([
      { boxShadow: '0 0 0 rgba(255,77,141,0)' },
      { boxShadow: '0 0 34px rgba(255,77,141,.28)' },
      { boxShadow: '0 0 0 rgba(255,77,141,0)' }
    ], { duration: 800, easing: 'ease-out' });
  }

  function setupDrawerWatcher() {
    const drawer = $('#accountDrawer');
    if (!drawer) return;
    const observer = new MutationObserver(() => {
      if (drawer.classList.contains('open')) requestAnimationFrame(enhanceOpenDrawer);
    });
    observer.observe(drawer, { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('click', event => {
      if (event.target.closest('[data-account-card], [data-add-variable], [data-add-empty]')) {
        requestAnimationFrame(enhanceOpenDrawer);
      }
    });
  }

  function hideStatementTools() {
    const tools = $('#statementTools');
    if (tools) tools.hidden = true;
    const observer = new MutationObserver(() => {
      if (!tools.hidden) tools.hidden = true;
    });
    if (tools) observer.observe(tools, { attributes: true, attributeFilter: ['hidden'] });
  }

  function normalizeImportedFinanceState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const safe = {
      formatVersion: 2,
      expenses: { variables: [] },
      savings: { variables: [] },
      current: { variables: [] },
      activity: [],
      periodSnapshots: {},
      importedStatements: []
    };

    ['expenses', 'savings', 'current'].forEach(section => {
      const variables = source?.[section]?.variables;
      safe[section].variables = Array.isArray(variables)
        ? variables.filter(item => item && typeof item === 'object').map(item => ({
            id: String(item.id || makeId(section.slice(0, 3))),
            name: String(item.name || 'Unnamed account').slice(0, 80),
            amount: Math.max(0, Number(item.amount) || 0),
            transactions: Array.isArray(item.transactions) ? item.transactions : []
          }))
        : [];
    });

    safe.activity = Array.isArray(source.activity)
      ? source.activity.filter(item => item && typeof item === 'object').map(item => ({
          id: String(item.id || makeId('txn')),
          section: ['expenses', 'savings', 'current'].includes(item.section) ? item.section : 'current',
          variableId: String(item.variableId || ''),
          variableName: String(item.variableName || 'Account').slice(0, 80),
          operation: item.operation === 'set' ? 'set' : 'add',
          amount: Math.max(0, Number(item.amount) || 0),
          note: String(item.note || '').slice(0, 160),
          timestamp: validDateTime(item.timestamp) ? item.timestamp : new Date().toISOString()
        }))
      : [];

    if (source.periodSnapshots && typeof source.periodSnapshots === 'object') {
      ['week', 'month', 'year'].forEach(period => {
        const snapshot = source.periodSnapshots[period];
        if (!snapshot || typeof snapshot !== 'object') return;
        safe.periodSnapshots[period] = {
          expenses: Math.max(0, Number(snapshot.expenses) || 0),
          savings: Math.max(0, Number(snapshot.savings) || 0),
          current: Math.max(0, Number(snapshot.current) || 0)
        };
      });
    }

    safe.importedStatements = Array.isArray(source.importedStatements)
      ? source.importedStatements.filter(item => item && typeof item === 'object' && item.hash).map(item => ({
          hash: String(item.hash),
          accountId: String(item.accountId || ''),
          fileName: String(item.fileName || 'Statement.pdf').slice(0, 180),
          importedAt: validDateTime(item.importedAt) ? item.importedAt : new Date().toISOString(),
          transactionCount: Math.max(0, Number(item.transactionCount) || 0),
          total: Math.max(0, Number(item.total) || 0)
        }))
      : [];

    return safe;
  }

  function replaceFinanceState(nextState) {
    const current = getState();
    Object.keys(current).forEach(key => delete current[key]);
    Object.assign(current, nextState);
  }

  function installBackupHooks() {
    const exportButton = $('#exportBackup');
    if (exportButton) {
      exportButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const payload = {
          ...getState(),
          ledgerV1: ledger,
          backupMeta: {
            app: 'Neon Finance',
            formatVersion: 3,
            exportedAt: new Date().toISOString()
          }
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `neon-finance-backup-${todayKey()}.nfinance`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        showToast('Backup exported with Balance Trace ledger.');
      }, true);
    }

    const input = $('#importBackupFile');
    if (input) {
      input.addEventListener('change', async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const file = event.target.files?.[0];
        if (!file) return;

        try {
          const parsed = JSON.parse(await file.text());
          const imported = normalizeImportedFinanceState(parsed);
          const accountCount = ['expenses', 'savings', 'current']
            .reduce((sum, section) => sum + imported[section].variables.length, 0);
          const shouldReplace = confirm(
            `Import this backup and replace the finance data stored in this browser?\n\n${accountCount} account${accountCount === 1 ? '' : 's'} found.`
          );
          if (!shouldReplace) return;

          replaceFinanceState(imported);
          ledger = Array.isArray(parsed.ledgerV1)
            ? parsed.ledgerV1.map(normalizeLedgerRecord).filter(Boolean)
            : [];
          saveLedger();
          persist();
          render();
          renameUi();
          enhanceCards();
          renderLedgerActivity();
          showToast('Backup imported with Balance Trace ledger.');
        } catch (error) {
          console.error(error);
          showToast('Import failed. Choose a valid Neon Finance backup.', true);
        } finally {
          input.value = '';
        }
      }, true);
    }
  }

  function init() {
    injectStyles();
    renameUi();
    injectDrawerControls();
    enhanceCards();
    injectTraceModal();
    setupDrawerWatcher();
    hideStatementTools();
    installBackupHooks();
    renderLedgerActivity();
    observeActivity();

    $('#variableForm')?.addEventListener('submit', () => {
      setTimeout(() => {
        renameUi();
        enhanceCards();
      }, 0);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && $('#ledgerTraceBackdrop')?.classList.contains('open')) closeTrace();
    });
  }

  init();
})();
