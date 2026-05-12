# Release Notes

## v2.0.0 — Multi-site AI Chat Exporter

The extension formerly known as **Gemini Chat Exporter** is now **AI Chat Exporter**, a per-site adapter framework supporting six sites out of the box.

### New sites

| Site | URL | Mode |
|------|-----|------|
| **ChatGPT** | `chatgpt.com` / `chat.openai.com` | turn-based |
| **Claude** | `claude.ai` | turn-based |
| **Meta AI** | `meta.ai` | turn-based |
| **WhatsApp Web** | `web.whatsapp.com` | **bubble-based** (new pipeline) |
| **OpenWebUI** | *user-supplied* | turn-based, runtime-injected |

Existing Gemini export behavior is unchanged.

### Architecture

- Split the monolithic `content/content.js` into an adapter registry + a generic framework + six per-site adapter files under `content/adapters/`.
- New **bubble-based** extraction pipeline for chat-app-style UIs (timestamps, per-message author, virtual-scroll harvesting).
- Markdown header / file naming / supported-site list all derive from the active adapter's `displayName` — no more hardcoded "Gemini".

### Per-site configuration

- New collapsible **"站点配置"** panel in the popup.
- Each adapter can be enabled / disabled.
- Each adapter accepts user-added **extra domains** (mirrors, internal deployments, OpenWebUI) — clicking "添加" triggers `chrome.permissions.request()` synchronously inside the user gesture; Chrome shows its native prompt.
- Removing an extra domain calls `chrome.permissions.remove()`.
- Bindings persist in `chrome.storage.local.site_bindings`.

### Quality improvements

- Multi-layer fallback selectors per adapter; `localStorage.AI_EXPORTER_DEBUG = '1'` enables match-level console diagnostics.
- ChatGPT: KaTeX `$...$` / `$$...$$` reconstruction, copy/like/dislike button stripping.
- Claude: Artifacts replaced with `[Artifact: title]` placeholders; "Extended Thinking" wrapped in collapsible `<details>` blocks.
- WhatsApp: timestamps parsed from `[data-pre-plain-text]`, role from `message-in` / `message-out`, virtual-scroll bubble harvesting with dedup by `data-id`.
- Active-site pill in the popup header now indicates which adapter (if any) matched the current tab.

### Permissions / safety

- `host_permissions` widened to cover the six supported sites only.
- `optional_host_permissions: ["*://*/*"]` added but **never granted by default**; activates exclusively when the user explicitly adds a custom domain through the popup.
- Disabling an adapter in the popup makes the extension silently no-op on that domain even though manifest-declared `host_permissions` cannot be revoked at runtime.

---

## Known limitations (carryover into next milestones)

- **Meta AI selectors** are best-guess — no published reference exists; expect community-driven fallback refinement.
- **WhatsApp Web** uses a virtual scroller that recycles offscreen bubbles. Very long histories may miss the deepest bubbles; manually scrolling up first is a workaround.
- **Claude Artifacts** are placeholder-only; the artifact body lives in a side panel we don't traverse yet.
- **OpenWebUI** templates vary between v0.1 / 0.3 / 0.5+; fallbacks cover the common cases but you may need to file an issue with a DOM snippet for unusual variants.

---

## Roadmap

### Next: Firefox support (followup, not in v2.0)

Tracked as a single follow-up task because it cuts across manifest, API surface, and UX:

- Split `manifest.json` per browser, OR add a build script that emits both `manifest.chrome.json` and `manifest.firefox.json`:
  - Chrome keeps `background.service_worker`
  - Firefox needs `background.scripts: ["background/service_worker.js"]`
- Vendor [webextension-polyfill](https://github.com/mozilla/webextension-polyfill) into `lib/` and switch source from `chrome.*` callbacks to `browser.*` promises (Firefox aliases `chrome` only for a subset of APIs).
- Add `browser_specific_settings.gecko.id` + `strict_min_version: "128.0"` for AMO submission.
- UX fallback: `chrome.permissions.request({origins: [...]})` does not pop a native dialog in Firefox the way it does in Chrome. The popup should detect Firefox via `navigator.userAgent` and, instead of trying to request the permission, show a copy-able instruction: "Open about:addons → AI Chat Exporter → Permissions and grant access to <pattern>".
- Cross-browser smoke test on each adapter.

Estimated incremental effort: ~20-30% on top of the v2.0 baseline.

### Other ideas (no commitment)

- ChatGPT / Claude conversation list iterator → bulk export multiple chats.
- Claude Artifact body retrieval (would require traversing the artifact side panel and stitching it back into the markdown).
- Markdown frontmatter (YAML) with metadata: model, timestamps, message count.
- Optional MCP / Obsidian Vault sync target instead of plain download.
- Wider sites: Perplexity, DeepSeek, Grok, Mistral Le Chat.

If you want any of these prioritized, please file an issue on GitHub.

---

## Migration from v1.x (Gemini Chat Exporter)

- Extension is renamed and re-versioned to 2.0.0; Chrome will surface this as an update.
- New permissions appear in Chrome's update notification dialog (the additional host permissions for ChatGPT / Claude / Meta AI / WhatsApp / OpenWebUI). Users must accept the update to keep using it.
- All previous preferences (auto-scroll, include images, ZIP, remote images) carry over; legacy `chrome.storage.local` keys are still read.
- A new `site_bindings` storage key is initialized on first launch with all six adapters enabled.
