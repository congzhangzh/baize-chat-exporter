// ============================================================
// AI Chat Exporter - ChatGPT Adapter (turn-based)
// Anchors on [data-message-author-role], which has been stable
// for years across chatgpt.com and chat.openai.com.
// ============================================================

(function () {
  const adapter = {
    id: 'chatgpt',
    displayName: 'ChatGPT',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
    },

    selectors: {
      chatContainer: ['main', '#__next main', '[role="main"]'],
      conversationTurn: [
        'article[data-testid^="conversation-turn"]',
        '[data-testid^="conversation-turn"]',
        'main article'
      ],
      userQuery: ['[data-message-author-role="user"]'],
      userQueryText: [
        '.whitespace-pre-wrap',
        '[data-message-content]',
        '.text-message',
        'div'
      ],
      modelResponse: ['[data-message-author-role="assistant"]'],
      modelResponseContent: [
        '.markdown.prose',
        '.markdown',
        '.prose',
        '[data-message-content]'
      ],
      conversationTitle: [
        'nav a[aria-current="page"]',
        'header h1',
        '[data-testid="conversation-title"]'
      ],
      generatedImages: [
        '[data-message-author-role="assistant"] img[src]',
        'img[alt*="generated" i][src]',
        'figure img[src]'
      ],
      userUploadedImages: [
        '[data-message-author-role="user"] img[src]'
      ]
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t && t.length > 0) return t;
      }
      return document.title.replace(/ ?[-–|] ?ChatGPT.*/i, '').trim() || 'ChatGPT Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button[aria-label*="Copy" i], button[aria-label*="复制" i], ' +
        '.copy-button, [data-testid="copy-turn-action-button"], ' +
        '[data-testid="good-response-turn-action-button"], ' +
        '[data-testid="bad-response-turn-action-button"]'
      ).forEach(el => el.remove());

      clone.querySelectorAll('[role="presentation"][aria-hidden="true"]').forEach(el => el.remove());
    },

    customTurndownRules(td) {
      td.addRule('chatgptKatexBlock', {
        filter: node =>
          node.nodeType === 1 &&
          (node.matches('.katex-display') ||
           (node.matches('.katex') && node.closest('.katex-display'))),
        replacement: (_content, node) => {
          const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
          const latex = annotation ? annotation.textContent.trim() : node.textContent.trim();
          return `\n\n$$${latex}$$\n\n`;
        }
      });

      td.addRule('chatgptKatexInline', {
        filter: node =>
          node.nodeType === 1 &&
          node.matches('.katex') &&
          !node.closest('.katex-display'),
        replacement: (_content, node) => {
          const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
          const latex = annotation ? annotation.textContent.trim() : node.textContent.trim();
          return `$${latex}$`;
        }
      });
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }
})();
