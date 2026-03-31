// ============================================================
// Gemini Chat Exporter — Content Script
// Runs on gemini.google.com. Loaded AFTER turndown.min.js
// and turndown-plugin-gfm.min.js via manifest content_scripts.
// ============================================================

// ----------------------------------------------------------
// DOM Selector tiers — fallback arrays survive Google redesigns
// ----------------------------------------------------------
const SELECTORS = {
  chatContainer: [
    'chat-history',
    '#chat-history',
    'infinite-scroller',
    '[jsname="K09D7"]',
    'main'
  ],
  conversationTurn: [
    'div.conversation-container',
    '.conversation-container',
    'conversation-container'
  ],
  userQuery: [
    'user-query',
    'query-content',
    '[data-test-id="user-query"]'
  ],
  userQueryText: [
    '.query-text .query-text-line',
    '.query-text p',
    '.query-text',
    'query-text'
  ],
  modelResponse: [
    'model-response',
    'response-container',
    '[data-test-id="model-response"]'
  ],
  modelResponseContent: [
    'message-content .markdown',
    '.model-response-text .markdown',
    '.response-container-content .markdown',
    '.markdown',
    'message-content'
  ],
  conversationTitle: [
    '[data-test-id="conversation-title"]',
    '.conversation-title',
    'mat-sidenav .conversation-title',
    'h1'
  ],
  generatedImages: [
    'generated-image img[src]',
    '.attachment-container img[src]',
    '.generated-images img[src]',
    'model-response img[src]',
    'message-content img[src]'
  ],
  userUploadedImages: [
    'user-query img[src]',
    'query-content img[src]',
    '.query-image img[src]',
    '.uploaded-image img[src]',
    '[data-test-id="user-query"] img[src]'
  ]
};

// ----------------------------------------------------------
// Selector helpers
// ----------------------------------------------------------
function queryFirst(selectorList, root = document) {
  const list = Array.isArray(selectorList) ? selectorList : [selectorList];
  for (const sel of list) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch (_) { /* invalid selector, skip */ }
  }
  return null;
}

function queryAll(selectorList, root = document) {
  const list = Array.isArray(selectorList) ? selectorList : [selectorList];
  for (const sel of list) {
    try {
      const results = root.querySelectorAll(sel);
      if (results.length > 0) return Array.from(results);
    } catch (_) { /* invalid selector, skip */ }
  }
  return [];
}

// ----------------------------------------------------------
// Scroll-to-load: triggers lazy rendering of older messages
// ----------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Find the actual scrollable ancestor of the conversation turns
function findScrollContainer() {
  // Prefer the explicit chat container selectors
  const candidate = queryFirst(SELECTORS.chatContainer);
  if (candidate && candidate.scrollHeight > candidate.clientHeight) return candidate;

  // Walk up from the first turn to find a scrollable ancestor
  const firstTurn = queryFirst(SELECTORS.conversationTurn);
  if (firstTurn) {
    let el = firstTurn.parentElement;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
  }

  // Fall back to documentElement (window scroll)
  return document.documentElement;
}

function triggerScrollEvent(container) {
  container.dispatchEvent(new Event('scroll', { bubbles: true }));
  window.dispatchEvent(new Event('scroll'));
}

