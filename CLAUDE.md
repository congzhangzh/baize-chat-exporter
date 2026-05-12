# CLAUDE.md — Engineer & Agent Handbook

> Read this first. This file is the contract between humans and AI agents
> working on this codebase. It captures the **non-obvious mechanics** of
> our adapter framework and — more importantly — the **debugging playbook**
> for when an adapter breaks against a live site.
>
> If you find yourself relearning a lesson written here, **patch this file**
> with the new evidence before closing the PR. Tribal knowledge belongs in
> source, not in someone's head.

---

## 1. What this project is

A Chromium MV3 extension that exports AI chat conversations (Gemini,
ChatGPT, Claude, Meta AI/WhatsApp, OpenWebUI) to Markdown. The runtime
shape is intentionally tiny:

```
manifest.json
├── content/
│   ├── adapter-registry.js     # window.__AIExporterRegistry — dedup by id
│   ├── adapters/<site>.js      # one file per site, IIFE, self-registers
│   └── content.js              # dispatcher: listens for popup messages,
│                               # routes to the active adapter
├── popup/popup.{html,js}       # UI + site_bindings storage
└── lib/turndown*.js            # HTML→MD
```

Two extraction modes per adapter: **`turn-based`** (one user query →
one model response, e.g. ChatGPT) and **`bubble-based`** (free-form flat
stream with multiple authors + timestamps, e.g. WhatsApp).

Architecture detail and adapter-authoring rules live in
[`docs/ADAPTER_NOTES.md`](docs/ADAPTER_NOTES.md). Read that before
touching any selector.

---

## 2. The reality of adapter work

Every adapter is a bet that some attribute / class / structural anchor
in the site's DOM will survive long enough to be useful. Sites change
their DOM constantly — sometimes silently. **The single largest
maintenance cost in this project is adapter rot.**

The cure is not "write better selectors". The cure is a **fast feedback
loop**: when a user reports "export failed on site X", you need to be
able to go from bug report → root cause → fix → verified in **under
15 minutes**, without writing throwaway test harnesses.

This file's main job is to make that loop fast.

---

## 3. The Adapter Debugging Playbook

Run these in order. **Do not skip steps** — every step builds evidence
that constrains the fix.

### Step 0 — Confirm it's our bug

Page consoles on big sites are noisy. **Ignore unless they mention
`[AI Exporter]`**:

- `Permissions-Policy header: Unrecognized feature: 'bluetooth'`
- CORS errors on `*.whatsapp.net/deidentified_telemetry`,
  `*.openai.com/v1/rgstr`, etc.
- React DevTools warnings
- `Violation: 'unload' is not allowed`

These are the site's own noise. They are **never** the cause of an
export failure. Chasing them wastes 30 minutes per incident.

### Step 1 — Turn on debug logging

In the **page console** (not the extension console — the tab's own
DevTools):

```js
localStorage.AI_EXPORTER_DEBUG = '1'
```

Reload the tab. Retry the export. Read every line prefixed with
`[AI Exporter]`. Adapter logs MUST report:

- Resolved panel (`tagName#id[data-tab=...]`) — if you see something
  unexpected like `mask#main`, you've found a panel-resolution bug.
- Each fallback layer's hit count.
- For virtualized lists: per-tick `wrappers / newly captured / still
  virtualized / cached total`.

If your adapter doesn't log enough to diagnose without re-running, add
`debugLog()` calls *as part of the fix*. Future-you will thank you.

### Step 2 — Run the structural probe

Paste into the page console. This is **the single most important
diagnostic tool in this project**:

