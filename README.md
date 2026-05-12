# AI Chat Exporter

> One-click export for conversations from **Gemini, ChatGPT, Claude, Meta AI, WhatsApp Web** (Meta AI or any contact), and **self-hosted OpenWebUI** — to clean, image-embedded Markdown.

Originally born as *Gemini Chat Exporter*. Now a generic per-site adapter framework: every site is a tiny adapter file. The next site you add is one `content/adapters/<name>.js` away.

---

## Supported sites

| Site | URL | Mode | Notes |
|------|-----|------|-------|
| **Gemini** | `gemini.google.com` | turn-based | Original support, math + citations cleaned |
| **ChatGPT** | `chatgpt.com` / `chat.openai.com` | turn-based | KaTeX `$...$` / `$$...$$` reconstructed |
| **Claude** | `claude.ai` | turn-based | Artifacts placeholder, Extended Thinking wrapped in `<details>` |
| **Meta AI** | `meta.ai` / `www.meta.ai` | turn-based | Best-guess selectors with multi-layer fallbacks |
| **WhatsApp Web** | `web.whatsapp.com` | bubble-based | Works for any chat, including Meta AI contact. Timestamps preserved. |
| **OpenWebUI** | *user-supplied* | turn-based | Add your self-hosted deployment in popup → runtime permission grant |

Each adapter is independent; UI changes on one site never break another.

---

## How exports look

**Turn-based** (Gemini / ChatGPT / Claude / Meta / OpenWebUI):

```markdown
# Conversation Title

*Exported from ChatGPT on 2026-05-12*

---

## You

Help me analyze this Transformer diagram...

---

## ChatGPT

This image shows the standard **Encoder-Decoder Transformer** architecture...

$$\text{Attention}(Q,K,V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$

---
```

**Bubble-based** (WhatsApp Web):

```markdown
# Meta AI

*Exported from WhatsApp on 2026-05-12*

---

**You · 5/12/2026 15:28**

Hi, what can you do?

---

**Meta AI · 5/12/2026 15:29**

I can answer questions, help write, analyze images...

---
```

---

## Two image modes

- **Inline (default)**: images become `data:image/...;base64,...` URIs embedded directly in the Markdown. Single file, paste anywhere.
- **ZIP**: download a `.zip` with `your_title/your_title.md` plus `your_title/images/image_001.png` style siblings.

Local uploads (`blob:` URLs) always work; remote images are gated behind the "下载远程图片" / "Download remote images" checkbox to avoid surprise CORS hits.

---

## Architecture

```
manifest.json                 5 static content_scripts groups +
                              optional_host_permissions for OpenWebUI

content/
├── adapter-registry.js       window.__AIExporterRegistry — register/getActive/debug
├── content.js                Generic framework: pipelines, image fetch,
│                             Turndown, message handling
└── adapters/
    ├── gemini.js             turn-based
    ├── chatgpt.js            turn-based, KaTeX + copy-button cleanup
    ├── claude.js             turn-based, Artifact placeholder + Thinking <details>
    ├── meta.js               turn-based, multi-layer fallback selectors
    ├── whatsapp.js           bubble-based, virtual-scroll harvesting
    └── openwebui.js          turn-based, injected on demand by popup

popup/
├── popup.html                Export buttons + site-config panel
└── popup.js                  Drives storage-backed bindings, dynamic
                              chrome.permissions.request() for new sites
```

### Adapter interface (informal)

```js
{
  id, displayName,
  extractMode: 'turn-based' | 'bubble-based',
  match(url),
  selectors?: { ... },          // turn-based
  collectBubbles?(),             // bubble-based
  scrollToLoadMore?(onProgress), // optional, overrides generic scroller
  getConversationTitle(queryFirst),
  cleanResponseClone?(clone),
  customTurndownRules?(td),
  decorateModelLabel?(modelEl),  // OpenWebUI multi-model
  cleanMarkdown?(text)
}
```

### Selector hardening

Every selector field is an **array of fallbacks** in priority order. Stability ranking:

