# House Painter

A 3D paint planner for real houses.
- Pick real Sherwin-Williams and Behr colours, or wood finishes, for every wall, ceiling, cabinet door, interior door and trim piece.
- See them in 3D under different light.
- Walk through the house and repaint it like a game.
- Export a scheme that Blender renders with the same colours.

Every house is one JSON file. The example is a remodelled 1998 Fleetwood **Waterford Park 4563C** double-wide (56' × 26'-8", 3 bed / 2 bath). Where this is heading, a plan editor so anyone can trace their own blueprint, is in [ROADMAP.md](ROADMAP.md).

![Dollhouse view of the Cozy deco · Emerald & brass scheme](renders/cozy-deco-emerald-brass/doll.png)

![Kitchen, rendered from an exported view](renders/cozy-deco-emerald-brass/export.png)

## What's here

| File | What it is |
|---|---|
| `houses/<id>/house.json` | **A house.** Walls, doors, windows, rooms, cabinets, heights and flooring, in feet. See [docs/house-format.md](docs/house-format.md). |
| `houses/waterford-4563c/` | The example house, with seven mid-century / Art Deco schemes in `schemes/`. |
| `houses/starter-cottage/` | A small template house to copy for your own. |
| `house-core.js` | The shared pipeline, for browser and Node: wall joinery, room zones, the paintable wall surfaces, room shapes, and the Blender export. |
| `house-loader.js` | Picks the house for a page (`?house=…`, an opened file, or the example) and builds it. |
| `paint.html` + `paint-app.js` + `house3d.js` | The 3D paint studio and walkthrough (Three.js r128). |
| `storage.js` | Where schemes are kept: this browser, or the Claude artifact runtime's shared database. It also makes share links and saves files. |
| `floorplan.html` + `floorplan.js` | The 2D floor plan: after / before / changes views and the paint-surface map. |
| `paint-colors.js` | Colour books: 1,526 Sherwin-Williams and 5,443 Behr colours (code, name, hex). |
| `build_house.py` | Builds the Blender model, applies an exported scheme, and renders views. |
| `export_house_json.js` | Compiles a house file for Blender and checks it for problems. |
| `examples/*.json` | A scheme exported with **Export for Blender**. |
| `data/*.js` | Build helpers: the colour-book compiler, a CIEDE2000 colour matcher, and the example schemes. |
| `textures/` | Plank textures (the example's is cropped from a photo of the actual flooring). |

## Running it

Any static file server works:

```bash
python -m http.server 8770
```

Then open:
- `http://localhost:8770/paint.html`: the paint studio, with the example house
- `http://localhost:8770/paint.html?house=houses/starter-cottage/house.json`: any house file by URL
- `http://localhost:8770/paint.html#walk`: straight into the walkthrough
- `http://localhost:8770/floorplan.html`: the floor plan (it takes `?house=` too)

## Your own house

1. Copy `houses/starter-cottage/house.json` to `houses/<your-id>/house.json`.
2. Trace your walls, openings and rooms, using [docs/house-format.md](docs/house-format.md) for the fields.
3. Check it:

   ```bash
   node export_house_json.js houses/<your-id>/house.json out.json
   ```

   This prints any problems.
4. Open it in either of two ways:
   - `paint.html?house=houses/<your-id>/house.json`;
   - **Open file…** in the studio, which keeps the house in your browser.

Schemes are saved separately for each house. A plan editor that traces a blueprint image for you is the next phase on the [roadmap](ROADMAP.md).

## Using the paint studio

- **Pick a surface:** click a wall, ceiling, cabinet, single cabinet door or drawer, door, or trim in the model, or use the room list. Shift-click adds more.
- **Pick a colour:** search by name, number (`7029`) or hex (`#D1CBC1` finds the nearest paints), and choose a sheen.
- **Wood:** walnut, teak, white oak, red oak, cherry, maple, rosewood or ebonized oak, with tileable grain at real-world scale.
- **Views:** dollhouse, top-down, outside, and face-a-wall (double-click). The field-of-view slider widens the inside views.
- **Lighting:**
  - True colour shows the chip colour exactly on every wall.
  - Daylight, Overcast and Evening (2700K bulbs) show how real light shifts it.
- **Walkthrough:** WASD to move, Shift to run, the mouse to look. Point at a surface and click it to open the paint panel.
- **Share link:** copies a link with the scheme inside it. If the house came from a file, the link carries the house too.
- **Open file…:** opens a house file, or imports a scheme file from **Export for Blender**.
- **Paint needed:** square feet and gallons per colour (2 coats at about 350 sq ft per gallon).
- **Export for Blender:** saves `house-<scheme>.json`, which contains the house, every surface's final colour, wood and sheen, and the camera you're looking through.

Screen colours are the brands' published approximations. Check real chips in your own light before buying.

Schemes save in your browser. When the page is published as a Claude artifact, they save to the artifact's shared database, so everyone with the link sees the same schemes. To use another backend, implement the small interface at the top of `storage.js`.

## Rendering a scheme in Blender

```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b -P build_house.py -- --scheme examples/house-cozy-deco-emerald-brass.json --render
```

| Option | What it does |
|---|---|
| `--scheme FILE` | A file from **Export for Blender**. It contains the house, so nothing else is needed. |
| `--house FILE` | A house to build without a scheme (primer white, cabinets in their default colours). This needs Node.js. The default is the example house. |
| `--views` | `export` (your exported camera), `doll`, `top`, `out`, `rooms` (the house's `renderRooms`), or room ids such as `kitchen,bed1`. The default is export + doll + rooms. |
| `--light` | `day`, `overcast`, `evening` or `true`. The default is the lighting you exported with. |
| `--samples`, `--res` | Cycles samples (default 64) and image size (default `1600x1000`). |
| `--render` | Render the views. Without it, the script only builds and saves the `.blend`. |

The script writes `house_<scheme>.blend` and `renders/<scheme>/<view>.png`. The Blender build uses the same surface keys, cabinet-door numbering and wood grain as the page. Interior light is calibrated so a wall facing the camera renders close to its paint chip.

## Rebuilding

```bash
node data/ascii_js.js                # keep the page scripts ASCII-safe after editing them
```

To rebuild the colour books, download them into `data/src/`, then compile:

```bash
curl -L -o data/src/sw.json https://raw.githubusercontent.com/jpederson/colornerd/master/json/sherwin-williams.json
curl -L -A "Mozilla/5.0" -o data/src/behr_all.js https://www.behr.com/mainService/services/colornx/all.js
node data/build_colors.js
```

To find the nearest real paints to any colour, by CIEDE2000:

```bash
node data/match_colors.js "#C35530" "#2A4F43"
```

## Notes

- The example's geometry is traced from a photo of the 1998 Fleetwood sheet and is accurate to about ±0.3 ft. Field-measure before ordering anything.
- Colour data: Sherwin-Williams values come from [colornerd](https://github.com/jpederson/colornerd), and Behr values from behr.com. Paint names and codes belong to their brands. See the [roadmap](ROADMAP.md) for how a public release will handle them.
