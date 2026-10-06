# Deploying House Painter

House Painter is a static site: HTML and JavaScript that run in the visitor's browser. There is no server, database, account, API key or upload. A blueprint
is opened from the visitor's computer and stays there; colour schemes are kept in the visitor's `localStorage` and in links they share.

This page is for putting it on **Cloudflare Pages** at <https://housepainter.r7orbit.io/> and embedding it in an iframe on <https://r7orbit.io>. Any static
host works the same way if you give it `dist/` and the headers in `_headers`.

## What the site requests (and where each library now comes from)

Before this change the pages fetched code from three CDNs. Now every library is a file in [`vendor/`](../vendor/README.md), served from the same host
(versions pinned, licences included, checksums in `vendor/SHA256SUMS`), so the site makes **no third-party request** and its CSP needs no CDN host.

| What | Version | Was loaded from | Now | When it loads |
|---|---|---|---|---|
| three.js, `OrbitControls`, `RoomEnvironment` | r128 | `cdn.jsdelivr.net` | `vendor/three-r128/` | Opening `paint.html` (all three) or `editor.html` (first two) |
| PDF.js and its worker | 3.11.174 | `cdnjs.cloudflare.com` | `vendor/pdfjs-3.11.174/` | Only when a PDF blueprint is opened |
| tesseract.js, its worker, WebAssembly core and English data (the optional dimension reader, about 7 MB) | 5.1.1 | `cdn.jsdelivr.net` (the library, the worker, `tesseract.js-core`, `@tesseract.js-data/eng`) | `vendor/tesseract-5.1.1/` | Only after the visitor presses **Read dimensions** and agrees |
| onnxruntime-web (the optional wall-finding model runtime, about 11 MB) | 1.20.1 | `cdn.jsdelivr.net` | `vendor/onnxruntime-web-1.20.1/` | Only after the visitor chooses an ONNX model file; the model is theirs and never shipped |
| Google Fonts (Bricolage Grotesque, IBM Plex Sans and Mono) | n/a | `fonts.googleapis.com`, `fonts.gstatic.com` | **Still there**: the `<link>`s in `index.html`, `paint.html` and `editor.html` are being replaced when the restyle self-hosts the fonts | Every page open |

All five libraries are under Cloudflare Pages' 25 MiB-per-file limit (the largest is `ort-wasm-simd-threaded.wasm`, 10.7 MB), so all five are vendored
and the optional ones still load lazily, from the same place, with the same code path. Nothing is left on a CDN.

