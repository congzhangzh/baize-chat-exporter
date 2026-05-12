// ============================================================
// AI Chat Exporter - Adapter Registry
// Provides a tiny global registry so per-site adapter scripts
// can self-register before content.js inspects the page.
// ============================================================

(function () {
  if (window.__AIExporterRegistry) return;

  const adapters = [];

  const registry = {
    register(adapter) {
      if (!adapter || typeof adapter.match !== 'function') {
        console.warn('[AI Exporter] Ignoring invalid adapter:', adapter);
        return;
      }
      const existingIdx = adapters.findIndex(a => a.id === adapter.id);
      if (existingIdx >= 0) {
        adapters[existingIdx] = adapter;
        return;
      }
      adapters.push(adapter);
    },

    list() {
      return adapters.slice();
    },

    getActive(url) {
      const href = url || location.href;
      for (const a of adapters) {
        try {
          if (a.match(href)) return a;
        } catch (err) {
          console.warn('[AI Exporter] Adapter match() threw:', a.id, err);
        }
      }
      return null;
    },

    isDebug() {
      try {
        return localStorage.getItem('AI_EXPORTER_DEBUG') === '1';
      } catch (_) {
        return false;
      }
    },

    log(...args) {
      if (this.isDebug()) {
        console.log('[AI Exporter]', ...args);
      }
    }
  };

  window.__AIExporterRegistry = registry;
})();
