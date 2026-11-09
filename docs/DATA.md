# Data formats

All data lives in plain JSON files and is loaded at runtime. Nothing in `src/` imports data files. Every file has
a `$schema` line pointing to a generated JSON Schema in `schemas/`, so VS Code validates and autocompletes it while
you edit. The authoritative definitions are the Zod schemas in `src/core/schema/`. Run `npm run schemas` after
changing them.

After editing any data file, run `npm run validate`. The app also re-validates on every change and lists problems
in its **Issues** panel.

| File | Contents |
|---|---|
| `data/apartment.json` | The fixed apartment: rooms, walls, doors, windows, kitchen, built-ins, checklist |
| `data/materials.json` | Material presets (colours, wood, fabric, metal, paint, floors, …) |
| `data/underlay/floorplan.png` | The original plan, cropped (no address), for the 2D underlay |
| `catalogue/**` | Furniture, one item per file; the format is in [`CATALOGUE.md`](../CATALOGUE.md) |
| `layouts/*.json` | Placed furniture; `default.json` is the autosaved current layout (named layouts: Phase 4) |

## Units and coordinate system

| Concept | Convention |
|---|---|
| Units | **Centimetres** everywhere. Angles are **degrees** in data files. |
| Plan coordinates | `[x, z]`. **+x** points right on the floor-plan sheet, **+z** points down the sheet (like an image or SVG). |
| Origin | Top-left of the apartment's bounding box as drawn. The PDF → model transform is stored in `apartment.json → source`. |
| Up | **+y**. The floor is at y = 0, the ceiling at y = `ceilingHeight`. |
| 3D | Three.js world X = plan x, Z = plan z, Y = up. |
| Rotation | Around the vertical axis, **clockwise as seen from above**. 0 means the object's front (local +z) faces down the plan. |
| Local frame of objects | Origin at the bottom centre. Width along local x, depth along local z, height along y. Front = +z, back = −z. |
| Wall sides | `left` / `right` as seen on the plan when walking from a wall's `start` to its `end`. |
| North | `north.planUpBearing` is the compass bearing of plan-up (−z), from the plan's north arrow (≈ 49°). |

## Provenance and confidence

Values that are not certain carry a `provenance` object so they can be checked with a tape measure:

```json
"provenance": {
  "confidence": "high",
  "source": "plan",
  "note": "Width = gap between the wall reveals.",
  "fields": {
    "height": { "confidence": "low", "source": "assumed", "note": "Door height not in plan; estimated from the photos." }
  }
}
```

| Field | Values |
|---|---|
| `confidence` | `high`: read from the plan's vector geometry, given by you, or measured. `medium`: interpreted from plan symbols. `low`: estimated. |
| `source` | `plan`, `photo`, `assumed`, `user`, `measured` |
| `fields` | Overrides for single properties (dot paths), e.g. `height` or `door.leafWidth`; on a part, e.g. `size.y` |

Fixture **parts** can carry their own `provenance` too. The Verify panel lists everything that is not `high`; a part
appears as `<part name>` and its fields as `<part name>.<field>`, e.g. `wall cabinets.size.z`.

## `data/apartment.json`

```ts
{
  schemaVersion: 1,
  name: string,
  ceilingHeight: number,                 // cm
  north: { planUpBearing: number },      // degrees
  location: { latitude, longitude, timeZone },   // city level, for the daylight simulation
  defaults: {                            // material preset ids used when an element has none
    wallMaterial, floorMaterial, ceilingMaterial, doorLeafMaterial, doorFrameMaterial,
    windowFrameMaterial, sashMaterial, glassMaterial, railingMaterial
  },
  source?: { pdfScale, ptToCm, originPt, note },   // how the geometry was derived
  underlay?: { image, x, z, widthCm, heightCm?, rotation?, defaultOpacity },
  rooms: Room[], walls: Wall[], openings: Opening[], fixtures: Fixture[],
  checks?: Check[]
}
```

### Rooms

```ts
{ id, name, kind: "indoor" | "balcony",
  outline: [x, z][],          // polygon as in the plan (interior walls at their centre line,
                              // exterior walls at the inner face)
  labelledArea?: number,      // m² printed on the plan, checked automatically (±1.5 %)
  floorMaterial?, wallMaterial?, hasCeiling?, provenance }
```

### Walls

```ts
{ id, kind: "interior" | "exterior" | "party" | "glazing",
  start: [x, z], end: [x, z],   // centre line
  thickness: number, height?: number,   // height defaults to ceilingHeight
  sides?: { left?: roomId, right?: roomId },
  provenance }
```

`glazing` walls are the window façade: the solid parts are the dark posts between the window units.

### Openings (doors and windows)

