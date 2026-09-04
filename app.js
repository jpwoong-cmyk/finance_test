const STORAGE_KEY = 'neon-finance-state-v3';
const BACKUP_EXTENSION = '.nfinance';

let state = null;
let activePeriod = 'month';
let toastTimer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const money = new Intl.NumberFormat('en-SG', {
  style: 'currency',
  currency: 'SGD',
  minimumFractionDigits: 2
});

const sectionMeta = {
  expenses: { label: 'Expenses', kicker: 'OUTFLOW' },
  savings: { label: 'Savings', kicker: 'GROWTH' },
  current: { label: 'Current', kicker: 'IDLE CASH' }
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyState() {
  return {
    formatVersion: 1,
    expenses: { variables: [] },
    savings: { variables: [] },
    current: { variables: [] },
    activity: [],
    periodSnapshots: {}
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    state = createEmptyState();
    persist();
    return;
  }

  try {
    state = normalizeState(JSON.parse(saved));
  } catch (error) {
    console.warn('Local finance state could not be read. Starting empty.', error);
    state = createEmptyState();
    persist();
  }
}

function normalizeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const safe = createEmptyState();

  ['expenses', 'savings', 'current'].forEach(section => {
    const variables = source?.[section]?.variables;
    safe[section].variables = Array.isArray(variables)
      ? variables
          .filter(item => item && typeof item === 'object')
          .map(item => ({
            id: String(item.id || makeId(section.slice(0, 3))),
            name: String(item.name || 'Unnamed account').slice(0, 80),
            amount: Math.max(0, Number(item.amount) || 0)
          }))
      : [];
  });

  safe.activity = Array.isArray(source.activity)
    ? source.activity
        .filter(item => item && typeof item === 'object')
        .map(item => ({
          id: String(item.id || makeId('txn')),
          section: ['expenses', 'savings', 'current'].includes(item.section) ? item.section : 'current',
          variableId: String(item.variableId || ''),
          variableName: String(item.variableName || 'Account').slice(0, 80),
          operation: item.operation === 'set' ? 'set' : 'add',
          amount: Math.max(0, Number(item.amount) || 0),
          note: String(item.note || '').slice(0, 160),
          timestamp: isValidDate(item.timestamp) ? item.timestamp : nowIso()
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

  return safe;
}

function isValidDate(value) {
  return value && !Number.isNaN(new Date(value).getTime());
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function exportBackup() {
  const payload = {
    ...state,
    backupMeta: {
      app: 'Neon Finance',
      formatVersion: 1,
      exportedAt: nowIso()
    }
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/octet-stream'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);

  anchor.href = url;
  anchor.download = `neon-finance-backup-${date}${BACKUP_EXTENSION}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  showToast('Backup exported to your device.');
}

async function importBackupFile(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported = normalizeState(parsed);

    const accountCount = ['expenses', 'savings', 'current']
      .reduce((sum, section) => sum + imported[section].variables.length, 0);

    const shouldReplace = confirm(
      `Import this backup and replace the finance data stored in this browser?\n\n${accountCount} account${accountCount === 1 ? '' : 's'} found.`
    );

    if (!shouldReplace) return;

    state = imported;
    persist();
    render();
    showToast('Backup imported. Local finance data restored.');
  } catch (error) {
    console.error(error);
    showToast('Import failed. Choose a valid Neon Finance backup.', true);
  } finally {
    $('#importBackupFile').value = '';
  }
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  if (!toast) return;

  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

function getSectionTotal(section) {
  return state[section].variables.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function getLiveTotals() {
  return {
    expenses: getSectionTotal('expenses'),
    savings: getSectionTotal('savings'),
    current: getSectionTotal('current')
  };
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
  return getLiveTotals();
}

function render() {
  const totals = getLiveTotals();

  $('#expenseValue').textContent = money.format(totals.expenses);
  $('#savingsValue').textContent = money.format(totals.savings);
  $('#currentValue').textContent = money.format(totals.current);

  $('#expenseCount').textContent = accountCountLabel('expenses');
  $('#savingsCount').textContent = accountCountLabel('savings');
  $('#currentCount').textContent = `${accountCountLabel('current')} · stale / available cash`;

  renderVariables('expenses');
  renderVariables('savings');
  renderVariables('current');
  renderActivity();
  drawChart(activePeriod);
}

function accountCountLabel(section) {
  const count = state[section].variables.length;
  return `${count} account${count === 1 ? '' : 's'}`;
}

function renderVariables(section) {
  const list = $(`#${section}List`);
  const variables = state[section].variables;

  if (!variables.length) {
    list.innerHTML = `<button class="empty-state-card" data-add-empty="${section}">+ Add your first account</button>`;
    list.querySelector('[data-add-empty]').addEventListener('click', () => openNewAccountDrawer(section));
    return;
  }

  list.innerHTML = variables.map(item => `
    <button class="variable-card ${section}" data-account-card data-section="${section}" data-id="${item.id}" type="button">
      <span class="variable-card-copy">
        <span class="variable-name">${escapeHtml(item.name)}</span>
        <span class="variable-meta">Open to update</span>
      </span>
      <span class="variable-amount">${money.format(item.amount)}</span>
      <span class="card-arrow" aria-hidden="true">›</span>
    </button>
  `).join('');

  list.querySelectorAll('[data-account-card]').forEach(card => {
    card.addEventListener('click', () => openAccountDrawer(card.dataset.section, card.dataset.id));
  });
}

function renderActivity() {
  const list = $('#activityList');
  const activity = [...state.activity]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 9);

  if (!activity.length) {
    list.innerHTML = `<div class="empty-state">No changes yet.</div>`;
    return;
  }

  list.innerHTML = activity.map(item => {
    const symbol = item.operation === 'set' ? '=' : '+';
    return `
      <div class="activity-item ${item.section}">
        <span class="activity-beam"></span>
        <div class="activity-title">
          <span>${symbol} ${money.format(item.amount)} · ${escapeHtml(item.variableName)}</span>
          <span>${formatActivityDate(item.timestamp)}</span>
        </div>
        <div class="activity-meta">${sectionMeta[item.section]?.label || capitalize(item.section)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div>
      </div>
    `;
  }).join('');
}

function formatActivityDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' });
}

function openAccountDrawer(section, id) {
  const item = state[section].variables.find(v => v.id === id);
  if (!item) return;

  $('#drawerAccountMode').hidden = false;
  $('#drawerNewMode').hidden = true;
  $('#drawerSection').value = section;
  $('#drawerVariableId').value = id;
  $('#drawerEyebrow').textContent = `${sectionMeta[section].kicker} // UPDATE`;
  $('#drawerTitle').textContent = item.name;
  $('#drawerCurrentAmount').textContent = money.format(item.amount);
  $('#drawerNote').value = '';

  setOperation('add');
  setDrawerTheme(section);
  showDrawer();
}

function openNewAccountDrawer(section) {
  $('#drawerAccountMode').hidden = true;
  $('#drawerNewMode').hidden = false;
  $('#newVariableSection').value = section;
  $('#newVariableName').value = '';
  $('#newVariableAmount').value = '0';
  $('#drawerEyebrow').textContent = `${sectionMeta[section].kicker} // NEW ACCOUNT`;
  $('#drawerTitle').textContent = `Add ${sectionMeta[section].label} account`;
  setDrawerTheme(section);
  showDrawer();
  requestAnimationFrame(() => $('#newVariableName').focus());
}

function setOperation(operation) {
  $('#drawerOperation').value = operation;
  $$('.operation-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.operation === operation));

  const section = $('#drawerSection').value;
  const id = $('#drawerVariableId').value;
  const item = state[section]?.variables.find(v => v.id === id);

  if (operation === 'set' && item) {
    $('#drawerAmount').value = item.amount;
    $('#amountLabel').textContent = 'Set exact amount';
    $('#drawerSubmit').textContent = 'Set exact amount';
  } else {
    $('#drawerAmount').value = '';
    $('#amountLabel').textContent = 'Amount to add';
    $('#drawerSubmit').textContent = 'Add amount';
  }
}

function setDrawerTheme(section) {
  $('#accountDrawer').dataset.theme = section;
}

function showDrawer() {
  $('#drawerBackdrop').hidden = false;
  requestAnimationFrame(() => {
    $('#drawerBackdrop').classList.add('show');
    $('#accountDrawer').classList.add('open');
    $('#accountDrawer').setAttribute('aria-hidden', 'false');
  });
}

function closeDrawer() {
  $('#drawerBackdrop').classList.remove('show');
  $('#accountDrawer').classList.remove('open');
  $('#accountDrawer').setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    if (!$('#accountDrawer').classList.contains('open')) $('#drawerBackdrop').hidden = true;
  }, 260);
}

$$('.operation-tab').forEach(tab => {
  tab.addEventListener('click', () => setOperation(tab.dataset.operation));
});

$('#closeDrawer').addEventListener('click', closeDrawer);
$('#drawerBackdrop').addEventListener('click', closeDrawer);

$('#exportBackup').addEventListener('click', exportBackup);
$('#importBackup').addEventListener('click', () => $('#importBackupFile').click());
$('#importBackupFile').addEventListener('change', event => importBackupFile(event.target.files?.[0]));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#accountDrawer').classList.contains('open')) closeDrawer();
});

