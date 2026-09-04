(() => {
  'use strict';

  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs';
  const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs';

  const app = window.NeonFinanceApp;
  if (!app) {
    console.error('NeonStatementImport: NeonFinanceApp API is not available. Load app.js first.');
    return;
  }

  const { money, makeId, nowIso, escapeHtml, persist, render, showToast, getState } = app;
  const $ = selector => document.querySelector(selector);

  let pendingStatementImport = null;
  let pdfjsLibPromise = null;

  const monthNames = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };

  function configure(section, account) {
    const tools = $('#statementTools');
    if (!tools) return;

    tools.hidden = section !== 'expenses';
    hideStatementPreview();
    setStatementStatus('', false, true);

    if (section === 'expenses' && account) {
      renderStatementHistory(account);
    }
  }

  function reset() {
    hideStatementPreview();
    setStatementStatus('', false, true);
  }

  function wireEvents() {
    $('#importStatementBtn')?.addEventListener('click', () => $('#statementFileInput')?.click());
    $('#statementFileInput')?.addEventListener('change', event => handleStatementFile(event.target.files?.[0]));
    $('#statementMonthInput')?.addEventListener('change', renderPendingStatementPreview);
    $('#cancelStatementImport')?.addEventListener('click', hideStatementPreview);
    $('#saveStatementImport')?.addEventListener('click', savePendingStatementImport);

    $('#statementHistory')?.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-statement]');
      if (!button) return;
      removeStatementImport(button.dataset.removeStatement);
    });
  }

async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(PDFJS_URL).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

async function handleStatementFile(file) {
  if (!file) return;

  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Choose a PDF statement.', true);
    $('#statementFileInput').value = '';
    return;
  }

  const section = $('#drawerSection').value;
  const accountId = $('#drawerVariableId').value;
  if (section !== 'expenses' || !accountId) return;

  try {
    setStatementStatus('Reading PDF locally…', false);
    $('#importStatementBtn').disabled = true;

    const buffer = await file.arrayBuffer();
    const hash = await sha256(buffer);

    const existing = getState().importedStatements.find(item => item.hash === hash && item.accountId === accountId);
    if (existing) {
      setStatementStatus(`Already imported on ${formatDateTime(existing.importedAt)}. Remove the old import first if you want to replace it.`, true);
      return;
    }

    const result = await extractTransactionsFromPdf(buffer);

    if (!result.transactions.length) {
      setStatementStatus('No expense rows were detected. This may be a scanned/image PDF or a layout the generic parser does not recognise yet.', true);
      return;
    }

    pendingStatementImport = {
      accountId,
      fileName: file.name,
      hash,
      transactions: result.transactions,
      detectedColumns: result.detectedColumns
    };

    const suggestedMonth = getDominantMonth(result.transactions) || new Date().toISOString().slice(0, 7);
    $('#statementMonthInput').value = suggestedMonth;
    $('#statementPreviewName').textContent = file.name;
    $('#statementPreview').hidden = false;
    renderPendingStatementPreview();

    const confidenceCopy = result.detectedColumns.debit
      ? 'Debit/withdrawal column detected.'
      : 'Generic amount detection used. Check the preview before saving.';
    setStatementStatus(`${result.transactions.length} expense row${result.transactions.length === 1 ? '' : 's'} detected. ${confidenceCopy}`, false);
  } catch (error) {
    console.error(error);
    setStatementStatus('Could not parse this PDF. If it is password-protected or scanned, it will need a different parser.', true);
  } finally {
    $('#importStatementBtn').disabled = false;
    $('#statementFileInput').value = '';
  }
}

async function extractTransactionsFromPdf(buffer) {
  const pdfjsLib = await getPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  const rows = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageRows = groupTextItemsIntoRows(content.items, pageNumber);
    rows.push(...pageRows);
  }

  const defaultYear = detectLikelyYear(rows);
  const columns = detectStatementColumns(rows);
  const logicalRows = buildLogicalTransactionRows(rows, defaultYear);
  const transactions = [];

  logicalRows.forEach(row => {
    const parsed = parseLogicalExpenseRow(row, columns, defaultYear);
    if (parsed) transactions.push(parsed);
  });

  return {
    transactions,
    detectedColumns: columns
  };
}

