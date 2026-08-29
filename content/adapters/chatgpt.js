// ============================================================
// AI Chat Exporter - ChatGPT Adapter (turn-based, virtualized)
//
// -----------------------------------------------------------
// Anchor priority (verified against live chatgpt.com DOM, 2026-08-29)
// -----------------------------------------------------------
//   1. [data-turn-id-container]  OUTER wrapper, one per turn. Exists in
//      BOTH states: materialized (contains the <section>) and virtualized
//      (an EMPTY div sized by --last-known-height, with
//      data-is-intersecting="false"). This is the dedup key. The wrapper
//      list itself is a sliding WINDOW (27 -> 19 wrappers observed while
//      sweeping): turns far from the viewport lose even their wrapper, so
//      conversation order has to be accumulated across ticks, not read
//      off the DOM at export time.
//      The first wrapper is a sentinel (`client-created-root`), skip it.
//      The materialized <section> ALSO carries data-turn-id-container, so
//      a naive querySelectorAll returns two wrappers per live turn: keep
//      only the outermost (25 raw wrappers were 11 turns + 3 placeholders).
//   2. section[data-testid^="conversation-turn"][data-turn=user|assistant]
//      INNER turn node, only present when materialized. Carries
//      data-turn-id. Used to be <article>; keep the tag-less selector.
//   3. [data-message-author-role=user|assistant]  message node inside the
//      section. Absent on image-generation-only replies and on turns that
//      were stopped while "thinking" - both still have a section.
//   4. .markdown  assistant body. User messages typed as markdown also
//      render into .markdown (no .whitespace-pre-wrap in that case).
//   5. [data-scroll-root]  the real scroller. It is an ANCESTOR of <main>;
//      <main> itself is overflow:visible, so `main.scrollTop = N` is a
//      silent no-op.
//
// -----------------------------------------------------------
// Failure history
// -----------------------------------------------------------
//   - 2026-08-29: "paragraphs / whole turns missing even after scrolling
//     to the top". Root cause: ChatGPT virtualizes turns in BOTH
//     directions. Turns leaving the viewport (plus a margin) are swapped
//     for empty [data-turn-id-container][data-is-intersecting="false"]
//     placeholders, and older turns are fetched lazily while scrolling
//     up. Probe on an 11-turn chat: `sections:5 placeholders:6`; after
//     `scrollTop = 0` + one rendered frame the bottom turns became
//     placeholders too. On top of that the generic loader targeted
//     <main> (overflow:visible) so it never scrolled at all. Fix:
//     incremental sweep over the real scroller, harvesting each turn by
//     wrapper id as it materializes; collectTurns() feeds the cached
//     clones to the framework and reports how many wrappers never
//     materialized (surfaced as a popup warning).
//   - 2026-08-29: `article[data-testid^="conversation-turn"]` returns 0;
//     turns are <section> now. Tag-less selector first, article kept as
//     a legacy layer.
//   - 2026-08-29: user messages typed as markdown have no
//     .whitespace-pre-wrap; the old generic `div` fallback joined every
//     nested div's textContent (a 459-char prompt became 3209 chars of
//     repeats). Fix: userQueryHtml -> framework runs turndown on the
//     .markdown block.
//   - 2026-08-29: image-generation replies have no
//     [data-message-author-role] node, so the whole turn was dropped.
//     Fix: `:scope[data-turn="assistant"] > div` fallback plus an
//     imagegen image selector; the framework keeps image-only turns.
//
// -----------------------------------------------------------
// Virtualization
// -----------------------------------------------------------
//   Materialization is IntersectionObserver-driven, which means it only
//   happens when the browser renders frames. In a hidden or occluded tab
//   (document.visibilityState === 'hidden') rAF and IO are paused and NO
//   amount of programmatic scrolling materializes anything - the sweep
//   will finish with every off-screen turn still virtualized. Export
//   with the tab in the foreground. scrollToLoadMore() logs the
//   visibility state so this is diagnosable from the console.
//
// -----------------------------------------------------------
// Debugging
// -----------------------------------------------------------
//   localStorage.AI_EXPORTER_DEBUG = '1', reload, export. Logs are
//   prefixed [AI Exporter][chatgpt] and include the resolved scroller
//   and per-tick `wrappers / newly captured / still virtualized /
//   cached total`. Probe snippet (paste in the page console):
//
//     [...document.querySelectorAll('[data-turn-id-container]')]
//       .map(w => (w.querySelector('[data-testid^="conversation-turn"]') ? '*' : '.')
//                 + w.getAttribute('data-is-intersecting')[0]).join(' ')
//
//   `*` = materialized, `.` = empty placeholder; t/f = intersecting.
// ============================================================

