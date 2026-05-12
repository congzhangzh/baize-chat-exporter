// ============================================================
// AI Chat Exporter - WhatsApp Web Adapter (bubble-based)
//
// See docs/ADAPTER_NOTES.md for the general selector-hardening
// philosophy. The notes below are WhatsApp-specific.
//
// -----------------------------------------------------------
// Anchor priority (most → least stable in practice)
// -----------------------------------------------------------
//   STRUCTURAL (panel + scroller):
//     A. [data-testid="conversation-panel-wrapper"]
//        Wraps the entire active chat panel. WhatsApp uses this
//        in their own QA tooling, so it survives refactors well.
//     B. [data-testid="conversation-panel-messages"] +
//        [data-scrolltracepolicy*="conversation.messages"]
//        The actual scrollable element. Has BOTH a testid and a
//        scroll-trace policy attribute — two independent anchors,
//        either suffices.
//     C. div#main (NOT bare #main — see failure history)
//
//   PER-MESSAGE (bubbles):
//     1. [data-testid^="conv-msg-<id>"]
//        Per-message wrapper used by WhatsApp QA. Each carries
//        `data-id="<msgId>"` (same id as the inner row), making
//        dedup trivial.
//     2. div.message-in / div.message-out
//        Class names that have survived ~5 years of churn. Nested
//        DEEP inside the conv-msg wrapper, but still useful as a
//        primary harvest selector.
//     3. [data-pre-plain-text="[HH:MM, M/D/YYYY] Author: "]
//        WhatsApp keeps this attribute for native copy/paste, so
//        it's part of an observable UX contract.
//     4. [role="row"]
//        Last-ditch: catches media-only bubbles without text.
//
// -----------------------------------------------------------
// Failure history (so we don't relearn the hard way)
// -----------------------------------------------------------
//   - 2026-05 (first): `<div id="main">` removed in WhatsApp Web.
//     Every selector fallback was scoped to `panel.querySelectorAll(...)`
//     where `panel = document.querySelector('#main')` was null, which
//     short-circuited the entire fallback chain and produced
//     "未找到对话内容" on real, open conversations. Fix: walk up from
//     a live bubble; fall back to document.body.
//
//   - 2026-05 (second): `document.querySelector('#main')` started
//     returning an SVG `<mask id="main">` element used by an icon
//     definition somewhere on the page. We then tried to set
//     `scrollTop` on the SVG mask (no-op) and harvested zero
//     bubbles from inside it. Fix: query `div#main` specifically,
//     so id-collisions with non-container elements (SVG masks,
//     <input>, etc.) are skipped automatically.
//
//   - Lesson: NEVER trust a bare id selector for a site you don't
//     control. Always constrain by element type (`div#x`, `main#y`)
//     or verify the node is a sensible container before using it.
//
//   - 2026-05 (third): dedup-by-data-id was silently dropping bubbles.
//     `data-id` lives on the OUTER `[data-testid="conv-msg-*"]`
//     wrapper, but we were running `getAttribute('data-id')` on the
//     INNER `.message-out` div (which has no data-id). Result: every
//     bubble looked id-less, dedup map keyed off `null`, only one
//     bubble was ever stored. Fix: iterate over the outer wrappers
//     and look INSIDE each for the inner role-bearing div.
//
//   - 2026-05 (fourth): Two-jump scrolling (`scrollTop=0`, then
//     `scrollHeight`) only materializes the top and bottom of the
//     virtualized list. Middle bubbles never render → never get
//     captured. Fix: incremental sweep — start at top, advance by
//     ~viewport-height steps, harvest after each step.
//
//   - 2026-05 (fifth): Meta AI bot replies don't carry the
//     `data-pre-plain-text="[time, date] Sender: "` clipboard
//     prefix that contact messages do. Don't fail on missing meta;
//     fall back to "Meta AI" as the author and skip the timestamp.
//     Role can still be inferred from `[data-icon="tail-in"]` when
//     present.
//
// -----------------------------------------------------------
// Virtualization
// -----------------------------------------------------------
//   WhatsApp's chat list is virtualized: offscreen rows render
//   as <div data-virtualized="true" style="min-height: NNNpx">
//   placeholders with no message DOM. We have to scroll the
//   container to materialize them. scrollToLoadMore() does two
//   passes (scroll-to-top for history, scroll-to-bottom for
//   recent messages) and harvests by `data-id` between scrolls,
//   stopping after STABLE_THRESHOLD ticks with no new bubbles.
//
// -----------------------------------------------------------
// Debugging
// -----------------------------------------------------------
//   In the page console:
//     localStorage.AI_EXPORTER_DEBUG = '1'  // enable
//     localStorage.removeItem('AI_EXPORTER_DEBUG')  // disable
//   Reload the tab, then export. Logs are prefixed with
//   `[AI Exporter][whatsapp]` and include the resolved panel,
//   scroller, and per-tick bubble counts.
// ============================================================

