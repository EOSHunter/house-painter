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
- **Walls:** filled rectangles, or (for walls at an angle) a thick line. Openings in a rectangular wall are measured along its long axis, using the same absolute coordinates. Openings in a `line` wall are measured from its start.

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
| `floor` | | `{ "name", "spec", "color", "plankW", "plankL", "dir", "texture", "wood" }`. Pick one look: `wood` is a species (`whiteoak`, `redoak`, `walnut`, `teak`, `cherry`, `maple`, `rosewood`, `ebonized`), drawn like the cabinet veneers. `texture` is a photo of a single plank, with the grain running up the picture, either as a path from the project root or as a `data:` URL. Without either the floor is plain `color`. |
| `floorRects` | | Floor area as `[x0, y0, x1, y1]` rectangles. Defaults to the inside of the exterior walls. |
| `walls` | yes | See [Walls](#walls). |
| `rooms` | yes | See [Rooms](#rooms). |
| `roomOrder` | | The order of rooms in the paint studio's list. Rooms you leave out follow in file order. |
| `items` | | See [Items](#items). |
| `fixtures` | | See [Fixtures](#fixtures). |
| `start` | | `{ "x", "y", "yaw" }`: where the walkthrough starts. Defaults to just inside the first exterior door. For `yaw`, 0 faces north (−y), π faces south, −π/2 faces east and π/2 faces west. |
| `renderRooms` | | Room ids Blender renders for `--views rooms`. Defaults to every room of 40 sq ft or more. |
| `plan` | | Floor-plan extras: `tints`, `labels`, `dims`, `texts`, `callouts`, `notes`. Only `floorplan.html` uses these. Rooms without labels are named automatically. |
| `editor` | | Written by the plan editor and ignored by everything else. `underlay` holds the blueprint's name, size, scale (`s`, in feet per pixel), position (`ox`, `oy`), rotation and opacity. `splits` holds the zone lines between open-plan rooms. |

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

### Angled walls

A wall that is not horizontal or vertical is written as a centre line and a thickness:

```json
{ "line": [26, 0, 32, 6], "t": 0.5, "ext": 1, "id": "entry-cut",
  "openings": [ { "a": 2.7, "b": 5.7, "type": "door", "hinge": "a", "swing": "r" } ] }
```

- `line` is `[x0, y0, x1, y1]`, the centre line from start to end, in the same feet as everything else. `t` is the thickness (it defaults to the exterior or interior thickness, by `ext`). A `line` wall that happens to run along an axis is just an ordinary wall.
- Openings run along the line from its **start**: `a` and `b` are distances from `[x0, y0]`. A door's `hinge` is `"a"` (the start side) or `"b"`, and its `swing` is `"l"` or `"r"`: the left or right of the way the line runs, looking from the start to the end. (Left and right are as they look on the plan, with north at the top.)
- Where two angled walls, or an angled wall and a straight one, meet at their ends, the corner is mitred and closed for you. Ends that stop within a wall's thickness of another wall join it, as for straight walls.
- A room against an angled wall is written as an outline, not rectangles (see Rooms). Sides are named by compass: an angled wall facing south-east gives `LIV-SE`, and the outside of an angled wall gives `EXT-NE` and so on (named the same way as the straight ones).
### Curved walls

```json
{ "arc": [22, 22, 10, 22, -3.6], "t": 0.5, "ext": 1, "id": "bay",
  "openings": [ { "a": 2.2, "b": 5.4, "type": "window", "panes": 3 } ] }
```

- `arc` is `[x0, y0, x1, y1, bulge]`: the two ends, and how far (feet) the middle of the curve stands out from the straight line between them. A positive bulge bows to the **right** of the way the wall runs from its start to its end (with north at the top); a negative one to the left. The bulge can be at most half the distance between the ends (a half circle).
- It is built as a run of short straight walls, one for about every 15° of the curve, closed up at the joints. The plan is made as big as everything in it, so a bay can stand out past the `W` and `D` you give.
- Openings run along the curve from its start (`a` and `b` are feet along the curve). One that crosses several of the short walls is shared out among them (so a wide window gets a frame post at every joint). A door sits in the one wall that its middle falls in.
- Paint: each face of a curve is **one** paint surface, however many short walls it has. Its id is the room, then `C` and a number: `LIV-C1`, `EXT-C2` (the number is only there if the room has more than one curved face).
- A room that touches a curve is written as an outline (`polys`) whose corners follow it: put a point on the curve for every joint, or let the plan editor do it.
- Limits: curves are circle arcs (no ellipses or splines), and the room outline you write for a curve is only as round as the corners you give it.

- Limits: fixtures (cabinets, appliances) stay square to the plan and cannot sit along an angled wall, though they can stand beside one; an angled wall inside one room (a peninsula) needs the room split by an outline that follows it; walls are straight (no curves).

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

Rooms are paint zones, and each is made of one or more rectangles, or outlines. A point belongs to the **first** room whose rectangles (then outlines) contain it, so put small rooms, such as a closet inside a bigger rectangle, before big ones. Points inside walls belong to no room.

- Open-plan spaces are split into rooms by the rectangles alone, with no wall needed. The kitchen and dining room in the example are split this way.
- Rectangles can overlap walls: a rectangle may run to a wall's centre line or past it.
- **Outlines:** a room with a corner cut off by an angled wall lists its shape as `"polys": [[[x, y], [x, y], ...]]`: one or more polygons, each with three or more corners, in order around the room. Write them along the wall centre lines (they may run into the walls: a point inside a wall belongs to no room). A room can have `rects`, `polys` or both. The plan editor writes them for you when you press Room beside an angled wall.
- `short` is the prefix for surface IDs. The north wall of `KIT` is `KIT-N`. When a room has several walls facing the same way, they are numbered: `KIT-E1`, `KIT-E2`.

The reserved ids are `exterior` and `house`.

**Ceilings.** Every room is flat at the house's `heights.ceiling` unless it says otherwise:

```json
{ "id": "great", "name": "Great room", "rects": [[0, 0, 20, 14]], "ceiling": { "type": "vault", "eave": 8, "peak": 13, "ridge": "x" } }
```

| `ceiling` | Meaning |
|---|---|
| a number, or `{ "type": "flat", "height": 10 }` | Flat, at that height (feet). |
| `{ "type": "shed", "low": 8, "high": 11, "rise": "e" }` | One slope across the room's bounding box, rising toward `n`, `e`, `s` or `w`. |
| `{ "type": "vault", "eave": 8, "peak": 13, "ridge": "x" }` | Two slopes meeting at a ridge down the middle of the room's bounding box. `ridge: "x"` runs the ridge east to west, `"y"` north to south. |

Walls rise to meet their rooms' ceilings (a wall between two rooms goes as high as the higher one), and the area of each painted wall face follows the ceiling above it. Heights are from the floor. Ceilings of any one room are one plane or two, taken across the bounding box of its shape, so an L-shaped room slopes as one rectangle would.

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

**Facing.** `front` (`n`, `e`, `s` or `w`) is the side a fixture's doors, controls or glass point to, and the back is the opposite side, usually against a wall. For a toilet it is `dir`, the way the bowl points. When `front` is left out the fixture keeps the direction older files assumed: east for the fridge, range and washer/dryer, north for the shower, south for the sink, and south for the barn door. `w` is the width across the front and `h` the depth for `n`/`s`; for `e`/`w` it is the other way round, because `w` and `h` are always along x and y.

| `k` | Notes |
|---|---|
| `box` with `paint` | A cabinet. `c`: `cabB` or `cabW` (its plan colour); `front`; `z1`: height (default 3, or 2.8 for `cabW`). `counter`: `false` for tall units, `"all"` to overhang every side (islands). The default is a counter when `z1` ≤ 4. `style`: `"door-drawer"` (a drawer over each door, the default under a counter), `"doors"` (the default for tall units) or `"drawers"` (a stack of three). `doors`: how many fronts (default one per 1.5 ft). `sink: true` sets a double kitchen sink into the counter and `basin: true` a bath basin. |
| `upper` | A wall cabinet with `paint`, `front`, `z0`/`z1` (its bottom and top heights), and optional `style` and `doors`. |
| `box` with `c: "app"` | A refrigerator (`label: "FRIDGE"`). |
| `box` with `c: "counter"` | A bare counter (desk). |
| `splash` | A backsplash tile panel with `z0`/`z1`. |
| `sink2`, `oval` | A double kitchen sink (`front` is the side you stand on, the faucet is at the back), and an oval vanity basin. |
| `range` | A range with a microwave above it. |
| `toilet` | `cx`, `cy`, `dir` (`n`/`s`/`e`/`w`: the direction the bowl points). The footprint runs 0.95 ft behind the centre, 0.85 ft ahead of it, and 0.6 ft to each side. |
| `tub`, `shower` | A tub; a shower pan with its glass door on the `front` side. |
| `front` | A front-loading washer or dryer, with a `label`; the door and controls are on the `front` side. |
| `heater`, `pumps`, `shelf`, `barn` | A water heater (`cx`, `cy`, `r`), pumps, a wire shelf, and a sliding barn door (`x1`, `x2`, `y`; `front`: `s` slides on the south side of its wall, `n` on the north; paint item `barn`, or `paint`). |
| `steps`, `deck` | Outside steps. |
| `label`, `dash`, `arch`, `fireplace`, `gtub`, `skylight` | Drawn on the plan only. |

Fixtures with `st: "removed"` appear only in the floor plan's Before and Changes views.

The plan editor places all of these from its fixture library (`F`). The shared geometry, which turns a fixture to face any direction, is in [`fixtures.js`](../fixtures.js).

## Checking a file

```bash
node export_house_json.js houses/my-house/house.json out.json
```

This prints a list of problems if the file is invalid. The paint studio shows the same list when you open the file with **Open file…**.
