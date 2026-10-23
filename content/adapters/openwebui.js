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
//
// Offline fixture: demo/site/index.html follows these anchors. Serve it
// on localhost, bind localhost to OpenWebUI in the popup, and export;
// demo/record.py does exactly that to record docs/media/demo.*.
//
// Failure history:
//   - 2026-10-23: every image in a reply exported twice. The <img> sat
//     inside the content block, so Turndown emitted it, and
//     generatedImages (.assistant-message img[src]) appended it again.
//     Fix: strip <img> from the clone; generatedImages is the path that
//     honours the inline / ZIP / remote-image options.
//   - 2026-10-23: a stray "python" line above each code fence. The code
//     block header (language label + Copy) is text beside the <pre>;
//     only the Copy button was removed. Fix: stripCodeBlockChrome().
//   Both found by the demo recording against the fixture, not on a live
//   deployment: re-check against a real instance when one is at hand.
// ============================================================

(function () {
  const CONTENT_TAGS = 'pre, code, img, p, li, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6';

  // A code block renders as a <div> wrapper holding the <pre> plus a header
  // (language label, Copy/Run/Save buttons) whose text otherwise leaks into
  // the Markdown as a stray line above the fence. OpenWebUI's class names
  // differ between releases, so the check is structural: inside the
  // wrapper, drop short-text div/span nodes that hold no content. The
  // wrapper is the highest div ancestor holding this one <pre> only, so a
  // list item or paragraph next to the code is never touched. The label
  // doubles as the fence language when <code> carries no language-* class.
  function stripCodeBlockChrome(root) {
    root.querySelectorAll('pre').forEach(pre => {
      let block = null;
      for (let el = pre.parentElement; el && el !== root && el.tagName === 'DIV'; el = el.parentElement) {
        if (el.querySelectorAll('pre').length > 1) break;
        block = el;
      }
      if (!block) return;
      block.querySelectorAll('button').forEach(el => el.remove());
      let label = '';
      block.querySelectorAll('div, span').forEach(el => {
        if (!block.contains(el) || el.contains(pre) || pre.contains(el)) return;
        if (el.querySelector(CONTENT_TAGS)) return;
        const text = el.textContent.trim();
        if (text.length > 30) return;
        if (!label && /^[\w+#.-]{1,20}$/.test(text)) label = text.toLowerCase();
        el.remove();
      });
      const code = pre.querySelector('code') || pre;
      if (label && !/\blanguage-/.test(code.className)) code.classList.add('language-' + label);
    });
  }

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

      // generatedImages already collects these; left here, Turndown would
      // emit each one a second time (see failure history).
      clone.querySelectorAll('img').forEach(el => el.remove());

      stripCodeBlockChrome(clone);
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

  if (window.__AIExporterTest) {
    window.__AIExporterOpenWebUIInternals = { stripCodeBlockChrome, adapter };
  }
})();
