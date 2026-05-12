// ============================================================
// AI Chat Exporter - Meta AI Adapter (turn-based)
//
// NOTE: meta.ai's DOM uses obfuscated React classes and there is
// no widely documented data-testid scheme as of writing.  We
// shoot multiple fallback selectors so most reasonable variants
// hit at least one layer.  Enable debug logging with:
//   localStorage.AI_EXPORTER_DEBUG = '1'
// to see which layer actually matched in your browser.
// ============================================================

(function () {
  const adapter = {
    id: 'meta',
    displayName: 'Meta AI',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/(www\.)?meta\.ai\//.test(url);
    },

    selectors: {
      chatContainer: ['[role="main"]', 'main', '#__next main', '#__next'],
      conversationTurn: [
        '[data-testid="conversation-turn"]',
        '[role="article"]',
        'div[class*="conversation"] > div[class*="message"]',
        'div[role="log"] > div'
      ],
      userQuery: [
        '[data-testid="user-message"]',
        '[role="user"]',
        '[data-author="user"]',
        'div[class*="user-message"]'
      ],
      userQueryText: [
        '[dir="auto"]',
        'p',
        'span'
      ],
      modelResponse: [
        '[data-testid="assistant-message"]',
        '[role="assistant"]',
        '[data-author="assistant"]',
        'div[class*="assistant-message"]'
      ],
      modelResponseContent: [
        '[data-testid="markdown-content"]',
        '.markdown',
        '[dir="auto"]'
      ],
      conversationTitle: [
        'header h1',
        '[role="banner"] h1',
        'h1'
      ],
      generatedImages: [
        'img[alt*="generated" i][src]',
        '[data-testid*="image"] img[src]',
        'figure img[src]',
        '[data-author="assistant"] img[src]'
      ],
      userUploadedImages: [
        '[data-testid="user-message"] img[src]',
        '[role="user"] img[src]',
        '[data-author="user"] img[src]'
      ]
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t && t.length > 0) return t;
      }
      return document.title.replace(/ ?[-–|] ?Meta AI.*/i, '').trim() || 'Meta AI Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button[aria-label*="Copy" i], button[aria-label*="复制" i], ' +
        'button[aria-label*="Like" i], button[aria-label*="Dislike" i]'
      ).forEach(el => el.remove());
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }
})();
