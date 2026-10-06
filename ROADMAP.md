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

## Phase 3: fixtures ✅

- [x] A fixture library in the editor (`F`): base, sink-base, drawer and tall cabinets, uppers, an island, a fridge, a range with microwave, a vanity with basin, a linen cabinet, a toilet, a tub, a shower, a washer, a dryer, a water heater and a wire shelf.
- [x] Placing is wall-aware: a fixture backs onto the wall nearest the cursor and faces into the room. It snaps to wall corners and to the edges of other fixtures. Free-standing ones turn with `T`. Overlaps are refused, except wall cabinets and shelves, which sit above floor-level fixtures.
- [x] Every fixture can face any way. The fridge, range, washer, dryer, shower, sink and barn door used to face a fixed direction. They are now built in their own frame (`fixtures.js`), in the browser and in Blender. Files that don't say which way they face look exactly as before: all 959 meshes of the example house are identical.
- [x] Select, drag, turn, resize, duplicate and delete fixtures. The inspector also sets the cabinet height, counter, fronts (drawer over each door, doors only, or a stack of drawers), how many fronts, a sink or basin set into the counter, and the paint group. A fixture list on the left finds any of them.
- [x] Paint groups: a new cabinet joins the house's existing group of that kind in the same room, or starts a new one. **New paint group…** makes your own. Every door and drawer can still be painted on its own.
- [x] Floors: plain colour, the bundled Desert Sand photo, eight wood species (drawn like the cabinet veneers, in the browser and in Blender), or your own photo. A photo is turned upright, shrunk and stored inside the house file.
- [x] The walkthrough's collision boxes follow each fixture's real footprint.

Still to do:
- [ ] Resizing by dragging handles (today it is in the inspector).
- [ ] Sinks, a range and a fridge that are separate fixtures, so a kitchen can be built from a plain run plus an appliance of any size.
- [ ] More fixtures: dishwasher, corner cabinets, a pantry with shelves, a double vanity, a freestanding tub.

## Phase 4: release ✅ (what's left needs the repository owner)

- [x] **Licence:** MIT, with third-party notices in [NOTICE.md](NOTICE.md).
- [x] **Paint brands:** the project ships its own palette, 124 original colours (`paint-colors.js`, built by `data/build_palette.js`). Sherwin-Williams and Behr are no longer part of it. A paint maker's book is an optional extra that you build from data you download yourself (`paint-colors-extra.js`, git-ignored): see [data/README.md](data/README.md). The studio shows the palette, plus an extra tab for each book it finds. The seven example schemes and the example export were remapped to the nearest palette colours (the biggest shift is 6 dE).
- [x] **Blender add-on** (`blender_addon/`, Blender 4.2+ extension): **File > Import > House Painter scheme (.json)**. Tested end to end, from the source tree and from the packaged zip (`python tools/build_addon.py`, then `blender -b --factory-startup -P tools/test_addon.py`), and the manifest validates with Blender's own checker.
- [x] **GitHub Pages:** `index.html` is the start page, `tools/build_site.js` assembles the site, and `.github/workflows/pages.yml` deploys it.
- [x] **Tests and CI:** 63 unit tests (`npm test`) run on every push. The surface IDs and areas of both example houses are locked by snapshot, and the tests also check the palette, the shipped schemes and every file a page loads.
- [x] **Community files:** CONTRIBUTING, a code of conduct, issue and pull request templates.
- [x] **Docs:** a [getting-started guide](docs/getting-started.md) with pictures, including "trace your house in 15 minutes".

Still to do by hand:
- [ ] Turn on GitHub Pages (Settings > Pages > Source: GitHub Actions).
- [ ] Tag a release (`git tag v0.1.0 && git push --tags`): `.github/workflows/addon.yml` attaches the add-on zip. Neither workflow could be run from here, so the first run is the real test.
- [ ] The earlier commits still contain the Sherwin-Williams and Behr colour books. Removing them from the history needs a history rewrite and a force push, which is the owner's call.
- [ ] Confirm you are happy to publish `textures/desert_sand_plank.png`, a crop of a flooring reference photo, and the traced Fleetwood plan.

## Phase 5: later

### Assisted tracing ✅ (first version)

The editor can suggest the walls in a blueprint (`tracer.js`). It uses classic image processing, so it needs no AI account, no upload and no model download, and it runs in the browser.