The only other `https://` addresses in the pages are ordinary links to GitHub in `index.html` (they navigate, they don't load anything).

`editor.js` is the one app file touched: the three places that named a CDN now call a one-line helper (`VENDOR('pdfjs-3.11.174/pdf.min.js')`) that builds the
address under `vendor/`, and the tesseract.js worker is told where its files are. The onnxruntime-web build is `ort.wasm.min.js` (WebAssembly only) instead of
`ort.min.js` (which also carries WebGPU and WebGL code and a 21 MB `.wasm`): the editor only ever asks for the `wasm` engine, so behaviour is the same.

## The build

```bash
npm run build        # node tools/build.js: Node built-ins only, no install step
npm run preview      # serves dist/ like Cloudflare Pages does, at http://localhost:8788/
```

`dist/` contains only what the pages need:

```
dist/
  index.html  paint.html  editor.html  floorplan.html  404.html  _headers  .nojekyll
  assets/    <name>.<hash>.js|css|png|woff2 ...   content-hashed: every file the pages name, and what CSS points at
  vendor/    <library>-<version>/                 the libraries above, with their licences
  houses/    <id>/house.json                      the example houses (no schemes/: nothing loads them)
  textures/  desert_sand_plank.png
```

Left out on purpose: `blender_addon/`, `build_house.py`, `docs/`, `tests/`, `tools/`, `data/`, `examples/`, `renders/` (except the one picture the landing page shows),
`.git*`, `.blend` files, `package.json`, markdown, and `paint-colors-extra.js` (a colour book built from a paint maker's data on one machine: it must never be published).

How it works, so you can predict it:

- It reads each page in the repository root and rewrites every local `<script src>`, `<link href>` (stylesheet, icon), `<img src>` and the script names in
  `house-loader.js`'s `data-then` to `assets/<name>.<sha256 first 10>.<ext>`. CSS (a `.css` file or a `<style>` block) is scanned for `url(...)` and `@import`, so fonts and
  images it names are hashed too and the CSS hash covers the rewritten text. Paths stay relative to the page, so the site works from the root of any host or a sub-path.
- Files under `vendor/` keep their path (the version is in the folder name). `houses/` and `textures/` keep theirs too, because the pages fetch them by name
  (`?house=houses/...`, `floor.texture` in a house file).
- It **fails** (exit 1, nothing deployed) if: any file is over 25 MiB or there are over 20,000 files; a reference does not resolve, **checked case-sensitively**
  (a Windows or macOS checkout would hide `Paint.js` vs `paint.js`); a `vendor/` file differs from `vendor/SHA256SUMS`; a page or app script asks for a CDN; `_headers`
  sets `X-Frame-Options`, lacks the `frame-ancestors` rule, or has no rule for a built page. It **warns** about Google Fonts links (until they are replaced).
- It prints the bundle size and what each page downloads when it opens. Current numbers (`npm run build`): about 25.9 MB in 44 files, of which 22.7 MB is the optional
  PDF / text-reading / model code that loads only on demand. A visitor opening the paint studio downloads about 0.85 MB of code plus the example house and textures
  (the landing page, 1.75 MB, is mostly its picture).

`npm test` includes `tests/build.test.js`, which runs the build and checks all of this.

## Cloudflare Pages settings

Create the project from the GitHub repository `EOSHunter/house-painter` (Workers & Pages > Create > Pages > Connect to Git):

| Setting | Value |
|---|---|
| Framework preset | **None** |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | (leave empty) |
| Environment variable (production and preview) | `NODE_VERSION` = `22` |

There is nothing to install (`package.json` has no dependencies), so the build takes a second or two.

Manual steps (they need your Cloudflare account):

1. **Custom domain:** the project's *Custom domains* tab > *Set up a custom domain* > `housepainter.r7orbit.io`. If `r7orbit.io` is a zone in the same Cloudflare account,
   Pages adds the `housepainter` CNAME (to `<project>.pages.dev`, proxied) for you. Otherwise add that CNAME at your DNS host. HTTPS is issued automatically.
2. **Leave these off** for the zone or the site (they rewrite or add scripts): Rocket Loader, Auto Minify, Email Address Obfuscation, and Cloudflare Web Analytics' automatic
   beacon (a third-party request, and it would need a CSP host). **Preview deployments** (`*.pages.dev`) are not embeddable on r7orbit.io and don't need to be: `frame-ancestors`
   admits only r7orbit.io.
3. Optional: protect preview deployments with Cloudflare Access if the site shouldn't be visible before launch.

Direct upload instead of Git: `npm run build && npx wrangler pages deploy dist --project-name house-painter --branch main`.

The `.github/workflows/pages.yml` workflow (GitHub Pages) still builds `dist/` and publishes it at `https://eoshunter.github.io/house-painter/`: paths are relative, so that works,
but its headers are GitHub's, not `_headers`. Delete the workflow if you only want Cloudflare.

## Headers

`_headers` (copied to `dist/_headers`; Cloudflare Pages applies it, and **merges every rule a URL matches** rather than overriding, so `Cache-Control` appears in exactly one rule per URL):

| For | Header |
|---|---|
| everything | `Content-Security-Policy: frame-ancestors 'self' https://r7orbit.io https://www.r7orbit.io` (no `X-Frame-Options`: it can't name two origins, and a stray one would block the embed) |
| everything | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` (fullscreen, pointer lock and clipboard are not restricted) |
| pages (`/`, `/paint`, `/paint.html`, ...) | `Cache-Control: no-cache`: revalidate every time, so a deploy shows at once |
| `/assets/*`, `/vendor/*` | `Cache-Control: public, max-age=31536000, immutable` |
| `/houses/*`, `/textures/*` | `Cache-Control: no-cache` (fetched by name; they revalidate with an `ETag`, which is cheap) |

**There is deliberately no `script-src` / `default-src` policy.** One was tried against the whole suite in `tools/e2e/embed.js` and every feature passed (PDF.js and its
worker, tesseract.js with its blob worker and WebAssembly, onnxruntime-web, share links, painting, walk-through):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:;
connect-src 'self' data: blob:; object-src 'none'; base-uri 'self'
```

(`'unsafe-inline'` for styles is needed: the pages use inline `<style>` blocks and `style=` attributes. Add the Google Fonts hosts to `style-src` / `font-src` until they are
self-hosted.) It was not shipped because that test does not cover every editor tool, and the restyle may add something it forbids. To adopt it: append it to the
`Content-Security-Policy` line after the `frame-ancestors` part, run `E2E_CSP="..." node tools/e2e/embed.js`, and click through the editor tools by hand.

## Embedding

```html
<iframe src="https://housepainter.r7orbit.io/paint"
        title="House Painter"
        style="width:100%;height:100vh;border:0"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-downloads"
        allow="fullscreen; clipboard-write"
        loading="lazy"></iframe>
```

Embed `/paint` (the studio) or `/editor`, not `/`: the landing page's GitHub links have no `target`, so they would try to open GitHub inside the frame, and GitHub refuses to be framed.
The studio links to the editor and back inside the same frame, and `/paint.html` and `/paint` both work (Pages redirects the first to the second, keeping `?query` and `#hash`).

What the app needs from the iframe, as tested in Chromium (`node tools/e2e/embed.js`):

| Attribute | Needed? | Why / what happens without it |
|---|---|---|
| `sandbox="allow-scripts"` | **Yes** | It is JavaScript. |
| `allow-same-origin` | **Yes** | `localStorage` (schemes, the opened house), `IndexedDB` (the blueprint picture, the model file) and same-origin `fetch` of the house files. Without it the frame has an opaque origin and all of these fail. |
| `allow-pointer-lock` | **Yes** for mouse-look | The walk-through. Without it a click can only pick a wall, not look around. Touch devices don't use it. |
| `allow-forms` | **Yes** | Every dialog that asks for text is a `<form>`: new / duplicate / rename scheme, the scale length in the editor, the PDF page chooser, new paint group. Without it Enter and the button do nothing and the console says *Blocked form submission ... allow-forms*. This one is **not** in the host's original list. |
| `allow-downloads` | **Yes** for saving | **Save house.json** and **Export for Blender** are downloads. Without it the browser drops the file silently, and the page still says "Saved ...". Also not in the original list. |
| `allow-modals`, `allow-popups`, `allow-top-navigation` | No | The app never calls `alert`, `confirm`, `prompt`, `window.open` or changes the top page. |
| `allow="fullscreen"` | **Yes** for the Full screen button | Without it the button does nothing. |
| `allow="clipboard-write"` | **Yes** for **Share link** to copy | Without it the studio still works: it opens a dialog showing the link to copy by hand (its Copy button fails too). The link is the same either way. |
| other `allow` features | No | No camera, microphone, geolocation, `clipboard-read`, WebGPU, SharedArrayBuffer or cross-origin isolation. |

Share links are built from the frame's own address, so inside the embed they read `https://housepainter.r7orbit.io/paint#scheme=...` (never the page that embeds it), and
open and restore the scheme on their own. The scheme travels in the `#hash`, which no server sees. The link grows with the scheme (180 characters for one painted surface; more as the scheme grows); a house opened from a file travels inside the link too, minus any floor photo.

`housepainter.r7orbit.io` and `r7orbit.io` are the same *site*, so browsers treat the frame's `localStorage` as first-party rather than partitioning it: schemes saved in the frame survive reloads
and later visits (tested in Chromium; Safari and Firefox were not available).

**Anything that fails in an iframe:** nothing beyond the table. The page needs a click inside the frame before the keyboard works (WASD keys go to the page that has focus);
a host page that scrolls will compete with the frame for the mouse wheel over the canvas, so give the frame the full viewport height; and without WebGL the 3D view does not appear
(below). Not tested: Safari and Firefox (only Chromium 153 was available), and a real touch device (only Chromium's phone emulation).

## Needs, controls, and what happens without WebGL

**No cross-origin isolation.** The app does not use `SharedArrayBuffer`, so it needs **no** `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers, and must not be given any:
COEP would stop the frame loading inside r7orbit.io. (onnxruntime-web runs single-threaded because the page isn't isolated; the optional models are slower, not broken.)

**Browser:** a current Chrome, Edge, Firefox or Safari. It uses WebGL (three.js r128 takes WebGL 2 and falls back to WebGL 1), Canvas 2D, `localStorage`, `IndexedDB`, Web Workers and
WebAssembly (only for the optional readers), `CompressionStream`/`DecompressionStream` for compact share links (older browsers fall back to longer uncompressed links but can't open the
compressed ones), `ResizeObserver`, `:has()` and `||=`. In practice that is Chrome/Edge 105+, Safari 16.4+, Firefox 121+. Tested: Chromium 153 only.

**Without WebGL** (blocked, disabled, or a very old GPU): the studio draws its panels but the 3D view stays empty and the header keeps saying "Loading the house...", with an
unhandled *Error creating WebGL context* in the console and no message to the visitor. The plan editor and floor plan page don't need WebGL (the editor's optional 3D preview does).
The app does not detect this itself; if it matters, a short fallback message in `paint-app.js` is the fix.

**Controls**

| | Mouse and keyboard | Touch |
|---|---|---|
| Paint studio, outside views | Click a wall, ceiling, cabinet, door or trim piece to pick it; Shift- or Ctrl-click adds; double-click faces a wall; drag orbits; wheel zooms; `Ctrl+Z` undoes | Tap picks; one finger orbits; pinch zooms |
| Walk-through | Click the model to capture the mouse; the mouse looks; `W A S D` or arrow keys move; `Shift` runs; click picks a surface under the crosshair; `Esc` frees the mouse; `Z` undoes | An on-screen pad moves; drag to look; tap a surface |
| Plan editor | Tools by key: `V` select, `W` wall, `D` door, `N` window, `O` opening, `R` room, `L` split, `U` stairwell, `F` fixture, `B` label, `M` measure, `G` start; type a length and `Enter`; `Space`-drag or middle-drag pans; wheel zooms; `+` `-` zoom; `H` fits; `T` turns a fixture; `Delete` removes; `Esc` cancels | One finger draws or drags; two fingers pinch and pan |

Both main pages have a touch layout (the walk pad appears on devices that report `hover: none`; the plan editor handles pointer events with two-finger pinch). It was checked with Chromium's
phone emulation at 390 x 844 (the walk pad appeared and the page didn't overflow sideways), not on real hardware. Pointer lock is for mice only.

## After deploying: checklist

1. `https://housepainter.r7orbit.io/` loads over HTTPS; `/paint`, `/editor`, `/floorplan` open; `/nope` shows the "That page isn't here" page with a 404 status.
2. `curl -I https://housepainter.r7orbit.io/paint` shows the `Content-Security-Policy: frame-ancestors ...` line, `cache-control: no-cache`, and **no** `x-frame-options`.
   `curl -I https://housepainter.r7orbit.io/assets/<any file>` shows `max-age=31536000, immutable`. (Cloudflare may add its own `cf-cache-status` and `server`.)
3. Browser dev tools > Network on `/paint`: every request is to `housepainter.r7orbit.io` (and, until the restyle lands, `fonts.googleapis.com`/`fonts.gstatic.com`). Console: no errors.
4. On `https://r7orbit.io`, paste the embed snippet: the studio renders in 3D, a wall can be painted, the walk-through captures the mouse, **Share link** says "Link copied",
   and pasting that link in a new tab opens `housepainter.r7orbit.io` with the scheme. Reload the page: the scheme is still there.
5. In the editor (in the frame): **Upload a blueprint** opens the file picker; try a PNG and a PDF. Optionally press **Read dimensions** on a plan with dimension lines: the
   Network tab shows `vendor/tesseract-5.1.1/...` files and nothing else.
6. Embedding from any other site is refused (the frame is blank and the console says it *Refused to frame*).
7. After a later deploy, a normal reload shows the new version (HTML is `no-cache`, and assets have new hashed names).

If the `eng.traineddata.gz` language file fails to read on Cloudflare (the text reader says *Could not read the dimensions*), check that the response has no `Content-Encoding: gzip`:
tesseract.js un-gzips the file itself, and a host that already decoded it would break that. This was fine on the local server; Cloudflare itself was not tested.

## Testing it yourself

```bash
npm test                          # unit tests, including the build's guarantees
npm run build && npm run preview  # look at dist/ at http://localhost:8788/
npm i --no-save playwright && npx playwright install chromium
node tools/e2e/embed.js           # drives the built site inside the iframe, over HTTPS, as housepainter.r7orbit.io on r7orbit.io
```

`tools/e2e/embed.js` maps the real host names to your machine (a Chromium host-resolver rule and a throwaway self-signed certificate made with `openssl`), serves `dist/` with the same
`_headers` rules as Pages (`tools/preview.js`), embeds it in a page on `r7orbit.io` with the sandbox above, and runs 31 checks: headers, refused embedding, render, painting, storage, pointer lock
and keys, share links standalone and embedded, downloads, the file picker with a picture and with one- and two-page PDFs, the dimension reader, the model runtime (a tiny hand-made ONNX
model), touch emulation, the pages without WebGL, and the expected failures under a smaller sandbox. Set `SANDBOX="..."` to try other attributes. It is not part of `npm test`: it needs Playwright.
