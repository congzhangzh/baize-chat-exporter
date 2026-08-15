// ============================================================
// AI Chat Exporter - Doubao Adapter (turn-based)
// Site: doubao.com (豆包, ByteDance; login + mainland account required)
//
// Anchor priority (surveyed live on 2026-08-15, logged in):
//   1. [data-observe-row] - one row per message.
//   2. [data-message-id] - the message element itself. Role is NOT an
//      attribute; it is expressed via layout utility classes on the
//      same element: user messages carry `justify-end` (right-aligned
//      bubble), assistant messages carry `grid`.
//   3. Content: .md-box-root (the only non-hashed content class) /
//      [data-render-engine].
// Everything else is hashed CSS-module classes (container-qX9Csx etc.)
// - do NOT anchor on those; they change every build.
// Code: [class*="code-block-element"] wrapper, language on the inner
// pre (language-python); header text leaks without the custom rule.
//
// Known limitations:
//   - Role detection rests on layout utility classes (justify-end /
//     grid); if Doubao restyles alignment, update both selectors.
//
// Failure history:
//   - 2026-08-15: initial version from a live DOM survey; the roadmap's
//     guessed selectors (.receive-message/.send-message,
//     [data-testid*="message"]) do not exist on the current site.
// ============================================================

(function () {
  const adapter = {
    id: 'doubao',
    displayName: 'Doubao',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/(www\.)?doubao\.com\//.test(url);
    },

    selectors: {
      chatContainer: ['[data-name="scroll_holder"]', 'main'],
      conversationTurn: ['[data-observe-row]', '[data-message-id]'],
      userQuery: [
        '[data-message-id][class*="justify-end"]'
      ],
      userQueryText: ['[class*="md-box-root"] p', '[class*="md-box-root"]', 'p'],
      modelResponse: [
        '[data-message-id][class*="grid"]',
        '[data-message-id]:not([class*="justify-end"])'
      ],
      modelResponseContent: ['[class*="md-box-root"]', '[data-render-engine]'],
      conversationTitle: [],
      generatedImages: ['[data-message-id][class*="grid"] img[src]'],
      userUploadedImages: ['[data-message-id][class*="justify-end"] img[src]']
    },

    getConversationTitle() {
      return document.title.replace(/ ?[-–|] ?豆包.*$/, '').trim() || 'Doubao Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button, [class*="action-bar"], [class*="message-action"], ' +
        'button[aria-label*="Copy" i], button[aria-label*="复制" i]'
      ).forEach(el => el.remove());
    },

    customTurndownRules(td) {
      td.addRule('doubaoCodeBlock', {
        filter: node =>
          node.nodeType === 1 && node.matches('[class*="code-block-element"]'),
        replacement: (_content, node) => {
          const pre = node.querySelector('pre');
          if (!pre) return '';
          const m = (pre.className || '').match(/language-([\w+-]+)/);
          const lang = m ? m[1] : '';
          const code = pre.textContent.replace(/\n+$/, '');
          return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        }
      });
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }

  if (window.__AIExporterTest) {
    window.__AIExporterDoubaoInternals = { adapter };
  }
})();
