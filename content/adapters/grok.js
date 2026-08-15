// ============================================================
// AI Chat Exporter - Grok Adapter (turn-based)
// Site: grok.com (SpaceXAI, ex-xAI standalone web app)
//
// Anchor priority (surveyed live on 2026-08-15, logged-in UI):
//   1. [data-testid="user-message"] / [data-testid="assistant-message"]
//      - semantic testids on the .message-bubble divs, same spirit as
//      ChatGPT's data-message-author-role. Primary role anchor.
//   2. [data-scroll-anchor-root] - one row wrapper per bubble (a row
//      never holds both roles; buildTurnMarkdown handles one-sided
//      turns, and the doc-order fallback pairs them if rows vanish).
//   3. Class-token fallback: user bubbles carry `rounded-br-lg` (the
//      bubble-tail corner) and `bg-surface-l1`; assistant bubbles carry
//      `max-w-none`. Exact class tokens - substring matches like
//      [class*="w-full"] are a trap (max-w-[100%] contains it).
// Content lives in .response-content-markdown; code blocks are
// [data-testid="code-block"] with a `group/code-header` row (language
// label in span.font-mono + Run/Copy buttons) above pre.shiki - the
// header text pollutes textContent, hence the custom Turndown rule.
//
// Known limitations:
//   - x.com/i/grok uses a different DOM tree; NOT covered here.
//   - .thinking-container (reasoning models) sits outside the content
//     div and is not exported yet; empty in Fast mode.
//   - KaTeX rules mirror the ChatGPT adapter but are unverified
//     against live Grok math output.
//   - Conversation list appeared non-virtualized (all rows present);
//     the framework's generic scroller is used as-is.
//
// Failure history:
//   - 2026-08-15: initial version, selectors taken from a live DOM
//     survey (console probes) rather than guesswork; testids
//     user-message/assistant-message confirmed on a real conversation.
// ============================================================

(function () {
  const adapter = {
    id: 'grok',
    displayName: 'Grok',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/grok\.com\//.test(url);
    },

    selectors: {
      chatContainer: ['main', '[role="main"]'],
      conversationTurn: [
        '[data-scroll-anchor-root]',
        'main [class*="message-bubble"]'
      ],
      userQuery: [
        '[data-testid="user-message"]',
        '.message-bubble.rounded-br-lg',
        '.message-bubble.bg-surface-l1'
      ],
      userQueryText: [
        '.response-content-markdown p',
        '.response-content-markdown',
        'p'
      ],
      modelResponse: [
        '[data-testid="assistant-message"]',
        '.message-bubble.max-w-none'
      ],
      modelResponseContent: [
        '.response-content-markdown',
        '[class*="markdown"]',
        '[class*="chat-md"]'
      ],
      conversationTitle: [
        '[data-testid="chat-title"]',
        'header h1'
      ],
      generatedImages: [
        '[data-testid="assistant-message"] img[src]',
        '.inline-media-container img[src]'
      ],
      userUploadedImages: [
        '[data-testid="user-message"] img[src]'
      ]
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t) return t;
      }
      return document.title.replace(/ ?[-–|] ?Grok.*$/i, '').trim() || 'Grok Conversation';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button, [class*="print:hidden"], ' +
        'button[aria-label*="Copy" i], button[aria-label*="复制" i]'
      ).forEach(el => el.remove());
    },

    customTurndownRules(td) {
      // Code blocks: language label + Run/Copy live in a header row whose
      // text would otherwise leak into the output ("PythonCopy...").
      td.addRule('grokCodeBlock', {
        filter: node =>
          node.nodeType === 1 && node.matches('[data-testid="code-block"]'),
        replacement: (_content, node) => {
          const lang = (node.querySelector('[class*="code-header"] span, span.font-mono')
            ?.textContent || '').trim().toLowerCase();
          const code = (node.querySelector('pre')?.textContent || '').replace(/\n+$/, '');
          return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        }
      });

      td.addRule('grokKatexBlock', {
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

      td.addRule('grokKatexInline', {
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

  if (window.__AIExporterTest) {
    window.__AIExporterGrokInternals = { adapter };
  }
})();
