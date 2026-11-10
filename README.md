# Apartment planner

A small 3D interior planning tool for one specific apartment (Wohnung 33, 3.5 Zimmer).
The apartment is fixed data. Furniture and layouts are data files too, so new pieces can be added without touching
the code: see [CATALOGUE.md](CATALOGUE.md).

It runs on this laptop (`npm start`), and the same app is published as a website:
**https://lettersfromfelix.github.io/interior-design-tool/**. There is no backend service, no account and no
network access at runtime.

## Start

You need [Node.js](https://nodejs.org) 22.12 or newer.

```powershell
npm install   # once
npm start     # opens http://127.0.0.1:5180 in the browser
```

After a fresh clone, the floor-plan underlay (2D) is missing: it is made from the private plan and not in git. To
get it back, put the plan at `reference/floorplan.pdf` and run `python tools/floorplan/underlay.py` (see
[tools/floorplan/README.md](tools/floorplan/README.md)). Without it, everything else works and the toggle is hidden.

## The website

https://lettersfromfelix.github.io/interior-design-tool/ is the same app, built from `main`. Every push to `main`
starts the **Website** workflow (`.github/workflows/pages.yml`): it validates the data, runs the tests, the type
check and the linter, builds the site and publishes it on GitHub Pages, usually within a few minutes (progress in the
repository's **Actions** tab). If a check fails, the previous version stays online.

|  | Locally (`npm start`) | Website |
|---|---|---|
| **Layouts** | the files in `layouts/`, saved automatically | the layouts in `layouts/` come with it as starting points; your changes and new layouts are kept in this browser automatically (per browser and device) |
| **Save** | automatic, to the file | **⤓ Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) downloads the layout as a JSON file |
| **Open file…** (layout menu) | copies a layout file into `layouts/` | adds a layout file to the layouts in this browser |
| **Reset…** | | drops this browser's changes to a layout that came with the website |
| **New furniture or data** | appears within a second | appears after a push to `main` and the rebuild |
| **Plan underlay** | yes, if the image was made (see above) | no: it is never published |

**Sharing layouts as files.** On the website, **⤓ Save** downloads the open layout, e.g. `inspiration.json`. Send
the file to anyone: they open it with **Open file…** in the layout menu, on the website or in the local tool, which
copies it into `layouts/` (or put it into `layouts/` yourself). To publish a layout for everyone, put the file into
`layouts/`, commit and push to `main`. Clearing the browser's site data deletes the layouts kept there, so save the
ones you want to keep.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Apartment geometry from the floor plan, 2D + 3D views, plan underlay, verification | **done**, waiting for tape measurements |
| 2 | Furniture catalogue (parametric + GLB), drag and drop, move/rotate/delete, materials | **done** |
| 3 | Snapping, collisions, measurements, stacking, wall items, undo/redo | **done** |
| 4 | Layouts (save, switch, duplicate, compare), wall colours and floors, first-person walk, daylight, doors | **done** |
| 5 | `CATALOGUE.md`, Copilot instructions, starter catalogue, demo layout | **done** |

## Using the tool

| | |
|---|---|
| **Views** | **2D**, **3D** and **Walk** in the toolbar; <kbd>Tab</kbd> switches between 2D and 3D. Each view keeps its own camera. |
| **Navigate** | 2D: drag to pan, wheel to zoom. 3D: drag to orbit, right-drag to pan, wheel to zoom. <kbd>F</kbd> or **Fit** shows the whole apartment. |
| **Walk** | First person at eye height, starting just inside the entrance. <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> walk, the arrow keys turn and look up or down, <kbd>Shift</kbd> runs. Click into the view to look around with the mouse; <kbd>Esc</kbd> frees the mouse, a second <kbd>Esc</kbd> leaves. Walls, closed doors and fixtures stop you, furniture only with **Bump into furniture**. The bar at the bottom also sets the eye height. |
| **Furniture** | **☰ Furniture** shows or hides the catalogue on the left, with search and categories. **Placed** lists everything in the layout. |
| **Place** | Drag a card into the view. Or click a card, then click into the view: the preview follows the pointer, <kbd>R</kbd> turns it, <kbd>Esc</kbd> cancels. |
| **Move** | Click an item to select it and drag it. Arrow keys nudge it by 1 cm (with <kbd>Shift</kbd> 10 cm). <kbd>Esc</kbd> during a drag cancels it. |
| **Rotate** | Drag the blue ring around the selected item (with **15° steps** on: 15° steps; <kbd>Shift</kbd> 90°, <kbd>Alt</kbd> free). The dot on the ring marks the item's front. Keys: <kbd>R</kbd> / <kbd>Shift</kbd>+<kbd>R</kbd> ±90°, <kbd>E</kbd> / <kbd>Q</kbd> ±15°. |
| **Stack** | Drop a lamp or another `onTop` item onto a sideboard, a table or a shelf board: it stands on it and moves with it. |
| **Wall items** | Shelves, pictures and the TV hang on the nearest wall. Set their height in **Inspect**. |
| **Duplicate / delete** | <kbd>Ctrl</kbd>+<kbd>D</kbd> / <kbd>Del</kbd>, or the buttons in **Inspect**; what stands on the item comes along. **Lock** protects an item from changes, **Hide** hides it (show it again from **Placed**). |
| **Undo / redo** | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>, or ↶ ↷ in the toolbar: every change to the layout, including materials, colours and doors. Each layout has its own history while the app runs. |
| **Placement aids** | The bar at the bottom of the view (at the bottom of the page on narrow screens): **Wall snap** (back flush to a wall, into corners), **Grid** and its size, **15° steps**, **Collisions** *Off* / *Warn* (red overlaps, amber warnings) / *Block* (items stop at walls, fixtures and other items), **Distances** to the nearest wall, fixture or item while moving, and **Clearance** zones. Every setting is remembered. |
| **Tape measure** | **📏 Measure** or <kbd>M</kbd>, then click two points, in 2D or 3D. It snaps to corners, edges and midpoints; <kbd>Shift</kbd> keeps the line straight, <kbd>Alt</kbd> turns snapping off. The lines stay until **Clear**. |
| **Materials** | **Inspect** shows the selected item's material slots (e.g. upholstery, legs) with the colours and materials its catalogue entry allows. Click a swatch. |
| **Position** | **Inspect** also takes exact values: x, z, rotation, and the height of wall items. Sizes come from the catalogue only. |
| **Doors** | Click a door. Its slider in **Inspect** shows it closed, ajar or open: the interior doors up to 180°, unless a wall stops them first; the balcony doors and the entrance door up to 90°. Only how the door is shown, saved with the layout. Furniture in a door's swing gets a warning. |
| **Colours and floors** | Click a room to choose its wall colour and floor for this layout, or a wall for the colour of that side. |
| **Daylight** | **☀ Daylight**: sunlight through the windows on a date (or today) and at a time of day, from the apartment's real orientation. |
| **Layouts** | The layout menu (▤ and the layout's name): open another layout, **New…**, **Duplicate…** (start a variant from the open one), **Rename…**, **Delete…** (moves it to `layouts/.trash/`), **Open file…** (add a layout file, see [the website](#the-website)), and **Compare**: a second layout side by side, read-only, with the cameras linked. |
| **Saving** | Every change is saved to the open layout's file in `layouts/` within a second (status top right). If the file changes on disk it is reloaded. If it is broken, editing pauses until it's fixed, so it is never overwritten. On the website, changes are kept in the browser instead, and **⤓ Save** downloads the layout. |
| **Plan underlay** | 2D only, local only. Shows the original floor plan with adjustable opacity, to check that the derived walls, doors and windows sit on its lines. |
| **Inspect** | Click a room, wall, door, window, fixture or piece of furniture to see its data. <kbd>Esc</kbd> clears the selection. **Inspect ☰** in the toolbar shows or hides the panel (with the number of issues while it's hidden). |
| **Verify** | Room areas compared with the printed areas, the tape-measure checklist (click an item to see a magenta dimension line for exactly what to measure), and all uncertain values. |
| **Issues** | Problems found in the data, catalogue and layout files, with file, property path and a hint. |

Data, catalogue and layout files are reloaded automatically when they change on disk. A broken file shows an error
and does not crash the app. `layouts/demo.json` is an example layout that shows every kind of item.

### Keyboard

| Key | 2D and 3D | Walk |
|---|---|---|
| <kbd>Tab</kbd> | switch between 2D and 3D | back to 3D |
| <kbd>F</kbd> | show the whole apartment | back to the entrance |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | | walk forwards, left, back, right |
| Arrow keys | nudge the selected item 1 cm (<kbd>Shift</kbd>: 10 cm) | turn left and right, look up and down |
| <kbd>Shift</kbd> | | run |
| <kbd>R</kbd> / <kbd>Shift</kbd>+<kbd>R</kbd>, <kbd>E</kbd> / <kbd>Q</kbd> | rotate ±90°, ±15° | |
| <kbd>Del</kbd>, <kbd>Ctrl</kbd>+<kbd>D</kbd> | delete, duplicate | |
| <kbd>M</kbd> | tape measure | |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd> | undo, redo | undo, redo |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | website: download the layout (**⤓ Save**) | |
| <kbd>Esc</kbd> | cancel placing, a drag or a measurement; clear the selection | free the mouse; again: leave |

## Commands

| Command | What it does |
|---|---|
| `npm start` | Start the tool and open the browser |
| `npm run build` | Build the website into `dist/` (what the **Website** workflow publishes) |
| `npm run preview` | Serve the last build at http://127.0.0.1:5181/interior-design-tool/, to check it before pushing |
| `npm run validate` | Validate all data, catalogue and layout files with the same rules as the app; non-zero exit on errors |
| `npm test` | Unit tests (Vitest), including checks against the real data files and the examples in `CATALOGUE.md` |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint, including the architecture rules below |
| `npm run schemas` | Regenerate `schemas/*.schema.json` from the Zod schemas |
| `npm run checklist` | Regenerate `docs/measurement-checklist.md` from `data/apartment.json` |
| `npm run make-example-glb` | Rebuild `catalogue/example-stool-glb/model.glb`, the GLB example made from primitives |

## Folder structure

```text
CATALOGUE.md            how to add furniture (format, placement types, material slots, examples)
.github/
  copilot-instructions.md  conventions for GHCP: furniture only in catalogue/, units, coordinates, validation
  workflows/pages.yml   checks, builds and publishes the website on every push to main
data/
  apartment.json        the fixed apartment: rooms, walls, doors, windows, kitchen, built-ins (+ provenance)
  materials.json        material presets (colours, wood, fabric, metal, paint, floors, …)
  underlay/             LOCAL ONLY (gitignored): floorplan.png for the 2D underlay, made by tools/floorplan/underlay.py
catalogue/              furniture, one item per file (or per folder with its 3D model) – see CATALOGUE.md
layouts/
  *.json                one file per layout, autosaved; tracked in git and shipped with the website
  demo.json             an example layout
  .trash/               deleted layouts (git-ignored)
schemas/                GENERATED JSON Schemas for editor validation – don't edit
docs/
  DATA.md               data formats, units and coordinate system, the file API and the website build
  measurement-checklist.md  what to measure on site
reference/              LOCAL ONLY (gitignored): the original floor plan PDF and photos
server/
  localFsApi.ts         Vite plugin: the local file API (the only code that touches the disk at runtime)
  staticSite.ts         Vite plugin for the website build: lists the data folders and copies models and decoders
src/
  core/                 pure TypeScript: schemas, validation, layout commands, placement, geometry, sun, walking
  data/                 loads the data folders (file API locally, build listings + browser storage on the website), validates, saves layouts
  state/                Zustand store (data, catalogue, layout, history, view, selection, preferences)
  engine/               Three.js: builders, furniture and 3D models, interaction, materials, views, overlays, light
  ui/                   React panels and toolbars
tools/
  validate.ts, gen-schemas.ts, gen-checklist.ts, make-example-glb.ts, docs.test.ts
  floorplan/            dev-only Python scripts that derived the apartment (and the underlay) from the PDF
```

## Architecture

```mermaid
flowchart LR
  D[data/ · catalogue/ · layouts/] --> API[server/localFsApi.ts<br/>npm start]
  D --> B[server/staticSite.ts<br/>website build]
  API --> R[src/data<br/>parse + validate]
  B --> R
  R --> S[src/state<br/>store]
  S <--> E[src/engine<br/>Three.js]
  S <--> U[src/ui<br/>React]
  R --> K[src/core]
  E --> K
```

The most important property is the strict separation between the engine, the apartment data, the catalogue data
and the layout data:

- Data files are never imported by the code. They are fetched at runtime, validated, and every problem becomes an
  entry in the Issues panel. Locally they come through the local file API (`GET /api/files?dir=…`); on the website
  from listings of the same folders that the build makes (`files/<dir>.json`). `src/data/fileBackend.ts` is the seam
  between the two.
- The engine contains no room, wall or item ids. Everything it draws comes from the data. Furniture is built from
  its catalogue entry only, so adding an item never needs a code change.
- ESLint enforces the layers: nothing in `src/` may import data files (`.json`, 3D models, images), `src/core` may
  not import Three.js or React, and the engine may not import React.

**Why this stack.** Vite + TypeScript + Three.js run in the browser with one command and no packaging. React is
used only for panels. Zod schemas give runtime validation, TypeScript types and the generated JSON Schemas from
one definition. A tiny Vite plugin serves the data folders and pushes file changes. Unlike the File System Access
API it works in every browser, never asks for permission, can list folders for auto-discovery, and sees edits made
by GHCP immediately.

**Saving.** The same plugin has exactly two write endpoints, both for layouts only: `PUT /api/layouts/<name>.json`
writes a layout and `DELETE` moves one to `layouts/.trash/`. They accept only layout file names (writes at most
1 MB), reject requests from other websites (Origin check), and write atomically (a temporary file, then a rename),
so a crash can't leave a half-written layout. Each request names the version of the file it is based on and is
refused if the file was changed outside the app in the meantime, so an edit by you or GHCP is never overwritten.

**The website.** GitHub Pages serves only static files, so `npm run build` makes the app static: the data folders are
listed at build time, and layouts are kept in the browser's `localStorage` with the same version check (one tab
never overwrites another's change). Downloads and **Open file…** move layouts between the website, other people and
the local tool. Details in [docs/DATA.md](docs/DATA.md#the-website-static-build).

## Privacy

The original floor plan and the photos contain the street address and the apartment's interior. They stay in
`reference/`, which is gitignored, and so does the underlay image made from the plan (`data/underlay/`); the website
build never includes it. The repository is public. Finishes seen in the photos (the stone floor, the tiles, the
paint colours) are recreated as procedural patterns and colour values in `data/materials.json`; no photo, crop of
one or texture made from one is committed.
