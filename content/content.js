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

async function loadAllMessages(onProgress) {
  const container = queryFirst(SELECTORS.chatContainer);
  if (!container) throw new Error('找不到对话容器，请确认当前页面是 Gemini 对话页面。');

  const MAX_ATTEMPTS = 40;
  const SCROLL_DELAY_MS = 1200;
  const STABLE_THRESHOLD = 3;

  let stableCount = 0;
  let lastTurnCount = 0;
  const savedScrollTop = container.scrollTop;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && stableCount < STABLE_THRESHOLD; attempt++) {
    container.scrollTop = 0;
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

  // Restore user's scroll position
  container.scrollTop = savedScrollTop;
  return lastTurnCount;
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

function extractImages(modelEl, includeImages) {
  if (!includeImages) return [];

  const found = [];
  const seen = new Set();

  for (const sel of SELECTORS.generatedImages) {
    try {
      const imgs = modelEl.querySelectorAll(sel);
      imgs.forEach(img => {
        const src = img.currentSrc || img.getAttribute('src') || '';
        if (!src || seen.has(src)) return;
        // Skip tiny data URIs (icons / spinners, usually < 300 chars)
        if (src.startsWith('data:') && src.length < 300) return;
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
      currentTurn = { index: turns.length, userText: extractUserText(el), modelHtml: null, images: [] };
    } else if (type === 'model' && currentTurn) {
      currentTurn.modelHtml = extractModelHtml(el);
      currentTurn.images = extractImages(el, includeImages);
    }
  }
  if (currentTurn) turns.push(currentTurn);

  return turns.filter(t => t.userText || t.modelHtml);
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

function buildMarkdown(turns, td, includeImages) {
  const title = getConversationTitle();
  const date = new Date().toISOString().split('T')[0];

  let md = `# ${title}\n\n`;
  md += `*Exported from Gemini on ${date}*\n\n`;
  md += `---\n\n`;

  for (const turn of turns) {
    if (turn.userText) {
      md += `## You\n\n`;
      md += `${turn.userText.trim()}\n\n`;
      md += `---\n\n`;
    }

    if (turn.modelHtml) {
      md += `## Gemini\n\n`;
      let responseText = cleanMarkdown(td.turndown(turn.modelHtml));
      md += `${responseText}\n\n`;

      if (includeImages && turn.images.length > 0) {
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
    const { mode, includeImages, scrollFirst } = message.options;

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

        const markdown = buildMarkdown(turns, td, includeImages);
        const title = getConversationTitle();
        const filename = sanitizeFilename(title) + '.md';

        // Always return markdown; popup handles clipboard write (page loses focus when popup opens)
        sendResponse({ status: 'done', mode, markdown, filename, turnCount: turns.length });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();

    return true; // Keep message channel open for async sendResponse
  }
});
