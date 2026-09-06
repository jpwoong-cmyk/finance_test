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

  const MONTH_PATTERN = 'JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T|TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?';

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

      if (!result.textItemCount) {
        setStatementStatus('This PDF has no readable text layer. It is probably scanned/image-based and needs OCR or AI vision.', true);
        return;
      }

      if (!result.transactions.length) {
        const detected = result.parserLabel ? ` Detected: ${result.parserLabel}.` : '';
        setStatementStatus(`No expense transactions were detected.${detected} Check whether this is a supported HSBC or Standard Chartered statement, or use the generic fallback for another bank.`, true);
        return;
      }

      pendingStatementImport = {
        accountId,
        fileName: file.name,
        hash,
        transactions: result.transactions,
        detectedColumns: result.detectedColumns,
        parserType: result.parserType,
        parserLabel: result.parserLabel
      };

      const suggestedMonth = getDominantMonth(result.transactions) || new Date().toISOString().slice(0, 7);
      $('#statementMonthInput').value = suggestedMonth;
      $('#statementPreviewName').textContent = file.name;
      $('#statementPreview').hidden = false;
      renderPendingStatementPreview();

      setStatementStatus(
        `${result.transactions.length} expense row${result.transactions.length === 1 ? '' : 's'} detected using ${result.parserLabel}. Check the preview before saving.`,
        false
      );
    } catch (error) {
      console.error(error);
      const passwordHint = /password/i.test(String(error?.message || error))
        ? ' This statement may be password-protected.'
        : '';
      setStatementStatus(`Could not parse this PDF.${passwordHint}`, true);
    } finally {
      $('#importStatementBtn').disabled = false;
      $('#statementFileInput').value = '';
    }
  }

  async function extractTransactionsFromPdf(buffer) {
    const layout = await extractPdfLayout(buffer);

    if (!layout.rows.length) {
      return {
        transactions: [],
        detectedColumns: emptyColumns(),
        parserType: 'no-text',
        parserLabel: 'No readable text',
        textItemCount: layout.textItemCount
      };
    }

    const dateContext = buildDateContext(layout.rows);
    const profile = detectStatementProfile(layout.rows);

    let parsed;
    if (profile.type === 'hsbc-credit-card') {
      parsed = parseHsbcCreditCard(layout.rows, dateContext);
    } else if (profile.type === 'sc-credit-card') {
      parsed = parseStandardCharteredCreditCard(layout.rows, dateContext);
    } else if (profile.type === 'sc-deposit') {
      parsed = parseStandardCharteredDeposit(layout.rows, dateContext);
    } else {
      parsed = parseGenericStatement(layout.rows, dateContext);
    }

    parsed.transactions = parsed.transactions
      .filter(txn => txn && txn.date && txn.amount > 0)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.page || 0) - (b.page || 0));

    return {
      ...parsed,
      parserType: profile.type,
      parserLabel: profile.label,
      textItemCount: layout.textItemCount
    };
  }

  async function extractPdfLayout(buffer) {
    const pdfjsLib = await getPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    const rows = [];
    let textItemCount = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      textItemCount += content.items.filter(item => item?.str?.trim()).length;
      rows.push(...groupTextItemsIntoRows(content.items, pageNumber));
    }

    return { rows, textItemCount, pageCount: pdf.numPages };
  }

  function groupTextItemsIntoRows(items, pageNumber) {
    const clean = items
      .filter(item => item?.str?.trim())
      .map(item => ({
        text: item.str.trim(),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0),
        width: Number(item.width || 0),
        height: Math.abs(Number(item.height || item.transform?.[0] || 0))
      }))
      .sort((a, b) => (b.y - a.y) || (a.x - b.x));

    if (!clean.length) return [];

    const heights = clean.map(item => item.height).filter(value => value > 0).sort((a, b) => a - b);
    const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 8;
    const yTolerance = Math.max(2.5, Math.min(4.5, medianHeight * 0.38));

    const rows = [];
    for (const cell of clean) {
      const last = rows[rows.length - 1];
      if (!last || Math.abs(last.y - cell.y) > yTolerance) {
        rows.push({ page: pageNumber, y: cell.y, cells: [cell] });
      } else {
        last.cells.push(cell);
        last.y = (last.y * (last.cells.length - 1) + cell.y) / last.cells.length;
      }
    }

    rows.forEach(row => {
      row.cells.sort((a, b) => a.x - b.x);
      row.text = row.cells.map(cell => cell.text).join(' ').replace(/\s+/g, ' ').trim();
      row.normalized = normalizeText(row.text);
    });

    return rows;
  }

  function detectStatementProfile(rows) {
    const sample = normalizeText(rows.slice(0, 220).map(row => row.text).join(' '));

    const hsbcHeader = rows.some(row =>
      /\bpost\s*date\b/i.test(row.text) &&
      /\btran\s*date\b/i.test(row.text) &&
      /\bdescrip/i.test(row.text) &&
      /\bamount/i.test(row.text)
    );

    if (
      (sample.includes('hsbc bank singapore') || sample.includes('hsbc visa') || sample.includes('hsbc mastercard')) &&
      hsbcHeader
    ) {
      return { type: 'hsbc-credit-card', label: 'HSBC credit-card parser' };
    }

    const scDepositHeader = rows.some(row =>
      /\bdate\b/i.test(row.text) &&
      /\bdescription\b/i.test(row.text) &&
      /\bdeposit\b/i.test(row.text) &&
      /\bwithdrawal\b/i.test(row.text) &&
      /\bbalance\b/i.test(row.text)
    );

    if (scDepositHeader && (sample.includes('standard chartered') || sample.includes('bonussaver') || sample.includes('xtrasaver'))) {
      return { type: 'sc-deposit', label: 'Standard Chartered savings/current parser' };
    }

    const scCardHeader = rows.some(row =>
      /\btransaction\s*date\b/i.test(row.text) &&
      /\bposting\s*date\b/i.test(row.text) &&
      /\bdescription\b/i.test(row.text) &&
      /\bamount/i.test(row.text)
    );

    if (scCardHeader && (sample.includes('standard chartered') || sample.includes('credit card and personal loan statement'))) {
      return { type: 'sc-credit-card', label: 'Standard Chartered credit-card parser' };
    }

    // Header-only recognition is useful when the bank logo is vector artwork and contributes no text layer.
    if (scDepositHeader) {
      return { type: 'sc-deposit', label: 'Deposit/withdrawal table parser' };
    }

    if (scCardHeader) {
      return { type: 'sc-credit-card', label: 'Transaction/posting-date card parser' };
    }

    if (hsbcHeader) {
      return { type: 'hsbc-credit-card', label: 'Post/tran-date card parser' };
    }

    return { type: 'generic', label: 'generic PDF parser' };
  }

  function parseHsbcCreditCard(rows, dateContext) {
    const transactions = [];
    let columns = null;
    let inTransactionTable = false;

    for (const row of rows) {
      if (isHsbcCardHeader(row)) {
        columns = getHsbcCardColumns(row);
        inTransactionTable = true;
        continue;
      }

      if (!inTransactionTable || !columns) continue;

      if (/^(your instalment plan|credit limit and interest rates|rewards summary|account summary)\b/i.test(row.text)) {
        inTransactionTable = false;
        continue;
      }

      if (isNonTransactionSummaryRow(row.text)) continue;

      const regions = buildColumnRegions(columns);
      const postText = regionText(row, regions.postDate);
      const tranText = regionText(row, regions.tranDate);
      const datesFromRow = extractDatesFromText(row.text, dateContext);

      const postingDate = parseDateFromText(postText, dateContext) || datesFromRow[0] || null;
      const transactionDate = parseDateFromText(tranText, dateContext) || datesFromRow[1] || datesFromRow[0] || null;
      if (!postingDate && !transactionDate) continue;

      const amountCandidate = moneyCandidateInRegion(row, regions.amount, { preferRightmost: true });
      if (!amountCandidate || amountCandidate.value <= 0) continue;
      if (isCreditCandidate(row, amountCandidate)) continue;

      const description = cleanCardDescription(regionText(row, regions.description));
      if (!description || isCreditDescription(description) || isNonExpenseDescription(description)) continue;

      transactions.push({
        id: makeId('stmt'),
        date: transactionDate || postingDate,
        postingDate: postingDate || undefined,
        description,
        amount: roundMoney(amountCandidate.value),
        source: 'pdf',
        bank: 'HSBC',
        parser: 'hsbc-credit-card',
        page: row.page
      });
    }

    return {
      transactions,
      detectedColumns: {
        debit: null,
        credit: null,
        balance: null,
        amount: columns?.amount ?? null
      }
    };
  }

  function parseStandardCharteredCreditCard(rows, dateContext) {
    const transactions = [];
    let columns = null;
    let inCardTable = false;

    for (const row of rows) {
      if (isScCardHeader(row)) {
        columns = getScCardColumns(row);
        inCardTable = true;
        continue;
      }

      if (!inCardTable || !columns) continue;

      if (/^(360|rewards points summary|cashback summary|instalment loan|installment loan)\b/i.test(row.text)) {
        inCardTable = false;
        continue;
      }

      if (isNonTransactionSummaryRow(row.text)) continue;

      const regions = buildColumnRegions(columns);
      const txnText = regionText(row, regions.transactionDate);
      const postingText = regionText(row, regions.postingDate);
      const datesFromRow = extractDatesFromText(row.text, dateContext);

      const transactionDate = parseDateFromText(txnText, dateContext) || datesFromRow[0] || null;
      const postingDate = parseDateFromText(postingText, dateContext) || datesFromRow[1] || null;
      if (!transactionDate && !postingDate) continue;

      const amountCandidate = moneyCandidateInRegion(row, regions.amount, { preferRightmost: true });
      if (!amountCandidate || amountCandidate.value <= 0) continue;
      if (isCreditCandidate(row, amountCandidate)) continue;

      const description = cleanCardDescription(regionText(row, regions.description));
      if (!description || isCreditDescription(description) || isNonExpenseDescription(description)) continue;

      transactions.push({
        id: makeId('stmt'),
        date: transactionDate || postingDate,
        postingDate: postingDate || undefined,
        description,
        amount: roundMoney(amountCandidate.value),
        source: 'pdf',
        bank: 'Standard Chartered',
        parser: 'sc-credit-card',
        page: row.page
      });
    }

    return {
      transactions,
      detectedColumns: {
        debit: null,
        credit: null,
        balance: null,
        amount: columns?.amount ?? null
      }
    };
  }

  function parseStandardCharteredDeposit(rows, dateContext) {
    const transactions = [];
    let columns = null;
    let inAccountTable = false;
    let currentTxn = null;

    for (const row of rows) {
      if (isScDepositHeader(row)) {
        columns = getScDepositColumns(row);
        inAccountTable = true;
        currentTxn = null;
        continue;
      }

      if (!inAccountTable || !columns) continue;

      if (/^(cashback summary|bonus interest summary|important note)\b/i.test(row.text)) {
        inAccountTable = false;
        currentTxn = null;
        continue;
      }

      const regions = buildColumnRegions(columns);
      const dateText = regionText(row, regions.date);
      const date = parseDateFromText(dateText, dateContext) || extractDatesFromText(row.text, dateContext)[0] || null;
      const descriptionRaw = regionText(row, regions.description);
      const description = cleanDepositDescription(descriptionRaw);

      const withdrawal = moneyCandidateInRegion(row, regions.withdrawal, { preferRightmost: true });
      const deposit = moneyCandidateInRegion(row, regions.deposit, { preferRightmost: true });

      if (date) {
        currentTxn = null;

        if (isNonTransactionSummaryRow(row.text) || /balance from previous statement|closing balance|opening balance/i.test(row.text)) {
          continue;
        }

        // A deposit is incoming money. Only import the withdrawal side into Expenses.
        if (!withdrawal || withdrawal.value <= 0) continue;

        // If a value somehow lands in both regions because the PDF text is badly positioned,
        // keep it only when the withdrawal match is clearly closer to the withdrawal column.
        if (deposit && Math.abs(deposit.x - columns.deposit) < Math.abs(withdrawal.x - columns.withdrawal) && deposit.raw === withdrawal.raw) {
          continue;
        }

        if (!description || isCreditDescription(description) || isNonExpenseDescription(description)) continue;

        currentTxn = {
          id: makeId('stmt'),
          date,
          description,
          amount: roundMoney(withdrawal.value),
          source: 'pdf',
          bank: 'Standard Chartered',
          parser: 'sc-deposit',
          page: row.page
        };
        transactions.push(currentTxn);
        continue;
      }

      // Some bank descriptions wrap onto the next visual row. Add only text from the description column,
      // never amounts/balances from continuation rows.
      if (currentTxn && description && !isLikelyHeaderOrFooter(description)) {
        currentTxn.description = `${currentTxn.description} ${description}`.replace(/\s+/g, ' ').trim().slice(0, 240);
      }
    }

    return {
      transactions,
      detectedColumns: {
        debit: columns?.withdrawal ?? null,
        credit: columns?.deposit ?? null,
        balance: columns?.balance ?? null,
        amount: null
      }
    };
  }

  function parseGenericStatement(rows, dateContext) {
    const columns = detectGenericColumns(rows);
    const regions = buildColumnRegions(columns);
    const transactions = [];
    let currentTxn = null;

    for (const row of rows) {
      if (isLikelyHeaderOrFooter(row.text) || isNonTransactionSummaryRow(row.text)) continue;

      const dates = extractDatesFromText(row.text, dateContext);
      const date = dates[0] || null;

      if (!date) {
        if (currentTxn) {
          const continuation = genericDescriptionText(row, regions);
          if (continuation && !extractMoneyCandidates(row).length) {
            currentTxn.description = `${currentTxn.description} ${continuation}`.replace(/\s+/g, ' ').trim().slice(0, 240);
          }
        }
        continue;
      }

      currentTxn = null;
      const candidates = extractMoneyCandidates(row);
      if (!candidates.length) continue;

      let chosen = null;

      if (regions.withdrawal) {
        chosen = moneyCandidateInRegion(row, regions.withdrawal, { preferRightmost: true });
      }

      if (!chosen && regions.debit) {
        chosen = moneyCandidateInRegion(row, regions.debit, { preferRightmost: true });
      }

      if (!chosen && regions.amount) {
        chosen = moneyCandidateInRegion(row, regions.amount, { preferRightmost: true });
      }

      if (!chosen && regions.balance) {
        const balanceStart = regions.balance.minX;
        const beforeBalance = candidates.filter(candidate => candidate.x < balanceStart);
        if (beforeBalance.length) chosen = beforeBalance[beforeBalance.length - 1];
      }

      if (!chosen) chosen = candidates[candidates.length - 1];
      if (!chosen || chosen.value <= 0 || isCreditCandidate(row, chosen)) continue;

      if (regions.credit && isCandidateInRegion(chosen, regions.credit)) continue;
      if (regions.deposit && isCandidateInRegion(chosen, regions.deposit)) continue;

      const description = genericDescriptionText(row, regions);
      if (!description || isCreditDescription(description) || isNonExpenseDescription(description)) continue;

      currentTxn = {
        id: makeId('stmt'),
        date,
        description,
        amount: roundMoney(chosen.value),
        source: 'pdf',
        parser: 'generic',
        page: row.page
      };
      transactions.push(currentTxn);
    }

    return { transactions, detectedColumns: columns };
  }

  function isHsbcCardHeader(row) {
    return /\bpost\s*date\b/i.test(row.text) &&
      /\btran\s*date\b/i.test(row.text) &&
      /\bdescrip/i.test(row.text) &&
      /\bamount/i.test(row.text);
  }

  function isScCardHeader(row) {
    return /\btransaction\s*date\b/i.test(row.text) &&
      /\bposting\s*date\b/i.test(row.text) &&
      /\bdescription\b/i.test(row.text) &&
      /\bamount/i.test(row.text);
  }

  function isScDepositHeader(row) {
    return /\bdate\b/i.test(row.text) &&
      /\bdescription\b/i.test(row.text) &&
      /\bdeposit\b/i.test(row.text) &&
      /\bwithdrawal\b/i.test(row.text) &&
      /\bbalance\b/i.test(row.text);
  }

  function getHsbcCardColumns(row) {
    const amountX = firstCellX(row, /\bamount\b/i);
    const accountSummaryCell = row.cells.find(cell =>
      Number.isFinite(amountX) &&
      cell.x > amountX &&
      /\baccount\s*summary\b|^account$/i.test(cell.text.trim())
    );

    return normalizeColumns({
      postDate: firstCellX(row, /\bpost\b/i),
      tranDate: firstCellX(row, /\btran\b/i),
      description: firstCellX(row, /descrip/i),
      amount: amountX,
      _tableEnd: accountSummaryCell?.x ?? null
    });
  }

  function getScCardColumns(row) {
    return normalizeColumns({
      transactionDate: firstCellX(row, /\btransaction\b/i),
      postingDate: firstCellX(row, /\bposting\b/i),
      description: firstCellX(row, /\bdescription\b/i),
      amount: firstCellX(row, /\bamount\b/i)
    });
  }

  function getScDepositColumns(row) {
    return normalizeColumns({
      date: firstCellX(row, /^date$/i) ?? row.cells[0]?.x ?? null,
      description: firstCellX(row, /\bdescription\b/i),
      deposit: firstCellX(row, /\bdeposit\b/i),
      withdrawal: firstCellX(row, /\bwithdrawal\b/i),
      balance: firstCellX(row, /\bbalance\b/i)
    });
  }

  function normalizeColumns(columns) {
    const entries = Object.entries(columns).filter(([key, value]) => !key.startsWith('_') && Number.isFinite(value));
    if (entries.length < 2) return columns;

    // If a multi-line header was split, a keyword can be missing. Estimate it only from neighbours
    // when the table order is unambiguous.
    const copy = { ...columns };
    const keys = Object.keys(copy).filter(key => !key.startsWith('_'));
    keys.forEach((key, index) => {
      if (Number.isFinite(copy[key])) return;
      const previous = keys.slice(0, index).reverse().find(candidate => Number.isFinite(copy[candidate]));
      const next = keys.slice(index + 1).find(candidate => Number.isFinite(copy[candidate]));
      if (previous && next) copy[key] = (copy[previous] + copy[next]) / 2;
    });
    return copy;
  }

  function firstCellX(row, pattern) {
    const cell = row.cells.find(item => pattern.test(item.text.trim()));
    return cell ? cell.x : null;
  }

  function buildColumnRegions(columns) {
    const entries = Object.entries(columns || {})
      .filter(([key, x]) => !key.startsWith('_') && Number.isFinite(x))
      .sort((a, b) => a[1] - b[1]);

    const regions = {};

    entries.forEach(([key, x], index) => {
      const prevX = index > 0 ? entries[index - 1][1] : null;
      const nextX = index < entries.length - 1 ? entries[index + 1][1] : null;

      regions[key] = {
        key,
        centerX: x,
        minX: prevX === null ? -Infinity : (prevX + x) / 2,
        maxX: nextX === null ? Infinity : (x + nextX) / 2
      };
    });

    // HSBC's sample statement places ACCOUNT SUMMARY beside the transaction table on the
    // same Y coordinates. Without a hard right edge, those summary values can be mistaken
    // for transaction amounts.
    if (Number.isFinite(columns?._tableEnd) && regions.amount) {
      regions.amount.maxX = Math.min(regions.amount.maxX, columns._tableEnd - 3);
    }

    return regions;
  }

  function regionText(row, region) {
    if (!region) return '';
    return row.cells
      .filter(cell => cell.x >= region.minX && cell.x < region.maxX)
      .map(cell => cell.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isCandidateInRegion(candidate, region) {
    return !!region && candidate.x >= region.minX && candidate.x < region.maxX;
  }

  function moneyCandidateInRegion(row, region, { preferRightmost = false } = {}) {
    if (!region) return null;
    const candidates = extractMoneyCandidates(row).filter(candidate => isCandidateInRegion(candidate, region));
    if (!candidates.length) return null;

    if (preferRightmost) {
      return [...candidates].sort((a, b) => b.x - a.x)[0];
    }

    return [...candidates].sort((a, b) => Math.abs(a.x - region.centerX) - Math.abs(b.x - region.centerX))[0];
  }

  function extractMoneyCandidates(row) {
    const candidates = [];
    const amountRegex = /(?:S\$|SGD|\$)?\s*\(?-?\d+(?:,\d{3})*(?:\.\d{2})\)?\s*(?:DR|CR)?/gi;

    row.cells.forEach((cell, cellIndex) => {
      const matches = [...cell.text.matchAll(amountRegex)];
      matches.forEach(match => {
        const raw = match[0].trim();
        const value = parseAmount(raw);
        if (!Number.isFinite(value) || value <= 0 || value >= 100000000) return;

        const inlineCredit = /\bCR\b/i.test(raw);
        const inlineDebit = /\bDR\b/i.test(raw);
        const nearbySuffix = row.cells.find((other, index) =>
          index !== cellIndex &&
          other.x >= cell.x &&
          other.x - cell.x < 80 &&
          /^(CR|DR)$/i.test(other.text.trim())
        );

        candidates.push({
          x: cell.x,
          raw,
          value: Math.abs(value),
          isCredit: inlineCredit || /^CR$/i.test(nearbySuffix?.text || ''),
          isDebit: inlineDebit || /^DR$/i.test(nearbySuffix?.text || '')
        });
      });
    });

    return candidates.sort((a, b) => a.x - b.x);
  }

  function parseAmount(raw) {
    const cleaned = String(raw)
      .replace(/S\$|SGD|\$/gi, '')
      .replace(/DR|CR/gi, '')
      .replace(/[()\s]/g, '')
      .replace(/,/g, '');
    return Number(cleaned);
  }

  function isCreditCandidate(row, candidate) {
    if (!candidate) return false;
    if (candidate.isCredit && !candidate.isDebit) return true;

    const suffixCells = row.cells.filter(cell =>
      cell.x >= candidate.x &&
      cell.x - candidate.x < 90 &&
      /^CR$/i.test(cell.text.trim())
    );
    return suffixCells.length > 0;
  }

  function cleanCardDescription(text) {
    return String(text || '')
      .replace(/\bTransaction\s+Ref(?:erence)?\s*[:#]?\s*[A-Za-z0-9-]+\b/gi, ' ')
      .replace(/\b(?:CR|DR)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[|:;\-–—\s]+|[|:;\-–—\s]+$/g, '')
      .trim()
      .slice(0, 240);
  }

  function cleanDepositDescription(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/^[|:;\-–—\s]+|[|:;\-–—\s]+$/g, '')
      .trim()
      .slice(0, 240);
  }

  function genericDescriptionText(row, regions) {
    if (regions.description) {
      return cleanCardDescription(regionText(row, regions.description));
    }

    let text = row.text;
    extractDatesFromText(row.text, buildDateContext([row])).forEach(date => {
      const d = new Date(`${date}T00:00:00`);
      const day = d.getDate();
      const month = d.toLocaleDateString('en-US', { month: 'short' });
      text = text.replace(new RegExp(`\\b0?${day}\\s+${month}\\b`, 'ig'), ' ');
    });

    extractMoneyCandidates(row).forEach(candidate => {
      text = text.replace(candidate.raw, ' ');
    });

    return cleanCardDescription(text)
      .replace(/\b(debit|credit|balance|withdrawal|deposit|transaction amount|amount)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  function isCreditDescription(description) {
    return /\b(payment\s*-\s*thank\s*you|payment thank you|payment received|cashback|refund|reversal|interest credit|salary credit|credit interest)\b/i.test(description);
  }

  function isNonExpenseDescription(description) {
    return /\b(previous statement balance|balance from previous statement|opening balance|closing balance|new balance|minimum payment due|total due)\b/i.test(description);
  }

  function isNonTransactionSummaryRow(text) {
    return /\b(previous statement balance|balance from previous statement|opening balance|closing balance|new balance|minimum payment due|total due|payments?\s*&\s*credits|purchases?\s*&\s*debits|approved credit limit|available credit limit|points earned|total points|cashback summary)\b/i.test(String(text));
  }

  function detectGenericColumns(rows) {
    const result = emptyColumns();

    for (const row of rows.slice(0, 220)) {
      for (const cell of row.cells) {
        const text = normalizeText(cell.text);

        if (result.withdrawal === null && /\bwithdrawal\b/.test(text)) result.withdrawal = cell.x;
        if (result.deposit === null && /\bdeposit\b/.test(text)) result.deposit = cell.x;
        if (result.debit === null && /\bdebit\b/.test(text)) result.debit = cell.x;
        if (result.credit === null && /\bcredit\b/.test(text)) result.credit = cell.x;
        if (result.balance === null && /\bbalance\b/.test(text)) result.balance = cell.x;
        if (result.amount === null && /\bamount\b/.test(text)) result.amount = cell.x;
        if (result.description === null && /\bdescription\b/.test(text)) result.description = cell.x;
      }
    }

    return result;
  }

  function emptyColumns() {
    return {
      date: null,
      description: null,
      debit: null,
      credit: null,
      withdrawal: null,
      deposit: null,
      balance: null,
      amount: null
    };
  }

  function buildDateContext(rows) {
    const text = rows.map(row => row.text).join('\n');
    const years = new Map();

    for (const match of text.matchAll(/\b20\d{2}\b/g)) {
      years.set(match[0], (years.get(match[0]) || 0) + 1);
    }

    const defaultYear = years.size
      ? Number([...years.entries()].sort((a, b) => b[1] - a[1])[0][0])
      : new Date().getFullYear();

    let statementStart = null;
    let statementEnd = null;

    const periodMatch = text.match(new RegExp(
      `statement\\s+period[^\\n]*?(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(20\\d{2})\\s+(?:to|-)\\s+(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(20\\d{2})`,
      'i'
    ));

    if (periodMatch) {
      statementStart = toIsoDate(Number(periodMatch[3]), monthNames[periodMatch[2].toLowerCase()], Number(periodMatch[1]));
      statementEnd = toIsoDate(Number(periodMatch[6]), monthNames[periodMatch[5].toLowerCase()], Number(periodMatch[4]));
    }

    if (!statementEnd) {
      const statementDateMatch = text.match(new RegExp(
        `statement\\s+date[^\\n\\d]*(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(20\\d{2})`,
        'i'
      ));
      if (statementDateMatch) {
        statementEnd = toIsoDate(
          Number(statementDateMatch[3]),
          monthNames[statementDateMatch[2].toLowerCase()],
          Number(statementDateMatch[1])
        );
      }
    }

    return { defaultYear, statementStart, statementEnd };
  }

  function extractDatesFromText(text, context) {
    const found = [];
    const occupied = [];

    const patterns = [
      {
        regex: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g,
        parse: match => ({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) })
      },
      {
        regex: /\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/g,
        parse: match => ({
          year: match[3] ? normalizeYear(Number(match[3])) : null,
          month: Number(match[2]),
          day: Number(match[1])
        })
      },
      {
        regex: new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_PATTERN})(?:\\s+(\\d{2,4}))?\\b`, 'gi'),
        parse: match => ({
          year: match[3] ? normalizeYear(Number(match[3])) : null,
          month: monthNames[match[2].toLowerCase()],
          day: Number(match[1])
        })
      },
      {
        regex: new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:,?\\s+(\\d{2,4}))?\\b`, 'gi'),
        parse: match => ({
          year: match[3] ? normalizeYear(Number(match[3])) : null,
          month: monthNames[match[1].toLowerCase()],
          day: Number(match[2])
        })
      }
    ];

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      for (const match of text.matchAll(pattern.regex)) {
        const start = match.index;
        const end = start + match[0].length;
        if (occupied.some(range => start < range.end && end > range.start)) continue;

        const parts = pattern.parse(match);
        const iso = resolveDateParts(parts, context);
        if (!iso) continue;

        found.push({ index: start, iso });
        occupied.push({ start, end });
      }
    }

    return found
      .sort((a, b) => a.index - b.index)
      .map(item => item.iso);
  }

  function parseDateFromText(text, context) {
    return extractDatesFromText(String(text || ''), context)[0] || null;
  }

  function resolveDateParts(parts, context) {
    if (!parts.day || !parts.month) return null;

    if (parts.year) {
      return toIsoDate(parts.year, parts.month, parts.day);
    }

    const baseYear = context?.defaultYear || new Date().getFullYear();
    const candidateYears = [baseYear, baseYear - 1, baseYear + 1];
    const valid = candidateYears
      .map(year => toIsoDate(year, parts.month, parts.day))
      .filter(Boolean);

    if (!valid.length) return null;

    if (context?.statementStart || context?.statementEnd) {
      const startMs = context.statementStart ? new Date(`${context.statementStart}T00:00:00Z`).getTime() : null;
      const endMs = context.statementEnd ? new Date(`${context.statementEnd}T00:00:00Z`).getTime() : null;

      const scored = valid.map(iso => {
        const ms = new Date(`${iso}T00:00:00Z`).getTime();
        let score = 0;

        if (startMs !== null && ms < startMs) score += (startMs - ms) / 86400000;
        if (endMs !== null && ms > endMs) score += (ms - endMs) / 86400000;
        if (startMs !== null && endMs !== null && ms >= startMs && ms <= endMs) score -= 1000;
        if (endMs !== null) score += Math.abs(endMs - ms) / 86400000 * 0.01;

        return { iso, score };
      });

      return scored.sort((a, b) => a.score - b.score)[0].iso;
    }

    return valid[0];
  }

  function normalizeYear(year) {
    if (year < 100) return year + 2000;
    return year;
  }

  function toIsoDate(year, month, day) {
    if (!year || !month || !day) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}$]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isLikelyHeaderOrFooter(text) {
    return /^(page\s+\d+|date\s+description|transaction date|posting date|post date|tran date|statement period|opening balance|closing balance|total\b|continued\b)/i.test(String(text).trim());
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
      total: roundMoney(transactions.reduce((sum, txn) => sum + txn.amount, 0)),
      parser: pendingStatementImport.parserType || 'generic'
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
    return new Date(value).toLocaleString('en-SG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
