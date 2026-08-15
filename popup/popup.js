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

// Shorthand for chrome.i18n.getMessage; substitutions must be strings.
const t = (key, subs) => chrome.i18n.getMessage(key, subs);

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
  // Placeholders survive escape(); substituting 'https?://' before escaping
  // would turn its '?' into a literal and the pattern would never match.
  body = body.replace(/^\*:\/\//, '\u0001');
  body = body.replace(/\*/g, '\u0000');
  body = escape(body);
  body = body.replace(/\u0001/, 'https?://');
  body = body.replace(/\u0000/g, '.*');
  // Chrome match patterns cannot carry ports and match URLs on any port;
  // mirror that so portless patterns still hit ported deployments.
  body = body.replace(/^([^\/]+:\/\/[^\/]+)/, '$1(:\\d+)?');
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
  // permissions.request rejects ported origins (match patterns cannot carry
  // ports and already cover every port) - store the hostname only.
  return `${url.protocol}//${url.hostname}/*`;
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
  // Static labels come from _locales; the English text in popup.html is only
  // a fallback for direct file preview.
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.title = t('appName') || document.title;
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.getElementById('ext-version').textContent = chrome.runtime.getManifest().version;

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
    btnDownloadTxt.textContent =
      optImages.checked && optZip.checked ? t('btnDownloadZip') : t('btnDownloadMd');
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
  // Status messages stay plain text; the spinner is a separate element so
  // no message string ever reaches innerHTML in this privileged page.
  function setStatus(msg, busy = false) {
    statusEl.textContent = '';
    if (busy) {
      const spin = document.createElement('span');
      spin.className = 'spinner';
      statusEl.appendChild(spin);
    }
    statusEl.appendChild(document.createTextNode(msg));
    errorEl.textContent = '';
  }
  function setError(msg) { errorEl.textContent = msg; statusEl.textContent = ''; }
  function setButtons(disabled) { btnDownload.disabled = disabled; btnClipboard.disabled = disabled; }

  // --------------------------------------------------------
  // Active site pill
  // --------------------------------------------------------
  async function refreshActivePill() {
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (_) {
      activeSitePill.textContent = t('siteUnknown');
      activeSitePill.classList.add('inactive');
      return null;
    }
    if (!tab || !tab.url) {
      activeSitePill.textContent = t('siteUnknown');
      activeSitePill.classList.add('inactive');
      return null;
    }
    const hit = resolveSite(tab.url, bindings);
    if (hit) {
      activeSitePill.textContent = hit.binding.displayName;
      activeSitePill.classList.remove('inactive');
      return { tab, hit };
    }
    activeSitePill.textContent = t('siteUnknown');
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

    sitesSummary.textContent = t('sitesSummary', [String(enabledCount), String(customCount)]);
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
      empty.textContent = t('patternDefaultEmpty');
      list.appendChild(empty);
    } else {
      binding.defaults.forEach(p => {
        const row = document.createElement('div');
        row.className = 'default';
        row.textContent = t('patternDefault', [p]);
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
      remove.title = t('removeTitle');
      remove.textContent = '×';
      remove.addEventListener('click', async () => {
        const idx = binding.extra.indexOf(p);
        if (idx >= 0) binding.extra.splice(idx, 1);
        // The same origin may be bound to another adapter; revoking it here
        // would silently break that binding too.
        const stillUsed = bindings.some(b =>
          b !== binding && [...b.defaults, ...b.extra].includes(p)
        );
        if (!stillUsed) {
          try { await chrome.permissions.remove({ origins: [p] }); } catch (_) {}
        }
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
    addBtn.textContent = t('btnAdd');
    // chrome.permissions.request must be called synchronously in the user
    // gesture handler, so we do all preflight work without awaiting first.
    addBtn.addEventListener('click', () => {
      const pattern = normalizeOriginPattern(input.value);
      if (!pattern) {
        setError(t('errInvalidUrl'));
        return;
      }
      if ([...binding.defaults, ...binding.extra].includes(pattern)) {
        setError(t('errDuplicate'));
        return;
      }
      chrome.permissions.request({ origins: [pattern] }, async granted => {
        if (chrome.runtime.lastError) {
          setError(t('errPermissionRequest', [chrome.runtime.lastError.message]));
          return;
        }
        if (!granted) {
          setError(t('errPermissionDenied'));
          return;
        }
        binding.extra.push(pattern);
        await saveSiteBindings(bindings);
        input.value = '';
        setStatus(t('statusSiteAdded', [binding.displayName, pattern]));
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
      help.textContent = t('openwebuiHelp');
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
      throw new Error(t('errInject', [err.message]));
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

    setStatus(scrollFirst ? t('statusScrolling') : t('statusExtracting'), true);

    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (err) {
      setError(t('errTabQuery', [err.message]));
      setButtons(false);
      return;
    }
    if (!tab || !tab.url) {
      setError(t('errNoUrl'));
      setButtons(false);
      return;
    }

    const hit = resolveSite(tab.url, bindings);
    if (!hit) {
      setError(t('errNoSiteMatch'));
      setButtons(false);
      return;
    }
    if (!hit.adapterFile) {
      setError(t('errNoAdapterFile', [hit.binding.adapter]));
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

    if (includeImages) setStatus(t('statusExtractingImages'), true);

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        action: 'EXPORT',
        options: { mode, includeImages, scrollFirst, imageMode, includeRemoteImages }
      });
    } catch (err) {
      setError(t('errSendMessage', [err.message]));
      setButtons(false);
      return;
    }

    if (!response) {
      setError(t('errNoResponse'));
      setButtons(false);
      return;
    }
    if (response.error) {
      setError(response.error);
      setButtons(false);
      return;
    }

    const spoolEnabled = optSpool.checked;

    // Whole sentences come from the message catalog; only the parenthetical
    // detail list is assembled here, so word order survives every locale.
    function exportSummary(withImages) {
      const parts = [];
      if (response.turnCount) {
        if (response.adapterName) parts.push(response.adapterName);
        parts.push(t(
          response.extractMode === 'bubble-based' ? 'fragMessages' : 'fragTurns',
          [String(response.turnCount)]
        ));
      }
      if (withImages && response.extractedImages && response.extractedImages.length > 0) {
        parts.push(t('fragImages', [String(response.extractedImages.length)]));
      }
      if (spoolEnabled) parts.push(t('fragSpool'));
      return parts.length ? `(${parts.join(' · ')})` : '';
    }

    if (mode === 'clipboard') {
      try {
        await navigator.clipboard.writeText(response.markdown);
        if (spoolEnabled) spoolMarkdown(response);
        setStatus(t('statusCopied', [exportSummary(false)]));
      } catch (err) {
        setError(t('errCopyFail', [err.message]));
      }
    } else {
      try {
        if (useZip && response.extractedImages && response.extractedImages.length > 0) {
          setStatus(t('statusZipping'), true);
          const zipDataUrl = await buildZip(
            response.filenameBase,
            response.markdown,
            response.extractedImages
          );
          downloadFile(zipDataUrl, response.filenameBase + '.zip');
          if (spoolEnabled) spoolMarkdown(response);
          setStatus(t('statusDownloadStarted', [exportSummary(true)]));
        } else {
          const dataUrl = textToDataUrl(response.markdown);
          downloadFile(dataUrl, response.filenameBase + '.md');
          if (spoolEnabled) spoolMarkdown(response);
          setStatus(t('statusDownloadStarted', [exportSummary(false)]));
        }
      } catch (err) {
        setError(t('errDownloadFail', [err.message]));
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
