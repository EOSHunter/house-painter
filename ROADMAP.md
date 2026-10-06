# Roadmap

The goal: anyone can upload a blueprint of their own house, set the wall and door heights, and get what this repo does for the example house:
- a 3D model with every wall mapped for painting;
- a paint studio and walkthrough;
- matching Blender renders.

## How it fits together

```
blueprint image ──► Plan editor ──► house.json ──► Paint studio (browser) ──► scheme export ──► Blender (optional)
                     (phase 2)        │                                          │
                                      └──► Floor plan                            └── carries the house, so one file renders
```

- **A house file is the contract.** [`docs/house-format.md`](docs/house-format.md) defines it. [`house-core.js`](house-core.js) turns it into joined walls, paint surfaces, room shapes and heights, and the same code runs in the browser and in Node.
- **Painting needs no Blender.** The studio builds its own 3D model in the browser. Blender is only for realistic renders, and the paint studio's export already contains everything Blender needs.

## Phase 1: one data contract ✅

- [x] The house moved out of the code into `houses/waterford-4563c/house.json`.
- [x] `house-core.js` holds the shared pipeline: wall joinery, room zones, paint surfaces and room shapes. Its output matches the old code's 90 surface IDs exactly.
- [x] The studio and floor plan load any house: `?house=<url>`, a file opened with **Open file…**, or the example house.
- [x] Heights per house (ceiling, door, window head and sill), and per opening (`height`, `sill`, `head`).
- [x] Cabinets, colour defaults, the room order, the walkthrough start, render rooms and floor shape all come from the data.
- [x] Pluggable scheme storage (`storage.js`):
  - this browser (localStorage);
  - the Claude artifact runtime (shared);
  - room for self-hosted backends.
- [x] Share links with the scheme compressed into the URL. When a house came from a file, the link carries the house too.
- [x] Schemes are kept separately for each house. Scheme files can be imported back.
- [x] The Blender export is self-contained, and `build_house.py --house` builds any house file.
- [x] A second house, `houses/starter-cottage`, serves as a template and as proof that nothing is tied to the example.

## Phase 2: plan editor ✅

`editor.html` turns a blueprint into a `house.json`.

- [x] Upload an image or a PDF page of the blueprint, shown under a drawing grid. The image stays in the browser (IndexedDB). Its scale and position are saved in the house file, so re-uploading the same image lines it up again.
- [x] Opacity and rotation sliders for skewed photos. A Move tool lines the image up.
- [x] Set the scale by clicking two points and typing a known length (`56'`, `26'8"`, `12.5`).
- [x] Draw walls by clicking corner to corner:
  - walls lock to horizontal or vertical;
  - ends snap to other walls' ends and centre lines, otherwise to a 1" grid (Alt turns snapping off);
  - type a length and press Enter for an exact wall;
  - closing the outside loop switches to inside walls.
- [x] Doors, windows and cased openings click onto walls. Drag the ends to size them, and drag the middle to slide them. Outside doors swing inward by default.
- [x] Inspector with exact feet-and-inches inputs for every wall, opening, room and house setting. Heights are set per house, with overrides on single doors and windows.
- [x] Rooms:
  - click inside a closed space to fill it on a 3" grid (doorways count as closed);
  - name it, and the wall-ID prefix follows;
  - split lines divide open-plan areas exactly.
- [x] Live 3D preview, built by the same `house3d.js` the paint studio uses.
- [x] Save `house.json`, or **Paint it**, which opens the house in the paint studio. The studio has an **Edit house** button that comes back.
- [x] Undo/redo, autosave, and opening existing house files. Loading a house file and saving it rebuilds the example house with identical surfaces.
- [x] A guided steps panel, a list of problems to fix before painting, and floor-plan labels for houses without hand-placed ones.

Still to do:
- [ ] Moving a wall doesn't drag the walls joined to it. Each wall moves on its own, and joinery tidies the ends.
- [ ] Touch: panning and zooming work, but drawing needs a mouse or pen for now.
- [ ] Editing the floor plan's labels, dimensions and notes (`plan`), and the walkthrough start point.

## Phase 3: fixtures

- [ ] A fixture library in the editor: base cabinet runs, uppers, tall units, islands, vanities, toilets, tubs, showers, a range, a fridge, a washer and dryer.
- [ ] A facing direction for every fixture. Today the range, fridge and washer controls face east, and the shower glass faces north.
- [ ] Cabinet runs that split into doors and drawers by width, with optional overrides.
- [ ] A floor material picker: bundled plank photos, a colour, or the user's own photo.

## Phase 4: release

- [ ] License: MIT for the code.
- [ ] Paint brands:
  - ship a generic palette by default;
  - make the Sherwin-Williams and Behr books an import that users build themselves with the scripts in `data/`.
  
  The brands own those names and codes, and the source data isn't licensed for redistribution.
- [ ] A Blender add-on (Blender 4.2+ extension) with an **Import House Painter scheme** menu item, for people who don't use the command line.
- [ ] GitHub Pages deployment of the studio, floor plan and editor.
- [ ] A CONTRIBUTING guide, a code of conduct, issue templates, and a small test suite in which the core's surface IDs and areas for both example houses are locked by snapshot.
- [ ] Docs: a getting-started guide with screenshots, plus "trace your house in 15 minutes".

## Phase 5: later

- [ ] Assisted tracing: suggest walls from a scanned blueprint, using classic line detection, a model trained on CubiCasa5K, or a vision model. The user confirms or fixes every suggestion in the editor.
- [ ] Imports: Apple RoomPlan (iPhone LiDAR) USDZ/JSON, DXF, and SVG.
- [ ] Vaulted and sloped ceilings, and a ceiling height per room.
- [ ] Walls that aren't straight lines: angled and curved walls.
- [ ] Multiple storeys and stairs.
- [ ] Exterior detail: roof, porch and siding profiles.

## Known limits today

- Walls must be horizontal or vertical. Ceilings are flat, at one height for the whole house, and there is one storey.
- Fixtures face fixed directions (see Phase 3).
- Saved colours are tied to surface IDs (such as `BR1-N`). If walls change in a way that renames surfaces, the colours on the renamed walls are lost.
