// ============================================================
// AI Chat Exporter - Popup
// Drives the export flow plus the per-site configuration panel.
// Uses chrome.storage.local.site_bindings as the source of truth
// for which adapter handles which URL pattern.
// ============================================================

const DEFAULT_SITE_BINDINGS = [
  {
    adapter: 'gemini',
    displayName: 'Gemini',
    enabled: true,
    defaults: ['https://gemini.google.com/*'],
    extra: [],
    dynamic: false
  },
  {
    adapter: 'chatgpt',
    displayName: 'ChatGPT',
    enabled: true,
    defaults: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    extra: [],
    dynamic: false
  },
  {
    adapter: 'claude',
    displayName: 'Claude',
    enabled: true,
    defaults: ['https://claude.ai/*'],
    extra: [],
    dynamic: false
  },
  {
    adapter: 'meta',
    displayName: 'Meta AI',
    enabled: true,
    defaults: ['https://meta.ai/*', 'https://www.meta.ai/*'],
    extra: [],
    dynamic: false
  },
  {
    adapter: 'whatsapp',
    displayName: 'WhatsApp',
    enabled: true,
    defaults: ['https://web.whatsapp.com/*'],
    extra: [],
    dynamic: false
  },
  {
    adapter: 'openwebui',
    displayName: 'OpenWebUI',
    enabled: true,
    defaults: [],
    extra: [],
    dynamic: true
  }
];

const ADAPTER_FILE = {
  gemini: 'content/adapters/gemini.js',
  chatgpt: 'content/adapters/chatgpt.js',
  claude: 'content/adapters/claude.js',
  meta: 'content/adapters/meta.js',
  whatsapp: 'content/adapters/whatsapp.js',
  openwebui: 'content/adapters/openwebui.js'
};

// ----------------------------------------------------------
// Storage helpers
// ----------------------------------------------------------
function loadSiteBindings() {
  return new Promise(resolve => {
    chrome.storage.local.get('site_bindings', data => {
      const stored = Array.isArray(data?.site_bindings) ? data.site_bindings : null;
      if (!stored) {
        resolve(cloneBindings(DEFAULT_SITE_BINDINGS));
        return;
      }

      // Merge new built-ins added in later versions while preserving user state.
      const merged = DEFAULT_SITE_BINDINGS.map(def => {
        const existing = stored.find(b => b.adapter === def.adapter);
        if (!existing) return cloneBinding(def);
        return {
          ...cloneBinding(def),
          enabled: existing.enabled !== false,
          extra: Array.isArray(existing.extra) ? existing.extra.slice() : []
        };
      });
      resolve(merged);
    });
  });
}

function saveSiteBindings(bindings) {
  return new Promise(resolve => {
    chrome.storage.local.set({ site_bindings: bindings }, resolve);
  });
}

function cloneBindings(arr) { return arr.map(cloneBinding); }
function cloneBinding(b) {
  return {
    adapter: b.adapter,
    displayName: b.displayName,
    enabled: b.enabled !== false,
    defaults: Array.isArray(b.defaults) ? b.defaults.slice() : [],
    extra: Array.isArray(b.extra) ? b.extra.slice() : [],
    dynamic: !!b.dynamic
  };
}

// ----------------------------------------------------------
// URL pattern matching (Chrome match pattern -> RegExp)
// ----------------------------------------------------------
function patternToRegex(pattern) {
  const escape = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  let body = pattern;
  body = body.replace(/^\*:\/\//, 'https?://');
  body = body.replace(/\*/g, '\u0000');
  body = escape(body);
  body = body.replace(/\u0000/g, '.*');
  return new RegExp('^' + body + '$');
}

function urlMatchesPattern(url, pattern) {
  try {
    return patternToRegex(pattern).test(url);
  } catch (_) {
    return false;
  }
}

function normalizeOriginPattern(input) {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return null;
  }
  if (!url.origin || url.origin === 'null') return null;
  return url.origin + '/*';
}

function resolveSite(url, bindings) {
  for (const b of bindings) {
    if (!b.enabled) continue;
    const all = [...b.defaults, ...b.extra];
    if (all.some(p => urlMatchesPattern(url, p))) {
      return { binding: b, adapterFile: ADAPTER_FILE[b.adapter] };
    }
  }
  return null;
}

