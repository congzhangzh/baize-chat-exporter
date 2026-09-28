// ============================================================
// AI Chat Exporter - ChatGPT Adapter (turn-based, virtualized)
//
// ChatGPT currently serves TWO page layouts, per account rather than
// per conversation, so the adapter supports both and picks whichever
// the live DOM has:
//   - LEGACY layout (seen on free accounts, 2026-09): one <section> per
//     message, described right below.
//   - APP-SHELL layout (seen on a Plus account, 2026-09-28, for both the
//     Chat and Work modes): one [data-turn-key] block per user+assistant
//     pair, described in the second anchor table.
//
// -----------------------------------------------------------
// Anchor priority - LEGACY layout (verified 2026-08-29, re-checked 2026-09-28)
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
// Anchor priority - APP-SHELL layout (verified 2026-09-28, Chat + Work)
// -----------------------------------------------------------
//   1. [data-turn-key]  one block per user+assistant PAIR; the value is
//      the user message UUID, so it is the dedup key. The list is a
//      plain virtual window (~4 blocks inside a tall div.relative): turns
//      outside it leave NO placeholder at all, so order is accumulated
//      across ticks exactly like the legacy layout.
//   2. [data-user-message-bubble]  the user's bubble. Reactions (an emoji
//      badge) sit next to it, not inside, so reading the bubble keeps them
//      out. Text lives in [data-search-result-target] > div[dir=auto].
//   3. [data-content-search-unit-key$=":assistant"]  assistant unit(s);
//      [data-chatgpt-selection-message-id] is the fallback. The "Worked
//      for 41s" reasoning summary is a separate sibling, not inside it.
//   4. [class*="MarkdownRoot"]  assistant body. The suffix is a CSS-module
//      hash (MarkdownRoot-rZKhxa), hence the substring match. There is no
//      .markdown class and no <pre>: code blocks are
//      div[data-markdown-copy="code-block"] with a language header marked
//      data-markdown-copy="exclude", inline code is
//      span[data-markdown-copy="inline-code"]. cleanResponseClone()
//      rewrites both to <pre><code>/<code> so turndown fences them.
//      Rich Chat-mode replies (place cards, photo strips, wide tables)
//      also render INSIDE MarkdownRoot: photos sit inside
//      <button aria-label="Open image N">, citation pills
//      (a[data-testid="chatgpt-citation"]) carry 32px favicons, and UI
//      buttons have visible text ("Add to Favorites"). stripShellWidgets()
//      unwraps the photos and drops the rest at harvest time.
//   5. [data-app-action-timeline-scroll]  the scroller. It is
//      flex-direction: COLUMN-REVERSE: scrollTop is 0 at the BOTTOM and
//      goes NEGATIVE towards the top. Older turns are paged in as the top
//      is reached ("Loading older messages..." status).
//
//   Pair blocks are normalized at harvest time into
//     section[data-ai-exporter-turn]
//       div[data-ai-exporter-role=user] > div[data-ai-exporter-text] + imgs
//       div[data-ai-exporter-role=assistant] > every assistant unit
//   so the framework's single-query selectors see ONE user and ONE model
//   node per turn, and multi-block Work replies are not cut to the first.
//
// -----------------------------------------------------------
// Failure history
// -----------------------------------------------------------
//   - 2026-09-28: "can't stop, retries forever at the top, and sometimes
//     doesn't refresh at the top". Root cause: at devicePixelRatio
//     1.40625 the column-reverse scroller pins at scrollTop -4989.87 vs
//     a bound of -4991, so `scrollTop > min + 1` read as "not at top"
//     forever and pass A ran into the shared 120s deadline, leaving
//     pass B no time. Separately, once pinned at the top a fetch that
//     missed its trigger never retries: "Loading older messages..."
//     sat unchanged for 60 ticks, and only a real wheel event loaded
//     more (scrollHeight 2647 -> 5831). Fix: atTopEdge() with 2px
//     slack plus a "did not move" test, a time-based idle exit keyed
//     on known ids + scrollHeight, a half-viewport nudge off the top
//     while idle, and separate budgets for pass A and pass B. The
//     status text stays in the DOM when idle, so it is not a usable
//     "still loading" signal. Verified in the page: pass A ends "idle at
//     top" in 16s (hidden tab), and pass B then reaches the bottom;
//     the reporter confirmed a full export in a foreground tab.
//   - 2026-09-28: "it does not work on ChatGPT anymore" (Plus account,
//     Chat and Work mode). Root cause: a new app-shell layout. Probe on a
//     Work conversation: turnWrapper 0, convTurn 0, sectionTurn 0,
//     markdown 0, [data-scroll-root] absent - every legacy anchor gone.
//     Also, the scroller is column-reverse, so the old sweep's
//     `Math.max(0, scrollTop - step)` could never move up at all. Fix:
//     second anchor set (table above), direction-aware scroll bounds,
//     sweep stop keyed on scrollHeight as well as wrapper count, pair
//     normalization, code-block / inline-code rewrite, widget stripping.
//     Free accounts still get the legacy layout, so both paths stay.
//     Verified live: Work chat 16/16 turns, Chat-mode chat 10/10 turns
//     (with photo strips and place cards: 9 photos kept, 0 UI buttons
//     and 0 favicons left), legacy free-account chat unchanged.
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
//
//   App-shell layout probe (legacy counts all 0 = you are on this one):
//
//     (() => { const s = document.querySelector('[data-app-action-timeline-scroll]');
//       return { turns: document.querySelectorAll('[data-turn-key]').length,
//                md: document.querySelectorAll('[class*="MarkdownRoot"]').length,
//                dir: s && getComputedStyle(s).flexDirection,
//                top: s && s.scrollTop, sh: s && s.scrollHeight }; })()
//
//   A 16-turn Work chat showed at most ~4 turns in the DOM at once. In a
//   hidden tab neither `scrollTop` writes nor waiting re-rendered the
//   window, while real wheel events did - the same frames-needed rule
//   as the legacy layout.
// ============================================================

