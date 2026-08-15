---
name: New adapter request
about: Request support for an AI chat site, or volunteer to build it
title: "adapter request: <site>"
labels: enhancement, adapter, help-wanted
---

**Site**
Name and chat page URL pattern (e.g. `https://chat.example.com/c/*`).

**Already on the roadmap?**
Check the community-wanted tables in RELEASE_NOTES.md — if the site is listed, mention the row so we can link things up.

**Selector hints**
From DevTools: what element wraps one user message, and one model response? Stable-looking attributes (`data-testid`, `data-message-*`, `role`) beat class names.

```html
<paste one user message + one model response outerHTML, redacted>
```

**Extraction mode guess**
- [ ] turn-based (user query → model response, like ChatGPT)
- [ ] bubble-based (flat stream with authors/timestamps, like WhatsApp)

**Can you test with a real account?**
- [ ] Yes, I can run a dev build against real conversations
- [ ] No, hints only

**Are you volunteering to build it?**
An adapter is ~100 lines; CONTRIBUTING.md has the checklist. Sponsoring instead? Tag this issue `sponsored-adapter` after donating (links in README).
