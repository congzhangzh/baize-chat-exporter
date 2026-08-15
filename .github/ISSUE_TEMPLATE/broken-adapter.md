---
name: Broken adapter
about: An export fails or produces wrong content on a supported site
title: "[<site>] export fails: <one-line symptom>"
labels: bug, adapter
---

**Site + URL**
Which site, and the URL pattern of the page you exported from (strip any conversation IDs you consider private).

**Extension version**
Shown at the bottom of the popup (e.g. v2.0.0).

**What happened**
What you clicked, what you expected, what you got (error message text helps).

**Debug output** (this is usually 90% of the fix)
1. Open the page's DevTools console (F12).
2. Run `localStorage.AI_EXPORTER_DEBUG = '1'` and reload the tab.
3. Retry the export.
4. Paste every console line prefixed with `[AI Exporter]` below.

```
<paste here>
```

**DOM snippet** (if you can)
In DevTools, right-click one user message and one model response → Copy → Copy outerHTML. Redact any private text; the element/attribute structure is what matters.

```html
<paste here>
```
