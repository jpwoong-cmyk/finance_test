(() => {
  'use strict';

  const LEDGER_KEY = 'neon-finance-ledger-v1';
  const $ = selector => document.querySelector(selector);

  let chartData = [];
  let hoverIndex = -1;
  let chartResizeObserver = null;
  let refreshRaf = 0;

  function money(value) {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
      minimumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function compactMoney(value) {
    const abs = Math.abs(Number(value) || 0);
    const sign = Number(value) < 0 ? '−' : '';
    if (abs >= 1000000) return `${sign}S$${(abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}M`;
    if (abs >= 1000) return `${sign}S$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
    return `${sign}S$${Math.round(abs)}`;
  }

  function readLedger() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('NeonMonthlyPerformance: ledger could not be read.', error);
      return [];
    }
  }

  function getMonthSeries(count = 12) {
    const now = new Date();
    const months = [];

    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      months.push({
        key: `${year}-${String(month).padStart(2, '0')}`,
        year,
        month,
        short: date.toLocaleDateString('en-SG', { month: 'short' }),
        full: date.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' }),
        savings: 0,
        spending: 0
      });
    }

    const byKey = new Map(months.map(item => [item.key, item]));
    const nonSpendingCategories = new Set([
      'Savings Transfer',
      'Transfer In',
      'Card Payment',
      'Investment'
    ]);

    readLedger().forEach(record => {
      const monthKey = String(record?.transactionDate || '').slice(0, 7);
      const month = byKey.get(monthKey);
      if (!month) return;

      const delta = Number(record.delta);
      if (!Number.isFinite(delta) || delta === 0) return;

      // Savings line = net movement into/out of Savings accounts.
      if (record.section === 'savings') {
        month.savings += delta;
      }

      // Spending rule:
      // 1) Positive movement on an Expenses account = newly recorded spending/outstanding cost.
      // 2) Negative movement from Current/Savings with no linked transfer = direct spending.
      // Linked transfers/card payments are deliberately excluded to prevent double counting.
      if (record.section === 'expenses' && delta > 0) {
        month.spending += delta;
        return;
      }

      const isAssetOutflow =
        (record.section === 'current' || record.section === 'savings') &&
        delta < 0;

      const isLinked = Boolean(record.transferId);
      const category = String(record.category || 'Unknown');

      if (isAssetOutflow && !isLinked && !nonSpendingCategories.has(category)) {
        month.spending += Math.abs(delta);
      }
    });

    return months.map(item => ({
      ...item,
      savings: roundMoney(item.savings),
      spending: roundMoney(item.spending)
    }));
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function injectStyles() {
    if ($('#monthlyPerformanceStyles')) return;

    const style = document.createElement('style');
    style.id = 'monthlyPerformanceStyles';
    style.textContent = `
      .monthly-performance-section {
        margin: 0 0 26px;
      }

      .monthly-performance-panel {
        overflow: visible;
        background:
          radial-gradient(circle at 18% 18%, rgba(0,255,168,.055), transparent 27%),
          radial-gradient(circle at 82% 24%, rgba(255,47,109,.05), transparent 28%),
          linear-gradient(180deg, rgba(9,13,29,.97), rgba(4,7,18,.97));
      }

      .monthly-performance-head {
        align-items: start;
        margin-bottom: 8px;
      }

      .monthly-performance-head-copy {
        display: grid;
        gap: 4px;
      }

      .monthly-performance-subcopy {
        color: var(--muted);
        font-size: .76rem;
        line-height: 1.5;
      }

      .monthly-range-pill {
        flex: 0 0 auto;
        padding: 6px 9px;
        color: #9befff;
        border: 1px solid rgba(0,234,255,.32);
        background: rgba(0,234,255,.035);
        font-size: .62rem;
        font-weight: 900;
        letter-spacing: .13em;
      }

      .monthly-performance-kpis {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1px;
        margin: 18px 0 8px;
        border: 1px solid rgba(133,153,214,.12);
        background: rgba(133,153,214,.12);
      }

      .monthly-kpi {
        min-width: 0;
        padding: 13px 15px;
        background: rgba(3,6,17,.96);
      }

      .monthly-kpi > span {
        display: block;
        color: var(--muted);
        font-size: .64rem;
        font-weight: 800;
        letter-spacing: .1em;
        text-transform: uppercase;
      }

      .monthly-kpi > strong {
        display: block;
        margin-top: 5px;
        font-size: 1.15rem;
        font-variant-numeric: tabular-nums;
      }

      .monthly-kpi.savings > strong {
        color: var(--savings);
        text-shadow: 0 0 15px rgba(var(--savings-rgb), .28);
      }

      .monthly-kpi.spending > strong {
        color: var(--expense);
        text-shadow: 0 0 15px rgba(var(--expense-rgb), .28);
      }

      .monthly-kpi small {
        display: block;
        margin-top: 4px;
        color: #6f7b98;
        font-size: .68rem;
      }

      .monthly-kpi small.up { color: #aab6cf; }
      .monthly-kpi small.down { color: #aab6cf; }

      .monthly-chart-shell {
        position: relative;
        min-height: 360px;
        margin-top: 4px;
      }

      #monthlyPerformanceCanvas {
        width: 100%;
        height: 360px;
        display: block;
        touch-action: none;
      }

      .monthly-chart-tooltip {
        position: absolute;
        z-index: 4;
        min-width: 170px;
        padding: 10px 11px;
        pointer-events: none;
        transform: translate(-50%, calc(-100% - 12px));
        border: 1px solid rgba(0,234,255,.25);
        background: rgba(3,7,18,.97);
        box-shadow: 0 14px 40px rgba(0,0,0,.46), 0 0 20px rgba(0,234,255,.07);
      }

      .monthly-chart-tooltip[hidden] { display: none; }

      .monthly-chart-tooltip > strong {
        display: block;
        margin-bottom: 7px;
        font-size: .75rem;
      }

      .monthly-tip-row {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        padding: 2px 0;
        font-size: .7rem;
      }

      .monthly-tip-row span { color: var(--muted); }
      .monthly-tip-row.savings b { color: var(--savings); }
      .monthly-tip-row.spending b { color: var(--expense); }

      .monthly-performance-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        align-items: center;
        justify-content: center;
        margin-top: 5px;
        color: var(--muted);
        font-size: .75rem;
      }

      .monthly-performance-legend > span {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .monthly-line-key {
        width: 22px;
        height: 2px;
        background: currentColor;
        box-shadow: 0 0 9px currentColor;
      }

      .monthly-performance-legend .savings-key { color: var(--savings); }
      .monthly-performance-legend .spending-key { color: var(--expense); }

      .monthly-ledger-note {
        margin-top: 12px;
        text-align: center;
        color: #697590;
        font-size: .67rem;
        line-height: 1.5;
      }

      @media (max-width: 720px) {
        .monthly-performance-kpis { grid-template-columns: 1fr; }
        .monthly-chart-shell { min-height: 315px; }
        #monthlyPerformanceCanvas { height: 315px; }
        .monthly-performance-head { gap: 12px; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectChartPanel() {
    if ($('#monthlyPerformancePanel')) return;

    const accountsSection = $('.accounts-section');
    if (!accountsSection) return;

    const section = document.createElement('section');
    section.className = 'monthly-performance-section';
    section.innerHTML = `
      <article id="monthlyPerformancePanel" class="panel monthly-performance-panel">
        <div class="panel-heading monthly-performance-head">
          <div class="monthly-performance-head-copy">
            <div>
              <p class="eyebrow">MONTHLY PERFORMANCE</p>
              <h2>Savings & Spending Trend</h2>
            </div>
            <p class="monthly-performance-subcopy">
              Twelve-month view of net savings movements and actual spending recorded through the ledger.
            </p>
          </div>
          <span class="monthly-range-pill">12 MONTHS</span>
        </div>

        <div class="monthly-performance-kpis">
          <div class="monthly-kpi savings">
            <span>Net saved this month</span>
            <strong id="monthlySavedValue">S$0.00</strong>
            <small id="monthlySavedDelta">No previous-month comparison yet</small>
          </div>
          <div class="monthly-kpi spending">
            <span>Spent this month</span>
            <strong id="monthlySpentValue">S$0.00</strong>
            <small id="monthlySpentDelta">No previous-month comparison yet</small>
          </div>
        </div>

        <div id="monthlyChartShell" class="monthly-chart-shell">
          <canvas id="monthlyPerformanceCanvas" aria-label="Monthly savings and spending line chart"></canvas>
          <div id="monthlyChartTooltip" class="monthly-chart-tooltip" hidden></div>
        </div>

        <div class="monthly-performance-legend">
          <span class="savings-key"><i class="monthly-line-key"></i>Net savings</span>
          <span class="spending-key"><i class="monthly-line-key"></i>Spending</span>
        </div>

        <p class="monthly-ledger-note">
          Historical months populate from dated Balance Trace ledger movements. Backdated entries are placed into their selected month automatically.
        </p>
      </article>
    `;

    accountsSection.parentNode.insertBefore(section, accountsSection);

    const canvas = $('#monthlyPerformanceCanvas');
    canvas?.addEventListener('pointermove', handlePointerMove);
    canvas?.addEventListener('pointerleave', () => {
      hoverIndex = -1;
      $('#monthlyChartTooltip').hidden = true;
      drawChart();
    });

    if ('ResizeObserver' in window) {
      chartResizeObserver = new ResizeObserver(() => drawChart());
      chartResizeObserver.observe($('#monthlyChartShell'));
    } else {
      window.addEventListener('resize', drawChart);
    }
  }

  function enforceProfessionalLabels() {
    const chartPanel = $('#pieCanvas')?.closest('.chart-panel');
    if (chartPanel) {
      const eyebrow = chartPanel.querySelector('.panel-heading .eyebrow');
      const title = chartPanel.querySelector('.panel-heading h2');
      if (eyebrow && eyebrow.textContent !== 'FINANCIAL POSITION') eyebrow.textContent = 'FINANCIAL POSITION';
      if (title && title.textContent !== 'Current Distribution') title.textContent = 'Current Distribution';
    }

    const expenseSummary = $('#expenseValue')?.closest('.summary-panel');
    const summaryLabel = expenseSummary?.querySelector('.summary-topline > span:first-child');
    if (summaryLabel && summaryLabel.textContent !== 'Expenses') summaryLabel.textContent = 'Expenses';

    const expensePanel = $('#expensesList')?.closest('.account-panel');
    if (expensePanel) {
      const heading = expensePanel.querySelector('.account-heading h2');
      const kicker = expensePanel.querySelector('.account-kicker');
      if (heading && heading.textContent !== 'Expenses') heading.textContent = 'Expenses';
      if (kicker && kicker.textContent !== 'OUTFLOW') kicker.textContent = 'OUTFLOW';
    }

    const legendExpense = $('.legend-expense');
    if (legendExpense) {
      const dot = legendExpense.querySelector('.legend-dot');
      const labelText = [...legendExpense.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.nodeValue)
        .join('')
        .trim();

      if (labelText !== 'Expenses') {
        legendExpense.innerHTML = '<span class="legend-dot"></span>Expenses';
      }
    }

    const sectionCopy = $('.accounts-section .section-heading > p');
    if (sectionCopy) {
      const desired = 'Open any account to record movements, reconcile balances, or link transfers between accounts.';
      if (sectionCopy.textContent !== desired) sectionCopy.textContent = desired;
    }

    const headerCopy = $('.header-copy');
    if (headerCopy) {
      const desired = 'Track current cash, savings, expenses and monthly movement in one local ledger.';
      if (headerCopy.textContent !== desired) headerCopy.textContent = desired;
    }

    // ledger-tools.js still uses the legacy phrase "Credit Cards" internally.
    // Keep the storage/model key unchanged, but make the visible UI consistently say Expenses.
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest('script, style')) return NodeFilter.FILTER_REJECT;
          return node.nodeValue.includes('Credit Cards')
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      node.nodeValue = node.nodeValue.replaceAll('Credit Cards', 'Expenses');
    });
  }

  function updateKpis() {
    if (!chartData.length) return;

    const current = chartData[chartData.length - 1];
    const previous = chartData[chartData.length - 2];

    $('#monthlySavedValue').textContent = money(current.savings);
    $('#monthlySpentValue').textContent = money(current.spending);

    setDeltaCopy($('#monthlySavedDelta'), current.savings, previous?.savings, 'saved');
    setDeltaCopy($('#monthlySpentDelta'), current.spending, previous?.spending, 'spent');
  }

  function setDeltaCopy(element, current, previous, verb) {
    if (!element) return;
    if (previous === undefined || previous === null) {
      element.textContent = 'No previous-month comparison yet';
      element.className = '';
      return;
    }

    const change = roundMoney(current - previous);
    if (Math.abs(change) < 0.005) {
      element.textContent = `No change vs last month`;
      element.className = '';
      return;
    }

    const direction = change > 0 ? '↑' : '↓';
    element.textContent = `${direction} ${money(Math.abs(change))} vs last month`;
    element.className = change > 0 ? 'up' : 'down';
  }

  function refresh() {
    chartData = getMonthSeries(12);
    enforceProfessionalLabels();
    updateKpis();
    drawChart();
  }

  function scheduleRefresh() {
    cancelAnimationFrame(refreshRaf);
    refreshRaf = requestAnimationFrame(refresh);
  }

  function drawChart() {
    const canvas = $('#monthlyPerformanceCanvas');
    const shell = $('#monthlyChartShell');
    if (!canvas || !shell || !chartData.length) return;

    const width = Math.max(300, shell.clientWidth);
    const height = window.innerWidth <= 720 ? 315 : 360;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const root = getComputedStyle(document.documentElement);
    const savingsColor = root.getPropertyValue('--savings').trim() || '#00ffa8';
    const expenseColor = root.getPropertyValue('--expense').trim() || '#ff2f6d';

    const pad = {
      left: width <= 520 ? 54 : 68,
      right: width <= 520 ? 18 : 28,
      top: 30,
      bottom: 46
    };

    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const allValues = chartData.flatMap(item => [item.savings, item.spending]);

    let minValue = Math.min(0, ...allValues);
    let maxValue = Math.max(0, ...allValues);

    if (minValue === maxValue) {
      maxValue = maxValue === 0 ? 100 : maxValue * 1.2;
      minValue = minValue === 0 ? 0 : minValue * 1.2;
    }

    const range = maxValue - minValue || 1;
    const topPad = range * 0.12;
    const bottomPad = minValue < 0 ? range * 0.08 : 0;

    maxValue += topPad;
    minValue -= bottomPad;

    const yFor = value =>
      pad.top + ((maxValue - value) / (maxValue - minValue || 1)) * plotHeight;

    const xFor = index => {
      if (chartData.length === 1) return pad.left + plotWidth / 2;
      return pad.left + (index / (chartData.length - 1)) * plotWidth;
    };

    // Horizontal grid + values.
    ctx.save();
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i += 1) {
      const ratio = i / gridLines;
      const value = maxValue - ratio * (maxValue - minValue);
      const y = pad.top + ratio * plotHeight;

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(133,153,214,.11)';
      ctx.lineWidth = 1;
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(133,153,214,.62)';
      ctx.fillText(compactMoney(value), pad.left - 10, y);
    }

    // Zero reference line when negative savings exist.
    if (minValue < 0 && maxValue > 0) {
      const zeroY = yFor(0);
      ctx.beginPath();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(width - pad.right, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // X labels.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const mobile = width < 620;

    chartData.forEach((item, index) => {
      if (mobile && index % 2 !== 0 && index !== chartData.length - 1) return;

      let label = item.short;
      if (index === 0 || item.month === 1) label += ` '${String(item.year).slice(-2)}`;

      ctx.fillStyle = 'rgba(133,153,214,.72)';
      ctx.fillText(label, xFor(index), height - pad.bottom + 15);
    });
    ctx.restore();

    drawSeries(ctx, chartData.map(item => item.savings), savingsColor, xFor, yFor, plotHeight, pad, 'savings');
    drawSeries(ctx, chartData.map(item => item.spending), expenseColor, xFor, yFor, plotHeight, pad, 'spending');

    if (hoverIndex >= 0 && hoverIndex < chartData.length) {
      const x = xFor(hoverIndex);

      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(220,235,255,.2)';
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, height - pad.bottom);
      ctx.stroke();
      ctx.restore();

      drawHoverPoint(ctx, x, yFor(chartData[hoverIndex].savings), savingsColor);
      drawHoverPoint(ctx, x, yFor(chartData[hoverIndex].spending), expenseColor);
    }

    canvas._monthlyChartGeometry = { pad, plotWidth, xFor, yFor, width, height };
  }

  function drawSeries(ctx, values, color, xFor, yFor, plotHeight, pad, name) {
    if (!values.length) return;

    const points = values.map((value, index) => ({
      x: xFor(index),
      y: yFor(value),
      value
    }));

    // Restrained area tint.
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotHeight);
    gradient.addColorStop(0, hexToRgba(color, .12));
    gradient.addColorStop(1, hexToRgba(color, 0));

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, pad.top + plotHeight);
    ctx.lineTo(points[0].x, pad.top + plotHeight);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();

    points.forEach(point => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#050815';
      ctx.fill();
      ctx.lineWidth = 1.7;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawHoverPoint(ctx, x, y, color) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 5.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#06101a';
    ctx.fill();
    ctx.restore();
  }

  function hexToRgba(color, alpha) {
    const hex = String(color).trim();
    const match = hex.match(/^#([0-9a-f]{6})$/i);
    if (!match) return `rgba(255,255,255,${alpha})`;

    const value = Number.parseInt(match[1], 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function handlePointerMove(event) {
    const canvas = $('#monthlyPerformanceCanvas');
    const shell = $('#monthlyChartShell');
    const geometry = canvas?._monthlyChartGeometry;
    if (!canvas || !shell || !geometry || !chartData.length) return;

    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const { pad, plotWidth } = geometry;

    const clamped = Math.max(pad.left, Math.min(pad.left + plotWidth, localX));
    const ratio = plotWidth > 0 ? (clamped - pad.left) / plotWidth : 0;
    const index = Math.max(0, Math.min(
      chartData.length - 1,
      Math.round(ratio * (chartData.length - 1))
    ));

    if (hoverIndex !== index) {
      hoverIndex = index;
      drawChart();
    }

    const tooltip = $('#monthlyChartTooltip');
    const item = chartData[index];
    const pointX = geometry.xFor(index);

    tooltip.innerHTML = `
      <strong>${item.full}</strong>
      <div class="monthly-tip-row savings">
        <span>Net savings</span>
        <b>${money(item.savings)}</b>
      </div>
      <div class="monthly-tip-row spending">
        <span>Spent</span>
        <b>${money(item.spending)}</b>
      </div>
    `;

    tooltip.hidden = false;
    const maxX = shell.clientWidth - 90;
    const minX = 90;
    tooltip.style.left = `${Math.max(minX, Math.min(maxX, pointX))}px`;

    const y = Math.min(
      geometry.yFor(item.savings),
      geometry.yFor(item.spending)
    );
    tooltip.style.top = `${Math.max(76, y)}px`;
  }

  function setupObservers() {
    const bodyObserver = new MutationObserver(() => {
      scheduleRefresh();
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.addEventListener('storage', event => {
      if (event.key === LEDGER_KEY) scheduleRefresh();
    });
  }

  function init() {
    injectStyles();
    injectChartPanel();
    enforceProfessionalLabels();
    setupObservers();
    refresh();

    console.info('Neon Finance monthly performance UI loaded.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
