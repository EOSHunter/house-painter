# House Painter decisions

- **2026-10-06 — Keep one JSON house contract across browser and Blender.** `docs/house-format.md` defines the file; `house-core.js` computes shared geometry/surfaces, and `build_house.py` and the browser use it.
- **2026-10-06 — Keep tracing and paint work in the browser.** Blueprint files stay in the browser; scheme storage is local or carried by share links. Optional OCR/model features are user-triggered, run locally, and their ONNX model is user-supplied (`README.md`, `docs/learned-model.md`).
- **2026-10-06 — Bundle and verify site dependencies locally.** `vendor/` holds pinned libraries and licences; `tools/build.js` checks local references and emits content-hashed static files. The design assets in `ui/` follow R7 Orbit tokens (`docs/DESIGN.md`, `docs/DEPLOY.md`).
- **2026-10-06 — Blender is an optional render/export path.** The browser studio works without Blender; exported scheme JSON includes the house, surface finishes and camera, and the add-on/CLI builds matching scenes (`README.md`, `build_house.py`, `blender_addon/`).
- **Deployment destination needs verification.** `docs/DEPLOY.md` specifies Cloudflare Pages and `housepainter.r7orbit.io`; `.github/workflows/pages.yml` publishes GitHub Pages. The repository contents do not establish which host is configured or live.
