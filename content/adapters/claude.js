// ============================================================
// AI Chat Exporter - Claude Adapter (turn-based)
// Anchors on data-testid + font-claude-response, both sustained
// across open-source exporters for claude.ai.
// ============================================================

(function () {
  const adapter = {
    id: 'claude',
    displayName: 'Claude',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/claude\.ai\//.test(url);
    },

    selectors: {
      chatContainer: ['main', '[role="main"]'],
      conversationTurn: [
        '[data-testid="conversation-turn"]',
        'main > div > div'
      ],
      userQuery: [
        '[data-testid="user-message"]',
        'div[data-test-render-count]'
      ],
      userQueryText: [
        '.font-user-message',
        'p',
        'div[class*="whitespace"]'
      ],
      modelResponse: [
        '[data-testid="ai-message"]',
        '.font-claude-response'
      ],
      modelResponseContent: [
        '.standard-markdown',
        '.progressive-markdown',
        '.font-claude-response',
        '.prose'
      ],
      conversationTitle: [
        'header button[data-testid*="chat-title"]',
        'nav a[aria-current="page"] [class*="title"]',
        'header h1'
      ],
      generatedImages: [
        '.font-claude-response img[src]',
        '[data-testid="ai-message"] img[src]'
      ],
      userUploadedImages: [
        '[data-testid="user-message"] img[src]',
        '[data-testid="file-thumbnail"] img[src]'
      ]
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t && t.length > 0) return t;
      }
      return document.title.replace(/ ?[-–|] ?Claude.*/i, '').trim() || 'Claude Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button[aria-label*="Copy" i], button[aria-label*="复制" i], ' +
        '.copy-button, [data-testid*="copy"]'
      ).forEach(el => el.remove());

      // Replace artifact thumbnail blocks with a markdown placeholder, since
      // the artifact body lives in a separate side panel that's hard to
      // capture reliably in this first pass.
      clone.querySelectorAll(
        '[data-testid="artifact-thumbnail"], [data-testid*="artifact-card"]'
      ).forEach(el => {
        const label =
          el.getAttribute('aria-label') ||
          el.querySelector('[class*="title"]')?.textContent?.trim() ||
          'Artifact';
        const placeholder = document.createElement('blockquote');
        placeholder.textContent = `[Artifact: ${label}]`;
        el.replaceWith(placeholder);
      });

      // Wrap Extended Thinking blocks in <details> so users can expand them
      // in the rendered Markdown. Turndown preserves HTML when it doesn't
      // recognize a custom replacement.
      clone.querySelectorAll(
        '[data-testid="thinking-block"], [data-testid*="thinking"]'
      ).forEach(el => {
        if (el.tagName.toLowerCase() === 'details') return;
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Extended Thinking';
        details.appendChild(summary);
        while (el.firstChild) details.appendChild(el.firstChild);
        el.replaceWith(details);
      });
    },

    customTurndownRules(td) {
      td.keep(['details', 'summary']);
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }
})();
