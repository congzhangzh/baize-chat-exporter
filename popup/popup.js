document.addEventListener('DOMContentLoaded', () => {
  const btnDownload  = document.getElementById('btn-download');
  const btnClipboard = document.getElementById('btn-clipboard');
  const statusEl     = document.getElementById('status');
  const errorEl      = document.getElementById('error');
  const optScroll    = document.getElementById('opt-scroll');
  const optImages    = document.getElementById('opt-images');

  // Restore saved preferences
  chrome.storage.local.get(['includeImages', 'scrollFirst'], prefs => {
    if (prefs.includeImages !== undefined) optImages.checked = prefs.includeImages;
    if (prefs.scrollFirst  !== undefined) optScroll.checked  = prefs.scrollFirst;
  });

  function savePrefs() {
    chrome.storage.local.set({
      includeImages: optImages.checked,
      scrollFirst:   optScroll.checked
    });
  }
  optImages.addEventListener('change', savePrefs);
  optScroll.addEventListener('change',  savePrefs);

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
  // Main export flow
  // --------------------------------------------------------
  async function triggerExport(mode) {
    setButtons(true);
    setError('');

    const scrollFirst    = optScroll.checked;
    const includeImages  = optImages.checked;

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

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        action: 'EXPORT',
        options: { mode, includeImages, scrollFirst }
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

    if (mode === 'clipboard') {
      setStatus(`已复制到剪贴板 ${count}`);
    } else {
      // Relay markdown to service worker for chrome.downloads API
      chrome.runtime.sendMessage({
        action: 'DOWNLOAD',
        markdown: response.markdown,
        filename: response.filename
      });
      setStatus(`下载已开始 ${count}`);
    }

    setButtons(false);
  }

  btnDownload.addEventListener('click',  () => triggerExport('download'));
  btnClipboard.addEventListener('click', () => triggerExport('clipboard'));
});