1. **Gemini** — verified in production
2. **WhatsApp Web** — anchors (`message-in/out`, `[data-pre-plain-text]`) stable for years
3. **ChatGPT** — `[data-message-author-role]` is multi-year stable
4. **Claude** — `data-testid="user-message"` / `.font-claude-response` are stable; Artifacts/Thinking are degraded gracefully
5. **OpenWebUI** — based on open-source Svelte templates; v0.1/0.3/0.5+ all covered by fallbacks
6. **Meta AI** — **best-guess only**. No published selectors exist; expect to refine after first real-world run

If an adapter goes blank, enable debug logging in the page console:

```js
localStorage.AI_EXPORTER_DEBUG = '1'
```

You'll see which selector layers matched (or didn't), which makes filing a fix obvious.

---

## Configurable site bindings

Every adapter can be enabled/disabled and bound to **extra domains** at runtime (e.g. ChatGPT mirrors, internal OpenWebUI, private Claude proxies). The data model in `chrome.storage.local.site_bindings`:

```js
{
  adapter: 'chatgpt',
  enabled: true,
  defaults: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],  // read-only, declared in manifest
  extra:    ['https://gpt.mycompany.com/*']                          // user-added, runtime-granted
}
```

In the popup, expand **"站点配置"** to:
- Toggle any built-in adapter on/off (disabled adapters silently no-op even on their default domains)
- Add an `extra` pattern — clicking "添加" triggers `chrome.permissions.request({origins: [...]})` synchronously inside the click handler; Chrome shows its native prompt
- Remove an `extra` pattern — calls `chrome.permissions.remove(...)` to revoke

**Limitations** (intentional, for safety):
- `defaults` are read-only because they're declared in `manifest.json` `host_permissions` and can't be revoked at runtime.
- You cannot mint a brand-new adapter type from the UI — that requires code (a new file in `content/adapters/`).

---

## Install (developer mode)

1. Clone this repo
2. Open `chrome://extensions`
3. Toggle **Developer mode**
4. Click **Load unpacked**
5. Select this folder

Works on any Chromium browser: Chrome, Edge, Brave, Opera, Arc, Vivaldi — zero modifications. See *Browser compatibility* below for Firefox status.

---

## Browser compatibility

| Browser | Status |
|---------|--------|
| Chrome, Edge, Brave, Opera, Arc, Vivaldi | ✅ Fully supported (MV3) |
| Firefox | ⏳ Followup. See **Roadmap** below |
| Safari | ❌ Different extension model (WKWebExtension) |

---

## Roadmap / Known limitations

- **Firefox MV3 adaptation** (followup, not in v2.0): swap `background.service_worker` → `background.scripts`, vendor [webextension-polyfill](https://github.com/mozilla/webextension-polyfill), add `browser_specific_settings.gecko`, write fallback UX for `optional_host_permissions` (Firefox doesn't show a native prompt — guide users to `about:addons → permissions`).
- **Meta AI selectors** are best-guess; expect to iterate after community feedback. Run with `localStorage.AI_EXPORTER_DEBUG = '1'` to see what matched.
- **WhatsApp Web virtual scroll** recycles offscreen bubbles. For very long histories the scroll-and-harvest loop may miss the deepest bubbles. Workaround: scroll up manually first, then export.
- **Claude Artifacts** are inserted as `[Artifact: title]` blockquote placeholders; the full artifact body lives in a side panel we don't traverse yet.
- **Code-block "Copy" buttons** are stripped per adapter; if your adapter starts emitting literal "Copy code" in Markdown, the selector layer needs another entry.

---

## Privacy

100% local. No telemetry. No network requests beyond the page's own images (only when you ask, gated by "Download remote images"). WhatsApp content is end-to-end encrypted on the wire — this extension only reads what's already rendered to your own DOM.

`optional_host_permissions: ["*://*/*"]` is declared in the manifest **but not granted by default** — it only activates when you explicitly add an OpenWebUI / mirror site in the popup.

---

## Credits

- [Turndown](https://github.com/mixmark-io/turndown) — HTML → Markdown
- [turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm) — GFM tables/strikethrough/tasks
- [JSZip](https://stuk.github.io/jszip/) — ZIP packaging
- Inspired by [gemini-export](https://github.com/jujusharp/gemini-export) and [ai-chat-exporter](https://github.com/amazingpaddy/ai-chat-exporter)
