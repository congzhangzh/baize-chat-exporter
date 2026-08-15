// ============================================================
// AI Chat Exporter - Kimi (Moonshot) Adapter (turn-based)
// Sites: kimi.com (current), kimi.moonshot.cn (legacy)
//
// Anchor priority (surveyed live on 2026-08-15, K3-era UI, logged in):
//   1. .chat-content-item (one per message) inside .chat-content-list,
//      with role modifiers .chat-content-item-user / -assistant.
//   2. .segment.segment-user / .segment.segment-assistant - the bubble
//      itself; used as the role query inside each item.
//   3. Content: .markdown-container - BUT the thinking block's markdown
//      wrapper carries the same class plus .toolcall-content-text, so
//      the content selector must exclude it or the export would ship
//      the reasoning instead of the answer.
// Code: .segment-code with .segment-code-lang (label) +
// .segment-code-content > pre; the header leaks into textContent,
// hence the custom Turndown rule.
//
// Known limitations:
//   - .thinking-container (reasoning) is stripped, not exported;
//     revisit if users want it wrapped in <details> like Claude.
//
// Failure history:
//   - 2026-08-15: initial version from a live DOM survey.
// ============================================================

(function () {
  const adapter = {
    id: 'kimi',
    displayName: 'Kimi',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/(www\.)?kimi\.(com|moonshot\.cn)\//.test(url);
    },

    selectors: {
      chatContainer: ['.chat-detail-main', 'main'],
      conversationTurn: ['.chat-content-item', '[class*="chat-content-item"]'],
      userQuery: ['.segment-user', '[class*="segment-user"]'],
      userQueryText: ['.segment-content p', '.segment-content', 'p'],
      modelResponse: ['.segment-assistant', '[class*="segment-assistant"]'],
      modelResponseContent: [
        '.markdown-container:not(.toolcall-content-text)',
        '.markdown'
      ],
      conversationTitle: [],
      generatedImages: ['.segment-assistant img[src]'],
      userUploadedImages: ['.segment-user img[src]']
    },

    getConversationTitle() {
      return document.title.replace(/ ?[-–|] ?Kimi.*$/i, '').trim() || 'Kimi Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        '.thinking-container, .toolcall-container, ' +
        '.segment-assistant-actions, button, ' +
        'button[aria-label*="Copy" i], button[aria-label*="复制" i]'
      ).forEach(el => el.remove());
    },

    customTurndownRules(td) {
      // The code header (language label + copy/run) leaks into
      // textContent without this rule.
      td.addRule('kimiCodeBlock', {
        filter: node =>
          node.nodeType === 1 && node.matches('.segment-code'),
        replacement: (_content, node) => {
          const lang = (node.querySelector('.segment-code-lang')?.textContent || '')
            .trim().toLowerCase();
          const body = node.querySelector('.segment-code-content pre, pre');
          const code = (body ? body.textContent : '').replace(/\n+$/, '');
          return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        }
      });
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }

  if (window.__AIExporterTest) {
    window.__AIExporterKimiInternals = { adapter };
  }
})();
