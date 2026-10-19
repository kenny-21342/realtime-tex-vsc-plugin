# Changelog

## Unreleased

- CI: the build and the end-to-end suite (Linux, macOS, Windows) also run on pull requests, not
  only after a push to `main`; a new `render` job checks the preview's drawing against MuPDF on
  realtime-tex's picture corpus (`test/render/compare.py --max 0.06 --require-native`).

## 0.0.3 (2026-10-13)

- Newly added paragraphs keep live feedback while the engine updates pagination. The Live
  indicator is shown only after the current edited units' rows are visible; its tooltip explains
  that page layout is still updating. Unplaced or clipped rows keep the updating indicator.
  Off-page live boxes re-anchor when page previews arrive, and rollback restores their original
  placements so a new paragraph cannot leave ghost text on an unrelated restored page.
  Requires engine v0.0.9 for new-paragraph page previews.

## 0.0.2 (2026-10-12)

- Display complete rebuilt pages as the engine ships them, without waiting for the rest of a
  long document. Page previews update drawing and source placements together, retain the
  committed layout for rollback, and prevent a newer growing paragraph from overlapping
  following drawings. Missing resources retain the previous page. Requires engine v0.0.8 with
  `PagePreview` events; older engines continue to use full layouts. Late-page previews still
  wait for TeX to process the preceding document.

- Full layouts made entirely of exact or natively drawable pages no longer transfer and open
  the whole document PDF on every update. Unsupported pages and missing fonts or images still
  use the PDF, including unchanged pages retained from an earlier layout.

- Live picture label edits draw the engine's native paths and glyph transforms at each row's
  placement, keeping axes, lines and rotated labels. Requires engine v0.0.7 or newer. With older
  engines or unsupported literals, the complete previous unit stays visible until the full compile,
  without an error outline.

- While an edit leaves a TikZ picture with errors (a half-typed coordinate), the preview keeps its
  last good version, outlined and labelled "editing", until the errors are fixed, instead of losing
  the picture. rtex 0.0.6 holds the picture in full compiles (`LayoutUpdate.held`); a live result
  with errors no longer blanks the part being typed either (its previous drawing stays, outlined).
  Setting `realtimeTex.engine.holdBrokenPictures` (on by default); the status pill's tooltip says
  when something is held.
