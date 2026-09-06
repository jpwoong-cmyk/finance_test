(() => {
  'use strict';

  // Compatibility bridge.
  // index.html already loads this path, so keep HTML unchanged and load
  // all current Neon Finance feature modules in sequence.
  if (window.NeonFinanceFeatureLoaderActive) return;
  window.NeonFinanceFeatureLoaderActive = true;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  loadScript('fetch/ledger-tools.js?v=20260906-ledger-v2')
    .then(() => loadScript('fetch/monthly-performance.js?v=20260906-monthly-v1'))
    .then(() => loadScript('fetch/reset-data.js?v=20260906-reset-v1'))
    .then(() => console.info('Neon Finance feature modules loaded.'))
    .catch(error => console.error(error));
})();