```js
// ============================================================
// AI Exporter — generic structural probe
// Adapt the four CUSTOMIZE blocks below per site, then paste.
// ============================================================
(() => {
  const out = {};
  const tag = el => el ? `${el.tagName}${el.id ? '#' + el.id : ''}` : '<null>';

  // CUSTOMIZE #1 — id collisions you suspect (e.g. '#main').
  const SUSPECT_IDS = ['#main'];
  SUSPECT_IDS.forEach(s => {
    out[`allNodesFor_${s}`] = [...document.querySelectorAll(s)].map(tag);
  });

  // CUSTOMIZE #2 — panel candidates in priority order.
  const PANEL_CANDIDATES = [
    '[data-testid="conversation-panel-wrapper"]',
    'div#main',
  ];
  PANEL_CANDIDATES.forEach(s => { out[`panel_${s}`] = tag(document.querySelector(s)); });
  const panel = PANEL_CANDIDATES.map(s => document.querySelector(s)).find(Boolean);
  out.resolvedPanel = tag(panel);

  // CUSTOMIZE #3 — scroller candidates.
  const SCROLLER_CANDIDATES = [
    '[data-testid="conversation-panel-messages"]',
    '[data-scrolltracepolicy*="conversation.messages"]',
    'div.copyable-area',
  ];
  SCROLLER_CANDIDATES.forEach(s => { out[`scroller_${s}`] = tag(panel?.querySelector(s)); });

  // CUSTOMIZE #4 — bubble fallback layers.
  const BUBBLE_LAYERS = {
    layer1_classBased:   'div.message-in, div.message-out',
    layer2_testidBased:  '[data-testid^="conv-msg-"]',
    layer3_clipboardMeta:'[data-pre-plain-text]',
    layer4_roleRow:      '[role="row"]',
  };
  const root = panel || document;
  Object.entries(BUBBLE_LAYERS).forEach(([k, sel]) => {
    out[k] = root.querySelectorAll(sel).length;
  });

  console.table(out);
  return out;
})();
```

Read the table:

- **Multiple `allNodesFor_#X` hits with different tagNames** → id
  collision (e.g. SVG `<mask id="main">` vs `<div id="main">`).
  Constrain selectors by tag: `div#main`, not `#main`.
- **`resolvedPanel: <null>`** → no panel found. Open a conversation
  first, or the site renamed everything.
- **All scroller candidates null** → walk up from a bubble to find
  `overflowY: auto|scroll` (see `findScrollContainer` in WhatsApp adapter).
