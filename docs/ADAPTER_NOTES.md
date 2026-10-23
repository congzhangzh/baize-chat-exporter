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
   until `overflowY` is `auto`/`scroll`. **Check `overflowY`, not just
   `scrollHeight > clientHeight`**: ChatGPT's `<main>` is taller than its
   box but `overflow: visible`, so `main.scrollTop = N` is a silent no-op.
   The real scroller (`[data-scroll-root]`) is an *ancestor* of `<main>`.

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

### 4.1 Dedup anchor rule (critical)

**The id you dedup by must live on an element that exists in both
materialized and virtualized states.** Most sites have a stable OUTER
wrapper carrying the id (`[data-testid^="conv-msg-"]` on WhatsApp) and
an INNER row that only appears when the bubble is on screen
(`.message-in / .message-out`). Dedup against the outer; harvest
content from the inner only when present.

How to verify: open DevTools, find a bubble outside the viewport, and
check that your chosen dedup attribute is still in its DOM. If it isn't,
walk up to an ancestor that survives.

Failure mode if you get this wrong: `collected.size` grows during
scroll but is much smaller than the true message count, and the
exported markdown has gaps. This was the WhatsApp `data-id` bug of
2026-05 — `getAttribute('data-id')` was called on the inner row, which
has no `data-id`, so dedup silently kept overwriting `undefined`.

### 4.2 Sweep strategy

A two-jump scroll (top → bottom) only materializes the top and bottom;
middle bubbles never render. Use an **incremental sweep**:

```
scroller.scrollTop = 0
loop:
  collect()
  scroller.scrollTop += clientHeight * 0.75
  await one frame + ~250ms
  break if scroll position unchanged or no new bubbles for N ticks
scroller.scrollTop = scrollHeight  // final pass
collect()
```

If the scroller has snap-points or sticky headers, dispatch a synthetic
`scroll` event after each `scrollTop` write — some sites only
materialize on the event, not the property write.

### 4.3 Skeleton

```js
async scrollToLoadMore(onProgress) {
  const collected = new Map();  // keyed by outer-wrapper id
  // incremental sweep (see 4.2)
  // call onProgress({ count, total }) per tick if known
}
```

Stash the result on `this._cachedBubbles` so `collectBubbles()` can
return them in DOM order without re-querying.

### 4.4 Bidirectional virtualization + sliding window (ChatGPT, 2026-08)

WhatsApp only virtualizes rows that were never scrolled into view.
ChatGPT is harsher, and the same pattern will show up elsewhere:

- **Both directions.** A turn that leaves the viewport (plus some
  margin) is swapped back for an empty
  `[data-turn-id-container][data-is-intersecting="false"]` div sized by
  `--last-known-height`. Content you saw a second ago is gone from the
  DOM. So the export cannot "scroll to load everything, then read the
  DOM" - it has to **harvest during the sweep** and hand the framework
  cached clones (`collectTurns()` for turn-based adapters, the mirror of
  `collectBubbles()`).
- **The wrapper list itself is a window.** Far enough away, even the
  outer wrapper is removed (27 -> 19 wrappers observed mid-sweep).
  Conversation order therefore has to be *accumulated* across ticks:
  merge each tick's contiguous id sequence into a global order
  (`mergeOrder()` in `chatgpt.js`), never read order off the DOM at
  export time.
- **Older history is fetched lazily on the way up.** Pass A walks up in
  viewport steps until `scrollTop === 0` *and* the wrapper count has been
  stable for a few ticks - a single `scrollTop = 0` jump is not enough.
- **Nested id carriers.** The materialized `<section>` carries the same
  `data-turn-id-container` as its wrapper, so a naive
  `querySelectorAll` double-counts every live turn. Keep only wrappers
  that have no wrapper ancestor.
- **Materialization needs rendered frames.** It is
  IntersectionObserver-driven; in a hidden or occluded tab
  (`document.visibilityState === 'hidden'`) rAF and IO are paused and
  programmatic scrolling materializes nothing, however long you wait.
  Log the visibility state, and when turns are still virtualized at
  export time report it (`adapter.lastWarning = { key, args }` ->
  popup) instead of silently shipping a partial file.

Probe (page console):

```js
[...document.querySelectorAll('[data-turn-id-container]')]
  .filter(w => !w.parentElement.closest('[data-turn-id-container]'))
  .map(w => (w.querySelector('[data-testid^="conversation-turn"]') ? '*' : '.')
            + (w.getAttribute('data-is-intersecting') || '?')[0]).join(' ')
```

`*` = materialized, `.` = empty placeholder. If you see `.f` entries
while those placeholders are inside the viewport, the tab is not
rendering - bring it to the foreground before trusting any conclusion
about "programmatic scroll does not work".

### 4.5 Reversed scrollers: `scrollTop` can be negative (ChatGPT, 2026-09)

Chat UIs that "stick to the bottom" often render the thread in a
`flex-direction: column-reverse` scroller. In Chromium that flips the
coordinate system: **`scrollTop` is `0` at the bottom and runs down to
`-(scrollHeight - clientHeight)` at the top.** Any sweep written for
the normal orientation breaks silently:

- `Math.max(0, scrollTop - step)` pins the scroller at the bottom - the
  "walk up" loop never moves, and the "we're at the top" check
  (`scrollTop === 0`) is true immediately.
- `scrollTop = scrollHeight` ("go to the bottom") is clamped to `0` and
  happens to work, which hides the bug during a quick manual test.

Rule: never hard-code `0` as the top. Derive both ends from the element:

```js
function scrollBounds(el) {
  const range = Math.max(0, el.scrollHeight - el.clientHeight);
  return getComputedStyle(el).flexDirection === 'column-reverse'
    ? { min: -range, max: 0 }
    : { min: 0, max: range };
}
```

`scrollTop -= step` means "up" in both orientations, so only the clamps
and the end-of-sweep checks need `scrollBounds()`.

Related: when a layout pages older history in while the *rendered*
window stays the same size, the wrapper count stops being a useful
"nothing new arrived" signal. Include `scrollHeight` in the stability
signature.

#### 4.5.1 Edge checks need slack, and every loop needs an exit

Two more traps from the same scroller (ChatGPT, 2026-09-28):

- **The bound is not always reachable.** At a non-integer
  `devicePixelRatio` (1.40625 measured), a scroller pinned at its top
  sat at `scrollTop = -4989.87` with `-(scrollHeight - clientHeight) =
  -4991`. An `atTop = scrollTop <= min + 1` check was never true, the
  "stable at top" counter reset every tick, and the export spun until
  its deadline. Test the edge with a few pixels of slack, **or** with
  "I asked it to move and it did not": `|scrollTop - before| < 1`.
- **Pinned at an edge, nothing retries.** Writing the same `scrollTop`
  again fires no `scroll` event, so a lazy history fetch that missed its
  trigger never fires again. While idling at the edge, nudge the
  scroller half a viewport away so the next tick crosses the loader's
  sentinel again.

Also give every pass its own time budget. One shared deadline let a
stuck pass A starve pass B, so the export ran for minutes and still
missed most turns. Key the "idle" exit on elapsed time rather than tick
count, and use a monotonic signal (known ids so far) instead of a live
count that can go up and down as the window slides.

### 4.6 One site, two layouts: rollouts are per account

A site can serve completely different DOMs to different accounts at
the same time. On 2026-09-28 ChatGPT gave a free account the legacy
`<section data-turn>` layout and a Plus account a new "app-shell"
layout (`[data-turn-key]` pairs, hashed `MarkdownRoot-*` classes, a
reversed scroller), both at `chatgpt.com/c/<id>`. "Works on my machine"
meant "works on my account".

- When a report doesn't reproduce, **ask which account / plan / mode
  the user was on** before concluding the adapter is fine, and test in
  that account (a separate Chrome profile works).
- Keep both anchor sets in the adapter until the old layout is gone
  everywhere, and document each one as its own table in the file
  header.
- When the new layout uses a different turn *shape* (e.g. one block per
  user+assistant pair instead of one per message), normalize it at
  harvest time into the shape the framework already reads, rather than
  teaching the framework a second shape.
- Hashed CSS-module classes (`MarkdownRoot-rZKhxa`) are priority 4 in
  §1, but the stable prefix is often the best anchor available. Match it
  with `[class*="MarkdownRoot"]`, never the full hashed name, and keep it
  as the *last* layer.

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

### 9.1 Images inside the content block export twice

The reply HTML goes through Turndown as-is, `<img>` included, and
`generatedImages` is appended after it. When a `generatedImages`
selector matches images that also sit inside `modelResponseContent`,
every image lands in the Markdown twice, and the inline copy skips the
inline / ZIP / remote-image options. Strip `<img>` from the clone in
`cleanResponseClone` and let `generatedImages` carry them.

Found 2026-10-23 in OpenWebUI (fixed there). Claude, HuggingChat and
Kimi have the same selector shape and do not strip `<img>`; audit them
against a live reply that contains an image.

### 9.2 Code-block chrome leaks into the Markdown

Sites wrap `<pre>` in a block with a header: a language label plus
Copy / Run / Save buttons. Removing the Copy button is not enough; the
label's text ends up as a stray line above the fence (`python`), or
glued to the button text (`PythonCopy`). Four adapters have hit this:
Grok, Kimi, ChatGPT and OpenWebUI. Two ways out:

- **Known DOM**: a custom Turndown rule that emits the fence from the
  block's label and `<pre>` (Grok, Kimi).
- **DOM that varies between releases**: structural stripping, as in
  OpenWebUI's `stripCodeBlockChrome()`: within the code block's
  wrapper, drop short-text nodes that hold no content, and reuse the
  label as the fence language.

---

## 10. Adding a new adapter — quick checklist

- [ ] File at `content/adapters/<id>.js`
- [ ] Object exposes: `id`, `displayName`, `extractMode`,
      `match(url)`, `getConversationTitle()`
- [ ] If `turn-based`: implement `userSelectors`, `modelSelectors`
      (or override extraction hooks documented in `content.js`)
- [ ] If `bubble-based`: implement `collectBubbles()` and (when the
      site virtualizes) `scrollToLoadMore(onProgress)`
- [ ] If the site unrenders turns that leave the viewport, also implement
      `collectTurns()` returning cached clones in accumulated order, and
      set `lastWarning` when some ids never materialized (see 4.4)
- [ ] Two layers of fallback selectors minimum
- [ ] Export a reply with an image and a code block: each image once,
      no stray label above the fence (see 9.1, 9.2)
- [ ] `debugLog()` covering panel + layer counts
- [ ] Header comment with: anchor priority, failure history,
      virtualization notes (if relevant)
- [ ] Register in `manifest.json` under a dedicated `content_scripts`
      entry (load order: `lib/turndown*.js` → `adapter-registry.js`
      → `adapters/<id>.js` → `content.js`)
- [ ] Add the site to `DEFAULT_SITE_BINDINGS` in `popup/popup.js`