$('#amountForm').addEventListener('submit', event => {
  event.preventDefault();

  const section = $('#drawerSection').value;
  const id = $('#drawerVariableId').value;
  const operation = $('#drawerOperation').value;
  const amount = Number($('#drawerAmount').value);
  const note = $('#drawerNote').value.trim();
  const item = state[section].variables.find(v => v.id === id);

  if (!item || !Number.isFinite(amount) || amount < 0) return;

  if (operation === 'add') item.amount = Number(item.amount) + amount;
  if (operation === 'set') item.amount = amount;

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

  syncMonthSnapshotToLiveTotals();
  persist();
  render();

  $('#drawerCurrentAmount').textContent = money.format(item.amount);
  if (operation === 'add') $('#drawerAmount').value = '';
  if (operation === 'set') $('#drawerAmount').value = item.amount;
});

$$('[data-add-variable]').forEach(btn => {
  btn.addEventListener('click', () => openNewAccountDrawer(btn.dataset.addVariable));
});

$('#variableForm').addEventListener('submit', event => {
  event.preventDefault();

  const section = $('#newVariableSection').value;
  const name = $('#newVariableName').value.trim();
  const amount = Number($('#newVariableAmount').value);

  if (!name || !Number.isFinite(amount) || amount < 0) return;

  const item = { id: makeId(section.slice(0, 3)), name, amount };
  state[section].variables.push(item);
  syncMonthSnapshotToLiveTotals();
  persist();
  render();
  closeDrawer();
});

$$('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activePeriod = btn.dataset.period;
    $$('.period-btn').forEach(b => b.classList.toggle('active', b === btn));
    drawChart(activePeriod);
  });
});

function syncMonthSnapshotToLiveTotals() {
  state.periodSnapshots = state.periodSnapshots || {};
  state.periodSnapshots.month = getLiveTotals();
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
  const values = [expenses, savings, current];
  const colors = ['#ff2f6d', '#00ffa8', '#ffd23f'];
  const total = values.reduce((a, b) => a + b, 0);
  const center = cssSize / 2;
  const radius = cssSize * 0.36;
  const lineWidth = cssSize * 0.12;

  ctx.lineCap = 'butt';

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(127, 149, 209, .10)';
  ctx.lineWidth = lineWidth + 2;
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (total > 0) {
    let start = -Math.PI / 2;
    values.forEach((value, i) => {
      if (value <= 0) return;
      const slice = (value / total) * Math.PI * 2;
      ctx.save();
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = lineWidth;
      ctx.arc(center, center, radius, start + 0.025, start + slice - 0.025);
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

loadState();
render();