// ----------------------------------------------------------
// DOM
// ----------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const btnDownload    = document.getElementById('btn-download');
  const btnDownloadTxt = document.getElementById('btn-download-text');
  const btnClipboard   = document.getElementById('btn-clipboard');
  const statusEl       = document.getElementById('status');
  const errorEl        = document.getElementById('error');
  const optScroll      = document.getElementById('opt-scroll');
  const optImages      = document.getElementById('opt-images');
  const optRemoteImg   = document.getElementById('opt-remote-images');
  const optZip         = document.getElementById('opt-zip');
  const optSpool       = document.getElementById('opt-spool');
  const imageSubOpts   = document.getElementById('image-sub-options');
  const activeSitePill = document.getElementById('active-site');
  const sitesSummary   = document.getElementById('sites-summary');
  const sitesList      = document.getElementById('sites-list');

  let bindings = [];

  // --------------------------------------------------------
  // Prefs persistence (legacy keys kept for compatibility)
  // --------------------------------------------------------
  chrome.storage.local.get(
    ['includeImages', 'scrollFirst', 'includeRemoteImages', 'useZip', 'spoolEnabled'],
    prefs => {
      if (prefs.includeImages !== undefined)       optImages.checked    = prefs.includeImages;
      if (prefs.scrollFirst  !== undefined)        optScroll.checked    = prefs.scrollFirst;
      if (prefs.includeRemoteImages !== undefined) optRemoteImg.checked = prefs.includeRemoteImages;
      if (prefs.useZip !== undefined)              optZip.checked       = prefs.useZip;
      if (prefs.spoolEnabled !== undefined)        optSpool.checked     = prefs.spoolEnabled;
      updateExportUI();
    }
  );

  function savePrefs() {
    chrome.storage.local.set({
      includeImages:       optImages.checked,
      scrollFirst:         optScroll.checked,
      includeRemoteImages: optRemoteImg.checked,
      useZip:              optZip.checked,
      spoolEnabled:        optSpool.checked
    });
  }

  function updateExportUI() {
    imageSubOpts.classList.toggle('hidden', !optImages.checked);
    if (optImages.checked && optZip.checked) {
      btnDownloadTxt.textContent = '下载 .zip 文件';
    } else {
      btnDownloadTxt.textContent = '下载 .md 文件';
    }
  }

  optImages.addEventListener('change', () => { savePrefs(); updateExportUI(); });
  optScroll.addEventListener('change',  savePrefs);
  optRemoteImg.addEventListener('change', savePrefs);
  optZip.addEventListener('change', () => { savePrefs(); updateExportUI(); });
  optSpool.addEventListener('change', savePrefs);

  // Sponsor links: open in a real tab. Anchor target="_blank" inside a popup
  // frame can be auto-closed before the new tab loads on some Chromium builds.
  document.querySelectorAll('a[data-sponsor]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      chrome.tabs.create({ url: a.href });
    });
  });

  // --------------------------------------------------------
  // Status helpers
  // --------------------------------------------------------
  function setStatus(msg) { statusEl.innerHTML = msg; errorEl.textContent = ''; }
  function setError(msg) { errorEl.textContent = msg; statusEl.textContent = ''; }
  function setButtons(disabled) { btnDownload.disabled = disabled; btnClipboard.disabled = disabled; }
  function spinner(label) { return `<span class="spinner"></span>${label}`; }

  // --------------------------------------------------------
  // Active site pill
  // --------------------------------------------------------
  async function refreshActivePill() {
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (_) {
      activeSitePill.textContent = '未识别站点';
      activeSitePill.classList.add('inactive');
      return null;
    }
    if (!tab || !tab.url) {
      activeSitePill.textContent = '未识别站点';
      activeSitePill.classList.add('inactive');
      return null;
    }
    const hit = resolveSite(tab.url, bindings);
    if (hit) {
      activeSitePill.textContent = hit.binding.displayName;
      activeSitePill.classList.remove('inactive');
      return { tab, hit };
    }
    activeSitePill.textContent = '未识别站点';
    activeSitePill.classList.add('inactive');
    return { tab, hit: null };
  }

  // --------------------------------------------------------
  // Sites config panel
  // --------------------------------------------------------
  function renderSitesPanel() {
    sitesList.innerHTML = '';
    let enabledCount = 0;
    let customCount = 0;

    for (const b of bindings) {
      if (b.enabled) enabledCount++;
      customCount += b.extra.length;
      sitesList.appendChild(renderSiteCard(b));
    }

    sitesSummary.textContent = `(${enabledCount} 启用 · ${customCount} 自定义域)`;
  }

  function renderSiteCard(binding) {
    const card = document.createElement('div');
    card.className = 'site-card';

    // header (toggle + name)
    const header = document.createElement('div');
    header.className = 'site-card-header';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = binding.enabled;
    cb.id = `toggle-${binding.adapter}`;
    cb.addEventListener('change', async () => {
      binding.enabled = cb.checked;
      await saveSiteBindings(bindings);
      renderSitesPanel();
      refreshActivePill();
    });
    const label = document.createElement('label');
    label.htmlFor = cb.id;
    label.className = 'site-name';
    label.textContent = binding.displayName;
    header.appendChild(cb);
    header.appendChild(label);
    card.appendChild(header);

    // patterns
    const list = document.createElement('div');
    list.className = 'pattern-list';

    if (binding.defaults.length === 0 && binding.dynamic) {
      const empty = document.createElement('div');
      empty.className = 'default';
      empty.textContent = '默认: (无,请添加你的部署地址)';
      list.appendChild(empty);
    } else {
      binding.defaults.forEach(p => {
        const row = document.createElement('div');
        row.className = 'default';
        row.textContent = `默认: ${p}`;
        list.appendChild(row);
      });
    }

    binding.extra.forEach(p => {
      const row = document.createElement('div');
      row.className = 'extra-row';
      const span = document.createElement('span');
      span.textContent = `· ${p}`;
      const remove = document.createElement('button');
      remove.className = 'remove-btn';
      remove.title = '删除';
      remove.textContent = '×';
      remove.addEventListener('click', async () => {
        const idx = binding.extra.indexOf(p);
        if (idx >= 0) binding.extra.splice(idx, 1);
        try { await chrome.permissions.remove({ origins: [p] }); } catch (_) {}
        await saveSiteBindings(bindings);
        renderSitesPanel();
        refreshActivePill();
      });
      row.appendChild(span);
      row.appendChild(remove);
      list.appendChild(row);
    });

    card.appendChild(list);

    // add row
    const addRow = document.createElement('div');
    addRow.className = 'add-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = binding.adapter === 'openwebui'
      ? 'https://chat.mycompany.com/'
      : 'https://mirror.example.com/';
    const addBtn = document.createElement('button');
    addBtn.textContent = '添加';
    // chrome.permissions.request must be called synchronously in the user
    // gesture handler, so we do all preflight work without awaiting first.
    addBtn.addEventListener('click', () => {
      const pattern = normalizeOriginPattern(input.value);
      if (!pattern) {
        setError('请输入合法的 URL，例如 https://chat.example.com/');
        return;
      }
      if ([...binding.defaults, ...binding.extra].includes(pattern)) {
        setError('该地址已存在。');
        return;
      }
      chrome.permissions.request({ origins: [pattern] }, async granted => {
        if (chrome.runtime.lastError) {
          setError('权限申请失败：' + chrome.runtime.lastError.message);
          return;
        }
        if (!granted) {
          setError('未授权该域名，扩展无法在此运行。');
          return;
        }
        binding.extra.push(pattern);
        await saveSiteBindings(bindings);
        input.value = '';
        setStatus(`已为 ${binding.displayName} 添加 ${pattern}`);
        renderSitesPanel();
        refreshActivePill();
      });
    });
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    card.appendChild(addRow);

    if (binding.dynamic && binding.defaults.length === 0) {
      const help = document.createElement('div');
      help.className = 'help-line';
      help.textContent = 'OpenWebUI 是自部署的，需先把你的实例地址加进来并授权。';
      card.appendChild(help);
    }

    return card;
  }

  // --------------------------------------------------------
  // Content script injection
  // --------------------------------------------------------
  async function ensureContentScript(tabId, adapterFile) {
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
      if (ping && ping.ready) return true;
    } catch (_) {
      // not yet injected
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'lib/turndown.min.js',
          'lib/turndown-plugin-gfm.min.js',
          'content/adapter-registry.js',
          adapterFile,
          'content/content.js'
        ]
      });
      await new Promise(r => setTimeout(r, 200));
      return true;
    } catch (err) {
      throw new Error('无法注入脚本：' + err.message);
    }
  }

  // --------------------------------------------------------
  // Download helpers
  // --------------------------------------------------------
  function textToDataUrl(text, mimeType = 'text/markdown') {
    const bytes = new TextEncoder().encode(text);
    const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
    return `data:${mimeType};charset=utf-8;base64,${btoa(binary)}`;
  }

  function downloadFile(dataUrl, filename, opts = {}) {
    const conflictAction = opts.conflictAction || 'uniquify';
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction }, () => {
      if (chrome.runtime.lastError) {
        console.error('[AI Exporter] Download failed:', chrome.runtime.lastError.message);
      }
    });
  }

  // ----------------------------------------------------------
  // Spool bucket helpers
  // ----------------------------------------------------------
  function spoolTimestamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  }

  function sanitizeFilenameSegment(name) {
    return (name || 'untitled')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'untitled';
  }

  function buildSpoolFilename(response) {
    const adapter = response.adapterId || 'unknown';
    const base = sanitizeFilenameSegment(response.filenameBase);
    return `ai-chat-spool/${spoolTimestamp()}-${adapter}-${base}.md`;
  }

  function spoolMarkdown(response) {
    if (!response || !response.markdown) return;
    const dataUrl = textToDataUrl(response.markdown);
    downloadFile(dataUrl, buildSpoolFilename(response));
  }

  async function buildZip(filenameBase, markdown, extractedImages) {
    const zip = new JSZip();
    const folder = zip.folder(filenameBase);
    folder.file(filenameBase + '.md', markdown);
    if (extractedImages && extractedImages.length > 0) {
      const imgFolder = folder.folder('images');
      for (const img of extractedImages) {
        imgFolder.file(img.filename, img.base64, { base64: true });
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:application/zip;base64,${btoa(binary)}`;
  }

  // --------------------------------------------------------
  // Main export flow
  // --------------------------------------------------------
  async function triggerExport(mode) {
    setButtons(true);
    setError('');

    const scrollFirst       = optScroll.checked;
    const includeImages     = optImages.checked;
    const includeRemoteImages = optRemoteImg.checked;
    const useZip            = optZip.checked && includeImages && mode === 'download';
    const imageMode         = useZip ? 'extract' : 'inline';

    setStatus(spinner(scrollFirst ? '正在滚动加载历史消息…' : '正在提取对话内容…'));

    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (err) {
      setError('无法获取当前标签页：' + err.message);
      setButtons(false);
      return;
    }
    if (!tab || !tab.url) {
      setError('无法读取当前页面 URL。');
      setButtons(false);
      return;
    }

    const hit = resolveSite(tab.url, bindings);
    if (!hit) {
      setError('当前页面未命中任何启用的站点。请打开支持的 AI 对话页面，或在下方"站点配置"添加/启用站点。');
      setButtons(false);
      return;
    }
    if (!hit.adapterFile) {
      setError(`未找到 ${hit.binding.adapter} 的适配器脚本。`);
      setButtons(false);
      return;
    }

    try {
      await ensureContentScript(tab.id, hit.adapterFile);
    } catch (err) {
      setError(err.message);
      setButtons(false);
      return;
    }

    if (includeImages) setStatus(spinner('正在提取对话与图片…'));

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        action: 'EXPORT',
        options: { mode, includeImages, scrollFirst, imageMode, includeRemoteImages }
      });
    } catch (err) {
      setError('发送消息失败：' + err.message);
      setButtons(false);
      return;
    }

    if (!response) {
      setError('内容脚本无响应，请刷新页面后重试。');
      setButtons(false);
      return;
    }
    if (response.error) {
      setError(response.error);
      setButtons(false);
      return;
    }

    const count = response.turnCount
      ? `（${response.adapterName || ''} · 共 ${response.turnCount} ${response.extractMode === 'bubble-based' ? '条消息' : '轮对话'}）`
      : '';
    const imgCount = response.extractedImages && response.extractedImages.length > 0
      ? `，${response.extractedImages.length} 张图片`
      : '';

    const spoolEnabled = optSpool.checked;

    if (mode === 'clipboard') {
      try {
        await navigator.clipboard.writeText(response.markdown);
        if (spoolEnabled) spoolMarkdown(response);
        setStatus(`已复制到剪贴板 ${count}${spoolEnabled ? '，并写入 spool 桶' : ''}`);
      } catch (err) {
        setError('复制失败：' + err.message);
      }
    } else {
      try {
        if (useZip && response.extractedImages && response.extractedImages.length > 0) {
          setStatus(spinner('正在打包 ZIP…'));
          const zipDataUrl = await buildZip(
            response.filenameBase,
            response.markdown,
            response.extractedImages
          );
          downloadFile(zipDataUrl, response.filenameBase + '.zip');
          if (spoolEnabled) spoolMarkdown(response);
          setStatus(`下载已开始 ${count}${imgCount}${spoolEnabled ? '，并写入 spool 桶' : ''}`);
        } else {
          const dataUrl = textToDataUrl(response.markdown);
          downloadFile(dataUrl, response.filenameBase + '.md');
          if (spoolEnabled) spoolMarkdown(response);
          setStatus(`下载已开始 ${count}${spoolEnabled ? '，并写入 spool 桶' : ''}`);
        }
      } catch (err) {
        setError('下载失败：' + err.message);
      }
    }

    setButtons(false);
  }

  btnDownload.addEventListener('click',  () => triggerExport('download'));
  btnClipboard.addEventListener('click', () => triggerExport('clipboard'));

  // --------------------------------------------------------
  // Boot
  // --------------------------------------------------------
  (async () => {
    bindings = await loadSiteBindings();
    await saveSiteBindings(bindings);
    renderSitesPanel();
    refreshActivePill();
  })();
});
