# House file format

A house is one JSON file, usually `houses/<id>/house.json`. Everything else is computed from it by `house-core.js`: the paint studio, the floor plan and the Blender build all read the same file:
- wall joinery
- paintable wall surfaces and their IDs
- room shapes and areas
- where the walkthrough starts

Copy [`houses/starter-cottage/house.json`](../houses/starter-cottage/house.json) to start a new one. [`houses/waterford-4563c/house.json`](../houses/waterford-4563c/house.json) is a full real-world example.

## Coordinates

- **Units:** feet.
- **Origin:** one outside corner of the plan, usually the back-left.
- **Axes:** `x` grows to the right (east), `y` grows down the page (south), and heights are measured up from the floor.
- **Walls:** filled rectangles. Openings in a wall are measured along its long axis, using the same absolute coordinates.

## Top level

| Field | Required | What it is |
|---|---|---|
| `format` | yes | Always `"house-painter/house"`. |
| `version` | yes | `1`. |
| `id` | yes | Short slug, such as `"my-house"`. Saved schemes are kept per house id. |
| `name`, `subtitle` | | Shown in the page headers. |
| `W`, `D` | yes | Overall width (x) and depth (y), outside to outside. |
| `wallThickness` | | `{ "exterior": 0.5, "interior": 0.33 }`. Used for the default floor and a few fixtures. |
| `heights` | | `{ "ceiling": 8, "door": 6.667, "windowHead": 6.667, "windowSill": 3 }`. The values shown are the defaults. Any door or window can override them. |
| `floor` | | `{ "name", "spec", "color", "plankW", "plankL", "dir", "texture" }`. `texture` is an optional photo of a single plank, as a path from the project root. Without it the floor uses `color`. |
| `floorRects` | | Floor area as `[x0, y0, x1, y1]` rectangles. Defaults to the inside of the exterior walls. |
| `walls` | yes | See [Walls](#walls). |
| `rooms` | yes | See [Rooms](#rooms). |
| `roomOrder` | | The order of rooms in the paint studio's list. Rooms you leave out follow in file order. |
| `items` | | See [Items](#items). |
| `fixtures` | | See [Fixtures](#fixtures). |
| `start` | | `{ "x", "y", "yaw" }`: where the walkthrough starts. Defaults to just inside the first exterior door. For `yaw`, 0 faces north (−y), π faces south, −π/2 faces east and π/2 faces west. |
| `renderRooms` | | Room ids Blender renders for `--views rooms`. Defaults to every room of 40 sq ft or more. |
| `plan` | | Floor-plan extras: `tints`, `labels`, `dims`, `texts`, `callouts`, `notes`. Only `floorplan.html` uses these. |

## Walls

```json
{ "x0": 0, "y0": 0, "x1": 56, "y1": 0.5, "ext": 1, "id": "north", "status": "keep",
  "openings": [ { "a": 3.9, "b": 7.7, "type": "window", "panes": 2, "sill": 3.6 } ] }
```

- A wall is horizontal when it is wider than it is deep, and vertical otherwise.
- Trace walls centre-line to centre-line. Ends that stop within 0.2 ft of another wall are joined to it automatically:
  - at a T junction, the stem stops at the face of the wall it meets;
  - at an L corner, the horizontal wall covers the corner.
- `ext: 1` marks an exterior wall. Its outer face becomes siding, and its doors stay shut in the walkthrough.
- `status` is `"keep"` (the default), `"removed"` or `"new"`. Removed walls appear only in the floor plan's Before and Changes views.

**Openings:**

| `type` | Fields |
|---|---|
| `door` | `a`, `b`, `hinge` (`"a"` or `"b"`: which end the hinge is on), `swing` (`n`/`s` on horizontal walls, `e`/`w` on vertical ones), `height` (optional) |
| `window` | `a`, `b`, `panes` (default 1), `sill` and `head` (both optional, in ft above the floor) |
| `cased` | `a`, `b`, `height` (optional). A doorway with trim and no door. |
| `panel` | `a`, `b`. An access panel, drawn on the plan only. |

## Rooms

```json
{ "id": "kitchen", "name": "Kitchen", "short": "KIT", "rects": [[18.8, 0, 29.7, 13.2]] }
```

Rooms are paint zones, and each is made of one or more rectangles. A point belongs to the **first** room whose rectangles contain it, so put small rooms, such as a closet inside a bigger rectangle, before big ones. Points inside walls belong to no room.

- Open-plan spaces are split into rooms by the rectangles alone, with no wall needed. The kitchen and dining room in the example are split this way.
- Rectangles can overlap walls: a rectangle may run to a wall's centre line or past it.
- `short` is the prefix for surface IDs. The north wall of `KIT` is `KIT-N`. When a room has several walls facing the same way, they are numbered: `KIT-E1`, `KIT-E2`.

The reserved ids are `exterior` and `house`.

> Saved schemes refer to surfaces by ID, such as `BR1-N`. Renaming a room's `short`, or adding a wall that splits a surface, changes IDs, and any colours saved on the old IDs no longer show.

## Items

Paintable things that aren't walls, such as cabinet runs and special doors:

```json
{ "key": "kbase", "name": "Base cabinets", "room": "kitchen", "kind": "cabinet", "default": "#4F6779" }
```

- `kind` is `cabinet` (satin by default) or `door` (semi-gloss).
- Cabinet fixtures point to an item with `paint: "<key>"`. Every door and drawer front is numbered automatically (`kbase:door1`, `kbase:drawer1`, …), so each can be painted on its own.
- Every house also gets trim, interior doors, exterior doors, exterior trim, one siding surface per side, and a ceiling per room.

## Fixtures

Each fixture has `k` (its kind) plus a position: `x, y, w, h` for a box, or `cx, cy` for round things.

| `k` | Notes |
|---|---|
| `box` with `paint` | A cabinet. `c`: `cabB` or `cabW` (its plan colour); `front`: `n`/`s`/`e`/`w`; `z1`: height (default 3, or 2.8 for `cabW`). `counter`: `false` for tall units, `"all"` to overhang every side (islands). The default is a counter when `z1` ≤ 4. |
| `upper` | A wall cabinet with `paint`, `front`, and `z0`/`z1` (its bottom and top heights). |
| `box` with `c: "app"` | A refrigerator (`label: "FRIDGE"`). |
| `box` with `c: "counter"` | A bare counter (desk). |
| `splash` | A backsplash tile panel with `z0`/`z1`. |
| `sink2`, `oval` | A double kitchen sink, and an oval vanity basin. |
| `range` | A range with a microwave above it. |
| `toilet` | `cx`, `cy`, `dir` (`n`/`s`/`e`/`w`: the direction the bowl points). |
| `tub`, `shower` | A tub; a shower pan with a glass door on its north side. |
| `front` | A front-loading washer or dryer, with a `label`. |
| `heater`, `pumps`, `shelf`, `barn` | A water heater (`cx`, `cy`, `r`), pumps, a wire shelf, and a sliding barn door (`x1`, `x2`, `y`; paint item `barn`). |
| `steps`, `deck` | Outside steps. |
| `label`, `dash`, `arch`, `fireplace`, `gtub`, `skylight` | Drawn on the plan only. |

Fixtures with `st: "removed"` appear only in the floor plan's Before and Changes views.

Several fixtures still assume a particular wall: the range, fridge and washer/dryer controls face east, and the shower glass is on its north side. Giving every fixture a facing direction is on the [roadmap](../ROADMAP.md).

## Checking a file

```bash
node export_house_json.js houses/my-house/house.json out.json
```

This prints a list of problems if the file is invalid. The paint studio shows the same list when you open the file with **Open file…**.
