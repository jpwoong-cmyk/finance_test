const DATA_URL = 'finance-data.json';
const STORAGE_KEY = 'neon-finance-state-v1';

let state = null;
let activePeriod = 'month';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const money = new Intl.NumberFormat('en-SG', {
  style: 'currency',
  currency: 'SGD',
  minimumFractionDigits: 2
});

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    state = JSON.parse(saved);
    return;
  }

  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error('Could not load finance-data.json');
  state = await response.json();
  persist();
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getSectionTotal(section) {
  return state[section].variables.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function getTotalsForPeriod(period) {
  const config = state.periodSnapshots?.[period];
  if (config) {
    return {
      expenses: Number(config.expenses || 0),
      savings: Number(config.savings || 0),
      current: Number(config.current || 0)
    };
  }

  const expenses = getSectionTotal('expenses');
  const savings = getSectionTotal('savings');
  return { expenses, savings, current: Math.max(savings - expenses, 0) };
}

function render() {
  const expenses = getSectionTotal('expenses');
  const savings = getSectionTotal('savings');
  const current = Math.max(savings - expenses, 0);

  $('#expenseValue').textContent = money.format(expenses);
  $('#savingsValue').textContent = money.format(savings);
  $('#currentValue').textContent = money.format(current);
  $('#expenseCount').textContent = `${state.expenses.variables.length} variable${state.expenses.variables.length === 1 ? '' : 's'}`;
  $('#savingsCount').textContent = `${state.savings.variables.length} variable${state.savings.variables.length === 1 ? '' : 's'}`;

  renderVariables('expenses');
  renderVariables('savings');
  renderActivity();
  drawChart(activePeriod);
}

function renderVariables(section) {
  const list = $(`#${section}List`);
  const variables = state[section].variables;

  if (!variables.length) {
    list.innerHTML = `<div class="empty-state">No variables yet. Add your first bank or account.</div>`;
    return;
  }

  list.innerHTML = variables.map(item => `
    <div class="variable-row">
      <div>
        <div class="variable-name">${escapeHtml(item.name)}</div>
        <div class="activity-meta">${section === 'expenses' ? 'Expense variable' : 'Savings variable'}</div>
      </div>
      <div class="variable-amount">${money.format(item.amount)}</div>
      <div class="variable-actions">
        <button class="action-btn" data-op="add" data-section="${section}" data-id="${item.id}" title="Add amount">+</button>
        <button class="action-btn" data-op="set" data-section="${section}" data-id="${item.id}" title="Set exact amount">=</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-op]').forEach(btn => {
    btn.addEventListener('click', () => openAmountDialog(btn.dataset.section, btn.dataset.id, btn.dataset.op));
  });
}

function renderActivity() {
  const list = $('#activityList');
  const activity = [...(state.activity || [])]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 8);

  if (!activity.length) {
    list.innerHTML = `<div class="empty-state">No changes yet.</div>`;
    return;
  }

  list.innerHTML = activity.map(item => {
    const symbol = item.operation === 'set' ? '=' : '+';
    return `
      <div class="activity-item ${item.section}">
        <div class="activity-title">
          <span>${symbol} ${money.format(item.amount)} · ${escapeHtml(item.variableName)}</span>
          <span>${new Date(item.timestamp).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' })}</span>
        </div>
        <div class="activity-meta">${capitalize(item.section)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div>
      </div>
    `;
  }).join('');
}

function openAmountDialog(section, id, operation) {
  const item = state[section].variables.find(v => v.id === id);
  if (!item) return;

  $('#dialogSection').value = section;
  $('#dialogVariableId').value = id;
  $('#dialogOperation').value = operation;
  $('#dialogAmount').value = operation === 'set' ? item.amount : '';
  $('#dialogNote').value = '';
  $('#dialogEyebrow').textContent = operation === 'set' ? 'SET EXACT AMOUNT' : 'ADD AMOUNT';
  $('#dialogTitle').textContent = item.name;
  $('#dialogSubmit').textContent = operation === 'set' ? 'Set amount' : 'Add amount';
  $('#amountDialog').showModal();
  requestAnimationFrame(() => $('#dialogAmount').focus());
}

$('#amountForm').addEventListener('submit', (event) => {
  event.preventDefault();

  const section = $('#dialogSection').value;
  const id = $('#dialogVariableId').value;
  const operation = $('#dialogOperation').value;
  const amount = Number($('#dialogAmount').value);
  const note = $('#dialogNote').value.trim();
  const item = state[section].variables.find(v => v.id === id);

  if (!item || !Number.isFinite(amount) || amount < 0) return;

  if (operation === 'add') item.amount = Number(item.amount) + amount;
  if (operation === 'set') item.amount = amount;

  state.activity = state.activity || [];
  state.activity.push({
    id: makeId('txn'),
    section,
    variableId: item.id,
    variableName: item.name,
    operation,
    amount,
    note,
    timestamp: nowIso()
  });

  syncSnapshotsToLiveTotals();
  persist();
  $('#amountDialog').close();
  render();
});

$$('[data-add-variable]').forEach(btn => {
  btn.addEventListener('click', () => {
    $('#newVariableSection').value = btn.dataset.addVariable;
    $('#newVariableName').value = '';
    $('#newVariableAmount').value = '0';
    $('#variableDialog').showModal();
    requestAnimationFrame(() => $('#newVariableName').focus());
  });
});

$('#variableForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const section = $('#newVariableSection').value;
  const name = $('#newVariableName').value.trim();
  const amount = Number($('#newVariableAmount').value);

  if (!name || !Number.isFinite(amount) || amount < 0) return;

  state[section].variables.push({ id: makeId(section.slice(0, 3)), name, amount });
  syncSnapshotsToLiveTotals();
  persist();
  $('#variableDialog').close();
  render();
});

$$('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activePeriod = btn.dataset.period;
    $$('.period-btn').forEach(b => b.classList.toggle('active', b === btn));
    drawChart(activePeriod);
  });
});

function syncSnapshotsToLiveTotals() {
  const expenses = getSectionTotal('expenses');
  const savings = getSectionTotal('savings');
  const current = Math.max(savings - expenses, 0);

  state.periodSnapshots = state.periodSnapshots || {};
  state.periodSnapshots.month = { expenses, savings, current };
  state.periodSnapshots.year = state.periodSnapshots.year || { expenses, savings, current };
  state.periodSnapshots.week = state.periodSnapshots.week || { expenses, savings, current };
}

function drawChart(period) {
  const canvas = $('#pieCanvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssSize = Math.min(canvas.parentElement.clientWidth, 420);

  canvas.width = cssSize * dpr;
  canvas.height = cssSize * dpr;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  const { expenses, savings, current } = getTotalsForPeriod(period);
  const values = [current, expenses, savings];
  const colors = ['#00eaff', '#ff4f7b', '#8c52ff'];
  const total = values.reduce((a, b) => a + b, 0);
  const center = cssSize / 2;
  const radius = cssSize * 0.36;
  const lineWidth = cssSize * 0.12;

  ctx.lineCap = 'butt';

  if (total <= 0) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(145,163,255,.14)';
    ctx.lineWidth = lineWidth;
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    let start = -Math.PI / 2;
    values.forEach((value, i) => {
      if (value <= 0) return;
      const slice = (value / total) * Math.PI * 2;
      ctx.save();
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = lineWidth;
      ctx.arc(center, center, radius, start + 0.02, start + slice - 0.02);
      ctx.stroke();
      ctx.restore();
      start += slice;
    });
  }

  $('#chartPeriodLabel').textContent = capitalize(period);
  $('#chartTotal').textContent = money.format(total).replace('.00', '');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

window.addEventListener('resize', () => drawChart(activePeriod));

loadState()
  .then(render)
  .catch(error => {
    console.error(error);
    document.body.innerHTML = `<main style="padding:2rem;color:white;font-family:system-ui"><h1>Could not load finance app</h1><p>${escapeHtml(error.message)}</p></main>`;
  });
