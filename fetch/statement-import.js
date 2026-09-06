(() => {
  'use strict';

  // Compatibility bridge.
  // The old PDF statement parser has been retired. index.html already loads
  // this path, so use it to load the new ledger/reconciliation engine without
  // requiring an index.html change.
  if (window.NeonLedgerToolsLoading) return;
  window.NeonLedgerToolsLoading = true;

  const script = document.createElement('script');
  script.src = 'fetch/ledger-tools.js?v=20260906-ledger-v1';
  script.async = false;
  script.onload = () => console.info('Neon Finance ledger tools loaded.');
  script.onerror = () => console.error('Could not load fetch/ledger-tools.js');
  document.head.appendChild(script);
})();