- [x] **Straighten:** measures the tilt of a photo (projection profile search, accurate to about 0.1° on the test set) and levels it.
- [x] **Suggest walls:** finds long, straight, thick bars (solid walls, double-line walls, or thin lines), ignores text, dimension lines, door swings and fixture outlines, lines up centre lines, measures thickness to a fraction of a pixel, joins corners, and bridges door and window gaps.
- [x] **Outside or inside:** works out which walls are on the outside (so siding is right) and sets the house's typical wall thicknesses.
- [x] **Doors and windows from gaps** (a guess: change the type of each one if needed), including a doorway at the very end of a wall.
- [x] **Review, don't trust:** every suggestion is shown over the blueprint, and you click out the wrong ones before adding. Nothing already drawn is touched.
- [x] **Find all rooms:** turns every closed space into a room in one press.
- [x] Tested in Node on blueprints drawn from both example houses, with noise, shading, blur, text, dimension lines, fixture outlines and tilt (`tests/tracer.test.js`). On those: roughly 90% or more of the wall area is found (85% in the blurriest photos), and about 90% of what is drawn is real wall. The same flow worked in the browser on a tilted, shaded, JPEG-compressed picture with lettering.
- [ ] Not tested on real scans of many different plans. Hand-drawn plans, curved lines and low-contrast photos are the likely weak spots; please send examples.
- [x] **Walls at an angle:** after the level and plumb walls are found, what ink is left is searched for directions that edges line up in; each direction is turned level and searched the same way. Pieces on one line across a door gap are joined, ends go on to the centre line of the wall they meet, and anything that joins nothing, lies along a straight wall, or meets one at a very shallow angle (under 20°, unless it is long) is dropped as leftover ink. A cut corner and a diagonal partition are found in the tests (`tests/tracer.test.js`). A bay whose sides are mostly window is not: a window leaves almost no wall to see.
- [ ] Scale from the dimension text on the plan (needs lettering recognition).
- [x] **Doors from windows by their symbols:** a gap with a quarter-circle swing is a door, with its hinge end and the side it swings to; a gap with a line along it is a window. Without either, the old guess from the wall type and the width applies. On the Waterford test plan about 80% or more of the doors come back with the right hinge and swing.
- [ ] A learned model (for example one trained on the CubiCasa5K data set) as an optional extra for plans the classic method can't read. It would be an opt-in download that runs on your own computer, never a paid service.

### Angled walls ✅ (first version)

Walls at any angle: a cut corner, a bay window, a diagonal partition. The example house `houses/bay-cottage/` has a cut entry corner and a three-sided bay.

- [x] **House file:** a wall can be a centre `line` with a thickness; rooms can have `polys` outlines ([format](docs/house-format.md#angled-walls)).
- [x] **Core:** corners are mitred and closed, rooms and the outside are found along the angle, and every face becomes a paint surface named by compass (`LIV-SE`, `EXT-NE`). Straight houses are unchanged: their surface IDs are locked by the snapshots.
- [x] **Paint Studio, floor plan and walkthrough:** angled walls with their trim, windows and doors, painted and clicked like any other; the walkthrough does not walk through them.
- [x] **Blender:** the add-on and `build_house.py` build them with the same materials.
- [x] **Plan editor:** an **Angled** switch (or `Shift`) draws walls that snap to 15°, to wall ends and to crossings; ends and whole walls can be dragged, their length and angle typed; doors and windows can be put in them; **Room** and **Find all rooms** outline spaces against them.
- [ ] Fixtures (cabinets, appliances) stay square to the plan and cannot back onto an angled wall.
- [ ] A free-standing angled wall inside one room (a peninsula) needs a room outline made to follow it.
- [x] **Curved walls** (arcs): built as short straight walls closed up at the joints; one paint surface per face of a curve; windows and doors in them; drawn in the plan editor (click both ends, then bend). The example is `houses/round-cottage/`. Ellipses and splines are not supported.
- [ ] A curve that bends into another curve with no corner (an S-shape) is two curves today.

### Ceilings ✅ (first version)

- [x] **A ceiling height per room, and sloped ceilings:** flat, shed (one slope) or vault (a ridge down the middle). The example is `houses/vaulted-cabin/`.
- [x] Walls rise to meet them (including gable-shaped walls), a wall between two rooms follows the higher side, and wall areas follow the height. The studio, the walkthrough and Blender draw them, and the plan editor sets them per room.
- [ ] Ceilings that are not one plane or two across a room: hips, domes, trays, beams.
- [ ] A ceiling that slopes through two rooms (a ridge that carries on through an open-plan space) is two separate ceilings today.

### More than one floor ✅ (first version)

- [x] **Floors above the ground floor** (`levels` in the house file): each has its own walls, rooms and fixtures, stacked on a slab with a stairwell (`voids`) cut in it. The example is `houses/two-storey/`.
- [x] **Straight stairs** (a fixture): solid steps climbing to the next floor.
- [x] **Studio:** every floor's rooms are listed, with a Floors switch to show up to a chosen floor; the walkthrough walks up and down the stairs (and can't step through a stairwell); Blender builds every floor at its own height; the floor plan page shows one floor at a time.
- [x] **Plan editor:** a Floors list (add, rename, delete, switch), the floor below shown faintly, a Stairwell tool.
- [ ] Turning stairs (an L or a U with a landing), spiral stairs, and railings round a stairwell.
- [ ] A basement, split levels, and an upper floor that overhangs the one below it.
- [ ] Heights for a whole upper floor in the plan editor (the house's heights are used).

### Other ideas

- [ ] Imports: Apple RoomPlan (iPhone LiDAR) USDZ/JSON, DXF, and SVG.
- [ ] Exterior detail: roof, porch and siding profiles.

## Known limits today

- Walls are straight. They can run at any angle, but the tracer only finds horizontal and vertical ones, and fixtures stay square to the plan. Ceilings are flat, at one height for the whole house, and there is one storey.
- Saved colours are tied to surface IDs (such as `BR1-N`). If walls change in a way that renames surfaces, the colours on the renamed walls are lost.