```ts
{ id, kind: "door" | "window",
  wall: wallId,
  centerFromStart: number,     // along the wall centre line, from `start` to the middle of the opening
  width: number,               // reveal to reveal
  height: number, sill: number,
  door?: { hinge: "start" | "end",        // jamb with the hinges
           opensTo: "left" | "right",     // wall side the leaf swings into
           leaves: 1 | 2, leafWidth?, style: "solid" | "glazed", isEntrance? },
  window?: { sashes: number, operation: "casement" | "tilt-turn" | "fixed",
             opensTo?: "left" | "right",
             railing?: { height, barSpacing, barWidth, barThickness } },   // Juliet railing, see below
  provenance }
```

Validation checks that every opening fits into its wall, doesn't overlap another opening, and that
`sill + height` stays below the wall height.

`railing` is a Juliet railing outside the window: vertical flat bars (`barWidth` across the railing line ×
`barThickness` along it, `barSpacing` centre to centre) between a top rail at `height` and a bottom rail whose top
edge is 10 cm above the floor. The rails use the same flat-bar section, lying flat. The balcony railings are fixtures
in the same style (see below).

### Fixtures (kitchen, built-ins, sanitary, column, railings)

Fixed elements are built from the same parametric **parts** that catalogue items use (see `CATALOGUE.md`):

```ts
{ id, name, kind: "kitchen" | "built-in" | "sanitary" | "appliance" | "column" | "railing" | "other",
  position: [x, z], elevation?: number, rotation: number,
  parts: Part[],
  materials: { [slot: string]: materialPresetId },   // every part's `material` must be a slot here
  collides?: boolean,
  provenance }
```

### Parts

Every part has `position` (its centre in local cm; for `extrusion` and `lathe`, the centre of its base),
an optional `rotation` (`{ x?, y?, z? }` in degrees, y clockwise from above), a `material` slot name, and
optionally:

- `mirror: ["x"]`, `["z"]` or `["x", "z"]`, which adds mirrored copies (e.g. four table legs from one);
- `repeat: { count, step: {x, y, z} }`, which adds evenly spaced copies;
- `repeatAround: { count, step }`, which adds copies rotated by a further `step` degrees each (clockwise from
  above) around the vertical axis through the item's origin (e.g. the bars of a round railing, chairs around a
  round table);
- `plan: "solid" | "dashed"`, which sets how the part shows in the 2D plan. `solid` (the default) shows it as seen
  from above. `dashed` shows only a dashed outline of its footprint, the drawing convention for things overhead
  such as wall cabinets, so it doesn't hide what's below. In 3D it looks the same either way.

| `shape` | Fields |
|---|---|
| `box` | `size: {x, y, z}`, `cornerRadius?` |
| `cylinder` | `radius`, `radiusTop?` (cone / taper), `height` |
| `sphere` | `radius`, `scale?: {x, y, z}` |
| `torus` | `radius`, `tube`, `arc?`. Lies flat. |
| `extrusion` | `points: [x, z][]` (footprint), `height` (extruded upwards) |
| `lathe` | `profile: [radius, y][]`, revolved around the vertical axis, `arc?` |

`arc` is a partial ring in degrees (default 360). It starts at the part's local +x axis and runs clockwise seen from
above, so `rotation.y` sets where it starts. The balcony railings use this: a lathe top and bottom rail along the
open edge of the balcony, and one bar part with `repeatAround`.

### Checks (tape-measure checklist)

```ts
{ id: "M01".."M99", title, how, priority: "must" | "nice", unit: "cm" | "deg",
  planValue: number,            // value the model uses now
  measured?: number,            // your tape-measure result
  from?: [x, y, z], to?: [x, y, z],   // dimension line shown in the app
  refs?: elementId[] }          // elements the check is about (highlighted in the app)
```

`docs/measurement-checklist.md` is generated from these (`npm run checklist`).

## Applying tape measurements (workflow for GHCP)

1. Put the measured value into `measured` of the check.
2. Correct the geometry it refers to (`refs`). Move wall centre lines and opening positions so that the
   **clear** dimension matches, and keep connected walls joined.
3. Set the corrected values' provenance to `source: "measured"`, `confidence: "high"` (use `fields` for single
   properties).
4. Measured values always win. If a value deviates more than 3 cm from the plan, review the neighbouring values
   for a systematic offset. Room areas may then drift from the printed areas; that is reported as a warning only.
5. Run `npm run validate`, `npm test` and `npm run checklist`, and check the result in the app with the plan underlay.

Railing bars: for the Juliet railings, set `barSpacing` / `barWidth` / `barThickness` in each window's `railing`. For a
balcony railing, change the `bars` part (it is the first bar; `repeatAround` adds the others). Its `size` is the bar
section, `repeatAround.count` = round(arc length at the bar radius r ÷ spacing) and `repeatAround.step` = the rails'
`arc` ÷ `count`. The first bar's angle is a = the rails' `rotation.y` + `step` / 2. Set the part's `rotation.y` = a
and its `position` x / z = r·cos a / r·sin a.

