# Store assets — to be produced

The previous promo tile and four screenshots were removed on purpose: they
were 1024×1024 JPEGs mislabeled as `.png` (the Chrome Web Store requires
440×280 / 1280×800), carried stale v1.0 "Gemini Chat Exporter" branding, and
one contained garbled AI-generated text. Better empty than wrong.

The shot list with captions lives in `STORE_LISTING.md` → "Screenshots
Needed". To produce the real set:

1. Load the unpacked extension (README → Installation → Manual install).
2. **Screenshots (1280×800 true PNG):** capture the popup over a live
   conversation page. For a clean popup-only shot, open
   `chrome-extension://<id>/popup/popup.html` in a normal tab (the `<id>`
   is shown on `chrome://extensions`) and use the DevTools device toolbar
   to control the viewport.
3. **Promo tile (440×280 true PNG):** BaiZe mark + name on the dark
   palette; compose from `icons/baize.svg`.
4. **Icons** are rendered from `icons/baize.svg` (the source of truth):
   `uvx cairosvg icons/baize.svg -o icons/icon128.png --output-width 128 --output-height 128`
   (repeat for 48 and 16).
5. Optional hero media: the BaiZe intro animation (ink-wash beast inhaling
   chat bubbles into a scroll) — embed as a GIF in the README and as the
   store promo video once generated.

Verify every file before submission: `file *.png` must report real PNG data
at the advertised dimensions.
