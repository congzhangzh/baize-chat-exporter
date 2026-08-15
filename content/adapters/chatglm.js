// ============================================================
// AI Chat Exporter - ChatGLM (Zhipu Qingyan) Adapter (turn-based)
// Site: chatglm.cn (智谱清言, Vue app, guest mode works)
//
// Anchor priority (surveyed live on 2026-08-15, guest session):
//   1. .conversation-item - one wrapper per Q+A PAIR (a true turn
//      container; a trailing followup-list item extracts empty and is
//      filtered by the framework).
//   2. .conversation.question / .answer inside each item.
//   3. Content: the answer renders as a SEQUENCE of .markdown-body
//      segments (text blocks and md-code blocks) inside .panel - take
//      .panel, never the first .markdown-body (it can be empty).
// Code: pre.hljs > code, language on the WRAPPER div
// (.language.language-python), not on the code element - hence the
// custom Turndown rule.
//
// Known limitations:
//   - Thinking/deep-research blocks not yet mapped (GLM-5.2 Fast had
//     none rendered); revisit with a reasoning conversation.
//
// Failure history:
//   - 2026-08-15: initial version from a live DOM survey; the roadmap's
//     guessed selectors ([data-message-id], .user-msg/.bot-msg) do not
//     exist on the current site.
// ============================================================

(function () {
  const adapter = {
    id: 'chatglm',
    displayName: 'ChatGLM',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/(www\.)?chatglm\.cn\//.test(url);
    },

    selectors: {
      chatContainer: ['.chatScrollContainer', '.conversation-list', 'main'],
      conversationTurn: ['.conversation-item', '[class*="conversation-item"]'],
      userQuery: ['.conversation.question', '[class*="question"]'],
      userQueryText: ['.question-text-style', '[class*="question-txt"]', 'p'],
      modelResponse: ['.answer', '[class*="answer"]'],
      modelResponseContent: ['.panel', '.markdown-body', '[class*="markdown"]'],
      conversationTitle: [
        '.history-item.selected .title',
        '.history-item.active .title'
      ],
      generatedImages: ['.answer img[src]'],
      userUploadedImages: ['.question img[src]']
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t) return t;
      }
      return 'ChatGLM Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button, [class*="regenerate"], [class*="more-btn"], ' +
        'button[aria-label*="Copy" i], button[aria-label*="复制" i]'
      ).forEach(el => el.remove());
    },

    customTurndownRules(td) {
      // Language lives on the pre's wrapper div (.language-xxx), not on
      // the code element where Turndown's default rule looks for it.
      td.addRule('chatglmCodeBlock', {
        filter: node =>
          node.nodeType === 1 && node.matches('pre') &&
          !!node.closest('[class*="language-"]'),
        replacement: (_content, node) => {
          const wrap = node.closest('[class*="language-"]');
          const m = (wrap.className || '').match(/language-([\w+-]+)/);
          const lang = m ? m[1] : '';
          const code = node.textContent.replace(/\n+$/, '');
          return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        }
      });
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }

  if (window.__AIExporterTest) {
    window.__AIExporterChatGLMInternals = { adapter };
  }
})();
