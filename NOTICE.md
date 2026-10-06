# Notices

House Painter is released under the [MIT licence](LICENSE). It uses and links to the following, under their own licences.

## Loaded by the web pages

These are fetched from a CDN when a page opens, not copied into this repository.

| What | Used for | Licence |
|---|---|---|
| [three.js](https://threejs.org/) r128 (and its `OrbitControls` and `RoomEnvironment` examples) | The 3D views | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) 3.11 | Reading a PDF blueprint in the plan editor, only when you upload one | Apache-2.0 |
| [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque), [IBM Plex Sans and Mono](https://fonts.google.com/specimen/IBM+Plex+Sans) via Google Fonts | The page typography | SIL Open Font License 1.1 |

The pages work without the fonts (they fall back to system fonts).

## Blender

The Blender add-on and `build_house.py` use Blender's Python API. Blender itself is licensed under the GPL and is not included. The add-on is MIT licensed, which is GPL-compatible, as Blender's extensions platform requires.

## Colours

The built-in palette (`paint-colors.js`) is original: its names and values were written for this project. It is not any paint maker's colour book.

The tools in `data/` can build extra colour books, such as a paint maker's own, from data you download yourself. Those books are for your own use. They are never committed to this repository (they are git-ignored), and the paint makers own their names, codes and values. Screen colours are approximations in any case: check a real chip in your own light before buying paint.

## Images

- `textures/desert_sand_plank.png` is cropped from a reference photo of the flooring chosen for the example house. If you reuse this project for your own house, pick one of the built-in woods or your own photo instead.
- Pictures in `renders/` and `docs/img/` were made with this project.
- The example house, Fleetwood's "Waterford Park 4563C", is traced from a photo of a floor plan, and names the original manufacturer's model for identification only. The plan is an approximation (about ±0.3 ft); this project is not affiliated with or endorsed by Fleetwood Homes.