- **All bubble layers 0** → either no chat is open, OR every selector
  rotted simultaneously (rare; usually it's panel resolution upstream).
- **Bubble counts disagree** → typical pattern. The layer with the
  *highest* count usually points to the most stable anchor. Use it.

### Step 3 — Check for virtualization

If bubble layers return numbers but the export is empty:

```js
(() => {
  const wrappers = [...document.querySelectorAll('[data-testid^="conv-msg-"]')];
  const virt = wrappers.filter(w => w.querySelector('[data-virtualized="true"]')).length;
  const real = wrappers.length - virt;
  console.log(`wrappers: ${wrappers.length}, materialized: ${real}, virtualized: ${virt}`);
})();
```

If `materialized < wrappers`, the site uses **virtualized scrolling**.
Most bubbles are placeholders until scrolled into view. Your adapter
must:

1. Identify the OUTER stable wrapper (carries id even when virtualized).
2. Identify the INNER bubble (only present when materialized).
3. Dedup by id on the outer, capture content from the inner.
4. **Incrementally** scroll top→bottom by ~viewport-height steps, NOT
   jump-to-top then jump-to-bottom (which skips the middle).

See `scrollToLoadMore` in `content/adapters/whatsapp.js` for the
reference implementation.

### Step 4 — Spot-check one bubble

When step 2/3 looks right but the export still has wrong content:

```js
(() => {
  const sample = document.querySelector('[data-testid^="conv-msg-"] .message-in, [data-testid^="conv-msg-"] .message-out');
  if (!sample) return console.warn('no materialized bubble in viewport — scroll to one first');
  console.log({
    role_classBased:  sample.classList.contains('message-out') ? 'user' : 'assistant',
    role_byTailIcon:  sample.querySelector('[data-icon="tail-out"]') ? 'user'
                    : sample.querySelector('[data-icon="tail-in"]')  ? 'assistant' : '?',
    prePlainText:     sample.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text'),
    selectableText:   sample.querySelector('span.selectable-text')?.textContent?.slice(0,80),
    copyableTextDiv:  sample.querySelector('div.copyable-text')?.textContent?.slice(0,80),
    imageCount:       sample.querySelectorAll('img[src]').length,
    outerHtmlPreview: sample.outerHTML.slice(0, 400) + '…',
  });
})();
```

Cross-check the adapter's `captureBubble` against this output. Every
field your adapter uses should be populated here. If a field is
`undefined`, add a fallback path.

### Step 5 — Verify the fix

After patching the adapter:

1. Reload the unpacked extension in `chrome://extensions/`.
2. Reload the tab.
3. Re-run steps 1–4. **All numbers should change for the better.**
4. Export. The downloaded `.md` file is the ground truth — open it,
   diff against what the chat actually shows.

### Step 6 — Patch the failure history

Two places to update **in the same PR** as the fix:

1. The adapter file header — add a dated bullet under "Failure history"
   describing what broke, the symptom (with actual log line), and the
   fix in one sentence.
2. `docs/ADAPTER_NOTES.md` — if the bug class is general (not specific
   to this site), add it as a new principle there.

If you skip this step, the next engineer (or the next iteration of
yourself in a new chat) will burn 30 minutes rediscovering the same
trap. **This is non-negotiable.**

---

## 4. Cardinal rules for adapter code

These came out of real production bugs. Each one has at least one
incident behind it (see whatsapp.js failure history for receipts).

1. **Constrain id selectors by tag.** Write `div#main`, never `#main`.
   Sites embed `<mask id="main">`, `<input id="search">`, etc. that
   collide.
2. **Never make the panel selector a gatekeeper.** If panel is `null`,
   fall back to `document` and let bubble selectors do their job. The
   sidebar usually doesn't contain message bubbles, so a doc-wide scan
   is safe — but verify per site.
3. **Resolve the scroller bottom-up.** Look for an explicit testid
   first (`conversation-panel-messages` etc.). Failing that, walk up
   from a bubble until `getComputedStyle(el).overflowY` is
   `auto`/`scroll` and `scrollHeight > clientHeight`. Don't guess.
4. **Dedup by stable id, not by position.** For virtualized lists, the
   outer wrapper carries the id; the inner role-bearing div doesn't.
   Iterate the outer, capture the inner.
5. **Incrementally sweep virtualized lists.** Two-jump (`top` →
   `bottom`) skips the middle. Step by ~`clientHeight * 0.75`.
6. **Layer your selectors.** Minimum two fallbacks per adapter. Each
   layer logs its hit count via `debugLog`. Never silently return `[]`.
7. **Idempotency.** Don't add top-level event listeners — register
   through `window.__AIExporterRegistry`. Re-injection is normal.

Full priority table and rationale: [`docs/ADAPTER_NOTES.md`](docs/ADAPTER_NOTES.md).

---

## 5. Code conventions

- **Comments in English.** This is a community project — keep the
  source approachable to non-Chinese-speaking contributors. (Chat with
  the user can be in Chinese.)
- **No emoji in code.** Anywhere.
- **No narration comments** (`// increment the counter`). Comments
  explain *why*, not *what*. The lessons we learned and the constraints
  we hit are worth comments. Code paraphrase isn't.
- **No new dependencies** without a clear justification — we want the
  unpacked extension to be runnable from a fresh checkout with zero
  build steps.
- **Test hook pattern**: end each adapter IIFE with

  ```js
  if (window.__AIExporterTest) {
    window.__AIExporter<Site>Internals = { findChatPanel, ... };
  }
  ```

  so future test rigs can grab internals without refactoring.

---

## 6. Committing

The user explicitly OK's commits. Don't auto-commit. When asked:

- Subject line ≤ 60 chars, English, conventional commits prefix
  (`fix:`, `feat:`, `refactor:`, `docs:`).
- Body explains *why*, with one-line bullet per logical change.
- Reference the failure history bullet by date if applicable.
- Never `--no-verify`, never amend pushed commits, never push to
  `main` without explicit OK.

---

## 7. Quick reference — files you'll likely touch

| File | When to touch |
|---|---|
| `content/adapters/<site>.js` | Selector rot, new site DOM bug |
| `content/adapter-registry.js` | Adapter lifecycle plumbing only |
| `content/content.js` | Cross-adapter dispatch / image fetch logic |
| `popup/popup.html` + `popup.js` | UI changes, new options, site_bindings schema |
| `manifest.json` | New content script entry, new permission |
| `docs/ADAPTER_NOTES.md` | When you discover a new general principle |
| `CLAUDE.md` (this file) | When the debugging workflow itself improves |
