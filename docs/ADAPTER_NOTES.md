# Adapter Authoring Notes

Cross-cutting wisdom for everyone adding or maintaining a site adapter
(`content/adapters/*.js`). The per-site quirks live in the file header
of each adapter; this document collects the rules that apply to all of
them.

> If you find yourself relearning a lesson that's already written here,
> please patch the doc with the new evidence. The whole point of this
> file is to keep tribal knowledge out of people's heads.

---

## 1. Selector hardening — anchor priority

Pick anchors in this order. Higher items are more stable across UI
redesigns.

| Priority | What | Why |
|---|---|---|
| ① | Attributes the site uses for **its own observable contract**: `data-pre-plain-text` (clipboard), `aria-label` (a11y), `data-testid` (their internal QA hooks) | Renaming these breaks user-facing behavior, so the site team is reluctant to change them. |
| ② | Long-lived **class names** that name a concept (`.message-in`, `.message-out`, `.markdown`, `.user-query-container`) | Survive cosmetic refactors as long as the concept exists. |
| ③ | **Role/tag structure** (`[role="row"]`, `article`, `main`) | Usually keeps semantics even when classes churn. |
| ④ | Hashed / utility classes (`.x1n2onr6`, Tailwind-style fragments) | **Avoid.** Regenerated on every build. |
| ⑤ | DOM position (`:nth-child`, "the 3rd div") | **Avoid.** Breaks the moment the site adds a wrapper. |

**Always layer.** Each adapter should have at least 2 fallback selectors
for "where are the messages". When the primary fails, log it and try
the next layer — never silently return `[]`.

---

## 2. The "panel" trap

A recurring class of bugs: the adapter scopes everything to one root
container (`#main`, `main`, `.conversation-root`) and that container's
selector is the first thing the site changes.

**Symptom**: harvest returns 0 even though messages are clearly in the
DOM. All fallback layers also return 0, because they're all
`panel.querySelectorAll(...)` and `panel` is `null`.

**Rules**:

1. **Never** make the panel selector the gatekeeper for fallbacks.
   If panel resolution fails, fall back to `document` and let the
   message-shaped selectors do their job. The sidebar/composer
   typically doesn't contain message bubbles, so a doc-wide scan
   is usually safe — but verify per site (see §3).
2. Resolve the panel **from the messages, not the other way around**:
   find one live message bubble, walk up to the nearest container that
   has the structural attribute you actually need (`[data-tab]`, a
   scroll container, etc).
3. If you genuinely need a single scrollable element (for virtualized
   lists), still resolve it bottom-up: starting from a bubble, walk up
   until `overflowY` is `auto`/`scroll`.

Historical example: WhatsApp `#main` → `[data-tab="8"]` migration
(2026-05) — see `content/adapters/whatsapp.js` header.

### 2.1 ID-collision trap (real story)

After the `#main` migration we wrote a `findChatPanel()` that did:

```js
const legacy = document.querySelector('#main');
if (legacy) return legacy;
```

…thinking "if `#main` still exists, great; otherwise walk up from a
bubble". In production this **kept failing** with logs showing
`panel = mask#main` and `scroller = SVGAnimatedString`.

Diagnosis: WhatsApp's icon SVGs include a `<mask id="main">` somewhere
in the page. `querySelector('#main')` returned the SVG mask, not a
chat panel. Then `panel.scrollTop = 0` did nothing (no-op on
non-scrollable elements) and `panel.querySelectorAll('.message-in')`
returned 0.

**Rules:**

1. **Never** trust a bare id selector on a site you don't control.
   Constrain by tag: `div#main`, `main#root`, etc. This auto-skips
   `<mask>`, `<symbol>`, `<input>`, and other id-bearing oddities.
2. If a legacy selector becomes unreliable, **delete it** and rely on
   the structural walk-up. A bad-but-truthy result is worse than no
   result, because it short-circuits your fallback chain.
3. When debug-logging the panel, log `tagName + id + key attributes`
   so id-collisions are visible at a glance. `panel = mask#main` is
   *much* more diagnostic than `panel = [object Element]`.

---

## 3. Document-wide scan: when is it safe?

A `document.querySelectorAll('.message-in, .message-out')` style scan
is safe **iff**:

- The site renders only one conversation in the DOM at a time, or
- The off-conversation elements use a clearly different selector
  (e.g. WhatsApp sidebar uses `[data-testid="cell-frame-container"]`,
  not `.message-in`).

Verify by opening the conversation list with multiple chats visible
and running your selector in DevTools. If you get hits from the
sidebar, your selector is too broad — narrow it before falling back to
`document`.