function groupTextItemsIntoRows(items, pageNumber) {
  const clean = items
    .filter(item => item?.str?.trim())
    .map(item => ({
      text: item.str.trim(),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0)
    }))
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const rows = [];
  const yTolerance = 2.8;

  clean.forEach(cell => {
    let row = rows.find(candidate => Math.abs(candidate.y - cell.y) <= yTolerance);
    if (!row) {
      row = { page: pageNumber, y: cell.y, cells: [] };
      rows.push(row);
    }
    row.cells.push(cell);
  });

  rows.forEach(row => {
    row.cells.sort((a, b) => a.x - b.x);
    row.text = row.cells.map(cell => cell.text).join(' ').replace(/\s+/g, ' ').trim();
  });

  return rows.sort((a, b) => (a.page - b.page) || (b.y - a.y));
}

function detectLikelyYear(rows) {
  const counts = new Map();
  rows.forEach(row => {
    const matches = row.text.match(/\b20\d{2}\b/g) || [];
    matches.forEach(year => counts.set(year, (counts.get(year) || 0) + 1));
  });

  if (!counts.size) return new Date().getFullYear();
  return Number([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}

function detectStatementColumns(rows) {
  const columns = { debit: null, credit: null, balance: null, amount: null };
  const keywordMap = {
    debit: ['debit', 'withdrawal', 'withdrawals', 'debit amount'],
    credit: ['credit', 'deposit', 'deposits'],
    balance: ['balance'],
    amount: ['amount', 'transaction amount']
  };

  rows.slice(0, 120).forEach(row => {
    row.cells.forEach(cell => {
      const text = cell.text.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
      Object.entries(keywordMap).forEach(([key, keywords]) => {
        if (columns[key] !== null) return;
        if (keywords.some(keyword => text === keyword || text.includes(keyword))) columns[key] = cell.x;
      });
    });
  });

  return columns;
}

function buildLogicalTransactionRows(rows, defaultYear) {
  const logical = [];
  let current = null;

  rows.forEach(row => {
    const date = parseDateFromText(row.text, defaultYear);

    if (date) {
      if (current) logical.push(current);
      current = {
        date,
        rows: [row],
        text: row.text,
        cells: [...row.cells]
      };
      return;
    }

    if (current && !isLikelyHeaderOrFooter(row.text)) {
      current.rows.push(row);
      current.text += ` ${row.text}`;
      current.cells.push(...row.cells);
    }
  });

  if (current) logical.push(current);
  return logical;
}

function parseLogicalExpenseRow(row, columns) {
  const lower = row.text.toLowerCase();

  if (isLikelyHeaderOrFooter(lower)) return null;
  if (/\b(refund|cashback|reversal|payment received|payment thank|thank you payment|interest credit)\b/i.test(lower)) return null;

  const amounts = extractAmountCandidates(row.cells);
  if (!amounts.length) return null;

  let chosen = null;

  if (columns.debit !== null) {
    chosen = nearestAmountToX(amounts, columns.debit, 100);
  }

  if (!chosen && columns.amount !== null) {
    const amountCandidate = nearestAmountToX(amounts, columns.amount, 90);
    if (amountCandidate && !isNearColumn(amountCandidate, columns.credit, 45)) chosen = amountCandidate;
  }

  if (!chosen && columns.balance !== null && amounts.length >= 2) {
    const nonBalance = amounts.filter(candidate => !isNearColumn(candidate, columns.balance, 55));
    if (nonBalance.length) chosen = nonBalance[nonBalance.length - 1];
  }

  if (!chosen && amounts.length >= 2) {
    chosen = amounts[amounts.length - 2];
  }

  if (!chosen) chosen = amounts[amounts.length - 1];

  if (!chosen || chosen.value <= 0) return null;
  if (columns.credit !== null && isNearColumn(chosen, columns.credit, 45) && !isNearColumn(chosen, columns.debit, 45)) return null;
  if (/\bcr\b/i.test(chosen.raw) && !/\bdr\b/i.test(chosen.raw)) return null;

  const description = cleanTransactionDescription(row.text, row.date, amounts);
  if (!description || description.length < 2) return null;

  return {
    id: makeId('stmt'),
    date: row.date,
    description,
    amount: roundMoney(chosen.value),
    source: 'pdf'
  };
}

function extractAmountCandidates(cells) {
  const candidates = [];
  const amountRegex = /(?:S\$|SGD|\$)?\s*\(?-?\d+(?:,\d{3})*(?:\.\d{2})\)?\s*(?:DR|CR)?/gi;

  cells.forEach(cell => {
    const matches = cell.text.match(amountRegex) || [];
    matches.forEach(raw => {
      const value = parseAmount(raw);
      if (!Number.isFinite(value)) return;
      candidates.push({ x: cell.x, raw: raw.trim(), value: Math.abs(value) });
    });
  });

  return candidates.filter(candidate => candidate.value > 0 && candidate.value < 100000000);
}

function parseAmount(raw) {
  const cleaned = raw
    .replace(/S\$|SGD|\$/gi, '')
    .replace(/DR|CR/gi, '')
    .replace(/[(),\s]/g, '')
    .replace(/,/g, '');
  return Number(cleaned);
}

function nearestAmountToX(candidates, x, maxDistance) {
  if (x === null || x === undefined) return null;
  const sorted = [...candidates].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
  if (!sorted.length || Math.abs(sorted[0].x - x) > maxDistance) return null;
  return sorted[0];
}

function isNearColumn(candidate, columnX, tolerance) {
  return columnX !== null && columnX !== undefined && Math.abs(candidate.x - columnX) <= tolerance;
}

function cleanTransactionDescription(text, isoDate, amounts) {
  let cleaned = text;

  const date = new Date(`${isoDate}T00:00:00`);
  const day = date.getDate();
  const monthShort = date.toLocaleDateString('en-US', { month: 'short' });
  const monthLong = date.toLocaleDateString('en-US', { month: 'long' });
  const year = date.getFullYear();

  const datePatterns = [
    new RegExp(`\\b0?${day}[\\/\\-.]0?${date.getMonth() + 1}(?:[\\/\\-.](?:${year}|${String(year).slice(-2)}))?\\b`, 'i'),
    new RegExp(`\\b0?${day}\\s+(?:${monthShort}|${monthLong})(?:\\s+${year})?\\b`, 'i'),
    new RegExp(`\\b(?:${monthShort}|${monthLong})\\s+0?${day}(?:,?\\s+${year})?\\b`, 'i'),
    new RegExp(`\\b${year}-0?${date.getMonth() + 1}-0?${day}\\b`, 'i')
  ];

  datePatterns.forEach(pattern => { cleaned = cleaned.replace(pattern, ' '); });
  amounts.forEach(candidate => { cleaned = cleaned.replace(candidate.raw, ' '); });

  cleaned = cleaned
    .replace(/\b(debit|credit|balance|withdrawal|deposit|transaction amount|amount)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[|:;\-–—\s]+|[|:;\-–—\s]+$/g, '')
    .trim();

  return cleaned.slice(0, 240);
}

function parseDateFromText(text, defaultYear) {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : defaultYear;
    if (year < 100) year += 2000;
    return toIsoDate(year, Number(numeric[2]), Number(numeric[1]));
  }

  const dayMonth = text.match(/\b(\d{1,2})\s+(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T|TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)(?:\s+(\d{2,4}))?\b/i);
  if (dayMonth) {
    let year = dayMonth[3] ? Number(dayMonth[3]) : defaultYear;
    if (year < 100) year += 2000;
    const month = monthNames[dayMonth[2].toLowerCase()];
    return toIsoDate(year, month, Number(dayMonth[1]));
  }

  const monthDay = text.match(/\b(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T|TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+(\d{1,2})(?:,?\s+(\d{2,4}))?\b/i);
  if (monthDay) {
    let year = monthDay[3] ? Number(monthDay[3]) : defaultYear;
    if (year < 100) year += 2000;
    const month = monthNames[monthDay[1].toLowerCase()];
    return toIsoDate(year, month, Number(monthDay[2]));
  }

  return null;
}

function toIsoDate(year, month, day) {
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isLikelyHeaderOrFooter(text) {
  return /^(page\s+\d+|date\s+description|transaction date|posting date|statement period|opening balance|closing balance|total\b|continued\b)/i.test(String(text).trim());
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer.slice(0));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function getDominantMonth(transactions) {
  const counts = new Map();
  transactions.forEach(txn => {
    const month = txn.date.slice(0, 7);
    counts.set(month, (counts.get(month) || 0) + 1);
  });
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function renderPendingStatementPreview() {
  if (!pendingStatementImport) return;

  const monthKey = $('#statementMonthInput').value || getDominantMonth(pendingStatementImport.transactions);
  const monthTransactions = pendingStatementImport.transactions.filter(txn => txn.date.startsWith(monthKey));
  const daily = groupTransactionsByDay(monthTransactions);
  const total = monthTransactions.reduce((sum, txn) => sum + txn.amount, 0);

  $('#statementPreviewCount').textContent = `${pendingStatementImport.transactions.length} txns found`;
  $('#statementMonthTotal').textContent = money.format(total);
  $('#statementDayCount').textContent = String(Object.keys(daily).length);

  const days = Object.entries(daily).sort((a, b) => b[0].localeCompare(a[0]));
  $('#statementDailyPreview').innerHTML = days.length
    ? days.slice(0, 12).map(([date, txns]) => `
        <div class="daily-preview-row">
          <span>${formatStatementDay(date)}</span>
          <span>${txns.length} txn${txns.length === 1 ? '' : 's'}</span>
          <strong>${money.format(txns.reduce((sum, txn) => sum + txn.amount, 0))}</strong>
        </div>
      `).join('')
    : '<div class="statement-empty">No transactions detected for this month.</div>';

  $('#saveStatementImport').disabled = pendingStatementImport.transactions.length === 0;
}

function savePendingStatementImport() {
  if (!pendingStatementImport) return;

  const account = getState().expenses.variables.find(item => item.id === pendingStatementImport.accountId);
  if (!account) return;

  const importedAt = nowIso();
  const transactions = pendingStatementImport.transactions.map(txn => ({
    ...txn,
    id: makeId('stmt'),
    statementHash: pendingStatementImport.hash,
    statementName: pendingStatementImport.fileName,
    importedAt
  }));

  account.transactions = [...(account.transactions || []), ...transactions];
  getState().importedStatements.push({
    hash: pendingStatementImport.hash,
    accountId: account.id,
    fileName: pendingStatementImport.fileName,
    importedAt,
    transactionCount: transactions.length,
    total: roundMoney(transactions.reduce((sum, txn) => sum + txn.amount, 0))
  });

  persist();
  render();
  renderStatementHistory(account);
  hideStatementPreview();
  setStatementStatus(`${transactions.length} statement transaction${transactions.length === 1 ? '' : 's'} saved locally.`, false);
  showToast('Statement saved locally. PDF file itself was not stored.');
}

function hideStatementPreview() {
  pendingStatementImport = null;
  if ($('#statementPreview')) $('#statementPreview').hidden = true;
  if ($('#statementFileInput')) $('#statementFileInput').value = '';
}

function setStatementStatus(message, isError = false, hide = false) {
  const status = $('#statementStatus');
  if (!status) return;
  status.hidden = hide || !message;
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function renderStatementHistory(account) {
  const container = $('#statementHistory');
  const transactions = [...(account.transactions || [])].sort((a, b) => b.date.localeCompare(a.date));

  if (!transactions.length) {
    container.innerHTML = '<div class="statement-empty-history">No imported statement history yet.</div>';
    return;
  }

  const byMonth = groupTransactionsByMonth(transactions);
  const monthMarkup = Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 12)
    .map(([monthKey, monthTxns], index) => {
      const days = groupTransactionsByDay(monthTxns);
      const monthTotal = monthTxns.reduce((sum, txn) => sum + txn.amount, 0);
      return `
        <details class="statement-month-card" ${index === 0 ? 'open' : ''}>
          <summary>
            <span>
              <small>${formatMonthKey(monthKey)}</small>
              <strong>${money.format(monthTotal)}</strong>
            </span>
            <span class="month-summary-meta">${monthTxns.length} txns · ${Object.keys(days).length} days</span>
          </summary>
          <div class="statement-month-body">
            ${Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])).map(([date, dayTxns]) => `
              <details class="statement-day-card">
                <summary>
                  <span>${formatStatementDay(date)}</span>
                  <strong>${money.format(dayTxns.reduce((sum, txn) => sum + txn.amount, 0))}</strong>
                </summary>
                <div class="statement-transaction-list">
                  ${dayTxns.map(txn => `
                    <div class="statement-transaction-row">
                      <span>${escapeHtml(txn.description)}</span>
                      <strong>${money.format(txn.amount)}</strong>
                    </div>
                  `).join('')}
                </div>
              </details>
            `).join('')}
          </div>
        </details>
      `;
    }).join('');

  const imports = getState().importedStatements
    .filter(item => item.accountId === account.id)
    .sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));

  const importMarkup = imports.length ? `
    <div class="statement-import-log">
      <div class="statement-subheading">Imported files</div>
      ${imports.map(item => `
        <div class="import-log-row">
          <span>
            <strong>${escapeHtml(item.fileName)}</strong>
            <small>${formatDateTime(item.importedAt)} · ${item.transactionCount} txns</small>
          </span>
          <button type="button" data-remove-statement="${item.hash}">Remove</button>
        </div>
      `).join('')}
    </div>
  ` : '';

  container.innerHTML = `
    <div class="statement-history-title">
      <span>Tracked expenses</span>
      <strong>${transactions.length} transactions</strong>
    </div>
    ${monthMarkup}
    ${importMarkup}
  `;
}

function removeStatementImport(hash) {
  const accountId = $('#drawerVariableId').value;
  const account = getState().expenses.variables.find(item => item.id === accountId);
  const imported = getState().importedStatements.find(item => item.hash === hash && item.accountId === accountId);
  if (!account || !imported) return;

  const shouldRemove = confirm(`Remove imported data from ${imported.fileName}?\n\nThis removes the parsed transactions from this browser. Your original PDF is not affected.`);
  if (!shouldRemove) return;

  account.transactions = (account.transactions || []).filter(txn => txn.statementHash !== hash);
  getState().importedStatements = getState().importedStatements.filter(item => !(item.hash === hash && item.accountId === accountId));
  persist();
  render();
  renderStatementHistory(account);
  showToast('Imported statement data removed.');
}

function groupTransactionsByDay(transactions) {
  return transactions.reduce((groups, txn) => {
    (groups[txn.date] ||= []).push(txn);
    return groups;
  }, {});
}

function groupTransactionsByMonth(transactions) {
  return transactions.reduce((groups, txn) => {
    const month = txn.date.slice(0, 7);
    (groups[month] ||= []).push(txn);
    return groups;
  }, {});
}

function formatStatementDay(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function formatMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}


  window.NeonStatementImport = Object.freeze({
    configure,
    reset,
    extractTransactionsFromPdf
  });

  wireEvents();
})();