async function loadAllMessages(onProgress) {
  const container = findScrollContainer();

  const MAX_ATTEMPTS = 40;
  const SCROLL_DELAY_MS = 900;
  const STABLE_THRESHOLD = 3;

  const savedScrollTop = container.scrollTop;

  // Pass 1: scroll to top to load older messages
  let stableCount = 0;
  let lastTurnCount = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && stableCount < STABLE_THRESHOLD; attempt++) {
    container.scrollTop = 0;
    triggerScrollEvent(container);
    await sleep(SCROLL_DELAY_MS);

    const currentCount = queryAll(SELECTORS.conversationTurn).length;
    if (currentCount === lastTurnCount) {
      stableCount++;
    } else {
      stableCount = 0;
      lastTurnCount = currentCount;
    }
    if (onProgress) onProgress(currentCount);
  }

  // Pass 2: scroll to bottom to load newer messages below original position
  stableCount = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && stableCount < STABLE_THRESHOLD; attempt++) {
    container.scrollTop = container.scrollHeight;
    triggerScrollEvent(container);
    await sleep(SCROLL_DELAY_MS);

    const currentCount = queryAll(SELECTORS.conversationTurn).length;
    if (currentCount === lastTurnCount) {
      stableCount++;
    } else {
      stableCount = 0;
      lastTurnCount = currentCount;
    }
    if (onProgress) onProgress(currentCount);
  }

  container.scrollTop = savedScrollTop;
  triggerScrollEvent(container);
  return lastTurnCount;
}

// ----------------------------------------------------------
// Image URL resolution — fetch blob: / https: URLs to base64
// ----------------------------------------------------------

/**
 * Detect MIME type from blob or URL, fallback to 'image/png'.
 */
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

/**
 * Fetch a URL (blob: or https:) and convert to { base64, mimeType }.
 * Returns null on failure.
 */
async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const mimeType = mimeFromBlob(blob);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return { base64, mimeType };
  } catch (_) {
    return null;
  }
}

/**
 * Convert a URL to a data URL string. Returns original URL on failure.
 */
async function urlToDataUrl(url) {
  const result = await fetchImageAsBase64(url);
  if (!result) return url;
  return `data:${result.mimeType};base64,${result.base64}`;
}

// ----------------------------------------------------------
// Extraction
// ----------------------------------------------------------
function extractUserText(userEl) {
  const lines = queryAll(SELECTORS.userQueryText, userEl);
  if (lines.length > 0) {
    return lines.map(l => l.textContent.trim()).filter(t => t.length > 0).join('\n');
  }
  return userEl.textContent.trim();
}

function extractModelHtml(modelEl) {
  const contentEl = queryFirst(SELECTORS.modelResponseContent, modelEl);
  if (!contentEl) return null;

  // Clone to avoid mutating the live DOM
  const clone = contentEl.cloneNode(true);

  // Remove citation buttons / footnote markers that pollute exported text
  clone.querySelectorAll('.citation-button, .footnote, [data-citation], .cite-marker').forEach(el => el.remove());
  // Remove "Show more" / expand buttons
  clone.querySelectorAll('button, .expand-button').forEach(el => el.remove());

  return clone.innerHTML;
}

/**
 * Extract images from an element using given selector list.
 * Returns array of { url, alt }.
 */
