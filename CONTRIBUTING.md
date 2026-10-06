# Contributing

Thanks for helping. This project is small and has no build step while you work on it: it is plain JavaScript pages that read JSON, plus a Blender script. If you can run `python -m http.server` and `npm test`, you can work on it. (`npm run build` makes the deployable `dist/`: see [docs/DEPLOY.md](docs/DEPLOY.md).)

## Running it

```bash
npm test                  # unit tests (Node 22+, no dependencies to install)
python -m http.server 8770   # then open http://localhost:8770/
```

## How it fits together

```
house.json ──► house-core.js ──► HOUSE + ROOMS ──► editor.js         (plan editor)
 (one file)    walls joined,                    ├─► house3d.js       (3D model, paint studio, walkthrough)
               rooms, surfaces                  ├─► floorplan.js     (2D plan)
                                                └─► build_house.py   (Blender, via the "built house" the studio exports)
```

- **`house-core.js`** turns a house file into walls, rooms and paint surfaces. It runs in the browser and in Node, and it is the one place that decides surface IDs like `BR1-N`.
- **`tracer.js`** finds walls in a picture of a floor plan. It is pure image processing on a grey-scale array, so it is tested in Node against blueprints drawn from the example houses (`tests/helpers/blueprint.js`). If you change it, check the numbers in `tests/tracer.test.js` still hold.
- **`fixtures.js`** is the fixture catalogue and the geometry (any facing) shared by everything.
- **`house3d.js`** and **`build_house.py`** build the same model twice, once in Three.js and once in Blender. They have to agree.
- **`storage.js`** is where schemes are kept. Add a backend there if you want your own.
- **`docs/house-format.md`** is the contract for the house file.
- **`ui/`** holds all the interface CSS. It uses the R7 Orbit tokens only (no raw colours, sizes or shadows); `docs/DESIGN.md` has the rules and `tests/ui-tokens.test.js` checks them.

## Rules that keep it working

1. **Surface IDs are part of the format.** Saved schemes refer to them. If a change alters them, the snapshot test fails. Run `UPDATE_SNAPSHOTS=1 npm test` (PowerShell: `$env:UPDATE_SNAPSHOTS=1; npm test`) only when you mean to, and say so in the pull request.
2. **Browser and Blender stay in step.** If you change how a fixture, wall or opening is built in `house3d.js`, make the same change in `build_house.py`, and check both. `blender -b --factory-startup -P tools/test_addon.py` runs the add-on end to end.
3. **Palette codes are append-only.** Add colours to `data/build_palette.js` and run `node data/build_palette.js`. Never renumber or reuse a code.
4. **No paint maker's data in the repository.** No names, codes or colour values copied from a brand's book. Extra books are built locally (`data/README.md`) and are git-ignored.
5. **Page scripts are plain ASCII.** Run `node data/ascii_js.js` after editing them; a test checks.
6. **Keep the old files working.** A house file written last month should still open. Add fields; don't change what existing ones mean. Bump `version` only for a real break, with a migration.

## Sending a change

1. Open an issue first for anything big, so we agree on the shape.
2. Make the change with tests. The core, fixtures and data have unit tests in `tests/`. Anything that draws should be tried in a browser, so say in the pull request what you tried.
3. Run `npm test`.
4. Fill in the pull request checklist.

## Reporting a bug

Include your `house.json` if it's about a house, the browser, and the console errors (F12). A screenshot helps.

## Conduct

Be kind and assume good faith. See the [code of conduct](CODE_OF_CONDUCT.md).
