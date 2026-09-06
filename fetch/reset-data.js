(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);

  const KNOWN_KEYS = [
    'neon-finance-state-v4',
    'neon-finance-state-v3',
    'neon-finance-ledger-v1'
  ];

  function financeKeys() {
    const keys = new Set(KNOWN_KEYS);

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('neon-finance-')) keys.add(key);
    }

    return [...keys];
  }

  function injectStyles() {
    if ($('#neonResetStyles')) return;

    const style = document.createElement('style');
    style.id = 'neonResetStyles';
    style.textContent = `
      .reset-data-btn {
        min-height: 34px;
        padding: 0 12px;
        border: 1px solid rgba(255, 47, 109, .28);
        background: rgba(255, 47, 109, .025);
        color: #ff8bad;
        font-size: .68rem;
        font-weight: 850;
        letter-spacing: .08em;
        transition: 170ms ease;
      }

      .reset-data-btn:hover,
      .reset-data-btn:focus-visible {
        color: #ffd7e3;
        border-color: rgba(255, 47, 109, .72);
        background: rgba(255, 47, 109, .075);
        box-shadow:
          0 0 18px rgba(255, 47, 109, .14),
          inset 0 0 14px rgba(255, 47, 109, .04);
        outline: none;
      }

      .reset-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 140;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(1, 2, 8, .82);
        backdrop-filter: blur(9px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 180ms ease;
      }

      .reset-modal-backdrop.open {
        opacity: 1;
        pointer-events: auto;
      }

      .reset-modal {
        width: min(520px, 100%);
        border: 1px solid rgba(255, 47, 109, .42);
        background:
          radial-gradient(circle at 82% 8%, rgba(255, 47, 109, .10), transparent 30%),
          linear-gradient(180deg, rgba(10, 12, 25, .995), rgba(3, 5, 13, .995));
        box-shadow:
          0 0 45px rgba(255, 47, 109, .10),
          0 34px 90px rgba(0, 0, 0, .64);
        padding: 24px;
      }

      .reset-modal-kicker {
        color: #ff6f9c;
        font-size: .62rem;
        font-weight: 900;
        letter-spacing: .18em;
        text-transform: uppercase;
      }

      .reset-modal h2 {
        margin: 6px 0 0;
        font-size: 1.45rem;
      }

      .reset-modal-copy {
        margin: 14px 0 0;
        color: #8a96b3;
        font-size: .8rem;
        line-height: 1.6;
      }

      .reset-data-list {
        display: grid;
        gap: 7px;
        margin: 18px 0;
        padding: 14px;
        border: 1px solid rgba(255, 47, 109, .14);
        background: rgba(255, 47, 109, .025);
        color: #cbd5ea;
        font-size: .74rem;
      }

      .reset-data-list span::before {
        content: "×";
        margin-right: 8px;
        color: #ff5f91;
        font-weight: 900;
      }

      .reset-warning {
        color: #ffb6ca;
        font-size: .72rem;
        line-height: 1.5;
      }

      .reset-modal-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
        margin-top: 20px;
      }

      .reset-modal-actions button {
        min-height: 42px;
        font-weight: 900;
      }

      .reset-cancel {
        border: 1px solid rgba(133, 153, 214, .22);
        background: rgba(255,255,255,.025);
        color: #cdd8ee;
      }

      .reset-confirm {
        border: 1px solid rgba(255, 47, 109, .65);
        background: linear-gradient(90deg, #ff2f6d, #ff6b4a);
        color: #160108;
        box-shadow: 0 0 24px rgba(255, 47, 109, .18);
      }

      @media (max-width: 520px) {
        .reset-modal { padding: 19px; }
        .reset-modal-actions { grid-template-columns: 1fr; }
      }
    `;

    document.head.appendChild(style);
  }

  function injectModal() {
    if ($('#resetFinanceBackdrop')) return;

    const backdrop = document.createElement('div');
    backdrop.id = 'resetFinanceBackdrop';
    backdrop.className = 'reset-modal-backdrop';
    backdrop.innerHTML = `
      <div
        class="reset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resetFinanceTitle"
      >
        <span class="reset-modal-kicker">Danger zone</span>
        <h2 id="resetFinanceTitle">Reset Neon Finance?</h2>

        <p class="reset-modal-copy">
          This returns the app to a completely fresh state in this browser.
          Your exported backup files on your device are not affected.
        </p>

        <div class="reset-data-list">
          <span>Accounts and balances</span>
          <span>Expenses, Savings and Current variables</span>
          <span>Transaction and activity history</span>
          <span>Balance Trace ledger movements</span>
          <span>Categories, linked movements and reconciliation data</span>
          <span>Monthly snapshots and imported-statement metadata</span>
        </div>

        <p class="reset-warning">
          This cannot be undone unless you exported a backup beforehand.
        </p>

        <div class="reset-modal-actions">
          <button id="cancelFinanceReset" class="reset-cancel" type="button">Cancel</button>
          <button id="confirmFinanceReset" class="reset-confirm" type="button">Reset everything</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    $('#cancelFinanceReset').addEventListener('click', closeResetModal);
    $('#confirmFinanceReset').addEventListener('click', resetFinanceData);

    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeResetModal();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && backdrop.classList.contains('open')) {
        closeResetModal();
      }
    });
  }

  function injectButton() {
    if ($('#resetFinanceData')) return;

    const toolbar = $('.privacy-toolbar');
    if (!toolbar) return;

    const button = document.createElement('button');
    button.id = 'resetFinanceData';
    button.className = 'reset-data-btn';
    button.type = 'button';
    button.textContent = 'Reset Data';
    button.title = 'Erase Neon Finance data stored in this browser';

    toolbar.appendChild(button);
    button.addEventListener('click', openResetModal);
  }

  function openResetModal() {
    const backdrop = $('#resetFinanceBackdrop');
    if (!backdrop) return;

    backdrop.classList.add('open');
    requestAnimationFrame(() => $('#cancelFinanceReset')?.focus());
  }

  function closeResetModal() {
    $('#resetFinanceBackdrop')?.classList.remove('open');
    $('#resetFinanceData')?.focus();
  }

  function resetFinanceData() {
    const keys = financeKeys();

    keys.forEach(key => localStorage.removeItem(key));

    // Clear session-only finance keys too if future features use them.
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('neon-finance-')) {
        sessionStorage.removeItem(key);
      }
    }

    const confirmButton = $('#confirmFinanceReset');
    if (confirmButton) {
      confirmButton.disabled = true;
      confirmButton.textContent = 'Resetting…';
    }

    setTimeout(() => {
      window.location.reload();
    }, 180);
  }

  function init() {
    injectStyles();
    injectModal();
    injectButton();
    console.info('Neon Finance reset control loaded.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
