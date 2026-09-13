(() => {
  'use strict';

  const engine = window.NeonLedgerTools;
  if (!engine) {
    console.error('NeonQuickEntry: ledger engine is not available.');
    return;
  }

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    minimumFractionDigits: 2
  });

  const MODE_META = {
    add: {
      label: 'Add',
      primaryOperation: 'add',
      accountSections: ['expenses', 'savings', 'current'],
      defaultCategory: 'Unknown',
      linkLabel: 'Link another account',
      defaultLinkedOperation: 'subtract',
      submit: 'Add amount'
    },
    subtract: {
      label: 'Subtract',
      primaryOperation: 'subtract',
      accountSections: ['expenses', 'savings', 'current'],
      defaultCategory: 'Unknown',
      linkLabel: 'Link another account',
      defaultLinkedOperation: 'add',
      submit: 'Subtract amount'
    },
    spend: {
      label: 'Spend',
      primaryOperation: 'add',
      accountSections: ['expenses'],
      defaultCategory: 'Food',
      linkLabel: 'Take the same amount from another account',
      defaultLinkedOperation: 'subtract',
      submit: 'Record spending'
    },
    income: {
      label: 'Income',
      primaryOperation: 'add',
      accountSections: ['current'],
      defaultCategory: 'Salary',
      linkLabel: '',
      defaultLinkedOperation: '',
      submit: 'Add income'
    }
  };

  const SECTION_LABELS = {
    expenses: 'Expenses',
    savings: 'Savings / Growth',
    current: 'Current / Idle Cash'
  };

  let mode = 'spend';
  let selectedPrimary = null;
  let selectedLinked = null;
  let linkedOperation = 'subtract';
  let accountsObserver = null;
  let refreshQueued = false;

  function todayKey() {
    return engine.todayKey();
  }

  function injectStyles() {
    if ($('#quickEntryStyles')) return;

    const style = document.createElement('style');
    style.id = 'quickEntryStyles';
    style.textContent = `
      .quick-entry-section { margin: 0 0 26px; }
      .quick-entry-panel {
        position: relative;
        overflow: hidden;
        background:
          linear-gradient(90deg, rgba(0,234,255,.025), transparent 34%, rgba(157,124,255,.025)),
          rgba(5,8,19,.96);
      }
      .quick-entry-panel::before {
        content:"";
        position:absolute;
        inset:0 auto 0 0;
        width:2px;
        background:linear-gradient(180deg,transparent,#00eaff,#9d7cff,transparent);
        box-shadow:0 0 16px rgba(0,234,255,.6);
      }
      .quick-entry-head { align-items:flex-start; gap:18px; }
      .quick-entry-copy { color:var(--muted); font-size:.74rem; line-height:1.5; margin-top:4px; }
      .quick-mode-tabs {
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        gap:7px;
        margin-top:18px;
      }
      .quick-mode-btn {
        min-height:42px;
        border:1px solid rgba(133,153,214,.17);
        background:rgba(255,255,255,.018);
        color:#8895b2;
        font-weight:900;
        letter-spacing:.05em;
      }
      .quick-mode-btn:hover,.quick-mode-btn:focus-visible { outline:none; border-color:rgba(0,234,255,.34); color:#dce8ff; }
      .quick-mode-btn.active {
        border-color:rgba(0,234,255,.55);
        color:#a8f8ff;
        background:rgba(0,234,255,.065);
        box-shadow:0 0 18px rgba(0,234,255,.09), inset 0 0 16px rgba(0,234,255,.035);
      }
      .quick-entry-grid {
        display:grid;
        grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);
        gap:20px;
        margin-top:16px;
      }
      .quick-entry-left,.quick-entry-right { display:grid; align-content:start; gap:14px; }
      .quick-fields {
        display:grid;
        grid-template-columns:minmax(150px,.75fr) minmax(150px,.65fr) minmax(180px,1fr);
        gap:10px;
      }
      .quick-field { display:grid; gap:6px; min-width:0; color:#8390ad; font-size:.68rem; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
      .quick-field input,.quick-field select {
        width:100%;
        min-width:0;
        border:1px solid rgba(133,153,214,.18);
        background:#030611;
        color:var(--text);
        padding:12px;
        outline:none;
      }
      .quick-field input:focus,.quick-field select:focus { border-color:#00eaff; box-shadow:0 0 16px rgba(0,234,255,.10); }
      .quick-amount-wrap { position:relative; }
      .quick-amount-wrap > span { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#65728f; font-weight:900; font-size:.72rem; }
      .quick-amount-wrap input { padding-left:35px; }
      .quick-account-zone { display:grid; gap:11px; }
      .quick-zone-head { display:flex; justify-content:space-between; gap:12px; align-items:center; }
      .quick-zone-head strong { color:#dbe6fb; font-size:.74rem; }
      .quick-zone-head small { color:#68758f; font-size:.66rem; }
      .quick-account-group { display:grid; gap:7px; }
      .quick-account-group > span { color:#64728e; font-size:.6rem; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
      .quick-pill-row { display:flex; flex-wrap:wrap; gap:7px; }
      .quick-account-pill {
        display:inline-flex;
        align-items:center;
        gap:8px;
        min-height:34px;
        padding:7px 10px;
        border:1px solid rgba(133,153,214,.16);
        background:rgba(255,255,255,.018);
        color:#a7b3cc;
        font-size:.72rem;
        font-weight:850;
      }
      .quick-account-pill small { color:#65718c; font-size:.64rem; font-weight:700; }
      .quick-account-pill:hover,.quick-account-pill:focus-visible { outline:none; border-color:rgba(0,234,255,.34); color:#eef7ff; }
      .quick-account-pill.active {
        border-color:#00eaff;
        color:#dffcff;
        background:rgba(0,234,255,.07);
        box-shadow:0 0 15px rgba(0,234,255,.08);
      }
      .quick-link-box {
        display:grid;
        gap:12px;
        padding:13px;
        border:1px solid rgba(157,124,255,.16);
        background:rgba(157,124,255,.025);
      }
      .quick-link-toggle { display:flex; align-items:center; gap:9px; cursor:pointer; color:#b5c1d9; font-size:.74rem; font-weight:850; }
      .quick-link-toggle input { width:18px; height:18px; accent-color:#9d7cff; }
      .quick-linked-controls { display:grid; gap:11px; }
      .quick-linked-controls[hidden] { display:none; }
      .quick-linked-actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
      .quick-linked-action {
        min-height:36px;
        border:1px solid rgba(157,124,255,.17);
        background:rgba(255,255,255,.018);
        color:#8995b2;
        font-weight:900;
      }
      .quick-linked-action.active { border-color:#9d7cff; color:#cbbcff; background:rgba(157,124,255,.08); box-shadow:0 0 14px rgba(157,124,255,.10); }
      .quick-preview {
        min-height:84px;
        display:grid;
        align-content:center;
        gap:5px;
        padding:13px;
        border:1px solid rgba(133,153,214,.13);
        background:rgba(0,0,0,.16);
      }
      .quick-preview > span { color:#65728e; font-size:.6rem; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
      .quick-preview strong { color:#e8f2ff; font-size:.85rem; line-height:1.5; }
      .quick-preview small { color:#71809b; font-size:.68rem; line-height:1.45; }
      .quick-note-row { display:grid; gap:6px; }
      .quick-note-row label { color:#8390ad; font-size:.68rem; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
      .quick-note-row input { width:100%; border:1px solid rgba(133,153,214,.18); background:#030611; color:var(--text); padding:12px; outline:none; }
      .quick-submit {
        min-height:44px;
        border:1px solid rgba(0,234,255,.48);
        background:linear-gradient(90deg,rgba(0,234,255,.14),rgba(157,124,255,.12));
        color:#dffcff;
        font-weight:950;
        letter-spacing:.06em;
        box-shadow:0 0 20px rgba(0,234,255,.08);
      }
      .quick-submit:hover,.quick-submit:focus-visible { outline:none; border-color:#00eaff; box-shadow:0 0 24px rgba(0,234,255,.14); }
      .quick-empty { color:#697590; font-size:.72rem; padding:8px 0; }
      @media (max-width:880px) {
        .quick-entry-grid { grid-template-columns:1fr; }
      }
      @media (max-width:650px) {
        .quick-mode-tabs { grid-template-columns:repeat(2,1fr); }
        .quick-fields { grid-template-columns:1fr; }
        .quick-account-pill { flex:1 1 calc(50% - 7px); justify-content:space-between; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectPanel() {
    if ($('#quickEntryPanel')) return;
    const accountsSection = $('.accounts-section');
    if (!accountsSection) return;

    const section = document.createElement('section');
    section.className = 'quick-entry-section';
    section.innerHTML = `
      <article id="quickEntryPanel" class="panel quick-entry-panel">
        <div class="panel-heading quick-entry-head">
          <div>
            <p class="eyebrow">QUICK ENTRY // FAST LANE</p>
            <h2>Record a movement</h2>
            <p class="quick-entry-copy">Use your existing cards without opening a drawer. Linked movements still write to the same Balance Trace ledger.</p>
          </div>
          <span class="live-pill">LIVE</span>
        </div>

        <div class="quick-mode-tabs" role="group" aria-label="Quick transaction type">
          <button type="button" class="quick-mode-btn" data-quick-mode="add">+ Add</button>
          <button type="button" class="quick-mode-btn" data-quick-mode="subtract">− Subtract</button>
          <button type="button" class="quick-mode-btn active" data-quick-mode="spend">Spend</button>
          <button type="button" class="quick-mode-btn" data-quick-mode="income">Income</button>
        </div>

        <form id="quickEntryForm" class="quick-entry-grid">
          <div class="quick-entry-left">
            <div class="quick-fields">
              <label class="quick-field">
                Amount
                <div class="quick-amount-wrap"><span>S$</span><input id="quickAmount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required /></div>
              </label>
              <label class="quick-field">
                Date
                <input id="quickDate" type="date" required />
              </label>
              <label class="quick-field">
                Category
                <select id="quickCategory"></select>
              </label>
            </div>

            <div class="quick-account-zone">
              <div class="quick-zone-head"><strong id="quickPrimaryLabel">Expense account</strong><small>choose one card</small></div>
              <div id="quickPrimaryAccounts"></div>
            </div>

            <div id="quickLinkBox" class="quick-link-box">
              <label class="quick-link-toggle">
                <input id="quickLinkToggle" type="checkbox" />
                <span id="quickLinkLabel">Take the same amount from another account</span>
              </label>
              <div id="quickLinkedControls" class="quick-linked-controls" hidden>
                <div id="quickLinkedActionWrap">
                  <div class="quick-zone-head"><strong>Linked account action</strong><small>same amount</small></div>
                  <div class="quick-linked-actions">
                    <button type="button" class="quick-linked-action" data-quick-linked-operation="add">+ Add</button>
                    <button type="button" class="quick-linked-action active" data-quick-linked-operation="subtract">− Subtract</button>
                  </div>
                </div>
                <div class="quick-account-zone">
                  <div class="quick-zone-head"><strong id="quickLinkedLabel">Other account</strong><small>optional link</small></div>
                  <div id="quickLinkedAccounts"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="quick-entry-right">
            <div id="quickPreview" class="quick-preview"></div>
            <div class="quick-note-row">
              <label for="quickNote">Note <span class="muted">optional</span></label>
              <input id="quickNote" type="text" maxlength="120" placeholder="e.g. Lunch, salary, transfer" />
            </div>
            <button id="quickSubmit" class="quick-submit" type="submit">Record spending</button>
          </div>
        </form>
      </article>
    `;

    accountsSection.parentNode.insertBefore(section, accountsSection);
  }

  function getAccounts() {
    return engine.getAccounts();
  }

  function accountsForSections(sections, exclude = null) {
    return getAccounts().filter(account =>
      sections.includes(account.section) &&
      !(exclude && account.section === exclude.section && account.id === exclude.id)
    );
  }

  function renderAccountPills(container, accounts, selected, type) {
    if (!container) return;
    if (!accounts.length) {
      container.innerHTML = '<div class="quick-empty">No matching accounts yet. Create an account below first.</div>';
      return;
    }

    const groups = ['expenses', 'savings', 'current']
      .map(section => ({ section, accounts: accounts.filter(account => account.section === section) }))
      .filter(group => group.accounts.length);

    container.innerHTML = groups.map(group => `
      <div class="quick-account-group">
        <span>${SECTION_LABELS[group.section]}</span>
        <div class="quick-pill-row">
          ${group.accounts.map(account => `
            <button
              type="button"
              class="quick-account-pill ${selected?.section === account.section && selected?.id === account.id ? 'active' : ''}"
              data-quick-account-type="${type}"
              data-section="${account.section}"
              data-id="${escapeHtml(account.id)}"
            >
              <span>${escapeHtml(account.name)}</span>
              <small>${money.format(account.amount)}</small>
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function findAccount(section, id) {
    return getAccounts().find(account => account.section === section && account.id === id) || null;
  }

  function ensureSelections() {
    const meta = MODE_META[mode];
    const availablePrimary = accountsForSections(meta.accountSections);
    if (!selectedPrimary || !availablePrimary.some(account => account.section === selectedPrimary.section && account.id === selectedPrimary.id)) {
      selectedPrimary = availablePrimary[0] || null;
    } else {
      selectedPrimary = findAccount(selectedPrimary.section, selectedPrimary.id);
    }

    const availableLinked = selectedPrimary
      ? accountsForSections(['expenses', 'savings', 'current'], selectedPrimary)
      : [];
    if (!selectedLinked || !availableLinked.some(account => account.section === selectedLinked.section && account.id === selectedLinked.id)) {
      selectedLinked = availableLinked[0] || null;
    } else {
      selectedLinked = findAccount(selectedLinked.section, selectedLinked.id);
    }
  }

  function renderCategories() {
    const select = $('#quickCategory');
    if (!select) return;
    const categories = engine.categories || [];
    select.innerHTML = categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    const desired = MODE_META[mode].defaultCategory;
    select.value = categories.includes(desired) ? desired : (categories[0] || 'Unknown');
    select.disabled = mode === 'income';
  }

  function renderMode() {
    const meta = MODE_META[mode];
    linkedOperation = meta.defaultLinkedOperation || '';
    ensureSelections();

    $$('.quick-mode-btn').forEach(button => button.classList.toggle('active', button.dataset.quickMode === mode));
    $('#quickPrimaryLabel').textContent = mode === 'spend'
      ? 'Expense account'
      : mode === 'income'
        ? 'Current / Idle Cash account'
        : 'Choose account';
    $('#quickLinkLabel').textContent = meta.linkLabel || '';
    $('#quickSubmit').textContent = meta.submit;
    $('#quickLinkBox').hidden = mode === 'income';
    $('#quickLinkToggle').checked = false;
    $('#quickLinkedControls').hidden = true;
    $('#quickLinkedActionWrap').hidden = mode === 'spend';
    $('#quickLinkedLabel').textContent = mode === 'spend' ? 'Pay from account' : 'Other account';
    setLinkedOperation(linkedOperation || 'add');
    renderCategories();
    renderAccounts();
    updatePreview();
  }

  function renderAccounts() {
    ensureSelections();
    const meta = MODE_META[mode];
    renderAccountPills(
      $('#quickPrimaryAccounts'),
      accountsForSections(meta.accountSections),
      selectedPrimary,
      'primary'
    );

    const linkedAccounts = selectedPrimary
      ? accountsForSections(['expenses', 'savings', 'current'], selectedPrimary)
      : [];
    renderAccountPills($('#quickLinkedAccounts'), linkedAccounts, selectedLinked, 'linked');
  }

  function setLinkedOperation(operation) {
    if (!['add', 'subtract'].includes(operation)) return;
    linkedOperation = operation;
    $$('.quick-linked-action').forEach(button => {
      button.classList.toggle('active', button.dataset.quickLinkedOperation === operation);
    });
    updatePreview();
  }

  function operationSymbol(operation) {
    return operation === 'subtract' ? '−' : '+';
  }

  function updatePreview() {
    const preview = $('#quickPreview');
    if (!preview) return;
    const meta = MODE_META[mode];
    const amount = Number($('#quickAmount')?.value || 0);
    const amountText = amount > 0 ? money.format(amount) : 'S$0.00';

    if (!selectedPrimary) {
      preview.innerHTML = '<span>Movement preview</span><strong>Create or choose an account to continue.</strong>';
      return;
    }

    const primaryLine = `${escapeHtml(selectedPrimary.name)} ${operationSymbol(meta.primaryOperation)} ${amountText}`;
    const linkEnabled = mode !== 'income' && $('#quickLinkToggle')?.checked;
    const actualLinkedOperation = mode === 'spend' ? 'subtract' : linkedOperation;

    if (linkEnabled && selectedLinked) {
      const linkedLine = `${escapeHtml(selectedLinked.name)} ${operationSymbol(actualLinkedOperation)} ${amountText}`;
      preview.innerHTML = `
        <span>Movement preview</span>
        <strong>${primaryLine}<br>${linkedLine}</strong>
        <small>Both movements use the same date and transfer ID.</small>
      `;
      return;
    }

    preview.innerHTML = `
      <span>Movement preview</span>
      <strong>${primaryLine}</strong>
      <small>${mode === 'spend' ? 'Expense is recorded without reducing another account unless you enable the link.' : 'Single-account movement.'}</small>
    `;
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      renderAccounts();
      updatePreview();
    });
  }

  function bindEvents() {
    $$('.quick-mode-btn').forEach(button => {
      button.addEventListener('click', () => {
        mode = button.dataset.quickMode;
        renderMode();
      });
    });

    $('#quickEntryPanel').addEventListener('click', event => {
      const pill = event.target.closest('[data-quick-account-type]');
      if (pill) {
        const account = findAccount(pill.dataset.section, pill.dataset.id);
        if (!account) return;
        if (pill.dataset.quickAccountType === 'primary') {
          selectedPrimary = account;
          if (selectedLinked?.section === account.section && selectedLinked?.id === account.id) selectedLinked = null;
          renderAccounts();
        } else {
          selectedLinked = account;
          renderAccounts();
        }
        updatePreview();
        return;
      }

      const linkedAction = event.target.closest('[data-quick-linked-operation]');
      if (linkedAction && mode !== 'spend') {
        setLinkedOperation(linkedAction.dataset.quickLinkedOperation);
      }
    });

    $('#quickLinkToggle').addEventListener('change', event => {
      $('#quickLinkedControls').hidden = !event.target.checked;
      if (event.target.checked) {
        ensureSelections();
        renderAccounts();
      }
      updatePreview();
    });

    $('#quickAmount').addEventListener('input', updatePreview);
    $('#quickEntryForm').addEventListener('submit', handleSubmit);

    document.addEventListener('neon-finance:changed', scheduleRefresh);
    $('#variableForm')?.addEventListener('submit', () => setTimeout(scheduleRefresh, 0));

    const accountsRoot = $('.accounts-section');
    if (accountsRoot && 'MutationObserver' in window) {
      accountsObserver = new MutationObserver(scheduleRefresh);
      accountsObserver.observe(accountsRoot, { childList: true, subtree: true });
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const meta = MODE_META[mode];
    const amount = Number($('#quickAmount').value);
    const transactionDate = $('#quickDate').value;
    const category = mode === 'income' ? 'Salary' : ($('#quickCategory').value || meta.defaultCategory);
    const note = $('#quickNote').value.trim();

    ensureSelections();
    if (!selectedPrimary) {
      window.NeonFinanceApp?.showToast?.('Choose an account first.', true);
      return;
    }

    let linked = null;
    const linkEnabled = mode !== 'income' && $('#quickLinkToggle').checked;
    if (linkEnabled) {
      if (!selectedLinked) {
        window.NeonFinanceApp?.showToast?.('Choose the linked account.', true);
        return;
      }
      linked = {
        section: selectedLinked.section,
        id: selectedLinked.id,
        operation: mode === 'spend' ? 'subtract' : linkedOperation,
        category
      };
    }

    const result = engine.executeMovement({
      section: selectedPrimary.section,
      id: selectedPrimary.id,
      operation: meta.primaryOperation,
      amount,
      transactionDate,
      category,
      note,
      linked,
      source: `quick-${mode}`
    });

    if (!result) return;

    const toast = window.NeonFinanceApp?.showToast;
    if (mode === 'spend') {
      toast?.(`${money.format(amount)} spending recorded${result.linked ? ` and linked with ${result.linked.item.name}` : ''}.`);
    } else if (mode === 'income') {
      toast?.(`${money.format(amount)} income added to ${result.item.name}.`);
    } else {
      toast?.(`${money.format(amount)} ${mode === 'add' ? 'added to' : 'subtracted from'} ${result.item.name}${result.linked ? ` · linked ${result.linked.item.name}` : ''}.`);
    }

    $('#quickAmount').value = '';
    $('#quickNote').value = '';
    $('#quickLinkToggle').checked = false;
    $('#quickLinkedControls').hidden = true;
    scheduleRefresh();
  }

  function init() {
    injectStyles();
    injectPanel();
    $('#quickDate').max = todayKey();
    $('#quickDate').value = todayKey();
    bindEvents();
    renderMode();
    console.info('Neon Finance quick entry loaded.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
