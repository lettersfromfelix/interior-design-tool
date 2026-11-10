# Furniture catalogue

The catalogue is data. **To add a piece of furniture, only create files in `catalogue/`. Never change code in
`src/`.** The app discovers new files by itself and shows them in its **Furniture** panel within about a second:
no registration, no restart, no build step. The [website](README.md#the-website) shows them after the next push to
`main`, which rebuilds it automatically.

This is the reference for writing items, for you and for GHCP. The [checklist](#checklist-for-adding-an-item-ghcp)
at the end is the short version.

## Quick start

1. Create `catalogue/<id>.json`, or a folder `catalogue/<id>/` with `item.json` and its 3D model.
2. Copy the closest [example](#examples) or starter item and change it. The first line, `$schema`, gives you
   validation and autocompletion in VS Code.
3. Run `npm run validate`. It applies exactly the app's rules and lists errors and warnings with file and property.
4. Look at it in the app. Its card thumbnail is rendered automatically. Place it, compare its size with the room,
   and try its materials.

Mistakes never break the app. An invalid file is listed in the **Issues** panel (with line and column for JSON
errors), its item is left out, and everything else keeps working. Fix the file and the item comes back.

## Units and the item's own frame

- **Centimetres** for all sizes and positions, **degrees** for angles.
- Every item has its own frame. The **origin is the bottom centre** of its box, **x = width**, **y = up**,
  **z = depth**, and the **front faces +z**. Standing in front of the item and looking at it, +x is on your right.
- So the item fills x from −width/2 to +width/2, z from −depth/2 (back) to +depth/2 (front), and y from 0 to height.

Placed items turn clockwise seen from above; at 0° their front faces down the floor plan. The apartment's coordinate
system is described in [docs/DATA.md](docs/DATA.md#units-and-coordinate-system).

## Files and ids

| Rule | |
|---|---|
| One item per file | `catalogue/sofa-3-seater.json`. An item with a 3D model gets a folder: `catalogue/example-stool-glb/item.json` + `model.glb`. |
| `id` | kebab-case (`lowercase-letters-and-digits`), unique, and equal to the file name (for `item.json`: the folder name). |
| Subfolders | Allowed for grouping (`catalogue/bedroom/bed-160.json`). Every `.json` file below `catalogue/` is an item; other files (models, `.bin`, textures) are assets that items can point to. |
| Duplicate ids | The first file (in path order) wins; the others are errors. |
| Paths | `geometry.src` is relative to the item file and must stay inside `catalogue/`. |

Placed copies refer to items by `id`. Changing an item file updates all placed copies at once. If an item is deleted,
renamed or broken, its placed copies stay in the layout and show as red placeholder boxes until it is back.

## Item format

```ts
{
  $schema?: "../schemas/catalogue-item.schema.json",  // "../../schemas/…" for catalogue/<id>/item.json
  schemaVersion: 1,
  id: string,                  // kebab-case, = file name (folder name for item.json)
  name: string,                // shown in the app
  category: string,            // kebab-case: seating, table, storage, bed, lighting, decor, rug, media, … new ones just appear
  tags?: string[],             // extra search words
  dimensions: { width: number, depth: number, height: number },   // cm: the real overall size (x, z, y)
  placement: Placement,        // floor | wall | onTop | ceiling, see below
  geometry: { type: "parametric", parts: Part[] }
          | { type: "model", src: string, fit?: "stretch" | "uniform", rotation?: { x?, y?, z? },
              materialMap?: { [modelMaterialName: string]: slotName } },
  materialSlots: { [slot: string]: { label?: string, default: presetId | "@original", allowed?: string[] } },
  surfaces?: Surface[],        // where onTop items can stand
  clearance?: { front?, back?, left?, right?: number, note?: string },   // free space the item needs, cm
  collision?: "parts" | "box" | "none",   // shape for collision checks
  collisionParts?: Part[],     // simpler collision shape for model items
  price?: { amount: number, currency: string },   // e.g. { "amount": 890, "currency": "CHF" }
  productUrl?: string,         // http(s) link to the product page
  notes?: string
}

type Placement =
  | { type: "floor" }
  | { type: "wall", defaultElevation: number, minElevation?: number, maxElevation?: number }
  | { type: "onTop", alsoOnFloor?: boolean }
  | { type: "ceiling" };

type Surface = { name?: string, height: number, width: number, depth: number, center?: [x, z], maxItemHeight?: number };
```

Unknown properties are errors, so a typo such as `"dimension"` is caught instead of being ignored. The generated
JSON Schema is `schemas/catalogue-item.schema.json`; its source is `src/core/schema/catalogue.ts`.

### `dimensions`

The authoritative real size: `width` along x, `depth` along z (front to back), `height` along y. Each item has
exactly one size; there are no variants, and sizes can't be changed in the app. To change a size, edit the file.

- It is the **overall** size, including handles, feet, cushions, a wall bracket or a lamp's cord. Manufacturers
  sometimes give the body without handles; add them. Wall snapping puts the back of this box against the wall, and
  clearance zones start at its sides.
- Parametric items: the parts should fill this box. Validation warns if a part sticks out by more than 1 cm.
- Model items: the model is scaled to this box.
- Ceiling items: include the cord or rod, since the item's top touches the ceiling.

### `placement`

| `type` | For | How it behaves |
|---|---|---|
| `floor` | most furniture | Stands on the floor. With **Wall snap** on, its back snaps flush against a wall when it comes within 25 cm and is turned less than 25° from facing straight away from the wall; a side within 10 cm of a crossing wall slides into the corner. |
| `wall` | shelves, pictures, a TV | Always hangs on a wall: its back (−z) flush against the nearest wall (never on glass), its bottom edge `defaultElevation` cm above the floor. Each placed copy's height can be changed in **Inspect**, within `minElevation` … `maxElevation`. Covering a window or door, or not hanging on a wall (e.g. after typing a position), is a warning. |
| `onTop` | table lamps, vases, books | Stands on a [surface](#surfaces-stacking) of another item when you drop it there, and from then on moves, turns, duplicates and is deleted with it. On the floor it gets a warning, unless `alsoOnFloor: true`. |
| `ceiling` | pendant lamps | Hangs from the ceiling: its top touches the ceiling, at whatever height the ceiling is. Moves like a floor item, without wall snap. |

**Grid** snapping works for all of them, except on a surface; for wall items and items snapped to a wall it works
along the wall.

### Parametric geometry

`parts` is a list of primitives in the item's frame, in cm. The kitchen and the built-ins in `data/apartment.json`
use the same part format.

| `shape` | Fields | `position` is |
|---|---|---|
| `box` | `size: {x, y, z}`, `cornerRadius?` | its centre |
| `cylinder` | `radius` (bottom), `radiusTop?` (cone or taper), `height`; upright | its centre, halfway up |
| `sphere` | `radius`, `scale?: {x, y, z}` (ellipsoid) | its centre |
| `torus` | `radius` (to the middle of the tube), `tube` (the tube's radius), `arc?`; lies flat | the centre of the ring |
| `extrusion` | `points: [x, z][]` (outline seen from above), `height` (extruded upwards) | the origin of `points`, at the bottom |
| `lathe` | `profile: [radius, y][]`, revolved around the vertical axis, `arc?` | the point on the axis where the profile's y is 0 |

Round shapes are drawn with 32 segments around (a lathe with 48 per full turn) and collide as 16-sided polygons whose
corners lie on the true circle, so a round table top collides as a circle, not as its bounding square.

Every part has a `position`, an optional `rotation`, a `material` (a slot name from `materialSlots`) and an optional
`name`. These add copies or change how it is drawn:

- `mirror: ["x"]`, `["z"]` or `["x", "z"]`: mirrored copies, e.g. four legs from one. They are reflections, so a leg
  splayed outwards is splayed outwards on the other side too. Mirroring copies the repeats as well.
- `repeat: { count, step: {x, y, z} }`: `count` parts in all, each `step` further on (doors, shelves, slats).
- `repeatAround: { count, step }`: `count` parts in all, each turned `step` degrees further (clockwise seen from
  above) around the item's vertical axis, the axis through the item's origin, not through the part (the bars of a
  round railing, the legs of a round table). Put the part where the first copy goes: at radius r and angle a
  (clockwise from +x, seen from above) that is `x = r·cos a`, `z = r·sin a`, with `rotation.y = a` if it should face
  outwards. For four identical legs on the diagonals, this and `mirror: ["x", "z"]` give the same result.
- `plan: "dashed"`: in the 2D plan, draw only a dashed outline of the part's footprint, the drawing convention for
  things overhead (a wall cabinet, a lamp's arc), so it doesn't hide what is below. `plan: "hidden"`: leave the part
  out of the plan altogether, for small details that would only clutter it (handles, a shower head). The default,
  `"solid"`, draws it as seen from above. In 3D all three look the same.

#### Rotating parts

`rotation: { x?, y?, z? }` (degrees) turns a part around its `position`:

- `y` turns it clockwise seen from above, like a placed item.
- `x` and `z` tilt it (right-hand rule): `x: -10` tilts its top backwards (towards −z), `z: 10` tilts its top to
  the left (towards −x).
- They are applied in the order **z, then x, then y**, always around the item's axes. So `y`, applied last, turns
  the already tilted part around the vertical axis.

`cornerRadius` rounds all twelve edges of a box. It is limited to just under half of the box's smallest side, so a
4 cm board gets at most a fully rounded edge of 2 cm; larger values change nothing.

#### Arcs: `torus` and `lathe`

`arc` (degrees, default 360) makes a partial ring. It starts on the part's +x side and runs clockwise seen from
above (towards +z), so `rotation.y` sets where it starts. A torus lies flat; to stand it up (an arc lamp, an arch),
use one of these rotations. The angles are as seen from the front, counter-clockwise from +x (0° = right, 90° = up):

| Upright arc in the item's front plane (x–y) | `rotation` |
|---|---|
| from +x (right) upwards, counter-clockwise | `{ "x": -90 }` |
| from −x (left) upwards, clockwise | `{ "x": -90, "y": 180 }` |
| starting at angle s, 0 ≤ s ≤ 180, counter-clockwise | `{ "x": s − 90, "y": 90, "z": 90 }` |
| starting at angle s, 180 ≤ s ≤ 360, counter-clockwise | `{ "x": 270 − s, "y": -90, "z": -90 }` |

Add 90 to `y` to turn any of them into the side plane (y–z). Example: `{ "shape": "torus", "radius": 50, "tube": 1,
"arc": 90, "position": { "x": 0, "y": 100, "z": 0 }, "rotation": { "x": -90 } }` is a quarter circle in the front
plane from (x 50, y 100) up to (x 0, y 150). `floor-lamp-arc.json` builds its arc from two such parts.

#### Tips

- A box or cylinder of height `h` standing on the floor has `position.y = h / 2`.
- The sideboard's four handles are one part with `repeat` (2) and `mirror` (`x`).
- Faces are one-sided and point outwards when you list a lathe profile from the bottom up along the outside. For a
  closed solid, go from the axis at the bottom outwards, up the outside and back to the axis at the top: a 3 cm table
  top with a softened edge is `[[0, 0], [40, 0], [40, 2.2], [39.2, 3], [0, 3]]`. In the opposite order the part looks
  inside out.
- A shell with real thickness goes up the outside and back down the inside (the pendant's shade); a single line
  would be invisible from inside.

### 3D models (GLB / glTF)

1. Get the model: a manufacturer's download page (often under planning, CAD or BIM files) or Sketchfab. The
   repository and the website are **public**, so only use a model whose licence allows publishing it, and credit
   the author in `notes` if the licence asks for that. Prefer light models (a few MB): every placed copy is drawn.
2. Make a folder `catalogue/<id>/` with the model (e.g. `model.glb`) and `item.json`.
3. Take `dimensions` from the product page, not from the model.
4. Set `"geometry": { "type": "model", "src": "model.glb" }`, then `fit`, `rotation` and `materialMap` as needed.
5. If the item isn't box-shaped (round, L-shaped, open below), add `collisionParts`.
6. Run `npm run validate` and check the item in the app: the dot on the rotation ring marks the front (+z).

```json
"geometry": { "type": "model", "src": "model.glb", "materialMap": { "Seat": "seat", "Legs": "frame" } }
```

- **Size and origin don't matter.** The model is measured, scaled to `dimensions`, centred and stood on the floor,
  whatever units (often metres) and origin it was made with.
- `fit`: `"stretch"` (default) scales each axis to `dimensions`. `"uniform"` keeps the proportions and fits the
  model inside the box. If stretching would distort the model by more than 5 %, you get a warning: usually the
  dimensions are swapped or the model needs a `rotation`.
- `rotation`: degrees, applied before fitting, so that the front faces +z and up is +y (same order as part
  rotations). Models made with Z up usually need `{ "x": -90 }`; a model facing backwards needs `{ "y": 180 }`.
- `materialMap`: model material name → slot. Mapped parts can then be recoloured with presets; a slot whose
  `default` is `"@original"` keeps the model's own material and textures until you pick a preset. Unmapped
  materials always keep their own look. If a name doesn't exist in the model, the Issues panel warns and lists the
  model's actual material names. To list them yourself:

  ```powershell
  node -e "const b=require('fs').readFileSync(process.argv[1]);console.log(JSON.parse(b.subarray(20,20+b.readUInt32LE(12))).materials.map(m=>m.name))" catalogue/example-stool-glb/model.glb
  ```

- `.glb` (one file) is easiest. `.gltf` works if its `.bin` and textures sit next to it.
- Draco- and Meshopt-compressed meshes and KTX2 textures are supported; the decoders are served locally (and are
  part of the website), so no network is needed.
- A model file that exists but can't be loaded shows as a red box, and the Issues panel says why.

### `materialSlots`

```json
"materialSlots": {
  "upholstery": { "label": "Upholstery", "default": "fabric.linen-grey", "allowed": ["fabric.*", "leather.*"] },
  "legs": { "label": "Legs", "default": "wood.oak-natural", "allowed": ["wood.*", "metal.black-matte", "metal.brass"] }
}
```

- Slot names are free. Parametric parts refer to them with `material`, models through `materialMap`.
- `default`: a preset id from `data/materials.json`, or `"@original"` (model items only).
- `allowed`: what can be picked for a placed item in **Inspect**: preset ids, whole groups (`"fabric.*"`) or
  `"@original"`. Without `allowed`, every preset can be picked. The default should be allowed.
- A group means every preset in it, including the ones that exist for the apartment: `metal.*` also offers
  `metal.railing`, and `glass.*` offers `glass.black` (the hob) and `glass.clear`. When only some fit, list them.
- The choice is stored per placed item in the layout file. Picking the default again removes it.
- Presets live in `data/materials.json`, in groups: `wood`, `lacquer`, `plastic`, `fabric`, `leather`, `cane`, `metal`,
  `glass`, `ceramic`, `stone`, `paper` (lamp shades), `plant`, and `paint`, `floor`, `kitchen`, `tile`, `door`, `frame`
  for the apartment. For a new colour or finish, add a preset there; see [docs/DATA.md](docs/DATA.md#datamaterialsjson).

### `surfaces` (stacking)

```json
"surfaces": [{ "name": "top", "height": 75, "width": 180, "depth": 41.5, "center": [0, -1.75] }]
```

A surface is a horizontal rectangle that `onTop` items can stand on. `height` is above the item's bottom, `width` ×
`depth` is the usable area, `center` is `[x, z]` in the item's frame (default `[0, 0]`), and `maxItemHeight` is the
free height above it (up to the next shelf board). Give an item one surface per board.

- An `onTop` item goes onto a surface when you drop it with the pointer over the surface's rectangle. Over several
  surfaces, it takes the highest one it fits under; in 3D, the one nearest to the point you are pointing at, so you
  can choose a lower board.
- Its whole `dimensions` footprint stays inside the rectangle; if it is bigger than the surface, it is centred on it.
- From then on it belongs to that item: it moves and turns with it, and is duplicated and deleted with it. Drag it
  off to put it somewhere else.
- Only `onTop` items stack, but any item can have surfaces: wall items (the wall shelf) and `onTop` items too (a tray
  on a sideboard).
- For a round top, use the largest square that fits (side = 0.7 × diameter), so nothing put on it overhangs the edge;
  `coffee-table-round-80.json` does this.

Validation warns if a surface lies outside the footprint or above the item.

### `clearance`

```json
"clearance": { "front": 60, "note": "Room to open the doors" }
```

Free space the item needs next to it, in cm: `front`, `back`, `left` and `right`, plus a `note` that says what it is
for. **Left and right are as seen standing in front of the item, looking at it** (right = +x). For a sofa that is
the opposite of the sitter's left and right.

Each zone is as long as that side of the item and as high as the item. With **Clearance** on, the zones are drawn on
the floor, and a zone turns amber when something stands in it. That is a warning; it never blocks.

A zone flags anything in it below the item's height, a coffee table too, so size it for what must really stay free:
45 cm in front of a sofa or armchair (legroom; a coffee table usually stands there), 60 cm in front of cabinets with
doors, 70 cm in front of a wardrobe, 50–60 cm beside a bed, 60 cm behind a dining chair. Tables get none: the chairs
around them carry it.

### `collision` and `collisionParts`

Collisions are checked when **Collisions** in the placement bar is set to **Warn** or **Block**.

- `"parts"` (the default for parametric items): every part, and every copy from `mirror`, `repeat` and
  `repeatAround`, is a separate block: its outline seen from above (made convex), from its lowest to its highest
  point. So a chair seat at 45 cm slides under a table whose frame starts at 64 cm, and a lamp stands on a sideboard.
- `"box"` (the default for 3D models): the whole `dimensions` box.
- `"none"`: never collides. For things you walk on, such as rugs.
- `collisionParts`: for a model, a few parts that describe its shape better than the box, e.g. one cylinder for a
  round stool. They use the part format; their `material` is required but ignored.

Because each block reaches from its part's lowest to its highest point, a long tilted part blocks everything under its
outline: a straight lamp arm leaning over a sofa would block the sofa. Split such parts into a few shorter ones. Arcs
are split for you: a `torus` or `lathe` with an `arc` below 360° collides as blocks of at most 10° along the arc (each
bulges at most 0.4 % of the radius into the curve). So a curved backrest or a round balcony railing leaves the space
inside its curve free, and an arc lamp's arc only blocks where it is low. A full ring (no `arc`) stays one block, hole
included.

Overlaps of up to 0.5 cm are ignored, so items can touch. Items standing on each other never collide with each other.
What the app reports:

- **Red, an overlap:** with another item, a wall, the kitchen, a built-in or the column. In **Block** mode an item
  you move stops there and slides along it.
- **Amber, a warning (never blocks):** the item stands in a door's swing (its normal 90°, and further when the layout
  opens the door further), something stands in its clearance zone, a wall item covers a window or door or doesn't
  hang on a wall, or an `onTop` item stands on the floor.

## Validation

`npm run validate` and the app use the same rules.

**Errors.** The item is left out:

- invalid JSON (reported with line and column), a missing or misspelt property, a wrong type or value;
- a duplicate `id`;
- a part whose `material` isn't a slot in `materialSlots`;
- `"@original"` on a parametric item;
- a model file that doesn't exist or lies outside `catalogue/`; a `materialMap` entry pointing to an unknown slot.

**Warnings.** The item works, but something is probably wrong:

- an unknown preset as a `default` (rendered grey) or in `allowed`, a default that isn't allowed, a group with no
  presets;
- a slot that no part or `materialMap` uses;
- parts sticking out of `dimensions` by more than 1 cm; a surface outside the footprint or above the item;
- a wall item that would reach above the ceiling; an item taller than the ceiling;
- an `id` that differs from the file name; a `src` whose upper/lower case differs from the file on disk;
- a model stretched unevenly by more than 5 %; a `materialMap` name the model doesn't have.

**What validation can't see.** It checks the format, the references and that the parts fit into `dimensions`, not
whether the item looks right: floating parts, gaps, parts inside each other and a backwards front all pass. Always
look at the thumbnail and place the item.

## House style

- Format files like the starter items: two-space indent, one part per line (long lines are fine), and several lines
  only for long `points` or `profile` lists.
- `name`: what the item is, then what sets it apart: "Sofa, 3-seater", "Dining table 160", "Coffee table, round Ø 80".
  The `id` says the same in kebab-case: `coffee-table-round-80`.
- Give every part a `name`.
- Reuse the existing categories: `seating`, `table`, `storage`, `bed`, `lighting`, `rug`, `media`, `decor`. A new
  category appears by itself, so only add one for a new kind of thing.
- `tags`: the rooms and other words someone would search for ("living room", "reading"). The search in the
  **Furniture** panel already matches the name, id and category.
- The first sentence of `notes` says what the item is based on: "Generic example with typical sizes, not a specific
  product.", "Built to the user's description, not a specific product.", or, for a real product, its maker and
  article number (with `productUrl` and `price`).
- Don't invent prices. If an example needs one, say "The price is a placeholder." in `notes`.
- Use the rest of `notes` for what someone placing the item should know: default heights, what the clearance is for,
  what the dimensions include.

## Examples

All examples are real files in `catalogue/` and validate without warnings (`npm test` checks that they match).

### Parametric floor item: `catalogue/sofa-3-seater.json`

Upholstery with rounded boxes, `mirror` for the legs and arms, `repeat` for the three seat and back cushions, a
tilted backrest, two material slots and a clearance zone in front.

```json
{
  "$schema": "../schemas/catalogue-item.schema.json",
  "schemaVersion": 1,
  "id": "sofa-3-seater",
  "name": "Sofa, 3-seater",
  "category": "seating",
  "tags": ["living room"],
  "dimensions": { "width": 220, "depth": 92, "height": 80 },
  "placement": { "type": "floor" },
  "geometry": {
    "type": "parametric",
    "parts": [
      { "name": "legs", "shape": "cylinder", "radius": 2.5, "radiusTop": 3, "height": 12, "position": { "x": 100, "y": 6, "z": 38 }, "mirror": ["x", "z"], "material": "legs" },
      { "name": "base", "shape": "box", "size": { "x": 220, "y": 18, "z": 92 }, "cornerRadius": 2, "position": { "x": 0, "y": 21, "z": 0 }, "material": "upholstery" },
      { "name": "arms", "shape": "box", "size": { "x": 18, "y": 32, "z": 92 }, "cornerRadius": 5, "position": { "x": 101, "y": 46, "z": 0 }, "mirror": ["x"], "material": "upholstery" },
      { "name": "back", "shape": "box", "size": { "x": 184, "y": 42, "z": 12 }, "cornerRadius": 2, "position": { "x": 0, "y": 51, "z": -40 }, "material": "upholstery" },
      { "name": "back cushions", "shape": "box", "size": { "x": 61, "y": 46, "z": 14 }, "cornerRadius": 5, "position": { "x": -61.5, "y": 55, "z": -27 }, "rotation": { "x": -7 }, "repeat": { "count": 3, "step": { "x": 61.5, "y": 0, "z": 0 } }, "material": "upholstery" },
      { "name": "seat cushions", "shape": "box", "size": { "x": 61, "y": 14, "z": 64 }, "cornerRadius": 4, "position": { "x": -61.5, "y": 37, "z": 13 }, "repeat": { "count": 3, "step": { "x": 61.5, "y": 0, "z": 0 } }, "material": "upholstery" }
    ]
  },
  "materialSlots": {
    "upholstery": { "label": "Upholstery", "default": "fabric.linen-grey", "allowed": ["fabric.*", "leather.*"] },
    "legs": { "label": "Legs", "default": "wood.oak-natural", "allowed": ["wood.*", "metal.black-matte", "metal.brass"] }
  },
  "clearance": { "front": 45, "note": "Legroom in front of the seat; a coffee table can stand 45 cm away" },
  "notes": "Generic example with typical sizes, not a specific product."
}
```

### Wall item with surfaces: `catalogue/wall-shelf-80.json`

A wall item whose three boards are surfaces; `maxItemHeight` keeps tall things off the lower boards.

```json
{
  "$schema": "../schemas/catalogue-item.schema.json",
  "schemaVersion": 1,
  "id": "wall-shelf-80",
  "name": "Wall shelf 80",
  "category": "storage",
  "tags": ["wall"],
  "dimensions": { "width": 80, "depth": 22, "height": 36 },
  "placement": { "type": "wall", "defaultElevation": 140, "minElevation": 30, "maxElevation": 200 },
  "geometry": {
    "type": "parametric",
    "parts": [
      { "name": "bottom and top", "shape": "box", "size": { "x": 80, "y": 2, "z": 22 }, "position": { "x": 0, "y": 1, "z": 0 }, "repeat": { "count": 2, "step": { "x": 0, "y": 34, "z": 0 } }, "material": "body" },
      { "name": "middle shelf", "shape": "box", "size": { "x": 76, "y": 2, "z": 22 }, "position": { "x": 0, "y": 18, "z": 0 }, "material": "body" },
      { "name": "sides", "shape": "box", "size": { "x": 2, "y": 32, "z": 22 }, "position": { "x": 39, "y": 18, "z": 0 }, "mirror": ["x"], "material": "body" }
    ]
  },
  "materialSlots": {
    "body": { "label": "Wood", "default": "wood.oak-natural", "allowed": ["wood.*", "lacquer.*"] }
  },
  "surfaces": [
    { "name": "top", "height": 36, "width": 80, "depth": 22 },
    { "name": "upper shelf", "height": 19, "width": 76, "depth": 22, "maxItemHeight": 15 },
    { "name": "lower shelf", "height": 2, "width": 76, "depth": 22, "maxItemHeight": 15 }
  ],
  "notes": "Generic example with typical sizes, not a specific product. Hangs with its bottom 140 cm above the floor by default; change the height per placed shelf."
}
```

### Stackable item: `catalogue/table-lamp-globe.json`

```json
{
  "$schema": "../schemas/catalogue-item.schema.json",
  "schemaVersion": 1,
  "id": "table-lamp-globe",
  "name": "Table lamp, globe",
  "category": "lighting",
  "dimensions": { "width": 30, "depth": 30, "height": 45 },
  "placement": { "type": "onTop" },
  "geometry": {
    "type": "parametric",
    "parts": [
      { "name": "foot", "shape": "cylinder", "radius": 8, "radiusTop": 7.5, "height": 2, "position": { "x": 0, "y": 1, "z": 0 }, "material": "base" },
      { "name": "stem", "shape": "cylinder", "radius": 0.8, "height": 14, "position": { "x": 0, "y": 9, "z": 0 }, "material": "base" },
      { "name": "globe", "shape": "sphere", "radius": 15, "position": { "x": 0, "y": 30, "z": 0 }, "material": "shade" }
    ]
  },
  "materialSlots": {
    "base": { "label": "Base", "default": "metal.brass", "allowed": ["metal.brass", "metal.black-matte", "metal.stainless", "ceramic.white"] },
    "shade": { "label": "Globe", "default": "glass.opal", "allowed": ["glass.opal", "glass.smoke"] }
  },
  "notes": "Generic example with typical sizes, not a specific product. Stands on the surface of another item, such as the sideboard top or a table, and moves with it."
}
```

### 3D model: `catalogue/example-stool-glb/item.json`

`model.glb` is made by `npm run make-example-glb` (`tools/make-example-glb.ts`) from primitives: 35 × 45 × 35 cm, in
metres, with its origin in the middle of the seat and two materials named `Seat` and `Legs`. The app scales and
moves it into place; both slots keep the model's own materials until you pick a preset.

```json
{
  "$schema": "../../schemas/catalogue-item.schema.json",
  "schemaVersion": 1,
  "id": "example-stool-glb",
  "name": "Stool (GLB example)",
  "category": "seating",
  "tags": ["example", "glb"],
  "dimensions": { "width": 35, "depth": 35, "height": 45 },
  "placement": { "type": "floor" },
  "geometry": {
    "type": "model",
    "src": "model.glb",
    "materialMap": { "Seat": "seat", "Legs": "frame" }
  },
  "materialSlots": {
    "seat": { "label": "Seat", "default": "@original", "allowed": ["@original", "wood.*", "lacquer.*", "leather.cognac"] },
    "frame": { "label": "Frame", "default": "@original", "allowed": ["@original", "metal.black-matte", "metal.brass", "metal.stainless"] }
  },
  "notes": "model.glb is generated by `npm run make-example-glb`. Like many downloaded models it is in metres, with its origin in the middle of the seat; the app scales and moves it to the declared dimensions."
}
```

The other starter items show the remaining features:

| File | Shows |
|---|---|
| `sideboard-180.json` | a surface, a clearance zone, a (placeholder) price, `repeat` with `mirror` |
| `coffee-table-round-80.json` | a round top with a square surface inside it, legs with `repeatAround` |
| `bookshelf-80.json` | six surfaces; the shelf boards limit the height with `maxItemHeight` |
| `dining-table-160.json`, `dining-chair.json` | a chair whose seat slides under the table top; clearance behind the chair |
| `floor-lamp-arc.json` | upright torus arcs, split in two for collisions; a lathe shade |
| `pendant-lamp-dome.json` | a ceiling item with a lathe shell |
| `tv-55.json` | a wall item with a bracket |
| `rug-200x300.json` | `collision: "none"` |
| `bed-160x200.json`, `wardrobe-150.json`, `armchair.json` | clearance on several sides, doors, cushions |

## Checklist for adding an item (GHCP)

1. Only create files in `catalogue/` (and, for a new colour or finish, add a preset to `data/materials.json`).
   Never change `src/`, `server/`, `schemas/` (generated) or `data/apartment.json` to add furniture. If the format
   can't express something, say so and ask instead of changing code.
2. Get the real width × depth × height. Ask if you're unsure; never guess a product's size silently.
3. Choose the `placement` type. Build the parts inside the `dimensions` box (or add the model), then the material
   slots and, where they help, `surfaces` and `clearance`.
4. Name the file after the `id`, and follow the [house style](#house-style).
5. Run `npm run validate`: 0 errors and, ideally, 0 warnings. If you changed an example item or this file, also run
   `npm test`.
6. Check it in the app: the thumbnail, then place it, compare it with the room and try its materials. If you can't
   see the app, say so, and ask the user to check it.
7. Don't place it in a layout unless you're asked to: the files in `layouts/` are the user's.
8. Commit and push only when the user asks. A push to `main` publishes the item on the website after the automatic
   rebuild (a few minutes; the **Website** workflow in the Actions tab shows its progress). Everything in
   `catalogue/` is public: no photos, nothing made from them, and only models you may publish.
