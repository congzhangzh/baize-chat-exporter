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
  const imageSubOpts   = document.getElementById('image-sub-options');

  // Restore saved preferences
  chrome.storage.local.get(
    ['includeImages', 'scrollFirst', 'includeRemoteImages', 'useZip'],
    prefs => {
      if (prefs.includeImages !== undefined)      optImages.checked    = prefs.includeImages;
      if (prefs.scrollFirst  !== undefined)       optScroll.checked    = prefs.scrollFirst;
      if (prefs.includeRemoteImages !== undefined) optRemoteImg.checked = prefs.includeRemoteImages;
      if (prefs.useZip !== undefined)             optZip.checked       = prefs.useZip;
      updateUI();
    }
  );

  function savePrefs() {
    chrome.storage.local.set({
      includeImages:       optImages.checked,
      scrollFirst:         optScroll.checked,
      includeRemoteImages: optRemoteImg.checked,
      useZip:              optZip.checked
    });
  }

  function updateUI() {
    // Show/hide image sub-options
    imageSubOpts.classList.toggle('hidden', !optImages.checked);

    // Update download button text
    if (optImages.checked && optZip.checked) {
      btnDownloadTxt.textContent = '下载 .zip 文件';
    } else {
      btnDownloadTxt.textContent = '下载 .md 文件';
    }
  }

  optImages.addEventListener('change', () => { savePrefs(); updateUI(); });
  optScroll.addEventListener('change',  savePrefs);
  optRemoteImg.addEventListener('change', savePrefs);
  optZip.addEventListener('change', () => { savePrefs(); updateUI(); });

  // --------------------------------------------------------
  // UI helpers
  // --------------------------------------------------------
  function setStatus(msg) {
    statusEl.innerHTML = msg;
    errorEl.textContent = '';
  }

  function setError(msg) {
    errorEl.textContent = msg;
    statusEl.textContent = '';
  }

  function setButtons(disabled) {
    btnDownload.disabled  = disabled;
    btnClipboard.disabled = disabled;
  }

  function spinner(label) {
    return `<span class="spinner"></span>${label}`;
  }

  // --------------------------------------------------------
  // Inject content script if not already running
  // --------------------------------------------------------
  async function ensureContentScript(tabId) {
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
      if (ping && ping.ready) return true;
    } catch (_) {
      // Not injected yet — inject on demand
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'lib/turndown.min.js',
          'lib/turndown-plugin-gfm.min.js',
          'content/content.js'
        ]
      });
      // Give the script a moment to register its listener
      await new Promise(r => setTimeout(r, 150));
      return true;
    } catch (err) {
      throw new Error('无法注入脚本：' + err.message);
    }
  }

  // --------------------------------------------------------
  // Download helpers — directly using chrome.downloads
  // --------------------------------------------------------

  /**
   * Encode a UTF-8 string as a base64 data URL.
   */
  function textToDataUrl(text, mimeType = 'text/markdown') {
    const bytes = new TextEncoder().encode(text);
    const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
    return `data:${mimeType};charset=utf-8;base64,${btoa(binary)}`;
  }

  /**
   * Trigger a download via chrome.downloads API.
   */
  function downloadFile(dataUrl, filename) {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, downloadId => {
      if (chrome.runtime.lastError) {
        console.error('[Gemini Exporter] Download failed:', chrome.runtime.lastError.message);
      }
    });
  }

  /**
   * Build a ZIP file containing markdown + images, return as data URL.
   */
  async function buildZip(filenameBase, markdown, extractedImages) {
    const zip = new JSZip();
    const folder = zip.folder(filenameBase);

    // Add markdown file
    folder.file(filenameBase + '.md', markdown);

    // Add images
    if (extractedImages && extractedImages.length > 0) {
      const imgFolder = folder.folder('images');
      for (const img of extractedImages) {
        // base64 string → binary
        imgFolder.file(img.filename, img.base64, { base64: true });
      }
    }

    // Generate ZIP blob
    const blob = await zip.generateAsync({ type: 'blob' });
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
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
    const useZip            = optZip.checked && includeImages;
    const imageMode         = useZip ? 'extract' : 'inline';

    const loadingMsg = scrollFirst
      ? spinner('正在滚动加载历史消息…')
      : spinner('正在提取对话内容…');
    setStatus(loadingMsg);

    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (err) {
      setError('无法获取当前标签页：' + err.message);
      setButtons(false);
      return;
    }

    if (!tab || !tab.url || !tab.url.startsWith('https://gemini.google.com/')) {
      setError('请先打开一个 Gemini 对话页面（gemini.google.com）。');
      setButtons(false);
      return;
    }

    try {
      await ensureContentScript(tab.id);
    } catch (err) {
      setError(err.message);
      setButtons(false);
      return;
    }

    // Update status for image processing
    if (includeImages) {
      setStatus(spinner('正在提取对话与图片…'));
    }

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
      setError('内容脚本无响应，请刷新 Gemini 页面后重试。');
      setButtons(false);
      return;
    }

    if (response.error) {
      setError(response.error);
      setButtons(false);
      return;
    }

    // Success
    const count = response.turnCount ? `（共 ${response.turnCount} 轮对话）` : '';
    const imgCount = response.extractedImages && response.extractedImages.length > 0
      ? `，${response.extractedImages.length} 张图片`
      : '';

    if (mode === 'clipboard') {
      try {
        await navigator.clipboard.writeText(response.markdown);
        setStatus(`已复制到剪贴板 ${count}`);
      } catch (err) {
        setError('复制失败：' + err.message);
      }
    } else {
      // Download mode
      try {
        if (useZip && response.extractedImages && response.extractedImages.length > 0) {
          setStatus(spinner('正在打包 ZIP…'));
          const zipDataUrl = await buildZip(
            response.filenameBase,
            response.markdown,
            response.extractedImages
          );
          downloadFile(zipDataUrl, response.filenameBase + '.zip');
          setStatus(`下载已开始 ${count}${imgCount}`);
        } else {
          // Single markdown file
          const dataUrl = textToDataUrl(response.markdown);
          downloadFile(dataUrl, response.filenameBase + '.md');
          setStatus(`下载已开始 ${count}`);
        }
      } catch (err) {
        setError('下载失败：' + err.message);
      }
    }

    setButtons(false);
  }

  btnDownload.addEventListener('click',  () => triggerExport('download'));
  btnClipboard.addEventListener('click', () => triggerExport('clipboard'));
});