(function () {
  const adapter = {
    id: 'whatsapp',
    displayName: 'WhatsApp',
    extractMode: 'bubble-based',

    match(url) {
      return /^https:\/\/web\.whatsapp\.com\//.test(url);
    },

    getConversationTitle() {
      const panel = findChatPanel();
      const root = panel || document;
      const header = root.querySelector('[data-testid="conversation-header"]')
        || root.querySelector('header');
      if (header) {
        const named = header.querySelector('span[title]');
        if (named) {
          const t = named.getAttribute('title') || named.textContent;
          if (t && t.trim()) return t.trim();
        }
        // Fallback: any non-empty heading text inside the header.
        const txt = header.textContent && header.textContent.trim();
        if (txt) return txt.split('\n')[0].slice(0, 80);
      }
      return 'WhatsApp Conversation';
    },

    async scrollToLoadMore(onProgress) {
      const panel = findChatPanel();
      debugLog('scrollToLoadMore: panel =', describePanel(panel));
      if (!panel) {
        debugLog('scrollToLoadMore: no chat panel detected — open a chat first.');
        return 0;
      }

      const scroller = findScrollContainer(panel) || panel;
      debugLog('scrollToLoadMore: scroller =', scroller && scroller.tagName, scroller && scroller.className);

      const collected = new Map();
      const collect = () => {
        // Iterate over the OUTER conv-msg wrappers — they carry data-id and
        // exist for every message (even virtualized ones). Then look for an
        // inner .message-in/.message-out: its presence means the bubble has
        // been materialized and we can capture its content. This dedup
        // strategy is the only correct one because data-id lives on the
        // outer wrapper, NOT on the inner role-bearing div.
        const wrappers = panel.querySelectorAll('[data-testid^="conv-msg-"][data-id]');
        let virtualized = 0;
        let captured = 0;
        wrappers.forEach(wrapper => {
          const id = wrapper.getAttribute('data-id');
          if (!id || collected.has(id)) return;
          const inner = wrapper.querySelector('div.message-in, div.message-out');
          if (!inner) {
            virtualized++;
            return;
          }
          collected.set(id, captureBubble(inner));
          captured++;
        });
        debugLog(
          'collect tick — wrappers:', wrappers.length,
          'newly captured:', captured,
          'still virtualized:', virtualized,
          'cached total:', collected.size
        );
        if (onProgress) onProgress(collected.size);
      };

      const sleep = ms => new Promise(r => setTimeout(r, ms));

      const SCROLL_DELAY = 500;
      const STABLE_THRESHOLD = 3;
      const MAX_PASSES = 3;

      // Pass A: jump to top to trigger history loading (WhatsApp lazy-loads
      // older messages on scrollTop=0).
      collect();
      let lastSize = -1;
      let stable = 0;
      for (let i = 0; i < 30 && stable < STABLE_THRESHOLD; i++) {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(SCROLL_DELAY);
        collect();
        if (collected.size === lastSize) stable++; else { stable = 0; lastSize = collected.size; }
      }

      // Pass B: incremental top-to-bottom sweep. This is the only way to
      // materialize bubbles in the MIDDLE of the list — virtualized lists
      // only render the rows in the visible viewport, so jumping
      // top→bottom in one step would skip everything between.
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        scroller.scrollTop = 0;
        await sleep(SCROLL_DELAY);
        collect();
        const stepSize = Math.max(scroller.clientHeight * 0.75, 200);
        let lastTop = -1;
        // Walk down by ~viewport-sized steps until we hit the bottom.
        // Guard against scrollTop refusing to advance (lastTop check) to
        // avoid spinning forever if the list is shorter than the viewport.
        while (scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 1) {
          if (scroller.scrollTop === lastTop) break;
          lastTop = scroller.scrollTop;
          scroller.scrollTop = lastTop + stepSize;
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
          await sleep(SCROLL_DELAY);
          collect();
        }
        // Land at the absolute bottom once to grab the newest bubbles.
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(SCROLL_DELAY);
        collect();
        // If a pass added nothing, we're done.
        if (collected.size === lastSize) break;
        lastSize = collected.size;
      }

      // Stash the ordered, deduped bubbles on the adapter for collectBubbles()
      this._cachedBubbles = orderBubbles(collected, panel);
      return this._cachedBubbles.length;
    },

    collectBubbles() {
      if (this._cachedBubbles && this._cachedBubbles.length > 0) {
        const out = this._cachedBubbles;
        this._cachedBubbles = null;
        return out;
      }
      return harvestBubbles();
    }
  };

  function debugLog(...args) {
    try {
      if (localStorage.getItem('AI_EXPORTER_DEBUG') === '1') {
        console.log('[AI Exporter][whatsapp]', ...args);
      }
    } catch (_) {}
  }

  function describePanel(panel) {
    if (!panel) return '<null>';
    if (panel === document) return '<document>';
    const tag = panel.tagName || '?';
    const id = panel.id ? `#${panel.id}` : '';
    const tab = panel.getAttribute ? panel.getAttribute('data-tab') : null;
    return `${tag}${id}${tab ? `[data-tab=${tab}]` : ''}`;
  }

  // Resolve the chat panel. Priority (verified against real WhatsApp DOM):
  //   1. `[data-testid="conversation-panel-wrapper"]` — internal QA hook,
  //      survives nearly every refactor.
  //   2. `div#main` — restricted to <div> to avoid SVG `<mask id="main">`
  //      collisions seen in production.
  //   3. Walk up from a live bubble to find the nearest container.
  function findChatPanel() {
    const wrapper = document.querySelector(
      '[data-testid="conversation-panel-wrapper"]'
    );
    if (wrapper) return wrapper;

    const legacy = document.querySelector('div#main');
    if (legacy) return legacy;

    const probe = document.querySelector(
      '[data-testid^="conv-msg-"], div.message-in, div.message-out, [data-pre-plain-text]'
    );
    if (probe) {
      let el = probe.parentElement;
      while (el && el !== document.body) {
        if (el.hasAttribute && el.hasAttribute('data-tab')) return el;
        el = el.parentElement;
      }
      return document.body;
    }

    return null;
  }

  // Find the element that actually scrolls. WhatsApp marks it with a
  // dedicated testid + a scroll-trace policy attribute, both of which we
  // can lean on.
  function findScrollContainer(panel) {
    if (!panel) return null;

    // The explicit scroller. Confirmed across recent builds.
    const messages = panel.querySelector(
      '[data-testid="conversation-panel-messages"], [data-scrolltracepolicy*="conversation.messages"]'
    );
    if (messages) return messages;

    // Older / alternate builds.
    const explicit = panel.querySelector('div.copyable-area, [role="application"]');
    if (explicit) return explicit;

    // Last resort: walk up from a bubble looking for overflow:auto/scroll.
    const bubble = panel.querySelector(
      '[data-testid^="conv-msg-"], div.message-in, div.message-out'
    );
    if (bubble) {
      let el = bubble.parentElement;
      while (el && el !== document.body) {
        const style = getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll')
          && el.scrollHeight > el.clientHeight + 1) {
          return el;
        }
        el = el.parentElement;
      }
    }

    return panel.querySelector('[tabindex="0"]') || panel;
  }

  function harvestBubbles() {
    const panel = findChatPanel();
    debugLog('harvestBubbles panel =', describePanel(panel));
    // WhatsApp renders only one conversation at a time, so a document-wide
    // scan won't bleed in messages from other chats.
    const root = panel || document;

    // Layer 1: long-standing class hooks.
    const primary = root.querySelectorAll('div.message-in, div.message-out');
    debugLog('layer1 .message-in/.message-out count:', primary.length);
    if (primary.length > 0) {
      return Array.from(primary).map(captureBubble);
    }

    // Layer 2: per-message testid wrappers. WhatsApp uses these for its own
    // QA tooling so they survive most refactors; very reliable when class
    // names get hashed.
    const testidRows = root.querySelectorAll('[data-testid^="conv-msg-"]');
    debugLog('layer2 [data-testid^="conv-msg-"] count:', testidRows.length);
    if (testidRows.length > 0) {
      return Array.from(testidRows)
        .map(captureBubbleHeuristic)
        .filter(b => b.html || b.images.length);
    }

    // Layer 3: rows that already carry pre-plain-text metadata. Survives
    // class-name churn because WhatsApp keeps the data attribute for the
    // browser's native copy/paste behavior.
    const anchored = root.querySelectorAll('[data-pre-plain-text]');
    debugLog('layer3 [data-pre-plain-text] count:', anchored.length);
    if (anchored.length > 0) {
      const bubbles = Array.from(anchored)
        .map(node => findBubbleContainer(node))
        .filter(Boolean);
      const deduped = dedupeByElement(bubbles);
      debugLog('layer3 deduped bubble count:', deduped.length);
      if (deduped.length > 0) return deduped.map(captureBubbleHeuristic);
    }

    // Layer 4: rows by role — every message row carries role="row" in the
    // virtualized list. Catches media-only bubbles (no pre-plain-text).
    const rows = root.querySelectorAll('[role="row"]');
    debugLog('layer4 [role="row"] count:', rows.length);
    if (rows.length > 0) {
      return Array.from(rows).map(captureBubbleHeuristic).filter(b => b.html || b.images.length);
    }

    debugLog('all four layers came up empty — open a chat with visible messages first');
    return [];
  }

  function findBubbleContainer(node) {
    // Walk up until we hit something that "looks like" a bubble: either a
    // div with role="row", or a node carrying message-in/message-out.
    // We stop at document.body to avoid runaway traversal.
    let el = node.parentElement;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('role') === 'row') return el;
      if (el.classList && (el.classList.contains('message-in') || el.classList.contains('message-out'))) return el;
      el = el.parentElement;
    }
    return node;
  }

  function dedupeByElement(arr) {
    const seen = new Set();
    const out = [];
    for (const el of arr) {
      if (seen.has(el)) continue;
      seen.add(el);
      out.push(el);
    }
    return out;
  }

  // Heuristic capture for layers 2 and 3 where role-by-class isn't reliable.
  function captureBubbleHeuristic(el) {
    const explicitRole = el.classList && el.classList.contains('message-out')
      ? 'user'
      : el.classList && el.classList.contains('message-in')
        ? 'assistant'
        : null;

    const metaEl = el.querySelector('[data-pre-plain-text]');
    const meta = metaEl ? metaEl.getAttribute('data-pre-plain-text') || '' : '';
    const m = meta.match(/^\[([^,\]]+),\s*([^\]]+)\]\s*([^:]+):/);

    // Fallback role detection: WhatsApp uses tail-in vs tail-out icons,
    // or aria-label on row.
    let role = explicitRole;
    if (!role) {
      if (el.querySelector('[data-icon="tail-out"]')) role = 'user';
      else if (el.querySelector('[data-icon="tail-in"]')) role = 'assistant';
      else role = 'assistant';
    }

    const timestamp = m ? `${m[2]} ${m[1]}` : undefined;
    const author = m ? m[3].trim() : (role === 'user' ? 'You' : 'Contact');

    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'button, [data-icon], .copyable-text [aria-hidden="true"], [role="button"]'
    ).forEach(node => node.remove());

    const textNodes = clone.querySelectorAll(
      'span.selectable-text.copyable-text, span.selectable-text'
    );
    let html = '';
    if (textNodes.length > 0) {
      html = Array.from(textNodes).map(n => n.innerHTML).join('<br>');
    } else {
      // Strip noisy structural wrappers but keep the bubble text.
      const candidate = clone.querySelector('[data-pre-plain-text]') || clone;
      html = candidate.innerHTML;
    }

    const images = [];
    const seen = new Set();
    el.querySelectorAll('img[src]').forEach(img => {
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (!src || seen.has(src)) return;
      if (src.startsWith('data:') && src.length < 300) return;
      if (img.width && img.width < 40) return;
      seen.add(src);
      images.push({ url: src, alt: img.getAttribute('alt') || 'Image' });
    });

    return { role, author, timestamp, html, images };
  }

  function captureBubble(el) {
    // Role detection — three independent signals, any one suffices:
    //   1. .message-out / .message-in class (most direct)
    //   2. tail-out / tail-in icon (still rendered even on Meta AI bot bubbles)
    //   3. data-pre-plain-text presence (only on user-side bubbles)
    let role;
    if (el.classList.contains('message-out')) role = 'user';
    else if (el.classList.contains('message-in')) role = 'assistant';
    else if (el.querySelector('[data-icon="tail-out"]')) role = 'user';
    else if (el.querySelector('[data-icon="tail-in"]')) role = 'assistant';
    else role = 'assistant';

    // Author + timestamp from the pre-plain-text prefix used by clipboard.
    // Meta AI's own replies don't carry this attribute, so we accept the
    // miss and fall back to a sensible default.
    const metaEl = el.querySelector('[data-pre-plain-text]');
    const meta = metaEl ? metaEl.getAttribute('data-pre-plain-text') || '' : '';
    // Examples:
    //   "[15:29, 5/12/2026] Meta AI: "
    //   "[15:29, 12/5/2026] +1 555 1234: "
    const m = meta.match(/^\[([^,\]]+),\s*([^\]]+)\]\s*([^:]+):/);
    const timestamp = m ? `${m[2]} ${m[1]}` : undefined;
    const author = m ? m[3].trim() : (role === 'user' ? 'You' : 'Meta AI');

    // Strip non-content nodes before extracting innerHTML.
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'button, [data-icon], .copyable-text [aria-hidden="true"], [role="button"]'
    ).forEach(node => node.remove());

    // Text extraction fallback chain — try the most specific first, then
    // progressively wider. The selectable-text spans are populated for
    // normal contact messages; Meta AI bot replies put the text into
    // div.copyable-text > div._akbu (or sometimes directly in the
    // .message-in subtree without selectable-text).
    let html = '';
    const selectables = clone.querySelectorAll(
      'span.selectable-text.copyable-text, span.selectable-text'
    );
    if (selectables.length > 0) {
      html = Array.from(selectables).map(n => n.innerHTML).join('<br>');
    } else {
      const copyableDiv = clone.querySelector('div.copyable-text');
      if (copyableDiv) {
        html = copyableDiv.innerHTML;
      } else {
        const akbu = clone.querySelector('div._akbu');
        if (akbu) {
          html = akbu.innerHTML;
        } else {
          // Last resort: dump the whole bubble. Will include some noise
          // but markdown conversion downstream usually copes.
          html = clone.innerHTML;
        }
      }
    }

    const images = [];
    const seen = new Set();
    el.querySelectorAll('img[src]').forEach(img => {
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (!src || seen.has(src)) return;
      // Skip avatars and tiny inline icons.
      if (src.startsWith('data:') && src.length < 300) return;
      if (img.width && img.width < 40) return;
      seen.add(src);
      images.push({ url: src, alt: img.getAttribute('alt') || 'Image' });
    });

    return { role, author, timestamp, html, images };
  }

  function orderBubbles(map, panel) {
    const root = panel || document;
    // Order by the OUTER conv-msg wrappers — they exist for every message
    // regardless of virtualization state, so DOM order is preserved across
    // scroll. Falls back to .message-in/.message-out for older builds.
    const wrappers = Array.from(
      root.querySelectorAll('[data-testid^="conv-msg-"][data-id]')
    );
    const idToOrder = new Map();
    if (wrappers.length > 0) {
      wrappers.forEach((el, idx) => {
        idToOrder.set(el.getAttribute('data-id'), idx);
      });
    } else {
      const liveBubbles = Array.from(
        root.querySelectorAll('div.message-in, div.message-out')
      );
      liveBubbles.forEach((el, idx) => {
        const id = el.getAttribute('data-id') || el.dataset.id;
        if (id) idToOrder.set(id, idx);
      });
    }
    return Array.from(map.entries())
      .sort((a, b) => {
        const oa = idToOrder.has(a[0]) ? idToOrder.get(a[0]) : Infinity;
        const ob = idToOrder.has(b[0]) ? idToOrder.get(b[0]) : Infinity;
        return oa - ob;
      })
      .map(([, value]) => value);
  }

  if (window.__AIExporterRegistry) {
    window.__AIExporterRegistry.register(adapter);
  }

  // Test hook — only when explicitly opted in. Exposes internal functions
  // so we can unit-test panel/scroller/harvest logic against fixture DOMs
  // without spinning up a real browser. Production code paths are
  // unaffected.
  if (window.__AIExporterTest) {
    window.__AIExporterWhatsAppInternals = {
      adapter,
      findChatPanel,
      findScrollContainer,
      harvestBubbles,
      captureBubble,
      captureBubbleHeuristic,
    };
  }
})();