(function () {
  const TURN_WRAPPER = '[data-turn-id-container]';
  const TURN_SECTION = '[data-testid^="conversation-turn"], section[data-turn]';
  const SENTINEL_IDS = new Set(['client-created-root']);

  const SCROLL_DELAY_MS = 450;
  const STABLE_TICKS_AT_TOP = 4;
  const MAX_TICKS = 400;
  const MAX_SWEEP_MS = 120000;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const adapter = {
    id: 'chatgpt',
    displayName: 'ChatGPT',
    extractMode: 'turn-based',
    joinResponseBlocks: true,

    match(url) {
      return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
    },

    selectors: {
      chatContainer: ['[data-scroll-root]', 'main', '#__next main', '[role="main"]'],
      conversationTurn: [
        '[data-testid^="conversation-turn"]',
        'section[data-turn]',
        'article[data-testid^="conversation-turn"]',
        'main article'
      ],
      userQuery: [
        '[data-message-author-role="user"]',
        ':scope[data-turn="user"] > div'
      ],
      userQueryHtml: ['.markdown'],
      userQueryText: [
        '.whitespace-pre-wrap',
        '[data-message-content]',
        '.text-message'
      ],
      modelResponse: [
        '[data-message-author-role="assistant"]',
        ':scope[data-turn="assistant"] > div'
      ],
      modelResponseContent: [
        '.markdown.prose',
        '.markdown',
        '.prose',
        '[data-message-content]'
      ],
      conversationTitle: [
        'nav a[aria-current="page"]',
        'header h1',
        '[data-testid="conversation-title"]'
      ],
      generatedImages: [
        '[data-message-author-role="assistant"] img[src]',
        '[class*="imagegen"] img[src]',
        'img[alt*="generated" i][src]',
        'figure img[src]'
      ],
      userUploadedImages: [
        '[data-message-author-role="user"] img[src]'
      ]
    },

    getConversationTitle(queryFirst) {
      const titleEl = queryFirst(this.selectors.conversationTitle);
      if (titleEl) {
        const t = titleEl.textContent.trim();
        if (t && t.length > 0) return t;
      }
      return document.title.replace(/ ?[-–|] ?ChatGPT.*/i, '').trim() || 'ChatGPT Conversation';
    },

    // Incremental sweep. Two passes over the real scroller:
    //   A. walk UP to scrollTop 0. Older turns are fetched lazily on the
    //      way, so the wrapper list keeps growing; stop only once we sit
    //      at the top and the count has been stable for a few ticks.
    //   B. walk DOWN by ~0.75 viewport steps to the bottom, harvesting
    //      after every step. Jumping straight to the bottom would leave
    //      everything in between virtualized.
    // Harvest keys on the OUTER wrapper id because the INNER section is
    // exactly the thing that disappears when a turn is virtualized.
    async scrollToLoadMore(onProgress) {
      const cache = newCache();
      this._cache = cache;

      const scroller = findScroller();
      debugLog('scrollToLoadMore: scroller =', describe(scroller),
        '| visibility =', document.visibilityState);
      if (document.visibilityState === 'hidden') {
        debugLog('tab is hidden: IntersectionObserver is paused, virtualized turns cannot materialize');
      }

      const collect = () => harvestInto(cache, onProgress);
      if (!scroller) {
        collect();
        return cache.turns.size;
      }

      const savedTop = scroller.scrollTop;
      const step = Math.max(scroller.clientHeight * 0.75, 200);
      const deadline = Date.now() + MAX_SWEEP_MS;

      collect();
      let stable = 0;
      let lastWrappers = -1;
      for (let i = 0; i < MAX_TICKS && stable < STABLE_TICKS_AT_TOP && Date.now() < deadline; i++) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - step);
        await sleep(SCROLL_DELAY_MS);
        const wrappers = collect();
        if (scroller.scrollTop > 0) {
          stable = 0;
          continue;
        }
        if (wrappers === lastWrappers) stable++;
        else { stable = 0; lastWrappers = wrappers; }
      }
      debugLog('pass A (up) done: wrappers =', lastWrappers, 'cached =', cache.turns.size);

      let lastTop = -1;
      for (let i = 0; i < MAX_TICKS && Date.now() < deadline; i++) {
        if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1) break;
        if (scroller.scrollTop === lastTop) break;
        lastTop = scroller.scrollTop;
        scroller.scrollTop = lastTop + step;
        await sleep(SCROLL_DELAY_MS);
        collect();
      }
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(SCROLL_DELAY_MS);
      collect();
      debugLog('pass B (down) done: cached =', cache.turns.size, 'ordered ids =', cache.order.length);

      scroller.scrollTop = savedTop;
      return cache.turns.size;
    },

    // Called by the framework instead of a live querySelectorAll. Returns
    // turn elements in conversation order: the cached clone when we have
    // one (preferring the larger snapshot, in case the live section is
    // mid-render), the live section otherwise. Ids with neither are
    // counted and reported through lastWarning. Without a prior sweep
    // (scrollFirst off) the order is whatever window the DOM holds now.
    collectTurns() {
      const cache = this._cache || newCache();
      this._cache = null;
      this.lastWarning = null;

      harvestInto(cache, null);
      if (cache.order.length === 0) {
        const live = liveSections();
        debugLog('collectTurns: no wrappers; live sections =', live.length);
        return live;
      }

      const liveById = new Map();
      turnWrappers().forEach(w => {
        liveById.set(w.getAttribute('data-turn-id-container'), sectionOf(w));
      });

      const out = [];
      let missing = 0;
      let fromCache = 0;
      cache.order.forEach(id => {
        const live = liveById.get(id) || null;
        const cached = cache.turns.get(id);
        if (cached && (!live || cached.size >= live.innerHTML.length)) {
          out.push(cached.el);
          fromCache++;
        } else if (live) {
          out.push(live);
        } else {
          missing++;
        }
      });
      debugLog('collectTurns: ordered ids =', cache.order.length, 'from cache =', fromCache,
        'live =', out.length - fromCache, 'still virtualized =', missing);
      if (missing > 0) {
        this.lastWarning = { key: 'warnVirtualizedTurns', args: [String(missing)] };
      }
      return out;
    },

    cleanResponseClone(clone) {
      clone.querySelectorAll(
        'button[aria-label*="Copy" i], button[aria-label*="复制" i], ' +
        '.copy-button, [data-testid="copy-turn-action-button"], ' +
        '[data-testid="good-response-turn-action-button"], ' +
        '[data-testid="bad-response-turn-action-button"]'
      ).forEach(el => el.remove());

      clone.querySelectorAll('[role="presentation"][aria-hidden="true"]').forEach(el => el.remove());
    },

    customTurndownRules(td) {
      td.addRule('chatgptKatexBlock', {
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

      td.addRule('chatgptKatexInline', {
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

  function debugLog(...args) {
    try {
      if (localStorage.getItem('AI_EXPORTER_DEBUG') === '1') {
        console.log('[AI Exporter][chatgpt]', ...args);
      }
    } catch (_) {}
  }

  function describe(el) {
    if (!el) return '<null>';
    const attrs = ['data-scroll-root', 'id'].map(a => {
      const v = el.getAttribute(a);
      return v == null ? '' : `[${a}=${v}]`;
    }).join('');
    return `${el.tagName}${attrs} sh=${el.scrollHeight} ch=${el.clientHeight}`;
  }

  function isScrollable(el) {
    const s = getComputedStyle(el);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight + 10;
  }

  // The scroller sits ABOVE <main>, so a plain `main` lookup is wrong.
  // Prefer the site's own hook, then walk up from a live turn checking
  // overflowY - scrollHeight > clientHeight alone is true for <main> too.
  function findScroller() {
    const roots = [...document.querySelectorAll('[data-scroll-root]')];
    const root = roots.find(r => r.querySelector(TURN_WRAPPER) || r.querySelector(TURN_SECTION));
    if (root && isScrollable(root)) return root;

    let el = document.querySelector(TURN_WRAPPER) || document.querySelector(TURN_SECTION);
    el = el && el.parentElement;
    while (el && el !== document.body) {
      if (isScrollable(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function turnWrappers() {
    return [...document.querySelectorAll(TURN_WRAPPER)].filter(w => {
      const id = w.getAttribute('data-turn-id-container');
      if (!id || SENTINEL_IDS.has(id)) return false;
      return !(w.parentElement && w.parentElement.closest(TURN_WRAPPER));
    });
  }

  function sectionOf(wrapper) {
    return wrapper.matches(TURN_SECTION) ? wrapper : wrapper.querySelector(TURN_SECTION);
  }

  function liveSections() {
    return [...document.querySelectorAll(TURN_SECTION)];
  }

  function newCache() {
    return { order: [], turns: new Map() };
  }

  // Fold the current wrapper window into the global order. The window is
  // contiguous, so an unseen id belongs right after the nearest preceding
  // id we already know (or at the very front when older history loaded).
  function mergeOrder(order, ids) {
    let anchor = -1;
    ids.forEach(id => {
      const idx = order.indexOf(id);
      if (idx >= 0) {
        anchor = idx;
        return;
      }
      order.splice(anchor + 1, 0, id);
      anchor = anchor + 1;
    });
  }

  // Snapshot every materialized turn we have not seen yet, or seen in a
  // smaller state (images / KaTeX still rendering). Returns the wrapper
  // count so the caller can detect lazy history loading.
  function harvestInto(cache, onProgress) {
    const wrappers = turnWrappers();
    mergeOrder(cache.order, wrappers.map(w => w.getAttribute('data-turn-id-container')));
    let captured = 0;
    let virtualized = 0;
    wrappers.forEach(w => {
      const id = w.getAttribute('data-turn-id-container');
      const section = sectionOf(w);
      if (!section) {
        virtualized++;
        return;
      }
      const size = section.innerHTML.length;
      const prev = cache.turns.get(id);
      if (prev && prev.size >= size) return;
      cache.turns.set(id, { size, el: section.cloneNode(true) });
      captured++;
    });
    debugLog('collect tick - wrappers:', wrappers.length,
      'newly captured:', captured,
      'still virtualized:', virtualized,
      'cached total:', cache.turns.size,
      'ordered ids:', cache.order.length);
    if (onProgress) onProgress(cache.turns.size);
    return wrappers.length;
  }

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }

  if (window.__AIExporterTest) {
    window.__AIExporterChatGPTInternals = {
      findScroller, turnWrappers, sectionOf, liveSections, harvestInto, mergeOrder, newCache, adapter
    };
  }
})();