- Self-update: installing the downloaded `.vsix` failed with "No Servers" (it was passed to VS Code
  under the `vscode-userdata:` scheme of the extension's storage; the installer takes `file:` URIs).
- The engine comes from the fork by default: **Install rtex** downloads the releases of
  [kenny-21342/realtime-tex](https://github.com/kenny-21342/realtime-tex/releases) (upstream's lack
  the fork's work), and **Build from Source** builds its `kenny/main` (its `main` mirrors upstream)
  when `realtimeTex.engine.branch` is empty. `realtimeTex.engine.repository` still picks another
  repository, upstream included, and then the empty branch means `main`.
- The extension updates itself from GitHub: every push to `main` is built and published as the
  rolling `main-build` prerelease (version `<next patch>-main.<run>`), and once a day the extension
  downloads a newer `.vsix`, checks its SHA-256, installs it and offers **Reload Window**.
  `realtimeTex.extensionUpdates` (`main`, `releases`, `off`), `realtimeTex.extensionRepository`,
  **Realtime TeX: Check for Extension Updates**. The extension's repository is now this fork.
- Native TikZ drawing: pages rtex sends with a `native` drawing (pgf paths, fills, strokes, dashes,
  clips, opacity, axial/radial shadings, transformed node text) are drawn on the canvas instead of
  from the PDF. Needs an rtex with native drawing (realtime-tex docs/DISPLAY_LIST.md, "Native
  drawing"); with older builds those pages still come from the PDF.
- Tiling patterns (TikZ `patterns` / `patterns.meta`) on native pages are drawn too: each cell is
  rendered once per period at the page's resolution and repeated through the pattern's matrix,
  so tiles stay anchored to the page as in the PDF (realtime-tex docs/display-list.md).
- TikZ fadings (soft masks) on native pages: each masked fill or shading is drawn on a layer and
  kept where the mask's luminosity says, as in the PDF.
- Cached TikZ pictures on native pages are found through the page's `pictures` spots and matched by
  cache key (`file:line`), so they stay in place while you edit around them.
- `realtimeTex.engine.repository` and `realtimeTex.engine.branch`: build the managed engine from a
  fork or a branch; **Update rtex Engine** and the daily check follow them.
- Render check (`npm run build:render`, `test/render/`): the preview's drawing code against MuPDF.
- CMYK colors (text and drawings) are converted the way pdf.js converts them, so a page looks the
  same drawn natively or from the PDF (CMYK magenta was #ff00ff before).
- Landscape pages (pdflscape's `/Rotate`, rtex's page `rotate`) are shown turned, as PDF viewers
  show them: drawing, the PDF fallback, double-click to source and the cursor marker follow the
  turn.
- Text and drawing colors follow the color stack top rtex records (`after` on color items, the
  page's `color_base`), so a page that starts inside a color group, or interleaves stacks, keeps
  its colors.
- A live unit takes its cached pictures only from its own page lines, on natively drawn pages too
  (the `pictures` spots inside those lines), so another unit's picture of the same size is never
  copied.
- `realtimeTex.engine.fastBudgetFactor` and `realtimeTex.engine.passTimeoutSeconds`: the live
  budget relative to the document's typical update (rtex `--fast-budget-factor`), and the time
  limit for a full compile (rtex `--pass-timeout-ms`). Passed only when changed, like the other
  engine settings.
- Glyphs LuaTeX does not write to the PDF (a font with no name or file, such as pgf's `\nullfont`;
  a character an OpenType font lacks) are skipped instead of sending the page to the PDF.

## 0.0.1

First release.

- Live preview that re-typesets the edited paragraph through rtex's fast path and installs background layouts as they arrive.
- Native display-list renderer for OpenType/TrueType fonts (glyph indices) and Type1/TFM fonts (through `pdftex.map`), with colors, rules, images and graphicx transforms. Pages it cannot draw exactly fall back to the background PDF, rendered by pdf.js.
- Live markers next to the line numbers: a solid green bar beside the parts that update live as you type, a dotted amber bar beside the parts that wait for the full compile, with the reason on hover (`realtimeTex.editor.liveMarkers`).
- **Install rtex** downloads the prebuilt engine of the latest realtime-tex release (v0.0.2 and later) for Linux (x86_64, arm64), macOS (arm64, x86_64) or Windows (x86_64), checks its SHA-256 and unpacks it into the extension's storage; no Rust needed. **Install rtex (Build from Source)** still builds realtime-tex `main` with `cargo`, and `realtimeTex.installFrom` picks the default. Updates follow the way the rtex in use was installed (a newer release, or new commits on `main`). **Install TeX Live** downloads realtime-tex's installer script instead of cloning the repository.
- `realtimeTex.engine.fastBudgetMs` defaults to 50 ms, rtex's own default since 0.0.2.
- Windows support (realtime-tex `3741920`): the preview runs rtex natively on Windows. **Install rtex** and **Install TeX Live** run their scripts in Git Bash, the managed binary is `rtex.exe`, and lualatex is found as `lualatex.exe`. CI runs the integration suite on Linux, macOS and Windows.
- Two-way navigation: the preview follows the cursor, and a double-click in the preview jumps to the source.
- LaTeX errors and warnings in the Problems panel; a status pill and status bar entry that explain what the engine is doing.
- Export PDF, recompile, restart and stop commands; automatic main-file detection.
- Guided setup: walkthrough, **Check Setup**, one-click **Install rtex** (build from source) and an optional minimal TeX Live install.
- A first compile that fails or takes long explains itself (with the LaTeX log one click away) instead of waiting silently.
- Keep rtex up to date: **Update rtex Engine** pulls the latest realtime-tex, rebuilds it and restarts the engine; the `realtimeTex.updateCheck` setting (`notify` / `auto` / `off`) checks once a day.
- Follows realtime-tex `e5cab6a`: a full compile that produces no pages (`compile: Failed`) keeps the previous pages on screen with a banner (before the first layout it explains the failure); paragraphs rtex reports as `removed` are cleared; TikZ pictures reused from the picture cache are drawn from the PDF; new routing reasons are explained in plain words.
- Engine settings: `realtimeTex.engine.eligibility`, `realtimeTex.engine.fastBudgetMs`, `realtimeTex.engine.pictureCache` (passed to `rtex serve` only when changed, so older rtex builds still start); changing them restarts the engine.
- Removed the workaround for projects with subfolders: rtex creates them itself since `e324bef` (update rtex with **Update rtex Engine**).
- Debugging: `realtimeTex.debug.enabled` (and `realtimeTex.debug.directory`) makes rtex save a bundle for every live-engine failure; the extension announces each bundle with **Reveal Bundle** / **Copy Path**. **Open Debug Folder** opens the folder.
