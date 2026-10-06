# House Painter

A 3D paint planner for a remodelled 1998 Fleetwood **Waterford Park 4563C** double-wide (56' × 26'-8", 3 bed / 2 bath). The page lets you pick real Sherwin-Williams and Behr colours, or wood finishes, for every wall, ceiling, cabinet door, interior door and trim piece, see them in 3D under different light, walk through the house to repaint it like a game, and export a scheme that Blender renders with the same colours.

![Dollhouse view of the Cozy deco · Emerald & brass scheme](renders/cozy-deco-emerald-brass/doll.png)

![Kitchen, rendered from an exported view](renders/cozy-deco-emerald-brass/export.png)

## What's here

| File | What it is |
|---|---|
| `house-data.js` | **The single source of truth.** Walls, doors, windows, fixtures, cabinets and flooring, in feet. Everything else reads it. |
| `rooms.js` | Room zones and the 90 paintable wall surfaces (one per wall face per room), with areas. |
| `floorplan.html` | 2D floor plan: after / before / changes views, Desert Sand LVP flooring, and the paint-surface map. |
| `paint.html` + `paint-app.js` + `house3d.js` | The 3D paint studio and walkthrough (Three.js r128). |
| `paint-colors.js` | Colour books: 1,526 Sherwin-Williams and 5,443 Behr colours (code, name, hex). |
| `build_house.py` | Builds the Blender model from the same data, applies an exported scheme, and renders views. |
| `examples/*.json` | A scheme exported from the page with **Export for Blender**. |
| `data/schemes/*.json` | Seven mid-century / Art Deco schemes covering the whole house. |
| `data/*.js` | Build helpers: colour-book compiler, CIEDE2000 colour matcher, scheme builders. |
| `textures/desert_sand_plank.png` | Plank texture cropped from a photo of the actual flooring. |

## Running it

Any static file server works:

```bash
python -m http.server 8770
```

Then open:
- `http://localhost:8770/paint.html` for the paint studio
- `http://localhost:8770/paint.html#walk` to go straight into the walkthrough
- `http://localhost:8770/floorplan.html` for the floor plan

Locally, schemes save in your browser. Published as a Claude artifact, they save to the artifact's shared database so everyone with the link sees the same schemes.

## Using the paint studio

- **Pick a surface:** click a wall, ceiling, cabinet, single cabinet door or drawer, door or trim in the model, or use the room list. Shift-click adds more.
- **Pick a colour:** search by name, number (`7029`) or hex (`#D1CBC1` finds the nearest paints). Choose a sheen.
- **Wood:** the Wood tab has walnut, teak, white oak, red oak, cherry, maple, rosewood and ebonized oak, with tileable grain at real-world scale. It works on cabinets, single doors, interior doors, trim and walls (paneling).
- **Views:** dollhouse, top-down, outside, and face-a-wall (double-click). The field-of-view slider widens the inside views.
- **Lighting:** True colour shows the chip colour exactly on every wall. Daylight, Overcast and Evening (2700K bulbs) show how real light shifts it.
- **Walkthrough:** WASD to move, Shift to run, mouse to look. Point at a surface and click to open the paint panel. The camera stays still while it's open.
- **Paint needed:** square feet and gallons per colour (2 coats at about 350 sq ft per gallon). Wood finishes are listed separately.
- **Export for Blender:** saves `house-<scheme>.json` with every surface's final colour, wood and sheen, plus the exact camera you're looking through.

Screen colours are the brands' published approximations. Check real chips in your own light before buying.

## Rendering a scheme in Blender

```bash
node export_house_json.js            # house.json: plan + paint surfaces + room shapes
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b -P build_house.py -- --scheme examples/house-cozy-deco-emerald-brass.json --render
```

| Option | What it does |
|---|---|
| `--scheme FILE` | A file from **Export for Blender**. Without it the house is primer white with the current blue/white cabinets. |
| `--views` | `export` (your exported camera), `doll`, `top`, `out`, `rooms` (every main room), or room ids like `kitchen,master,bed1`. Default: export + doll + rooms. |
| `--light` | `day`, `overcast`, `evening` or `true`. Default: the lighting you exported with. |
| `--samples`, `--res` | Cycles samples (default 64) and size (default `1600x1000`). |
| `--render` | Render the views. Without it, the script only builds and saves the `.blend`. |

Outputs `house_<scheme>.blend` and `renders/<scheme>/<view>.png`. The Blender build uses the same surface keys, cabinet-door numbering and wood grain as the page. Interior light is calibrated so a wall facing the camera renders close to its paint chip.

## Rebuilding

After editing `house-data.js`:

```bash
node export_house_json.js            # house.json for Blender
node data/ascii_js.js                # keep scripts ASCII-safe
```

To rebuild the colour books, download them into `data/src/` and compile:

```bash
curl -L -o data/src/sw.json https://raw.githubusercontent.com/jpederson/colornerd/master/json/sherwin-williams.json
curl -L -A "Mozilla/5.0" -o data/src/behr_all.js https://www.behr.com/mainService/services/colornx/all.js
node data/build_colors.js
```

Nearest real paints to any colour, by CIEDE2000:

```bash
node data/match_colors.js "#C35530" "#2A4F43"
```

## Notes

- Geometry is traced from a photo of the 1998 Fleetwood sheet, accurate to about ±0.3 ft. Field-measure before ordering anything.
- Heights are defaults: 8' flat ceiling, 6'8" doors, 3' window sills.
- Colour data: Sherwin-Williams values via [colornerd](https://github.com/jpederson/colornerd); Behr values from behr.com. Paint names and codes belong to their brands.