function extractImagesFromElement(el, selectorList) {
  const found = [];
  const seen = new Set();

  for (const sel of selectorList) {
    try {
      const imgs = el.querySelectorAll(sel);
      imgs.forEach(img => {
        const src = img.currentSrc || img.getAttribute('src') || '';
        if (!src || seen.has(src)) return;
        // Skip tiny data URIs (icons / spinners, usually < 300 chars)
        if (src.startsWith('data:') && src.length < 300) return;
        // Skip already-embedded large data URIs (don't re-process)
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
  return extractImagesFromElement(modelEl, SELECTORS.generatedImages);
}

function extractUserImages(userEl, includeImages) {
  if (!includeImages) return [];
  return extractImagesFromElement(userEl, SELECTORS.userUploadedImages);
}

function extractConversation(includeImages) {
  const turns = queryAll(SELECTORS.conversationTurn);

  // Fallback: no wrapper elements — collect interleaved user/model elements
  if (turns.length === 0) {
    return extractConversationFallback(includeImages);
  }

  return turns.map((turn, index) => {
    const userEl = queryFirst(SELECTORS.userQuery, turn);
    const modelEl = queryFirst(SELECTORS.modelResponse, turn);
    return {
      index,
      userText: userEl ? extractUserText(userEl) : null,
      userImages: userEl ? extractUserImages(userEl, includeImages) : [],
      modelHtml: modelEl ? extractModelHtml(modelEl) : null,
      images: modelEl ? extractImages(modelEl, includeImages) : []
    };
  }).filter(t => t.userText || t.modelHtml);
}

function extractConversationFallback(includeImages) {
  // Build synthetic turns by interleaving user-query and model-response elements
  const userEls = queryAll(SELECTORS.userQuery);
  const modelEls = queryAll(SELECTORS.modelResponse);

  const allNodes = [...userEls.map(el => ({ type: 'user', el })),
                    ...modelEls.map(el => ({ type: 'model', el }))]
    .sort((a, b) => {
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
        images: []
      };
    } else if (type === 'model' && currentTurn) {
      currentTurn.modelHtml = extractModelHtml(el);
      currentTurn.images = extractImages(el, includeImages);
    }
  }
  if (currentTurn) turns.push(currentTurn);

  return turns.filter(t => t.userText || t.modelHtml);
}

// ----------------------------------------------------------
// Image resolution for different export modes
// ----------------------------------------------------------

/**
 * Classify whether a URL is local (blob:) or remote (https:).
 */
function isLocalUrl(url) {
  return url.startsWith('blob:') || url.startsWith('data:');
}

/**
 * Resolve images in all turns for INLINE mode.
 * Modifies image URLs in-place to data URLs.
 */
async function resolveImagesInline(turns, includeRemoteImages) {
  for (const turn of turns) {
    const allImages = [...(turn.userImages || []), ...(turn.images || [])];
    for (const img of allImages) {
      if (img.url.startsWith('data:')) continue; // already inline

      const shouldResolve =
        img.url.startsWith('blob:') ||
        (includeRemoteImages && img.url.startsWith('http'));

      if (shouldResolve) {
        img.url = await urlToDataUrl(img.url);
      }
    }
  }
}

/**
 * Resolve images in all turns for EXTRACT mode (ZIP packaging).
 * Returns array of { filename, base64, mimeType }.
 * Modifies image URLs in-place to relative paths.
 */
async function resolveImagesExtract(turns, includeRemoteImages) {
  const extractedImages = [];
  let imageIndex = 0;

  for (const turn of turns) {
    const allImageSets = [
      { images: turn.userImages || [], prefix: 'user' },
      { images: turn.images || [], prefix: 'model' }
    ];

    for (const { images } of allImageSets) {
      for (const img of images) {
        if (img.url.startsWith('data:')) {
          // Already a data URL — extract it
          const match = img.url.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            imageIndex++;
            const mimeType = match[1];
            const ext = extensionFromMime(mimeType);
            const filename = `image_${String(imageIndex).padStart(3, '0')}.${ext}`;
            extractedImages.push({ filename, base64: match[2], mimeType });
            img.url = `images/${filename}`;
          }
          continue;
        }

        const shouldResolve =
          img.url.startsWith('blob:') ||
          (includeRemoteImages && img.url.startsWith('http'));

        if (shouldResolve) {
          const result = await fetchImageAsBase64(img.url);
          if (result) {
            imageIndex++;
            const ext = extensionFromMime(result.mimeType);
            const filename = `image_${String(imageIndex).padStart(3, '0')}.${ext}`;
            extractedImages.push({ filename, base64: result.base64, mimeType: result.mimeType });
            img.url = `images/${filename}`;
          }
          // If fetch failed, keep original URL
        }
      }
    }
  }

  return extractedImages;
}

// ----------------------------------------------------------
// Turndown configuration
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

  // GFM plugin: tables, strikethrough, task lists
  if (typeof turndownPluginGfm !== 'undefined') {
    td.use(turndownPluginGfm.gfm);
  }

  // Math block: $$...$$
  td.addRule('mathBlock', {
    filter: node =>
      node.nodeType === 1 &&
      node.matches('.math-block[data-math], [data-formula], mjx-container[display="true"]'),
    replacement: (_content, node) => {
      const latex =
        node.getAttribute('data-math') ||
        node.getAttribute('data-formula') ||
        node.textContent.trim();
      return `\n\n$$${latex}$$\n\n`;
    }
  });

  // Math inline: $...$
  td.addRule('mathInline', {
    filter: node =>
      node.nodeType === 1 &&
      node.matches('.math-inline[data-math], mjx-container:not([display="true"])'),
    replacement: (_content, node) => {
      const latex =
        node.getAttribute('data-math') ||
        node.textContent.trim();
      return `$${latex}$`;
    }
  });

  // Hard line breaks
  td.addRule('hardBreak', {
    filter: 'br',
    replacement: () => '  \n'
  });

  // Strip Gemini citation markers
  td.addRule('citations', {
    filter: node =>
      node.nodeType === 1 && (
        node.classList.contains('cite-marker') ||
        node.classList.contains('citation-button') ||
        node.getAttribute('data-citation') != null
      ),
    replacement: () => ''
  });

  return td;
}

// ----------------------------------------------------------
// Markdown assembly
// ----------------------------------------------------------
function getConversationTitle() {
  const titleEl = queryFirst(SELECTORS.conversationTitle);
  if (titleEl) {
    const t = titleEl.textContent.trim();
    if (t && t.length > 0) return t;
  }
  return document.title.replace(/ ?[-–|] ?Gemini.*/i, '').trim() || 'Gemini Conversation';
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'gemini_chat';
}

function cleanMarkdown(text) {
  return text
    .replace(/\[cite_start\]/g, '')
    .replace(/\[cite:[\d,\s]+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildMarkdown(turns, td) {
  const title = getConversationTitle();
  const date = new Date().toISOString().split('T')[0];

  let md = `# ${title}\n\n`;
  md += `*Exported from Gemini on ${date}*\n\n`;
  md += `---\n\n`;

  for (const turn of turns) {
    if (turn.userText) {
      md += `## You\n\n`;
      md += `${turn.userText.trim()}\n\n`;

      // User-uploaded images
      if (turn.userImages && turn.userImages.length > 0) {
        turn.userImages.forEach(img => {
          md += `![${img.alt}](${img.url})\n\n`;
        });
      }

      md += `---\n\n`;
    }

    if (turn.modelHtml) {
      md += `## Gemini\n\n`;
      let responseText = cleanMarkdown(td.turndown(turn.modelHtml));
      md += `${responseText}\n\n`;

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

// ----------------------------------------------------------
// Message listener (receives commands from popup)
// ----------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'PING') {
    sendResponse({ ready: true });
    return false;
  }

  if (message.action === 'EXPORT') {
    const {
      mode,
      includeImages,
      scrollFirst,
      imageMode = 'inline',         // 'inline' | 'extract'
      includeRemoteImages = false
    } = message.options;

    (async () => {
      try {
        if (scrollFirst) {
          await loadAllMessages();
        }

        const td = buildTurndownService();
        const turns = extractConversation(includeImages);

        if (turns.length === 0) {
          sendResponse({ error: '未找到对话内容。请确认当前页面是 Gemini 对话，且已完全加载。' });
          return;
        }

        const title = getConversationTitle();
        const filenameBase = sanitizeFilename(title);

        let extractedImages = [];

        if (includeImages) {
          if (imageMode === 'extract') {
            // ZIP mode: resolve images, get separate files, use relative paths in markdown
            extractedImages = await resolveImagesExtract(turns, includeRemoteImages);
          } else {
            // Inline mode: resolve blob/remote URLs to data URLs in-place
            await resolveImagesInline(turns, includeRemoteImages);
          }
        }

        const markdown = buildMarkdown(turns, td);

        sendResponse({
          status: 'done',
          mode,
          markdown,
          filename: filenameBase + (imageMode === 'extract' ? '.zip' : '.md'),
          filenameBase,
          turnCount: turns.length,
          extractedImages: imageMode === 'extract' ? extractedImages : [],
          imageMode
        });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();

    return true; // Keep message channel open for async sendResponse
  }
});
