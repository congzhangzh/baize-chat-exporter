// ============================================================
// AI Chat Exporter - Content Script (framework)
// Drives extraction by delegating to a registered adapter for
// the current site.  Adapter-specific selectors, scroll-to-load
// strategy, and HTML cleanup live in content/adapters/*.js.
// ============================================================

(function () {
  if (window.__AIExporterInstalled) {
    // Re-injection (e.g. popup hit a stale instance). Keep the original
    // listener bindings to avoid duplicate sendResponse channels.
    return;
  }
  window.__AIExporterInstalled = true;

  const registry = window.__AIExporterRegistry;
  if (!registry) {
    console.warn('[AI Exporter] Adapter registry missing; content script aborted.');
    return;
  }

  const adapter = registry.getActive();
  if (!adapter) {
    registry.log('No adapter matched this URL:', location.href);
    return;
  }

  registry.log('Active adapter:', adapter.id, '(', adapter.extractMode, ')');

  // ----------------------------------------------------------
  // Storage-driven enable check
  // ----------------------------------------------------------
  function isAdapterEnabled() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get('site_bindings', data => {
          const bindings = data && data.site_bindings;
          if (!Array.isArray(bindings)) {
            resolve(true);
            return;
          }
          const binding = bindings.find(b => b.adapter === adapter.id);
          if (!binding) {
            resolve(true);
            return;
          }
          resolve(binding.enabled !== false);
        });
      } catch (_) {
        resolve(true);
      }
    });
  }

  // ----------------------------------------------------------
  // Selector helpers
  // ----------------------------------------------------------
  function queryFirst(selectorList, root = document) {
    const list = Array.isArray(selectorList) ? selectorList : [selectorList];
    for (const sel of list) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) { /* skip invalid selector */ }
    }
    return null;
  }

  function queryAll(selectorList, root = document) {
    const list = Array.isArray(selectorList) ? selectorList : [selectorList];
    for (const sel of list) {
      try {
        const results = root.querySelectorAll(sel);
        if (results.length > 0) return Array.from(results);
      } catch (_) { /* skip */ }
    }
    return [];
  }

  // ----------------------------------------------------------
  // Generic scroll-to-load (used when adapter doesn't override)
  // ----------------------------------------------------------
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function isScrollable(el) {
    const s = getComputedStyle(el);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight + 10;
  }

  // scrollHeight > clientHeight is NOT enough: ChatGPT's <main> satisfies it
  // while being overflow:visible, so `main.scrollTop = N` silently did
  // nothing. Require a real overflow scroller first; only fall back to the
  // lenient height check when no ancestor declares overflow at all.
  function findScrollContainer() {
    const candidates = adapter.selectors?.chatContainer || [];
    for (const sel of (Array.isArray(candidates) ? candidates : [candidates])) {
      let el = null;
      try { el = document.querySelector(sel); } catch (_) { /* skip */ }
      if (el && isScrollable(el)) return el;
    }

    const firstTurn = queryFirst(adapter.selectors?.conversationTurn || []);
    if (firstTurn) {
      let el = firstTurn.parentElement;
      while (el && el !== document.body) {
        if (isScrollable(el)) return el;
        el = el.parentElement;
      }
      el = firstTurn.parentElement;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight + 10) return el;
        el = el.parentElement;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  function triggerScrollEvent(container) {
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));
  }

  async function loadAllMessages(onProgress) {
    if (typeof adapter.scrollToLoadMore === 'function') {
      return adapter.scrollToLoadMore(onProgress);
    }
    const turnSelectors = adapter.selectors?.conversationTurn || [];
    const container = findScrollContainer();
    const savedScrollTop = container.scrollTop;

    const MAX_ATTEMPTS = 40;
    const SCROLL_DELAY_MS = 900;
    const STABLE_THRESHOLD = 3;

    let stableCount = 0;
    let lastTurnCount = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && stableCount < STABLE_THRESHOLD; attempt++) {
      container.scrollTop = 0;
      triggerScrollEvent(container);
      await sleep(SCROLL_DELAY_MS);
      const currentCount = queryAll(turnSelectors).length;
      if (currentCount === lastTurnCount) stableCount++;
      else { stableCount = 0; lastTurnCount = currentCount; }
      if (onProgress) onProgress(currentCount);
    }

    stableCount = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && stableCount < STABLE_THRESHOLD; attempt++) {
      container.scrollTop = container.scrollHeight;
      triggerScrollEvent(container);
      await sleep(SCROLL_DELAY_MS);
      const currentCount = queryAll(turnSelectors).length;
      if (currentCount === lastTurnCount) stableCount++;
      else { stableCount = 0; lastTurnCount = currentCount; }
      if (onProgress) onProgress(currentCount);
    }

    container.scrollTop = savedScrollTop;
    triggerScrollEvent(container);
    return lastTurnCount;
  }

  // ----------------------------------------------------------
  // Image fetch / encode (site-agnostic)
  // ----------------------------------------------------------
  function mimeFromBlob(blob) {
    if (blob.type && blob.type.startsWith('image/')) return blob.type;
    return 'image/png';
  }

  function extensionFromMime(mime) {
    const map = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp'
    };
    return map[mime] || 'png';
  }

  async function fetchImageAsBase64(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      const mimeType = mimeFromBlob(blob);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return { base64: btoa(binary), mimeType };
    } catch (_) {
      return null;
    }
  }

  async function urlToDataUrl(url) {
    const result = await fetchImageAsBase64(url);
    if (!result) return url;
    return `data:${result.mimeType};base64,${result.base64}`;
  }

  // ----------------------------------------------------------
  // Turn-based extraction
  // ----------------------------------------------------------
  let activeTurndown = null;

  // All hits of the first matching selector, minus the ones nested inside
  // another hit (Canvas embeds a .markdown inside the reply's .markdown).
  function queryAllTopLevel(selectorList, root) {
    const hits = queryAll(selectorList, root);
    return hits.filter(el => !hits.some(o => o !== el && o.contains(el)));
  }

  function extractUserText(userEl) {
    // Messages the user typed as markdown render as .markdown with no
    // plain-text node; convert them properly instead of joining textContent.
    if (adapter.selectors.userQueryHtml && activeTurndown) {
      const blocks = queryAllTopLevel(adapter.selectors.userQueryHtml, userEl);
      if (blocks.length > 0) {
        return blocks
          .map(b => cleanMarkdown(activeTurndown.turndown(b.cloneNode(true).innerHTML)))
          .filter(t => t.length > 0)
          .join('\n\n');
      }
    }
    const lines = queryAll(adapter.selectors.userQueryText, userEl);
    if (lines.length > 0) {
      return lines.map(l => l.textContent.trim()).filter(t => t.length > 0).join('\n');
    }
    return userEl.textContent.trim();
  }

  function extractModelHtml(modelEl) {
    // A reply can be split into several sibling content blocks (text,
    // generated image, more text). Adapters that have verified their first
    // selector never matches non-answer blocks opt in via joinResponseBlocks.
    const blocks = adapter.joinResponseBlocks
      ? queryAllTopLevel(adapter.selectors.modelResponseContent, modelEl)
      : [queryFirst(adapter.selectors.modelResponseContent, modelEl)].filter(Boolean);
    if (blocks.length === 0) return null;
    return blocks.map(block => {
      const clone = block.cloneNode(true);
      if (typeof adapter.cleanResponseClone === 'function') {
        adapter.cleanResponseClone(clone);
      }
      return clone.innerHTML;
    }).join('\n');
  }

  function extractImagesFromElement(el, selectorList) {
    const found = [];
    const seen = new Set();
    for (const sel of selectorList) {
      try {
        const imgs = el.querySelectorAll(sel);
        imgs.forEach(img => {
          const src = img.currentSrc || img.getAttribute('src') || '';
          if (!src || seen.has(src)) return;
          if (src.startsWith('data:') && src.length < 300) return;
          if (src.startsWith('data:') && src.length >= 300) {
            seen.add(src);
            found.push({ url: src, alt: img.getAttribute('alt') || 'Image' });
            return;
          }
          try {
            const abs = new URL(src, window.location.href).href;
            seen.add(src);
            found.push({ url: abs, alt: img.getAttribute('alt') || 'Image' });
          } catch (_) {}
        });
      } catch (_) {}
    }
    return found;
  }

  function extractImages(modelEl, includeImages) {
    if (!includeImages) return [];
    return extractImagesFromElement(modelEl, adapter.selectors.generatedImages || []);
  }

  function extractUserImages(userEl, includeImages) {
    if (!includeImages) return [];
    return extractImagesFromElement(userEl, adapter.selectors.userUploadedImages || []);
  }

  function hasContent(t) {
    return !!(t.userText || t.modelHtml ||
      (t.images && t.images.length) || (t.userImages && t.userImages.length));
  }

  function extractTurnConversation(includeImages) {
    // Virtualizing sites (ChatGPT) hand back cached clones harvested during
    // scrollToLoadMore, because the live DOM only holds the turns near the
    // viewport at any given moment.
    const turns = typeof adapter.collectTurns === 'function'
      ? adapter.collectTurns()
      : queryAll(adapter.selectors.conversationTurn);
    registry.log('Turn count from primary selectors:', turns.length);

    if (turns.length === 0) {
      return extractTurnConversationFallback(includeImages);
    }

    return turns.map((turn, index) => {
      const userEl = queryFirst(adapter.selectors.userQuery, turn);
      const modelEl = queryFirst(adapter.selectors.modelResponse, turn);
      const modelLabel = modelEl && typeof adapter.decorateModelLabel === 'function'
        ? adapter.decorateModelLabel(modelEl)
        : adapter.displayName;
      return {
        index,
        userText: userEl ? extractUserText(userEl) : null,
        userImages: userEl ? extractUserImages(userEl, includeImages) : [],
        modelHtml: modelEl ? extractModelHtml(modelEl) : null,
        modelLabel,
        images: modelEl ? extractImages(modelEl, includeImages) : []
      };
    }).filter(hasContent);
  }

  function extractTurnConversationFallback(includeImages) {
    const userEls = queryAll(adapter.selectors.userQuery);
    const modelEls = queryAll(adapter.selectors.modelResponse);
    registry.log('Fallback user/model counts:', userEls.length, modelEls.length);

    const allNodes = [
      ...userEls.map(el => ({ type: 'user', el })),
      ...modelEls.map(el => ({ type: 'model', el }))
    ].sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    const turns = [];
    let currentTurn = null;

    for (const { type, el } of allNodes) {
      if (type === 'user') {
        if (currentTurn) turns.push(currentTurn);
        currentTurn = {
          index: turns.length,
          userText: extractUserText(el),
          userImages: extractUserImages(el, includeImages),
          modelHtml: null,
          modelLabel: adapter.displayName,
          images: []
        };
      } else if (type === 'model' && currentTurn) {
        currentTurn.modelHtml = extractModelHtml(el);
        if (typeof adapter.decorateModelLabel === 'function') {
          currentTurn.modelLabel = adapter.decorateModelLabel(el);
        }
        currentTurn.images = extractImages(el, includeImages);
      }
    }
    if (currentTurn) turns.push(currentTurn);
    return turns.filter(hasContent);
  }

  // ----------------------------------------------------------
  // Bubble-based extraction
  // ----------------------------------------------------------
  function extractBubbleConversation(includeImages) {
    if (typeof adapter.collectBubbles !== 'function') return [];
    const bubbles = adapter.collectBubbles();
    registry.log('Bubble count:', bubbles.length);
    return bubbles.map(b => ({
      role: b.role,
      author: b.author,
      timestamp: b.timestamp,
      html: b.html,
      images: includeImages ? (b.images || []) : []
    }));
  }

  // ----------------------------------------------------------
  // Image resolution (shared)
  // ----------------------------------------------------------
  async function resolveTurnImagesInline(turns, includeRemoteImages) {
    for (const turn of turns) {
      const allImages = [...(turn.userImages || []), ...(turn.images || [])];
      for (const img of allImages) {
        if (img.url.startsWith('data:')) continue;
        const shouldResolve =
          img.url.startsWith('blob:') ||
          (includeRemoteImages && img.url.startsWith('http'));
        if (shouldResolve) img.url = await urlToDataUrl(img.url);
      }
    }
  }

  async function resolveTurnImagesExtract(turns, includeRemoteImages) {
    const extracted = [];
    let imageIndex = 0;

    for (const turn of turns) {
      const groups = [turn.userImages || [], turn.images || []];
      for (const images of groups) {
        for (const img of images) {
          imageIndex = await packImage(img, imageIndex, extracted, includeRemoteImages);
        }
      }
    }
    return extracted;
  }

  async function resolveBubbleImagesInline(bubbles, includeRemoteImages) {
    for (const b of bubbles) {
      for (const img of (b.images || [])) {
        if (img.url.startsWith('data:')) continue;
        const shouldResolve =
          img.url.startsWith('blob:') ||
          (includeRemoteImages && img.url.startsWith('http'));
        if (shouldResolve) img.url = await urlToDataUrl(img.url);
      }
    }
  }

  async function resolveBubbleImagesExtract(bubbles, includeRemoteImages) {
    const extracted = [];
    let imageIndex = 0;
    for (const b of bubbles) {
      for (const img of (b.images || [])) {
        imageIndex = await packImage(img, imageIndex, extracted, includeRemoteImages);
      }
    }
    return extracted;
  }

  async function packImage(img, imageIndex, out, includeRemoteImages) {
    if (img.url.startsWith('data:')) {
      const match = img.url.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        imageIndex++;
        const mimeType = match[1];
        const filename = `image_${String(imageIndex).padStart(3, '0')}.${extensionFromMime(mimeType)}`;
        out.push({ filename, base64: match[2], mimeType });
        img.url = `images/${filename}`;
      }
      return imageIndex;
    }
    const shouldResolve =
      img.url.startsWith('blob:') ||
      (includeRemoteImages && img.url.startsWith('http'));
    if (!shouldResolve) return imageIndex;

    const result = await fetchImageAsBase64(img.url);
    if (!result) return imageIndex;
    imageIndex++;
    const filename = `image_${String(imageIndex).padStart(3, '0')}.${extensionFromMime(result.mimeType)}`;
    out.push({ filename, base64: result.base64, mimeType: result.mimeType });
    img.url = `images/${filename}`;
    return imageIndex;
  }

  // ----------------------------------------------------------
  // Turndown
  // ----------------------------------------------------------
  function buildTurndownService() {
    const td = new TurndownService({
      codeBlockStyle: 'fenced',
      headingStyle: 'atx',
      emDelimiter: '*',
      strongDelimiter: '**',
      hr: '---',
      bulletListMarker: '-'
    });
    if (typeof turndownPluginGfm !== 'undefined') {
      td.use(turndownPluginGfm.gfm);
    }
    td.addRule('hardBreak', {
      filter: 'br',
      replacement: () => '  \n'
    });
    if (typeof adapter.customTurndownRules === 'function') {
      adapter.customTurndownRules(td);
    }
    return td;
  }

  // ----------------------------------------------------------
  // Markdown assembly
  // ----------------------------------------------------------
  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'ai_chat';
  }

  function getTitle() {
    if (typeof adapter.getConversationTitle === 'function') {
      try {
        const t = adapter.getConversationTitle(queryFirst, queryAll);
        if (t && t.trim()) return t.trim();
      } catch (err) {
        registry.log('adapter.getConversationTitle threw:', err);
      }
    }
    return 'AI Conversation';
  }

  function cleanMarkdown(text) {
    let out = text.replace(/\n{3,}/g, '\n\n');
    if (typeof adapter.cleanMarkdown === 'function') {
      out = adapter.cleanMarkdown(out);
    }
    return out.trim();
  }

  function buildTurnMarkdown(turns, td) {
    const title = getTitle();
    const date = new Date().toISOString().split('T')[0];

    let md = `# ${title}\n\n`;
    md += `*Exported from ${adapter.displayName} on ${date}*\n\n---\n\n`;

    for (const turn of turns) {
      if (turn.userText) {
        md += `## You\n\n${turn.userText.trim()}\n\n`;
        if (turn.userImages && turn.userImages.length > 0) {
          turn.userImages.forEach(img => {
            md += `![${img.alt}](${img.url})\n\n`;
          });
        }
        md += `---\n\n`;
      }
      if (turn.modelHtml || (turn.images && turn.images.length > 0)) {
        const label = turn.modelLabel || adapter.displayName;
        md += `## ${label}\n\n`;
        if (turn.modelHtml) md += `${cleanMarkdown(td.turndown(turn.modelHtml))}\n\n`;
        if (turn.images && turn.images.length > 0) {
          turn.images.forEach(img => {
            md += `![${img.alt}](${img.url})\n\n`;
          });
        }
        md += `---\n\n`;
      }
    }
    return md;
  }

  function buildBubbleMarkdown(bubbles, td) {
    const title = getTitle();
    const date = new Date().toISOString().split('T')[0];

    let md = `# ${title}\n\n`;
    md += `*Exported from ${adapter.displayName} on ${date}*\n\n---\n\n`;

    for (const b of bubbles) {
      const author = b.role === 'user' ? (b.author || 'You') : (b.author || 'Contact');
      const ts = b.timestamp ? ` · ${b.timestamp}` : '';
      md += `**${author}${ts}**\n\n`;
      const body = b.html ? cleanMarkdown(td.turndown(b.html)) : '';
      if (body) md += `${body}\n\n`;
      if (b.images && b.images.length > 0) {
        b.images.forEach(img => {
          md += `![${img.alt}](${img.url})\n\n`;
        });
      }
      md += `---\n\n`;
    }
    return md;
  }

  // ----------------------------------------------------------
  // Message dispatch
  // ----------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'PING') {
      sendResponse({ ready: true, adapter: adapter.id, displayName: adapter.displayName });
      return false;
    }

    if (message.action === 'EXPORT') {
      const {
        mode,
        includeImages,
        scrollFirst,
        imageMode = 'inline',
        includeRemoteImages = false
      } = message.options;

      (async () => {
        try {
          const enabled = await isAdapterEnabled();
          if (!enabled) {
            sendResponse({ error: chrome.i18n.getMessage('errAdapterDisabled', [adapter.displayName]) });
            return;
          }

          if (scrollFirst) {
            await loadAllMessages();
          }

          const td = buildTurndownService();
          activeTurndown = td;
          let markdown;
          let extractedImages = [];
          let unitCount = 0;

          if (adapter.extractMode === 'bubble-based') {
            const bubbles = extractBubbleConversation(includeImages);
            if (bubbles.length === 0) {
              sendResponse({
                error: chrome.i18n.getMessage('errNoConversation', [adapter.displayName])
              });
              return;
            }
            if (includeImages) {
              if (imageMode === 'extract') {
                extractedImages = await resolveBubbleImagesExtract(bubbles, includeRemoteImages);
              } else {
                await resolveBubbleImagesInline(bubbles, includeRemoteImages);
              }
            }
            markdown = buildBubbleMarkdown(bubbles, td);
            unitCount = bubbles.length;
          } else {
            const turns = extractTurnConversation(includeImages);
            if (turns.length === 0) {
              sendResponse({
                error: chrome.i18n.getMessage('errNoConversation', [adapter.displayName])
              });
              return;
            }
            if (includeImages) {
              if (imageMode === 'extract') {
                extractedImages = await resolveTurnImagesExtract(turns, includeRemoteImages);
              } else {
                await resolveTurnImagesInline(turns, includeRemoteImages);
              }
            }
            markdown = buildTurnMarkdown(turns, td);
            unitCount = turns.length;
          }

          const title = getTitle();
          const filenameBase = sanitizeFilename(title);

          // Adapters flag partial captures (e.g. turns that never
          // materialized) as { key, args }; translate here so adapters
          // stay free of chrome.* calls.
          let warning = null;
          if (adapter.lastWarning && adapter.lastWarning.key) {
            try {
              warning = chrome.i18n.getMessage(adapter.lastWarning.key, adapter.lastWarning.args || []);
            } catch (_) { /* fall through */ }
            registry.log('Adapter warning:', adapter.lastWarning);
          }

          sendResponse({
            status: 'done',
            warning,
            mode,
            markdown,
            filename: filenameBase + (imageMode === 'extract' ? '.zip' : '.md'),
            filenameBase,
            turnCount: unitCount,
            extractedImages: imageMode === 'extract' ? extractedImages : [],
            imageMode,
            adapterId: adapter.id,
            adapterName: adapter.displayName,
            extractMode: adapter.extractMode
          });
        } catch (err) {
          console.error('[AI Exporter] Export failed:', err);
          sendResponse({ error: err.message });
        }
      })();

      return true;
    }
  });
})();
