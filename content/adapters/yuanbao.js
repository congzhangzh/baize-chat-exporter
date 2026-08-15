// ============================================================
// AI Chat Exporter - Tencent Yuanbao (Hunyuan) Adapter (turn-based)
// Site: yuanbao.tencent.com (腾讯元宝, Hy3-era UI)
//
// Anchor priority (surveyed live on 2026-08-15, logged in):
//   1. .agent-chat__list__item with BEM role modifiers
//      --human / --ai. A turn item holds one message, so userQuery /
//      modelResponse match CONTENT inside the item, not the item class
//      itself (querySelector never matches its own root).
//   2. Human text: .hyc-content-text (only in human items -
//      .hyc-component-text is NOT role-safe, it also wraps the AI
//      body). AI content: .hyc-content-md > .hyc-common-markdown
//      (only in ai items).
// Code: .hyc-common-markdown__code with header __code__hd (language in
// __code__langComponent__text) above pre > code; header leaks into
// textContent without the custom rule.
// Thinking: .hyc-card-box-process-list (deep-think process) - stripped.
//
// Known limitations:
//   - Conversation title falls back to the first user message (no
//     stable title element identified yet).
//
// Failure history:
//   - 2026-08-15: initial version from a live DOM survey.
// ============================================================

(function () {
  const adapter = {
    id: 'yuanbao',
    displayName: 'Yuanbao',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/yuanbao\.tencent\.com\//.test(url);
    },

    selectors: {
      chatContainer: ['.agent-chat__list__content-wrapper', '.agent-chat__list', 'main'],
      conversationTurn: ['.agent-chat__list__item', '[class*="agent-chat__list__item"]'],
      userQuery: [
        '.hyc-content-text',
        '.agent-chat__list__item--human [class*="hyc-component-text"]'
      ],
      userQueryText: ['p', 'div'],
      modelResponse: ['.hyc-content-md', '[class*="hyc-content-md"]'],
      modelResponseContent: ['.hyc-common-markdown', '[class*="markdown"]'],
      conversationTitle: [],
      generatedImages: ['.hyc-content-md img[src]'],
      userUploadedImages: ['.agent-chat__list__item--human img[src]']
    },

    getConversationTitle() {
      const first = document.querySelector(
        '.agent-chat__list__item--human .hyc-component-text'
      );
      const t = first ? first.textContent.trim().slice(0, 50) : '';
      return t || 'Yuanbao Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        '.hyc-card-box-process-list, button, ' +
        '[class*="__code__hd"], [class*="agent-chat__toolbar"], ' +
        'button[aria-label*="Copy" i], button[aria-label*="复制" i]'
      ).forEach(el => el.remove());
    },

    customTurndownRules(td) {
      td.addRule('yuanbaoCodeBlock', {
        filter: node =>
          node.nodeType === 1 && node.matches('[class*="hyc-common-markdown__code"]') &&
          !node.matches('[class*="__code__"] *'),
        replacement: (_content, node) => {
          const lang = (node.querySelector('[class*="langComponent__text"]')?.textContent || '')
            .trim().toLowerCase();
          const pre = node.querySelector('pre');
          const code = (pre ? pre.textContent : '').replace(/\n+$/, '');
          return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        }
      });
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }

  if (window.__AIExporterTest) {
    window.__AIExporterYuanbaoInternals = { adapter };
  }
})();