(function () {
  const TURN_WRAPPER = '[data-turn-id-container]';
  const TURN_SECTION = '[data-testid^="conversation-turn"], section[data-turn]';
  const SENTINEL_IDS = new Set(['client-created-root']);

  const SHELL_TURN = '[data-turn-key]';
  const SHELL_SCROLLER = '[data-app-action-timeline-scroll]';
  const SHELL_USER = ['[data-user-message-bubble]', '[data-content-search-unit-key$=":user"]'];
  const SHELL_ASSISTANT = [
    '[data-content-search-unit-key$=":assistant"]',
    '[data-chatgpt-selection-message-id]'
  ];

  const SCROLL_DELAY_MS = 450;
  // How long to sit at the top with nothing new arriving before pass A
  // gives up. Time-based, not tick-based, so a slow history fetch gets the
  // same grace whatever the tick length.
  const TOP_IDLE_MS = 6000;
  // Fractional pixels at non-integer devicePixelRatio: a column-reverse
  // scroller pinned at its top was measured at -4989.87 vs a bound of -4991.
  const EDGE_EPSILON_PX = 2;
  const MAX_TICKS = 400;
  // Separate budgets so a pass A that runs long can never starve pass B.
  const MAX_UP_MS = 90000;
  const MAX_DOWN_MS = 90000;

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
      chatContainer: [SHELL_SCROLLER, '[data-scroll-root]', 'main', '#__next main', '[role="main"]'],
      conversationTurn: [
        '[data-testid^="conversation-turn"]',
        'section[data-turn]',
        SHELL_TURN,
        'article[data-testid^="conversation-turn"]',
        'main article'
      ],
      userQuery: [
        '[data-message-author-role="user"]',
        '[data-ai-exporter-role="user"]',
        ':scope[data-turn="user"] > div'
      ],
      userQueryHtml: ['.markdown'],
      userQueryText: [
        '.whitespace-pre-wrap',
        '[data-message-content]',
        '.text-message',
        '[data-ai-exporter-text]'
      ],
      modelResponse: [
        '[data-message-author-role="assistant"]',
        '[data-ai-exporter-role="assistant"]',
        ':scope[data-turn="assistant"] > div'
      ],
      modelResponseContent: [
        '.markdown.prose',
        '.markdown',
        '.prose',
        '[data-message-content]',
        '[class*="MarkdownRoot"]'
      ],
      conversationTitle: [
        'nav a[aria-current="page"]',
        'header h1',
        '[data-testid="conversation-title"]'
      ],
      generatedImages: [
        '[data-message-author-role="assistant"] img[src]',
        '[data-ai-exporter-role="assistant"] img[src]',
        '[class*="imagegen"] img[src]',
        'img[alt*="generated" i][src]',
        'figure img[src]'
      ],
      userUploadedImages: [
        '[data-message-author-role="user"] img[src]',
        '[data-ai-exporter-role="user"] img[src]'
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
    //   A. walk UP to the top edge. Older turns are fetched lazily on the
    //      way, so the known-id list keeps growing; stop once we have sat
    //      at the top for TOP_IDLE_MS with nothing new, nudging the
    //      scroller off the edge meanwhile to re-trigger the fetch.
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

      // "Nothing new arrived" = same known-id count AND same scrollHeight:
      // the app-shell layout pages older turns in without growing the
      // (windowed) wrapper count. The id count only ever grows, so the
      // signature cannot flip-flop forever the way a live count can.
      collect();
      let lastSig = '';
      let idleSince = 0;
      let nudges = 0;
      let reason = 'max ticks';
      const upDeadline = Date.now() + MAX_UP_MS;
      for (let i = 0; i < MAX_TICKS; i++) {
        if (Date.now() >= upDeadline) { reason = 'time budget'; break; }
        const before = scroller.scrollTop;
        scroller.scrollTop = Math.max(scrollBounds(scroller).min, before - step);
        await sleep(SCROLL_DELAY_MS);
        collect();
        if (!atTopEdge(scroller, before)) {
          idleSince = 0;
          continue;
        }
        const sig = cache.order.length + ':' + scroller.scrollHeight;
        if (sig !== lastSig) {
          lastSig = sig;
          idleSince = Date.now();
          continue;
        }
        if (Date.now() - idleSince >= TOP_IDLE_MS) { reason = 'idle at top'; break; }
        // Pinned at the top, writing the same scrollTop fires no scroll
        // event, so a history fetch that missed its trigger never retries.
        // Back off half a viewport; the next tick scrolls up across the
        // loader's sentinel again.
        scroller.scrollTop = scrollBounds(scroller).min + scroller.clientHeight * 0.5;
        nudges++;
      }
      debugLog('pass A (up) done:', reason, '| ids:scrollHeight =', lastSig,
        '| nudges =', nudges, '| cached =', cache.turns.size);

      const downDeadline = Date.now() + MAX_DOWN_MS;
      for (let i = 0; i < MAX_TICKS && Date.now() < downDeadline; i++) {
        const before = scroller.scrollTop;
        if (before >= scrollBounds(scroller).max - EDGE_EPSILON_PX) break;
        scroller.scrollTop = before + step;
        await sleep(SCROLL_DELAY_MS);
        collect();
        if (Math.abs(scroller.scrollTop - before) < 1) break;
      }
      scroller.scrollTop = scrollBounds(scroller).max;
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
      liveTurns().forEach(t => {
        if (t.node) liveById.set(t.id, t);
      });

      const out = [];
      let missing = 0;
      let fromCache = 0;
      cache.order.forEach(id => {
        const live = liveById.get(id) || null;
        const cached = cache.turns.get(id);
        if (cached && (!live || cached.size >= live.node.innerHTML.length)) {
          out.push(cached.el);
          fromCache++;
        } else if (live) {
          out.push(live.snapshot());
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
      normalizeShellCode(clone);
      clone.querySelectorAll('[data-markdown-copy="exclude"], button[aria-hidden="true"]')
        .forEach(el => el.remove());

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

  // column-reverse scrollers (app-shell layout) keep scrollTop at 0 at the
  // BOTTOM and go negative towards the top; normal ones run 0..range.
  function scrollBounds(el) {
    const range = Math.max(0, el.scrollHeight - el.clientHeight);
    return getComputedStyle(el).flexDirection === 'column-reverse'
      ? { min: -range, max: 0 }
      : { min: 0, max: range };
  }

  // At the top when within EDGE_EPSILON_PX of the bound, or when a scroll
  // up from `before` did not move at all. Either alone is not enough: the
  // bound can be unreachable by a fraction of a pixel, and a real move of
  // less than a pixel happens right at the edge.
  function atTopEdge(el, before) {
    return el.scrollTop - scrollBounds(el).min <= EDGE_EPSILON_PX ||
      Math.abs(el.scrollTop - before) < 1;
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
    const shell = document.querySelector(SHELL_SCROLLER);
    if (shell && isScrollable(shell)) return shell;

    const roots = [...document.querySelectorAll('[data-scroll-root]')];
    const root = roots.find(r => r.querySelector(TURN_WRAPPER) || r.querySelector(TURN_SECTION));
    if (root && isScrollable(root)) return root;

    let el = document.querySelector(SHELL_TURN) ||
      document.querySelector(TURN_WRAPPER) || document.querySelector(TURN_SECTION);
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
    const shell = shellTurns();
    if (shell.length > 0) return shell.map(normalizeShellTurn);
    return [...document.querySelectorAll(TURN_SECTION)];
  }

  function shellTurns() {
    return [...document.querySelectorAll(SHELL_TURN)]
      .filter(t => !(t.parentElement && t.parentElement.closest(SHELL_TURN)));
  }

  // One entry per turn currently in the DOM, whichever layout is live.
  // `node` is null for a legacy placeholder; snapshot() returns the
  // element the framework should read (a normalized clone for app-shell
  // pairs, the live section for legacy turns).
  function liveTurns() {
    const shell = shellTurns();
    if (shell.length > 0) {
      return shell.map(t => ({
        id: 'turn-key:' + t.getAttribute('data-turn-key'),
        node: t,
        snapshot: () => normalizeShellTurn(t)
      }));
    }
    return turnWrappers().map(w => {
      const section = sectionOf(w);
      return {
        id: w.getAttribute('data-turn-id-container'),
        node: section,
        snapshot: () => section
      };
    });
  }

  function firstIn(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function allIn(root, selectors) {
    for (const sel of selectors) {
      const els = [...root.querySelectorAll(sel)].filter(Boolean);
      if (els.length > 0) return els.filter(e => !els.some(o => o !== e && o.contains(e)));
    }
    return [];
  }

  // Block-level children become line breaks. Works on detached clones,
  // where innerText has no layout to go on.
  function textWithBreaks(el) {
    let out = '';
    el.childNodes.forEach(n => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent;
      } else if (n.nodeName === 'BR') {
        out += '\n';
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const inner = textWithBreaks(n);
        if (/^(DIV|P|LI|H[1-6])$/.test(n.nodeName)) {
          if (out && !out.endsWith('\n')) out += '\n';
          out += inner + '\n';
        } else {
          out += inner;
        }
      }
    });
    return out;
  }

  // Flatten an app-shell user+assistant pair into one element with a
  // single user node and a single assistant node (see header).
  function normalizeShellTurn(turn) {
    const out = document.createElement('section');
    out.setAttribute('data-ai-exporter-turn', turn.getAttribute('data-turn-key') || '');

    const bubble = firstIn(turn, SHELL_USER);
    if (bubble) {
      const user = document.createElement('div');
      user.setAttribute('data-ai-exporter-role', 'user');
      const source = bubble.querySelector('[data-search-result-target]') || bubble;
      const text = document.createElement('div');
      text.setAttribute('data-ai-exporter-text', '');
      text.textContent = textWithBreaks(source).replace(/\n{3,}/g, '\n\n').trim();
      user.appendChild(text);
      bubble.querySelectorAll('img[src]').forEach(img => user.appendChild(img.cloneNode(true)));
      out.appendChild(user);
    }

    const units = allIn(turn, SHELL_ASSISTANT);
    if (units.length > 0) {
      const model = document.createElement('div');
      model.setAttribute('data-ai-exporter-role', 'assistant');
      units.forEach(u => model.appendChild(u.cloneNode(true)));
      stripShellWidgets(model);
      out.appendChild(model);
    }
    return out;
  }

  // Rich replies (hotel / place cards, image strips, wide tables) put UI
  // buttons with visible text ("Open image 1", "Add to Favorites") inside
  // MarkdownRoot, and the photos themselves live INSIDE those buttons.
  // Unwrap image buttons, drop the rest. Citation pills carry 32px site
  // favicons that would otherwise be exported as pictures; the link text
  // is kept. Done at harvest time so image extraction sees the same DOM.
  function stripShellWidgets(root) {
    root.querySelectorAll('[data-testid="chatgpt-citation"] img').forEach(img => img.remove());
    root.querySelectorAll('button').forEach(btn => {
      // A detached clone is never isConnected; check containment instead
      // so buttons already removed with an ancestor are skipped.
      if (!root.contains(btn)) return;
      const imgs = [...btn.querySelectorAll('img[src]')];
      if (imgs.length > 0) btn.replaceWith(...imgs);
      else if (!btn.closest('[data-markdown-copy="code-block"]')) btn.remove();
    });
  }

  // App-shell code blocks are <div>s with a <code> inside and a language
  // header; inline code is a <span>. Rewrite both into the plain HTML
  // turndown already knows how to fence.
  function normalizeShellCode(root) {
    root.querySelectorAll('[data-markdown-copy="code-block"]').forEach(block => {
      const code = block.querySelector('code');
      if (!code) return;
      const header = block.querySelector('[data-markdown-copy="exclude"]');
      const labelEl = header && (header.querySelector('.truncate') || header);
      const label = labelEl ? labelEl.textContent.trim().toLowerCase() : '';
      const lang = /^(plain ?text|text|)$/.test(label) ? '' : label.replace(/[^a-z0-9#+-]/g, '');
      const pre = document.createElement('pre');
      const out = document.createElement('code');
      if (lang) out.className = 'language-' + lang;
      out.textContent = code.textContent;
      pre.appendChild(out);
      block.replaceWith(pre);
    });
    root.querySelectorAll('span[data-markdown-copy="inline-code"]').forEach(span => {
      const code = document.createElement('code');
      code.textContent = span.textContent;
      span.replaceWith(code);
    });
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
    const wrappers = liveTurns();
    mergeOrder(cache.order, wrappers.map(t => t.id));
    let captured = 0;
    let virtualized = 0;
    wrappers.forEach(t => {
      if (!t.node) {
        virtualized++;
        return;
      }
      const size = t.node.innerHTML.length;
      const prev = cache.turns.get(t.id);
      if (prev && prev.size >= size) return;
      const snap = t.snapshot();
      cache.turns.set(t.id, { size, el: snap === t.node ? snap.cloneNode(true) : snap });
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
      findScroller, scrollBounds, turnWrappers, sectionOf, liveSections, liveTurns,
      normalizeShellTurn, normalizeShellCode, harvestInto, mergeOrder, newCache, adapter
    };
  }
})();
