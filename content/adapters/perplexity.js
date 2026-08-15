// ============================================================
// AI Chat Exporter - Perplexity Adapter (turn-based)
// Site: perplexity.ai (works anonymously)
//
// Anchor priority (surveyed live on 2026-08-15, anonymous session):
//   1. .break-words.min-w-0.flex-1 - the answer column wrapping the
//      .prose body. ([id^="markdown-content-"] still exists on the
//      page but is an EMPTY sibling container now - do not anchor
//      there.)
//   2. Query text: div carrying the Tailwind group token
//      "group/query" ([class*="group/query"]).
//   3. There is no per-pair wrapper; conversationTurn is left
//      unmatched so the framework's doc-order fallback pairs
//      query -> answer.
// Code: pre.not-prose contains the language label INSIDE the pre
// (before the code element), so the custom rule subtracts the code
// text to recover the language.
//
// Known limitations:
//   - Inline source citations export as plain links; no footnote
//     formatting yet.
//   - Anonymous sessions hit a login modal after several turns.
//
// Failure history:
//   - 2026-08-15: initial version from a live DOM survey.
// ============================================================

(function () {
  const adapter = {
    id: 'perplexity',
    displayName: 'Perplexity',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/(www\.)?perplexity\.ai\//.test(url);
    },

    selectors: {
      chatContainer: ['main', '[class*="thread"]'],
      // Intentionally unmatched: rows carry no stable pair wrapper, so
      // extraction goes through the doc-order fallback.
      conversationTurn: ['[data-ai-exporter-no-such-wrapper]'],
      userQuery: ['[class*="group/query"]', '[class*="query"]'],
      userQueryText: ['p', 'span'],
      modelResponse: ['.break-words.min-w-0.flex-1', '[class*="min-w-0"][class*="break-words"]'],
      modelResponseContent: ['.prose', '[class*="prose"]'],
      conversationTitle: ['h1[class*="query"]'],
      generatedImages: ['[id^="markdown-content-"] img[src]'],
      userUploadedImages: []
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t) return t;
      }
      return document.title.replace(/ ?[-–|] ?Perplexity.*$/i, '').trim()
        || 'Perplexity Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button, [class*="citation-hover"], ' +
        'button[aria-label*="Copy" i], button[aria-label*="复制" i]'
      ).forEach(el => el.remove());
    },

    customTurndownRules(td) {
      // The language label is rendered inside the pre, before the code
      // element - subtract the code text to isolate it.
      td.addRule('perplexityCodeBlock', {
        filter: node =>
          node.nodeType === 1 && node.matches('pre') && !!node.querySelector('code'),
        replacement: (_content, node) => {
          const codeEl = node.querySelector('code');
          const code = codeEl.textContent.replace(/\n+$/, '');
          const header = node.textContent.replace(codeEl.textContent, '').trim();
          const lang = (header.split(/\s+/)[0] || '').toLowerCase().replace(/[^\w+-]/g, '');
          return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        }
      });
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }

  if (window.__AIExporterTest) {
    window.__AIExporterPerplexityInternals = { adapter };
  }
})();
