# R7 repository context: House Painter

House Painter turns a house blueprint into a paintable 3D model, walkthrough and Blender render. It runs locally in the browser; house geometry is stored in JSON and shared by the editor, paint studio, floor plan and Blender tools (`docs/house-format.md`, `house-core.js`). Current `main` head: `8abbf861be0424446298593ecca2c9ffa0e19df0` (2026-10-06). This note describes checked-in code and configuration, not a verified production deployment.

- `editor.html`, `editor.js`: blueprint/PDF tracing, dimensions and fixtures, writes a `house.json`.
- `paint.html`, `paint-app.js`, `house3d.js`: 3D surface painting, lighting, walkthrough and scheme export.
- `floorplan.html`, `floorplan.js`: 2D plan and before/after views.
- `house-core.js`, `fixtures.js`, `dimensions.js`: shared house geometry, room/surface data, fixtures and measurements.
- `build_house.py`, `blender_addon/`, `tools/build_addon.py`: Blender scene generation, importer add-on and packaging.
- `houses/`, `examples/`, `renders/`: sample plans/schemes and rendered images.
- `paint-colors.js`, `data/`: original palette and optional palette-data tools.
- `ui/`: locally hosted R7 Orbit design tokens, fonts and mark; `vendor/`: pinned browser libraries and licences.
- `tests/`, `tools/build.js`: Node test suite and static deployment build. `package.json` lists `npm test`, `npm run build`, `npm run preview` and add-on packaging.

See [decisions](decisions.md) and [October 2026 changes](changes/2026-10.md). `ROADMAP.md`, `docs/getting-started.md`, `docs/DEPLOY.md` and `docs/learned-model.md` describe plan/editor status, usage, deployment and optional local wall detection. The GitHub Actions workflow deploys GitHub Pages, while `docs/DEPLOY.md` also describes a Cloudflare Pages target; confirm the actual host before assuming either deployment is live.