---

## 4. Virtualized lists

Many chat apps recycle offscreen DOM. Markers to look for:

- `data-virtualized="true"` placeholders with `min-height: NNNpx`
- React-virtualized / TanStack Virtual wrapper classes
- A scroll container with `scrollHeight >> clientHeight` but very few
  message DOM nodes

If you detect virtualization, you cannot harvest in one pass. Pattern:

```js
async scrollToLoadMore() {
  const collected = new Map();  // dedupe by data-id
  // Pass 1: scroll to top, harvest as history loads
  // Pass 2: scroll to bottom, harvest recent messages
  // Stop when N consecutive ticks add nothing.
}
```

Stash the result on `this._cachedBubbles` so `collectBubbles()` can
return them in DOM order without re-querying.

---

## 5. Diagnostic toggle

Every adapter should support a localStorage debug toggle. Convention:

```js
function debugLog(...args) {
  try {
    if (localStorage.getItem('AI_EXPORTER_DEBUG') === '1') {
      console.log('[AI Exporter][<adapter-id>]', ...args);
    }
  } catch (_) {}
}
```

When `AI_EXPORTER_DEBUG=1`, log:

- Resolved panel (tag + id + key attributes)
- Each fallback layer's hit count
- Scroll progress (live bubbles vs cached)

When triaging an "empty conversation" bug report, the very first thing
to ask the user is "open page console, run
`localStorage.AI_EXPORTER_DEBUG='1'`, reload, retry, then paste the
`[AI Exporter]` lines". DO NOT chase site-internal CORS/telemetry
noise — it's never us.

---

## 6. Idempotency

Content scripts get re-injected when the popup invokes
`chrome.scripting.executeScript` more than once on the same tab.
Without guards this duplicates `chrome.runtime.onMessage` listeners
and causes channel collisions.

- `content/content.js` sets `window.__AIExporterInstalled` on first
  run and short-circuits on re-injection.
- `content/adapter-registry.js` dedupes adapters by `id` on
  `register()`.

When adding new adapters, do **not** add new top-level listeners; route
everything through the registry + content.js dispatcher.

---

## 7. Title extraction

Don't use `document.title` directly — it usually contains the brand
suffix ("ChatGPT", "Claude — Anthropic"). Each adapter implements
`getConversationTitle()` and is expected to:

1. Try a header element specific to the open conversation
   (`header h1`, `header span[title]`, etc).
2. Strip brand suffix only if you have to.
3. Fall back to a stable string like `"<Brand> Conversation"`.

The framework will `sanitizeFilename()` the result, but try to return
human-readable Unicode; we don't transliterate.

---

## 8. Two extraction modes

| Mode | Use when | Output unit |
|---|---|---|
| `turn-based` | One user message → one model response, like AI chat sites | `{ userHtml, modelHtml, modelLabel? }` per turn |
| `bubble-based` | Free-form flat stream of messages with multiple authors and timestamps (chat apps) | `{ role, author, timestamp?, html, images[] }` per bubble |

Declare `extractMode` on the adapter object. Don't mix — if a site has
both modes, write two adapters that match different URL patterns.

---

## 9. Image handling

Adapters return bubble/turn objects with `images: [{ url, alt }]`.
`content.js` decides how to fetch them based on user prefs:

- `inline`: base64-embed into the markdown.
- `extract`: bundle as a ZIP.

You don't need image-mode logic in the adapter — just return the URLs
(blob: URLs are also fine; the framework handles them).

---

## 10. Adding a new adapter — quick checklist

- [ ] File at `content/adapters/<id>.js`
- [ ] Object exposes: `id`, `displayName`, `extractMode`,
      `match(url)`, `getConversationTitle()`
- [ ] If `turn-based`: implement `userSelectors`, `modelSelectors`
      (or override extraction hooks documented in `content.js`)
- [ ] If `bubble-based`: implement `collectBubbles()` and (when the
      site virtualizes) `scrollToLoadMore(onProgress)`
- [ ] Two layers of fallback selectors minimum
- [ ] `debugLog()` covering panel + layer counts
- [ ] Header comment with: anchor priority, failure history,
      virtualization notes (if relevant)
- [ ] Register in `manifest.json` under a dedicated `content_scripts`
      entry (load order: `lib/turndown*.js` → `adapter-registry.js`
      → `adapters/<id>.js` → `content.js`)
- [ ] Add the site to `DEFAULT_SITE_BINDINGS` in `popup/popup.js`
