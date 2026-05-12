# Chrome Web Store Listing — AI Chat Exporter

> Copy material for the Chrome Web Store submission of the multi-site AI Chat Exporter (v2.0+).

---

## Basics

| Field | Value |
|-------|-------|
| **Extension Name** | AI Chat Exporter — Markdown export for Gemini, ChatGPT, Claude, Meta AI, WhatsApp |
| **Short Name** | AI Chat Exporter |
| **Category** | Productivity |
| **Language** | English (Primary), zh-CN (Localized) |

---

## Short Description (≤132 chars)

```
Draw from every AI; grow your own intelligence. Export Gemini, ChatGPT, Claude, Meta AI, WhatsApp, OpenWebUI to Markdown.
```

---

## Detailed Description (English)

```
🚀 AI Chat Exporter — Draw from every AI; grow your own intelligence.

Switching between Gemini, ChatGPT, Claude, Meta AI, WhatsApp and your own OpenWebUI? Every one of them has a different (or missing) export experience. This extension gives them all the same one-click Markdown export.

━━━━━━━━━━━━━━━━━━━━━━

🌐 SUPPORTED SITES

• Gemini (gemini.google.com)
• ChatGPT (chatgpt.com, chat.openai.com)
• Claude (claude.ai)
• Meta AI (meta.ai)
• WhatsApp Web (web.whatsapp.com) — any contact, including Meta AI
• OpenWebUI — your own self-hosted instance (add the URL in the popup)

Each site has its own adapter, with multi-layer fallback selectors that survive UI redesigns.

━━━━━━━━━━━━━━━━━━━━━━

✨ KEY FEATURES

📝 Clean Markdown
Code blocks, tables, math formulas (KaTeX → LaTeX), task lists, citations — all preserved. Claude's "Extended Thinking" is wrapped in a collapsible <details> block.

🖼️ Image Export
Captures local uploads (blob: URLs that vanish on tab close) and optionally generated/remote images. Inline as data: URIs or packaged into a ZIP.

📋 Copy or Download
One click to copy the whole conversation, or download as .md / .zip.

⚙️ Per-Site Configuration
Toggle any adapter on/off. Add extra domains (ChatGPT mirrors, internal OpenWebUI, private proxies) — the extension requests permission for that origin at runtime, never globally.

⚡ Smart Scrolling
Auto-scrolls to load all messages. WhatsApp's virtual scroller (which recycles offscreen bubbles) gets a dedicated harvest strategy.

🔒 100% Local
No telemetry. No network calls except fetching the page's own images. End-to-end-encrypted content (WhatsApp) stays in your browser.

━━━━━━━━━━━━━━━━━━━━━━

🎯 PERFECT FOR

• Feeding one AI's analysis into another
• Archiving long debugging sessions or research
• Building a personal knowledge base in Obsidian / Notion
• Saving WhatsApp Meta AI chats for offline reference
• Documenting AI-assisted work

━━━━━━━━━━━━━━━━━━━━━━

📍 COMING SOON

More adapters are added on demand, not in big batches. Currently in the queue:

Chinese: Doubao · Kimi · Zhipu (ChatGLM) · Qwen · Wenxin · Spark · MiniMax · StepFun · 01.AI
English: HuggingChat · Perplexity · DeepSeek · Grok · Mistral Le Chat · Microsoft Copilot · Pi

If a site you care about is on this list, you can sponsor faster delivery (links inside the popup).

━━━━━━━━━━━━━━━━━━━━━━

🔐 PERMISSIONS EXPLAINED

• Host permissions for the six supported sites — only read the chat DOM when you click export.
• "optional_host_permissions": *://*/* — NOT granted by default; only activates when YOU add a custom OpenWebUI / mirror site in the popup, which triggers Chrome's native permission prompt.
• "scripting" — inject the per-site adapter on demand.
• "downloads" — save the .md / .zip to your computer.
• "storage" — remember checkbox preferences and your custom site list.
• "clipboardWrite" — for the Copy button.

━━━━━━━━━━━━━━━━━━━━━━

📖 OPEN SOURCE

https://github.com/congzhangzh/sorry_gemini

Like the tool? You can sponsor faster Roadmap delivery on GitHub Sponsors or Ko-fi (links in the popup). The extension stays free and open source — sponsorship only influences which adapter gets prioritized next.

━━━━━━━━━━━━━━━━━━━━━━

If this saves you time, please leave a ⭐ review!
```

