// ============================================================
// AI Chat Exporter - HuggingChat Adapter (turn-based)
// Site: huggingface.co/chat (HF login required since 2026)
//
// Anchor priority (surveyed live on 2026-08-15, logged in, Omni router):
//   1. div[role="presentation"] - one group per message. Role is
//      structural: the assistant group contains .prose, the user group
//      contains p.disabled (the disabled textarea-lookalike). There is
//      no per-pair wrapper, so conversationTurn stays unmatched and the
//      framework's doc-order fallback pairs query -> answer.
//      (The roadmap's guessed [role="article"] anchor no longer exists.)
//   2. Content: .prose - the Thinking block conveniently lives OUTSIDE
//      it, so reasoning never leaks into the export.
//   3. Model label: a footer like "agentic with Kimi-K2.6 via together"
//      near the group - parsed into "HuggingChat (Kimi-K2.6)" since the
//      Omni router picks a different model per reply.
// Code: plain pre > code inside .prose, no language label rendered -
// Turndown's default fenced rule applies.
//
// Known limitations:
//   - Fences carry no language (the UI does not render one).
//   - Requires an HF login; anonymous access redirects to OAuth.
//
// Failure history:
//   - 2026-08-15: initial version from a live DOM survey.
// ============================================================

(function () {
  const adapter = {
    id: 'huggingchat',
    displayName: 'HuggingChat',
    extractMode: 'turn-based',

    match(url) {
      return /^https:\/\/huggingface\.co\/chat/.test(url);
    },

    selectors: {
      chatContainer: ['.scrollbar-custom', 'main'],
      // No stable pair wrapper; force the doc-order fallback.
      conversationTurn: ['[data-ai-exporter-no-such-wrapper]'],
      userQuery: [
        'div[role="presentation"]:has(p.disabled)',
        'p.disabled'
      ],
      userQueryText: ['p.disabled', 'p'],
      modelResponse: ['div[role="presentation"]:has(.prose)'],
      modelResponseContent: ['.prose'],
      conversationTitle: ['[data-testid="chat-title"]'],
      generatedImages: ['div[role="presentation"] .prose img[src]'],
      userUploadedImages: ['div[role="presentation"]:has(p.disabled) img[src]']
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t) return t;
      }
      return document.title.replace(/ ?[-–|] ?HuggingChat.*$/i, '').trim()
        || 'HuggingChat Conversation';
    },

    decorateModelLabel(modelEl) {
      // Footer example: "agentic with Kimi-K2.6 via together"
      const scope = modelEl.parentElement || modelEl;
      const footer = [...scope.querySelectorAll('div')]
        .find(d => /\bwith\s+\S+\s+via\b/.test(d.textContent) && d.textContent.length < 80);
      const m = footer && footer.textContent.match(/\bwith\s+(\S+)\s+via\b/);
      return m ? `HuggingChat (${m[1]})` : 'HuggingChat';
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button, button[aria-label*="Copy" i], button[aria-label*="复制" i]'
      ).forEach(el => el.remove());
    }
  };

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }

  if (window.__AIExporterTest) {
    window.__AIExporterHuggingChatInternals = { adapter };
  }
})();
