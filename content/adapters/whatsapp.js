// ============================================================
// AI Chat Exporter - WhatsApp Web Adapter (bubble-based)
//
// Anchors on multi-year stable hooks:
//   - #main (currently open chat panel)
//   - div.message-in / div.message-out
//   - [data-pre-plain-text] structured metadata
//
// Unlike turn-based AI sites, WhatsApp uses a virtual scroller
// that recycles offscreen bubbles, so scrollToLoadMore() collects
// bubbles while scrolling instead of waiting until everything is
// resident in the DOM.
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
      const headerName = document.querySelector(
        '#main header span[title]'
      );
      if (headerName) {
        const t = headerName.getAttribute('title') || headerName.textContent;
        if (t && t.trim()) return t.trim();
      }
      return 'WhatsApp Conversation';
    },

    async scrollToLoadMore(onProgress) {
      const panel = document.querySelector('#main');
      if (!panel) return 0;

      const scroller = panel.querySelector('div.copyable-area, [role="application"]')
        || panel.querySelector('[tabindex="0"]')
        || panel;

      const collected = new Map();
      const collect = () => {
        const bubbles = panel.querySelectorAll(
          'div.message-in, div.message-out'
        );
        bubbles.forEach(el => {
          const id = el.getAttribute('data-id') || el.dataset.id;
          if (!id) return;
          if (!collected.has(id)) {
            collected.set(id, captureBubble(el));
          }
        });
        if (onProgress) onProgress(collected.size);
      };

      const sleep = ms => new Promise(r => setTimeout(r, ms));

      const MAX_ATTEMPTS = 60;
      const SCROLL_DELAY = 700;
      const STABLE_THRESHOLD = 4;

      // Pass 1: scroll up to load history while harvesting bubbles
      collect();
      let lastSize = -1;
      let stable = 0;
      for (let i = 0; i < MAX_ATTEMPTS && stable < STABLE_THRESHOLD; i++) {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(SCROLL_DELAY);
        collect();
        if (collected.size === lastSize) stable++; else { stable = 0; lastSize = collected.size; }
      }

      // Pass 2: scroll down to capture latest bubbles below initial viewport
      stable = 0;
      for (let i = 0; i < MAX_ATTEMPTS && stable < STABLE_THRESHOLD; i++) {
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(SCROLL_DELAY);
        collect();
        if (collected.size === lastSize) stable++; else { stable = 0; lastSize = collected.size; }
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

      const panel = document.querySelector('#main');
      if (!panel) return [];
      const bubbles = panel.querySelectorAll(
        'div.message-in, div.message-out'
      );
      return Array.from(bubbles).map(captureBubble);
    }
  };

  function captureBubble(el) {
    const role = el.classList.contains('message-out') ? 'user' : 'assistant';
    const metaEl = el.querySelector('[data-pre-plain-text]');
    const meta = metaEl ? metaEl.getAttribute('data-pre-plain-text') || '' : '';
    // Examples:
    //   "[15:29, 5/12/2026] Meta AI: "
    //   "[15:29, 12/5/2026] +1 555 1234: "
    const m = meta.match(/^\[([^,\]]+),\s*([^\]]+)\]\s*([^:]+):/);
    const timestamp = m ? `${m[2]} ${m[1]}` : undefined;
    const author = m ? m[3].trim() : (role === 'user' ? 'You' : 'Contact');

    // Strip tooltip / forwarded labels that aren't real content.
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'button, [data-icon], .copyable-text [aria-hidden="true"], [role="button"]'
    ).forEach(node => node.remove());

    // The textual payload typically lives in span.selectable-text.copyable-text
    const textNodes = clone.querySelectorAll(
      'span.selectable-text.copyable-text, span.selectable-text, div._akbu'
    );
    let html = '';
    if (textNodes.length > 0) {
      html = Array.from(textNodes).map(n => n.innerHTML).join('<br>');
    } else {
      html = clone.innerHTML;
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
    // Use DOM order when available, fall back to insertion order.
    const liveBubbles = Array.from(
      panel.querySelectorAll('div.message-in, div.message-out')
    );
    const idToOrder = new Map();
    liveBubbles.forEach((el, idx) => {
      const id = el.getAttribute('data-id') || el.dataset.id;
      if (id) idToOrder.set(id, idx);
    });
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
})();