`tools/floorplan/build_apartment.py` regenerates the file from the PDF, but it refuses to overwrite measured data
without `--force`. After measuring, edit `data/apartment.json` directly.

## `data/materials.json`

```ts
{ schemaVersion: 1,
  presets: [{
    id: "<group>.<name>",        // e.g. "wood.oak-natural"; the group is used for material choices
    name: string,
    color: "#RRGGBB",
    roughness?: 0..1, metalness?: 0..1, opacity?: 0..1,
    emissive?: "#RRGGBB", emissiveIntensity?: number,
    pattern?: { type: "wood-grain" | "planks" | "tiles" | "weave" | "noise",
                color2: "#RRGGBB", scale: number /* cm per repeat */, strength?: 0..1 },
    texture?: { map: "data/textures/….jpg", normalMap?: string, repeat: number /* cm */ }
  }] }
```

Patterns are generated in the browser at real-world scale (a 60 cm tile is 60 cm), so no image files are needed.
Groups in use: `paint`, `floor`, `kitchen`, `door`, `frame`, `glass`, `ceramic`, `metal`, `wood`, `lacquer`,
`fabric`, `leather`. New presets and groups can be added freely. Unknown ids show an issue with suggestions and fall
back to neutral grey. Catalogue items offer presets per material slot, by id or by group (`"fabric.*"`).

## `layouts/*.json`

A layout is the furniture placed in the apartment. The app writes it; you (or GHCP) can read and edit it too.

```ts
{
  $schema?: "../schemas/layout.schema.json",
  schemaVersion: 1,
  name: string,
  description?: string,
  createdFrom?: string,            // the layout this one was duplicated from (Phase 4)
  updatedAt?: string,              // ISO time, set by the app on every save
  surfaces?: {                     // wall colours and floors (Phase 4)
    walls?: { rooms?: { [roomId]: presetId }, faces?: { ["<wallId>:left|right"]: presetId } },
    floors?: { [roomId]: presetId }
  },
  items: [{
    uid: string,                   // unique in the layout, e.g. "sofa-3-seater-1"
    item: string,                  // catalogue id
    label?: string,
    position: [x, z],              // plan position of the item's origin (bottom centre), cm
    rotation: number,              // degrees, clockwise seen from above; 0 = front faces +z (down the plan)
    elevation?: number,            // wall items: floor to the bottom edge (default: the item's defaultElevation)
    parent?: { uid, surface },     // stands on surface #surface of another item (Phase 3); position and
                                   // rotation are then relative to that item
    materials?: { [slot]: presetId | "@original" },   // only slots that differ from the catalogue default
    locked?: boolean,              // can't be moved, rotated or deleted
    hidden?: boolean
  }]
}
```

How the app treats the file:

- **Autosave.** Every change is written about half a second later. `default.json` is created by the first change.
  The file is formatted for reading and diffing: stable key order, values rounded to 0.1 cm and 0.1°, and each
  placed item on a single line when it fits into 120 characters.
- **Edited outside the app.** The app reloads it within about a second. Local changes that weren't saved yet are
  dropped in favour of the file. This also holds if the file changes just before an autosave: every save names the
  version of the file it is based on, and the server refuses it (409) if the file on disk is a different one.
- **Broken file.** The app reports it in **Issues** and pauses editing until the file is valid again, so it never
  overwrites your edit.
- **Unknown item or material.** A placed item whose catalogue id doesn't exist (any more) is kept and shown as a red
  box. A material that isn't allowed (any more) falls back to the slot's default. Both are listed as warnings.

## Local file API

`server/localFsApi.ts` is the only code that touches the disk. It runs inside the Vite dev server.

| Request | Result |
|---|---|
| `GET /api/files?dir=data\|catalogue\|layouts` | All `.json` files in the folder (recursive) with their text and modification time, plus `assets`: the other files (models, textures) with size and time |
| `PUT /api/layouts/<name>.json` | Writes a layout atomically (temporary file, then rename). Only layout file names, at most 1 MB, not from other websites. With the `x-layout-base` header (the app always sends it) only if the file on disk is one of the listed versions, otherwise `409`. Writes to the same file are applied one after another |
| `GET /vendor/draco/…`, `/vendor/basis/…` | The Draco and KTX2 decoders that ship with three.js, for compressed GLB models |

Images and 3D models (`/data/…`, `/catalogue/…`) are served by Vite itself from the repository folder. Changes on
disk are pushed to the app as `fs:change` events over Vite's HMR connection; the app then re-reads the folder.
