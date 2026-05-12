// ============================================================
// AI Chat Exporter - OpenWebUI Adapter (turn-based)
//
// OpenWebUI is self-hosted, so the domain is user-supplied. The
// extension keeps this adapter out of manifest.content_scripts;
// it is injected on demand by popup.js via chrome.scripting on
// origins the user has authorized through chrome.permissions.
//
// match() therefore always returns true: this script only runs
// where popup has decided OpenWebUI is the right adapter.
// ============================================================

(function () {
  const adapter = {
    id: 'openwebui',
    displayName: 'OpenWebUI',
    extractMode: 'turn-based',

    match() {
      return true;
    },

    selectors: {
      chatContainer: ['#messages-container', 'main #chat', 'main'],
      conversationTurn: [
        '.message',
        '[id^="message-"]',
        'div[class*="chat-message"]'
      ],
      userQuery: [
        '.user-message',
        '[data-role="user"]',
        '.message.user'
      ],
      userQueryText: [
        '.message-content',
        '.prose',
        'div[class*="content"]'
      ],
      modelResponse: [
        '.assistant-message',
        '[data-role="assistant"]',
        '.message.assistant'
      ],
      modelResponseContent: [
        '.message-content .markdown',
        '.message-content .prose',
        '.message-content',
        '.prose'
      ],
      conversationTitle: [
        'header h1',
        'nav .active',
        '.chat-title'
      ],
      generatedImages: [
        '.assistant-message img[src]',
        '[data-role="assistant"] img[src]'
      ],
      userUploadedImages: [
        '.user-message img[src]',
        '[data-role="user"] img[src]'
      ]
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t && t.length > 0) return t;
      }
      return document.title.replace(/ ?[-–|] ?Open ?WebUI.*/i, '').trim() || 'OpenWebUI Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button[title*="Copy" i], .copy-code-button, ' +
        'button[aria-label*="Copy" i], button[aria-label*="复制" i]'
      ).forEach(el => el.remove());
    },

    decorateModelLabel(modelEl) {
      // OpenWebUI sometimes renders multiple assistant messages per turn
      // (model comparison feature). Expose the model name on the section
      // heading so the export distinguishes them.
      const model =
        modelEl.getAttribute('data-model') ||
        modelEl.querySelector('.model-name')?.textContent?.trim() ||
        modelEl.querySelector('[class*="model"]')?.textContent?.trim();
      return model ? `${this.displayName} (${model})` : this.displayName;
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }
})();