---

## Detailed Description (中文)

```
🚀 AI Chat Exporter — 汲百家所长，长出你自己的智慧

Gemini、ChatGPT、Claude、Meta AI、WhatsApp、自部署的 OpenWebUI——每家都有不同的导出体验，或者干脆没有。这个扩展给它们统一了一键 Markdown 导出。

━━━━━━━━━━━━━━━━━━━━━━

🌐 支持站点

• Gemini (gemini.google.com)
• ChatGPT (chatgpt.com, chat.openai.com)
• Claude (claude.ai)
• Meta AI (meta.ai)
• WhatsApp Web (web.whatsapp.com) — 包括与 Meta AI 联系人的对话
• OpenWebUI — 自部署实例（在弹窗内添加自己的地址）

每个站点有独立的适配器，多层 fallback 选择器抗 UI 改版。

━━━━━━━━━━━━━━━━━━━━━━

✨ 核心功能

📝 干净的 Markdown
代码块、表格、数学公式 (KaTeX → LaTeX)、任务列表、引用，全部保留。Claude 的 "Extended Thinking" 自动包裹为可折叠的 <details>。

🖼️ 图片导出
捕获本地上传 (关闭页面就消失的 blob: URL)，可选下载生成的远程图片。Markdown 内联或打包 ZIP。

📋 复制或下载
一键复制整段对话，或下载 .md / .zip。

⚙️ 站点配置
任一适配器可启用/禁用；可为镜像、内网部署、私有代理添加额外域名——扩展运行时按需申请权限，永不全局持有。

⚡ 智能滚动
自动滚动加载全部消息。WhatsApp 的虚拟滚动 (离屏气泡会被回收) 用专门的"边滚边收集"策略处理。

🔒 100% 本地
无遥测，无网络请求 (除拉取页面自己的图片)。WhatsApp 的端到端加密内容只在你的浏览器里。

━━━━━━━━━━━━━━━━━━━━━━

📍 即将支持

新适配器按真实需求添加,不批量上线。当前 Roadmap:

中文圈: 豆包 · Kimi · 智谱清言 · 通义千问 · 文心一言 · 讯飞星火 · MiniMax 海螺 · 阶跃跃问 · 零一万物
英文圈: HuggingChat · Perplexity · DeepSeek · Grok · Mistral Le Chat · Microsoft Copilot · Pi

如果你关注的站点在列表上,可以通过 popup 内的赞助链接让它优先上线。

━━━━━━━━━━━━━━━━━━━━━━

🔐 权限说明

• 6 个支持站点的 host 权限：仅在点击导出时读取对话 DOM
• optional_host_permissions: *://*/*：默认 **不持有**；仅当你在弹窗里手动添加 OpenWebUI / 镜像站点时,Chrome 弹原生授权框
• scripting：按需注入对应适配器
• downloads：保存 .md / .zip 到电脑
• storage：记忆勾选项与自定义站点列表
• clipboardWrite：复制按钮使用

━━━━━━━━━━━━━━━━━━━━━━

📖 完全开源
https://github.com/congzhangzh/sorry_gemini

喜欢这工具? 你可以通过 popup 里的 GitHub Sponsors / Ko-fi 链接赞助,加速 Roadmap 上某个站点的落地。扩展本身免费开源,赞助仅影响优先级。
```

---

## Privacy Policy

