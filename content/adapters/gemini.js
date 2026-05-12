// ============================================================
// AI Chat Exporter - Gemini Adapter (turn-based)
// Selectors layered with fallbacks to survive Google redesigns.
// ============================================================

(function () {
  const adapter = {
    id: 'gemini',
    displayName: 'Gemini',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/gemini\.google\.com\//.test(url);
    },

    selectors: {
      chatContainer: [
        'chat-history',
        '#chat-history',
        'infinite-scroller',
        '[jsname="K09D7"]',
        'main'
      ],
      conversationTurn: [
        'div.conversation-container',
        '.conversation-container',
        'conversation-container'
      ],
      userQuery: [
        'user-query',
        'query-content',
        '[data-test-id="user-query"]'
      ],
      userQueryText: [
        '.query-text .query-text-line',
        '.query-text p',
        '.query-text',
        'query-text'
      ],
      modelResponse: [
        'model-response',
        'response-container',
        '[data-test-id="model-response"]'
      ],
      modelResponseContent: [
        'message-content .markdown',
        '.model-response-text .markdown',
        '.response-container-content .markdown',
        '.markdown',
        'message-content'
      ],
      conversationTitle: [
        '[data-test-id="conversation-title"]',
        '.conversation-title',
        'mat-sidenav .conversation-title',
        'h1'
      ],
      generatedImages: [
        'generated-image img[src]',
        '.attachment-container img[src]',
        '.generated-images img[src]',
        'model-response img[src]',
        'message-content img[src]'
      ],
      userUploadedImages: [
        'user-query img[src]',
        'query-content img[src]',
        '.query-image img[src]',
        '.uploaded-image img[src]',
        '[data-test-id="user-query"] img[src]'
      ]
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t && t.length > 0) return t;
      }
      return document.title.replace(/ ?[-–|] ?Gemini.*/i, '').trim() || 'Gemini Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        '.citation-button, .footnote, [data-citation], .cite-marker'
      ).forEach(el => el.remove());
      clone.querySelectorAll('button, .expand-button').forEach(el => el.remove());
    },

    customTurndownRules(td) {
      td.addRule('geminiMathBlock', {
        filter: node =>
          node.nodeType === 1 &&
          node.matches('.math-block[data-math], [data-formula], mjx-container[display="true"]'),
        replacement: (_content, node) => {
          const latex =
            node.getAttribute('data-math') ||
            node.getAttribute('data-formula') ||
            node.textContent.trim();
          return `\n\n$$${latex}$$\n\n`;
        }
      });

      td.addRule('geminiMathInline', {
        filter: node =>
          node.nodeType === 1 &&
          node.matches('.math-inline[data-math], mjx-container:not([display="true"])'),
        replacement: (_content, node) => {
          const latex =
            node.getAttribute('data-math') ||
            node.textContent.trim();
          return `$${latex}$`;
        }
      });

      td.addRule('geminiCitations', {
        filter: node =>
          node.nodeType === 1 && (
            node.classList.contains('cite-marker') ||
            node.classList.contains('citation-button') ||
            node.getAttribute('data-citation') != null
          ),
        replacement: () => ''
      });
    },

    cleanMarkdown(text) {
      return text
        .replace(/\[cite_start\]/g, '')
        .replace(/\[cite:[\d,\s]+\]/g, '');
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }
})();
