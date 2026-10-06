# Vendored libraries

Third-party code the pages load, copied here byte for byte so the site makes no third-party request (no CDN) and keeps working if a CDN
changes or goes away. Each library is in a folder named with its version, so a deployed copy never changes in place and can be cached forever.

| Folder | Library | Source (npm package, file) | Licence | Loaded |
|---|---|---|---|---|
| `three-r128/` | [three.js](https://threejs.org/) r128: `three.min.js`, and the examples `OrbitControls.js`, `RoomEnvironment.js` | `three@0.128.0`: `build/three.min.js`, `examples/js/{controls,environments}/` | MIT (`LICENSE`) | `<script>` in `paint.html` and `editor.html` |
| `pdfjs-3.11.174/` | [PDF.js](https://mozilla.github.io/pdf.js/) `pdf.min.js` and `pdf.worker.min.js` | `pdfjs-dist@3.11.174`: `build/` | Apache-2.0 (`LICENSE`) | On demand, when a PDF blueprint is opened |
| `tesseract-5.1.1/` | [tesseract.js](https://github.com/naptha/tesseract.js) `tesseract.min.js`, `worker.min.js`; the WebAssembly cores `core/tesseract-core-lstm.wasm.js` and `core/tesseract-core-simd-lstm.wasm.js` (tesseract.js-core 5.1.1); English data `lang/eng.traineddata.gz` | `tesseract.js@5.1.1`: `dist/`; `tesseract.js-core@5.1.1`; `@tesseract.js-data/eng@1.0.0`: `4.0.0_best_int/` | Apache-2.0 (`LICENSE-tesseract.js`, `LICENSE-tesseract.js-core`); the language data is Apache-2.0 from [tesseract-ocr/tessdata_best](https://github.com/tesseract-ocr/tessdata_best) | On demand, when **Read dimensions** is pressed and the visitor agrees (about 8 MB: the worker, one core, the language data) |
| `onnxruntime-web-1.20.1/` | [onnxruntime-web](https://github.com/microsoft/onnxruntime) `ort.wasm.min.js` (the WebAssembly-only build), `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm` | `onnxruntime-web@1.20.1`: `dist/` | MIT (`LICENSE`) | On demand, only after the visitor chooses a wall-finding model file (see [docs/learned-model.md](../docs/learned-model.md)); the model itself is never shipped |

Not copied, because the pages never ask for them: PDF.js `cmaps/` and `standard_fonts/` (the CDN copy didn't serve them either, so a PDF that needs
a non-embedded font or a CJK character map looks the same as before), the source maps, the other three.js builds, the other tesseract cores
(non-LSTM, which `createWorker('eng')` doesn't use), and the other onnxruntime builds (WebGPU and WebGL: the editor only asks for `wasm`).
Each file is under Cloudflare Pages' 25 MiB limit; the largest is `ort-wasm-simd-threaded.wasm` at 10.7 MB.

`SHA256SUMS` lists every vendored file. `npm run build` fails if one differs, or if a file is added without a line here, so an edit or a
line-ending conversion can't slip in (`.gitattributes` turns conversion off for this folder).

## Updating one

1. `npm pack <package>@<version>` and unpack it somewhere else.
2. Copy the files in the table's "Source" column into a **new** folder named for the new version (`pdfjs-3.12.0/`), with its licence.
3. Change the version in the path where it is used: `<script src>` in `paint.html` / `editor.html`, and the `VENDOR(...)` calls in `editor.js`
   (PDF.js, tesseract.js, onnxruntime-web). Delete the old folder.
4. `sha256sum` the new files into `SHA256SUMS`, update this table and [NOTICE.md](../NOTICE.md), run `npm test` and `npm run build`.
5. Try it in a browser: open a PDF, press **Read dimensions**, choose a model file (`node tools/e2e/embed.js` does all three).

three.js r128 is old on purpose: the pages use the r128 build with its `examples/js` scripts (no ES modules). Moving to a newer three.js is a
code change, not a file swap.
