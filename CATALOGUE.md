# Furniture catalogue

The catalogue is data. **To add a piece of furniture, only create files in `catalogue/`. Never change code in
`src/`.** The app discovers new files by itself and shows them in its **Catalogue** panel within about a second:
no registration, no restart, no build step.

> Draft (Phase 2). Stacking, wall snapping, clearance overlays and collisions arrive in Phase 3; the fields for them
> are already part of the format, so items written now keep working.

## Quick start

1. Create `catalogue/<id>.json`, or a folder `catalogue/<id>/` with `item.json` and its 3D model.
2. Copy one of the [examples](#examples) and change it. The first line `$schema` gives you validation and
   autocompletion in VS Code.
3. Run `npm run validate`. It applies exactly the app's rules and lists errors and warnings with file and property.
4. Look at it in the app: the card's thumbnail is rendered automatically; place it and check its size and look.

Mistakes never break the app. An invalid file is listed in the **Issues** panel (with line and column for JSON
errors), its item is left out, and everything else keeps working. Fix the file and the item comes back.

## Units and the item's own frame

- **Centimetres** for all sizes and positions, **degrees** for angles.
- Every item has its own frame: the **origin is the bottom centre** of its box, **x = width**, **y = up**,
  **z = depth**, and the **front faces +z**. Standing in front of the item and looking at it, +x is on your right.
- Part rotations: `y` turns **clockwise seen from above** (like a placed item's rotation); `x` and `z` tilt by the
  right-hand rule (`x: -10` tilts the top backwards, towards −z).

See [docs/DATA.md](docs/DATA.md#units-and-coordinate-system) for the apartment's coordinate system.

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
  category: string,            // kebab-case: seating, table, storage, bed, lighting, decor, rug, … new ones just appear
  tags?: string[],             // extra search words
  dimensions: { width: number, depth: number, height: number },   // cm: the real size (x, z, y)
  placement: Placement,        // floor | wall | onTop | ceiling, see below
  geometry: { type: "parametric", parts: Part[] }
          | { type: "model", src: string, fit?: "stretch" | "uniform", rotation?: { x?, y?, z? },
              materialMap?: { [modelMaterialName: string]: slotName } },
  materialSlots: { [slot: string]: { label?: string, default: presetId | "@original", allowed?: string[] } },
  surfaces?: Surface[],        // where other items can stand (stacking, Phase 3)
  clearance?: { front?, back?, left?, right?: number, note?: string },   // free space needed, cm (Phase 3)
  collision?: "parts" | "box" | "none",   // shape for collision checks (Phase 3)
  collisionParts?: Part[],     // simpler collision shape for model items (Phase 3)
  price?: { amount: number, currency: string },   // e.g. { "amount": 890, "currency": "CHF" }
  productUrl?: string,         // http(s) link to the product page
  notes?: string
}
```

Unknown properties are errors, so a typo such as `"dimension"` is caught instead of being ignored.

### `dimensions`

The authoritative real size: `width` along x, `depth` along z (front to back), `height` along y. Each item has
exactly one size; there are no variants and sizes can't be changed in the app. To change a size, edit the file.

- Parametric items: the parts should fill this box. Validation warns if a part sticks out by more than 1 cm.
- Model items: the model is scaled to this box.
- Ceiling items: include the cord or rod, since the item's top touches the ceiling.

### `placement`

| `type` | Meaning | Fields |
|---|---|---|
| `floor` | Stands on the floor. | |
| `wall` | Hangs on a wall with its back (−z) against it: shelves, pictures, a TV. | `defaultElevation` (cm, floor to the item's bottom edge), `minElevation?`, `maxElevation?` |
| `onTop` | Stands on another item's surface: a lamp on a sideboard, books on a shelf. | `alsoOnFloor?` (may also stand on the floor) |
| `ceiling` | Hangs from the ceiling: its top touches the ceiling. | |

Each placed wall item's height can be changed in the **Inspect** panel, within `minElevation` … `maxElevation`.

**Phase 2:** `onTop` items stand on the floor until stacking arrives in Phase 3, and wall items aren't snapped to
walls yet (move them there and set their height).

### Parametric geometry

`parts` is a list of primitives in the item's frame, in cm. It's the same part format the apartment uses for the
kitchen and built-ins; the full reference is in [docs/DATA.md → Parts](docs/DATA.md#parts).

| `shape` | Fields |
|---|---|
| `box` | `size: {x, y, z}`, `cornerRadius?` (rounded edges, good for upholstery) |
| `cylinder` | `radius` (bottom), `radiusTop?` (cone or taper), `height` |
| `sphere` | `radius`, `scale?: {x, y, z}` (ellipsoid) |
| `torus` | `radius`, `tube`, `arc?` (lies flat) |
| `extrusion` | `points: [x, z][]` (footprint polygon), `height` (extruded upwards) |
| `lathe` | `profile: [radius, y][]` revolved around the vertical axis, `arc?` |

Every part has `position` (its **centre**; for `extrusion` and `lathe` the centre of its base), an optional
`rotation`, a `material` (a slot name from `materialSlots`), and optionally:

- `mirror: ["x"]`, `["z"]` or `["x", "z"]`: mirrored copies, e.g. four legs from one;
- `repeat: { count, step: {x, y, z} }`: evenly spaced copies (doors, shelves, slats);
- `repeatAround: { count, step }`: copies turned by `step` degrees each around the item's vertical axis (chairs
  around a round table);
- `plan: "dashed"`: in the 2D plan, draw only a dashed outline of the part (for things overhead).

Tips:

- A box of height `h` standing on the floor has `position.y = h / 2`.
- Mirroring copies the repeats too: the sideboard's four handles are one part with `repeat` (2) and `mirror` (`x`).
- Surfaces are one-sided. A lathe profile that goes up the outside and back down the inside gives a shell with real
  thickness (the pendant's shade); a single line would be invisible from inside.

### 3D models (GLB / glTF)

Put the model next to `item.json` and point `geometry.src` at it:

```json
"geometry": { "type": "model", "src": "model.glb", "materialMap": { "Seat": "seat", "Legs": "frame" } }
```

- **Size and origin don't matter.** The model is measured, scaled to `dimensions`, centred and stood on the floor,
  whatever units (often metres) and origin it was made with.
- `fit`: `"stretch"` (default) scales each axis to `dimensions`. `"uniform"` keeps the proportions and fits the
  model inside the box. If stretching would distort the model by more than 5 %, you get a warning: usually the
  dimensions are swapped or the model needs a `rotation`.
- `rotation`: degrees, applied before fitting, so that the front faces +z and up is +y. Models made with Z up
  usually need `{ "x": -90 }`; a model facing backwards needs `{ "y": 180 }`.
- `materialMap`: model material name → slot. Mapped parts can then be recoloured with presets; a slot whose
  `default` is `"@original"` keeps the model's own material and textures until you pick a preset. Unmapped
  materials always keep their own look. If a name doesn't exist in the model, the Issues panel warns and lists the
  model's actual material names. To list them yourself:

  ```powershell
  node -e "const b=require('fs').readFileSync(process.argv[1]);console.log(JSON.parse(b.subarray(20,20+b.readUInt32LE(12))).materials.map(m=>m.name))" catalogue/example-stool-glb/model.glb
  ```

- `.glb` (one file) is easiest. `.gltf` works if its `.bin` and textures sit next to it.
- Draco- and Meshopt-compressed meshes and KTX2 textures are supported; the decoders are served locally, so no
  network is needed.
- Sources: manufacturers' download pages or Sketchfab (check the licence). Prefer light models (a few MB).

### `materialSlots`

```json
"materialSlots": {
  "upholstery": { "label": "Upholstery", "default": "fabric.linen-grey", "allowed": ["fabric.*", "leather.*"] },
  "legs": { "label": "Legs", "default": "wood.oak-natural", "allowed": ["wood.*", "metal.black-matte", "metal.brass"] }
}
```

- Slot names are free. Parametric parts refer to them with `material`, models through `materialMap`.
- `default`: a preset id from `data/materials.json`, or `"@original"` (model items only).
- `allowed`: what can be picked for this placed item in the **Inspect** panel. Use preset ids, whole groups
  (`"fabric.*"`) or `"@original"`. Without `allowed`, every preset can be picked. The default should be allowed.
- The choice is stored per placed item in the layout file. Picking the default again removes it.
- Presets live in `data/materials.json` (groups such as `wood`, `fabric`, `leather`, `metal`, `lacquer`, `glass`).
  For a new colour or finish, add a preset there; see [docs/DATA.md](docs/DATA.md#datamaterialsjson).

### `surfaces` (stacking, Phase 3)

```json
"surfaces": [{ "name": "top", "height": 75, "width": 180, "depth": 41.5, "center": [0, -1.75] }]
```

`height` is above the item's bottom, `width` × `depth` is the usable area, `center` is `[x, z]` in the item's frame
(default `[0, 0]`), and `maxItemHeight` limits what fits below the next shelf. An item can have several surfaces
(shelf boards). Validation warns if a surface lies outside the footprint or above the item.

### `clearance`, `collision` and `collisionParts` (Phase 3)

- `clearance`: free space needed beyond the footprint, in cm, e.g. `{ "front": 60, "note": "Room to open the doors" }`.
  Phase 3 shows it as an overlay.
- `collision`: `"parts"` (default for parametric items) uses the parts, `"box"` (default for models) uses
  `dimensions`, and `"none"` is for things you walk over, such as rugs.
- `collisionParts`: a simpler shape for a model, e.g. one cylinder for a round stool. The parts need a `material`
  for the format, but it is ignored.

## Validation

`npm run validate` and the app use the same rules.

**Errors.** The item is left out:

- invalid JSON (reported with line and column), a missing or misspelt property, a wrong type or value;
- a duplicate `id`;
- a part whose `material` isn't a slot in `materialSlots`;
- `"@original"` on a parametric item;
- a model file that doesn't exist or lies outside `catalogue/`; a `materialMap` entry pointing to an unknown slot.

A model file that exists but can't be loaded is found when the app loads it: the item then shows as a red box and
the Issues panel says why.

**Warnings.** The item works, but something is probably wrong:

- an unknown preset as a `default` (rendered grey) or in `allowed`, a default that isn't allowed, a group with no
  presets;
- a slot that no part or `materialMap` uses;
- parts sticking out of `dimensions` by more than 1 cm; a surface outside the footprint or above the item;
- a wall item that would reach above the ceiling; an item taller than the ceiling;
- an `id` that differs from the file name; a `src` whose upper/lower case differs from the file on disk;
- a model stretched unevenly by more than 5 %; a `materialMap` name the model doesn't have.

## Examples

All examples are real files in `catalogue/` and validate without warnings.

### Parametric floor item: `catalogue/sofa-3-seater.json`

Upholstery with rounded boxes, `mirror` for the legs and arms, `repeat` for the three seat and back cushions, a
tilted backrest and two material slots.

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
  "clearance": { "front": 60, "note": "Legroom in front of the seat" },
  "notes": "Generic example with typical sizes, not a specific product."
}
```

### Wall item with surfaces: `catalogue/wall-shelf-80.json`

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
  "notes": "Hangs with its bottom 140 cm above the floor by default; change the height per placed shelf."
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
  "notes": "Stands on furniture surfaces such as the sideboard top (stacking arrives in Phase 3)."
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

The other starter items show the remaining features: `sideboard-180.json` (a surface, clearance, price, `repeat`
with `mirror`) and `pendant-lamp-dome.json` (a ceiling item and a lathe shell).

## Checklist for adding an item (GHCP)

1. Only create files in `catalogue/` (and, for a new colour or finish, add a preset to `data/materials.json`).
   Don't touch `src/`.
2. Get the real width × depth × height. Ask if unsure; never guess a product's size silently.
3. Name the file after the `id`. Build the parts (or add the model), the material slots and the placement.
4. Run `npm run validate`: 0 errors and, ideally, 0 warnings.
5. Check it in the app: the thumbnail, then place it and compare with the room.
