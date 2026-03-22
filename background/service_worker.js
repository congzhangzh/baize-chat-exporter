// ============================================================
// Gemini Chat Exporter — Service Worker
// Only responsibility: receive markdown from popup and trigger
// chrome.downloads.download(), which is unavailable in content scripts.
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'DOWNLOAD') return false;

  const { markdown, filename } = message;

  if (!markdown || !filename) {
    sendResponse({ ok: false, error: 'Missing markdown or filename' });
    return false;
  }

  // Encode markdown as a base64 data URL.
  // TextEncoder handles full Unicode (CJK, emoji, etc.).
  const bytes = new TextEncoder().encode(markdown);
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
  const base64 = btoa(binary);
  const dataUrl = `data:text/markdown;charset=utf-8;base64,${base64}`;

  chrome.downloads.download(
    { url: dataUrl, filename, saveAs: false },
    downloadId => {
      if (chrome.runtime.lastError) {
        console.error('[Gemini Exporter] Download failed:', chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, downloadId });
      }
    }
  );

  return true; // Keep message channel open for async callback
});