```markdown
# Privacy Policy — AI Chat Exporter

**Last updated: 2026-05-12**

## Data Collection
AI Chat Exporter does NOT collect, store, transmit, or share any user data. Period.

## How It Works
- The extension reads the currently visible conversation DOM from the supported AI chat sites — only when you click an export button.
- All processing (DOM extraction, Markdown conversion, image encoding, ZIP packaging) happens entirely within your browser.
- No data is sent to any external server, API, or analytics service.
- Exported files are saved directly to your computer via Chrome's built-in download manager.

## Permissions Used
| Permission | Purpose |
|------------|---------|
| `activeTab` | Access the current tab when you click the extension |
| `scripting` | Inject the per-site adapter on demand |
| `downloads` | Save exported files to your computer |
| `storage` | Remember preference settings and custom site list locally |
| `clipboardWrite` | Copy the markdown to your clipboard on demand |
| Host permissions (gemini.google.com, chatgpt.com, chat.openai.com, claude.ai, meta.ai, web.whatsapp.com) | Read conversations on these specific sites |
| `optional_host_permissions: *://*/*` | NOT granted by default. Activated only when you explicitly add an OpenWebUI / mirror site through the popup, which triggers Chrome's native permission dialog. You can revoke any added permission from the popup at any time. |

## Local Storage
The extension uses `chrome.storage.local` to remember:
- Your checkbox preferences (auto-scroll, include images, ZIP packaging, etc.)
- Your `site_bindings` table: which adapters are enabled and which extra domains you've authorized.
This data never leaves your browser.

## Third-Party Services
None. The extension makes no analytics or telemetry network requests. All libraries (Turndown, JSZip) are bundled locally.

## Network Activity
The extension only fetches resources that are already part of the AI chat page you're viewing — specifically, image URLs in the conversation, when you've checked "include images" / "download remote images". No other network activity.

## Open Source
The complete source code is available at:
https://github.com/congzhangzh/sorry_gemini

## Contact
https://github.com/congzhangzh/sorry_gemini/issues
```

---

## Screenshots Needed (1280×800 or 640×400)

| # | Content | Caption |
|---|---------|---------|
| 1 | Popup with site-config panel expanded | "One export button for every AI" |
| 2 | Exported ChatGPT Markdown in VS Code | "Clean Markdown with code, tables, LaTeX" |
| 3 | WhatsApp Web with Meta AI conversation + popup pill showing "WhatsApp" | "Export Meta AI chats from WhatsApp Web" |
| 4 | Popup adding a custom OpenWebUI URL | "Plug in your self-hosted OpenWebUI" |
| 5 | ZIP file structure | "Images as separate files in a clean folder" |

---

## Promotional Tiles

| Size | Use |
|------|-----|
| 440×280 | Small tile |
| 920×680 | Large tile (optional) |
| 1400×560 | Marquee (optional) |

---

## Publishing Checklist

- [ ] Chrome Web Store developer account ($5 one-time)
- [ ] Privacy policy live (GitHub Pages or repo README)
- [ ] 5 screenshots (1280×800)
- [ ] 128×128 high-res icon
- [ ] Zip the extension (exclude `.git`, `STORE_LISTING.md`, `Chrome Extension MV3 技术报告.md`)
- [ ] Fill listing using copy above
- [ ] Highlight the `optional_host_permissions: *://*/*` reasoning under "Single purpose" review — auditors usually ask about wildcard hosts; the answer is "for self-hosted OpenWebUI, user-granted at runtime only"
- [ ] Submit for review (typically 1-3 business days)

---

## Notes for the reviewer

Wildcard `optional_host_permissions: *://*/*` is required so users can authorize their **own self-hosted OpenWebUI** deployment, whose URL is unknown at packaging time. The permission is **never granted automatically** — it activates only after the user explicitly types in a URL inside the popup and clicks "添加 / Add", which triggers Chrome's native permission prompt. The permission can be revoked from the same popup, which calls `chrome.permissions.remove()`. We could narrow to `http://localhost/*` only, but that would block the legitimate use case of users running OpenWebUI on their own servers.

The optional "spool bucket" checkbox writes an extra `.md` copy of each export to `~/Downloads/ai-chat-spool/<timestamp>-<adapter>-<title>.md` using the regular `chrome.downloads.download` API. This is local-only and does not perform any network requests; it exists so an external MCP server (independent npm package, separate distribution) can pick up conversation history without coupling to the extension.

Sponsorship links in the popup open `github.com/sponsors/...` and `ko-fi.com/...` in a regular browser tab. No in-extension payment, no embedded checkout, no license-key validation. All extension functionality remains free.
