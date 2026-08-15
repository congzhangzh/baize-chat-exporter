# Contributing to BaiZe — AI Chat Exporter

Adapters are the heart of this project, and they are designed to be
community-contributed. This page is the short path from "my site isn't
supported" to a merged PR.

## How the extension works (5 lines)

1. `manifest.json` injects, per site: `lib/turndown*.js` → `content/adapter-registry.js` → one `content/adapters/<site>.js` → `content/content.js`.
2. Each adapter is a plain object that self-registers via `window.__AIExporterRegistry`.
3. `content.js` is the generic framework: extraction pipeline, image fetch, Turndown conversion, message handling. Adapters only describe the site's DOM.
4. Two extraction modes: `turn-based` (user query → model response, e.g. ChatGPT) and `bubble-based` (flat message stream with authors + timestamps, e.g. WhatsApp).
5. `popup/popup.js` maps URLs to adapters through `chrome.storage.local.site_bindings` and requests host permissions at runtime for user-added domains.

Deep dives: [docs/ADAPTER_NOTES.md](docs/ADAPTER_NOTES.md) (adapter-authoring
rules and selector priorities) and [CLAUDE.md](CLAUDE.md) §4 (the 6-step
debugging playbook with copy-pasteable console probes). When an adapter
misbehaves, set `localStorage.AI_EXPORTER_DEBUG = '1'` in the page console and
reload — every selector layer logs its hit count.

## Adding a new adapter — checklist

- [ ] File at `content/adapters/<id>.js`
- [ ] Object exposes: `id`, `displayName`, `extractMode`, `match(url)`, `getConversationTitle()`
- [ ] If `turn-based`: implement `userSelectors`, `modelSelectors` (or override extraction hooks documented in `content.js`)
- [ ] If `bubble-based`: implement `collectBubbles()` and (when the site virtualizes) `scrollToLoadMore(onProgress)`
- [ ] Two layers of fallback selectors minimum
- [ ] `debugLog()` covering panel + layer counts
- [ ] Header comment with: anchor priority, failure history, virtualization notes (if relevant)
- [ ] Register in `manifest.json` under a dedicated `content_scripts` entry (load order: `lib/turndown*.js` → `adapter-registry.js` → `adapters/<id>.js` → `content.js`)
- [ ] Add the site to `DEFAULT_SITE_BINDINGS` in `popup/popup.js`
- [ ] Verify against a real conversation: export it and diff the `.md` against what the page shows

Pick a target from the community-wanted tables in
[RELEASE_NOTES.md](RELEASE_NOTES.md) — each row already carries a domain and a
selector hint.

## Translations

The UI ships in English, 简体中文, 日本語 and 한국어
(`_locales/{en,zh_CN,ja,ko}/messages.json`). The **ja and ko catalogs are
AI-drafted first passes** — corrections from native speakers are explicitly
help-wanted, as are entirely new locales. Rules: keep the key set identical to
`_locales/en/messages.json` (missing keys silently render as empty strings),
keep `$1`/`$2` placeholders, and reload the unpacked extension to see changes.

## Code conventions

- Comments in English; no emoji in code; comments explain *why*, not *what*.
- No build step, no new dependencies — the unpacked extension must run from a fresh checkout.
- Commit subjects ≤ 60 chars, English, conventional prefix (`fix:`, `feat:`, `refactor:`, `docs:`).
- Every non-trivial adapter fix adds a dated bullet to the adapter file header's failure history. See [CLAUDE.md](CLAUDE.md) for the reasoning behind these rules.

## Filing issues

Use the issue templates: **broken adapter** (asks for the
`AI_EXPORTER_DEBUG` console output and a DOM snippet — that is usually 90% of
the fix) or **new adapter request**. Maintainers use the body below to open
`help-wanted` issues for each roadmap site; feel free to self-assign one.

```markdown
**Site**: <name>
**URL**: <chat page URL pattern>
**Selector hints**: <from RELEASE_NOTES.md, or your own DevTools findings>
**DOM snippet**: <paste the outerHTML of one user message + one model response>
**Debug output**: <console lines prefixed [AI Exporter] with AI_EXPORTER_DEBUG=1>
**Can you test with a real account?**: yes / no
```
