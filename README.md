# Gemini Chat Exporter

> 一键把 Gemini 多模态对话导出为 Markdown，轻松喂给 Claude 继续分析。

---

## 为什么需要这个插件？

**Gemini 很强，但它不会整理自己。**

| 能力 | Gemini | Claude |
|------|--------|--------|
| 多模态理解（图片、表格、复杂图表）| ✅ 顶级 | 一般 |
| 长文综合、逻辑整理、深度分析 | 一般 | ✅ 顶级 |
| 导出/复制完整对话 | ❌ 没有 | ✅ 支持 |

典型的工作流：用 Gemini 分析一张复杂架构图或医学影像，得到详细解读；然后想把整个对话拿给 Claude 做进一步推理——**但 Gemini 没有全文复制功能**，你只能一段一段手动复制。

这个插件解决这个痛点。

---

## 效果演示

```
┌─────────────────────────────────────┐
│  📄 Gemini Chat Exporter            │
├─────────────────────────────────────┤
│  ☑ 自动滚动加载全部消息              │
│    取消则只导出当前可见内容           │
│  ☑ 包含图片 URL                     │
├─────────────────────────────────────┤
│  ⬇  下载 .md 文件                   │
│  📋 复制到剪贴板                     │
│                                     │
│  ✓ 已复制到剪贴板（共 47 轮对话）    │
└─────────────────────────────────────┘
```

导出的 Markdown 长这样：

```markdown
# 分析这张神经网络架构图

*Exported from Gemini on 2026-03-22*

---

## You

帮我分析这张 Transformer 架构图，重点讲 Attention 机制的数据流向。

---

## Gemini

这张图展示的是标准的 **Encoder-Decoder Transformer** 架构...

### Multi-Head Attention 的数据流

$$\text{Attention}(Q,K,V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$

每个 head 独立计算注意力权重，最终拼接后通过线性层投影...

```python
# 对应的 PyTorch 实现
attn_output = F.scaled_dot_product_attention(q, k, v)
```

![架构图标注版](https://lh3.googleusercontent.com/gg/abc123...)

---

## You

残差连接的作用是什么？

---
```

---

## 技术方案

### 架构总览

```
Chrome Extension (Manifest V3)
│
├── content/content.js      ← 注入 Gemini 页面，提取 DOM + 转换 Markdown
├── popup/popup.html|js     ← 弹窗 UI，收集选项，触发导出
├── background/             ← Service Worker，调用 chrome.downloads API
└── lib/turndown*.js        ← 打包的 HTML→Markdown 转换库（离线，无 CDN）
```

### 关键设计决策

**1. 选择器分层 Fallback，应对 Google 频繁改版**

Gemini 基于 Angular，使用自定义元素（Custom Elements）。Google 随时可能改 DOM 结构，所以每个选择器都是一个优先级数组：

```javascript
const SELECTORS = {
  conversationTurn: [
    'div.conversation-container',   // 当前确认有效
    '.conversation-container',      // 类名变体
    'conversation-container'        // Angular 自定义元素
  ],
  modelResponseContent: [
    'message-content .markdown',    // 主选择器
    '.model-response-text .markdown',
    '.markdown'                     // 最后兜底
  ],
  // ...
};
```

任何一级匹配到即停止，一次改版通常只需更新数组首项。

**2. 滚动加载：解决虚拟列表问题**

Gemini 对长对话使用**虚拟滚动**——只渲染视口附近的消息，旧消息不在 DOM 里。插件采用稳定性检测策略：

```
↑ 滚动到顶部 → 等待渲染 → 计数对话轮次
  └─ 连续 3 次计数不变 → 判定全部加载完毕
  └─ 最多 40 次尝试（约 50 秒超时保护）
```

可以通过 checkbox 关闭，只导出当前可见内容。

**3. 按轮次（Turn-based）提取，不是按像素位置**

提取逻辑完全基于对话轮次结构，100 轮对话就产出 100 个 `## You` / `## Gemini` 段落，与滚动位置无关：

```javascript
const turns = queryAll(SELECTORS.conversationTurn);  // 找所有轮次容器
turns.map(turn => ({
  userText:  extractUserText(turn),      // 用户问题（纯文本）
  modelHtml: extractModelHtml(turn),     // AI 回答（原始 HTML）
  images:    extractImages(turn)         // 图片 URL 列表
}))
```

**4. Turndown + GFM 插件做 HTML→Markdown**

AI 回答的 HTML 包含代码块、表格、数学公式等复杂结构，直接用 `.textContent` 会丢失格式。Turndown 逐节点转换，并扩展了：

- 数学公式：`.math-block` / `.math-inline` → `$$...$$` / `$...$`
- GFM 表格、删除线、任务列表（通过 turndown-plugin-gfm）
- 过滤 Gemini 的引用标记（`[cite:...]`）和 UI 按钮节点

**5. 大文件下载走 Service Worker**

`chrome.downloads` API 只在扩展上下文可用，Content Script 没有权限。弹窗将 Markdown 文本转发给 Service Worker，由后者编码为 Base64 Data URL 触发下载——对 Unicode（中文、emoji）做了正确处理：

```javascript
const bytes  = new TextEncoder().encode(markdown);  // UTF-8 字节
const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
const dataUrl = `data:text/markdown;charset=utf-8;base64,${btoa(binary)}`;
chrome.downloads.download({ url: dataUrl, filename });
```

---

## 安装

**方法一：开发者模式加载（推荐，当前唯一方式）**

```
1. 克隆或下载此仓库
2. 打开 Chrome → chrome://extensions
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目根目录
```

> 首次加载后图标会出现在工具栏，点击图钉固定它。

---

## 使用指南

| 场景 | 操作 |
|------|------|
| 导出完整长对话 | 保持「自动滚动」勾选，点击下载 |
| 快速复制当前可见部分 | 取消勾选「自动滚动」，点击复制 |
| 不需要图片，纯文字 | 取消勾选「包含图片 URL」|
| 把导出内容给 Claude | 复制到剪贴板，直接粘贴到 Claude |

偏好设置会自动保存，下次打开无需重新配置。

---

## 如果提取失败

Gemini DOM 改版时，浏览器控制台会出现错误，或弹窗提示"未找到对话内容"。

定位方式：在 Gemini 页面按 `F12` → Elements，找到对话消息对应的 HTML 元素，然后更新 [content/content.js](content/content.js) 顶部 `SELECTORS` 对象中对应字段的数组首项。其他逻辑不需要改动。

---

## 文件结构

```
gemini_all_context/
├── manifest.json                   Chrome 扩展清单（MV3）
├── content/
│   └── content.js                  核心：DOM 提取 + Markdown 转换 + 消息监听
├── popup/
│   ├── popup.html                  弹窗界面
│   └── popup.js                    弹窗逻辑（选项、按钮、状态展示）
├── background/
│   └── service_worker.js           文件下载中继
├── lib/
│   ├── turndown.min.js             HTML→Markdown（本地打包）
│   └── turndown-plugin-gfm.min.js  GFM 扩展（表格、删除线等）
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 致谢

- [Turndown](https://github.com/mixmark-io/turndown) — HTML to Markdown 转换
- [turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm) — GitHub Flavored Markdown 支持
- 灵感来自 [gemini-export](https://github.com/jujusharp/gemini-export) 和 [ai-chat-exporter](https://github.com/amazingpaddy/ai-chat-exporter)
