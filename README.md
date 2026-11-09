# Apartment planner

A small, local 3D interior planning tool for one specific apartment (Wohnung 33, 3.5 Zimmer).
The apartment is fixed data. Furniture and layouts are data files too, so new pieces can be added without touching
the code: see [CATALOGUE.md](CATALOGUE.md).

It runs only on this laptop: there is no hosting, no backend service, no account and no network access at runtime.

## Start

You need [Node.js](https://nodejs.org) 22 or newer.

```powershell
npm install   # once
npm start     # opens http://127.0.0.1:5180 in the browser
```

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Apartment geometry from the floor plan, 2D + 3D views, plan underlay, verification | **done**, waiting for tape measurements |
| 2 | Furniture catalogue (parametric + GLB), drag and drop, move/rotate/delete, materials | **done** |
| 3 | Snapping, collisions, measurements, stacking, wall items, undo/redo | next |
| 4 | Layouts (save/compare), wall and floor colours, first-person walk, daylight | |
| 5 | `CATALOGUE.md` final, Copilot instructions, full starter catalogue | |

## Using the tool

| | |
|---|---|
| **2D / 3D** | Toolbar buttons or <kbd>Tab</kbd>. 2D is a top-down plan, 3D an orbit view. Each view keeps its own camera. |
| **Navigate** | 2D: drag to pan, wheel to zoom. 3D: drag to orbit, right-drag to pan, wheel to zoom. <kbd>F</kbd> or **Fit** shows the whole apartment. |
| **Furniture** | **☰ Furniture** shows or hides the catalogue on the left, with search and categories. **Placed** lists everything in the layout. |
| **Place** | Drag a card into the view. Or click a card, then click into the view: the preview follows the pointer, <kbd>R</kbd> turns it, <kbd>Esc</kbd> cancels. |
| **Move** | Click an item to select it and drag it. Arrow keys nudge it by 1 cm (with <kbd>Shift</kbd> 10 cm). <kbd>Esc</kbd> during a drag cancels it. |
| **Rotate** | Drag the blue ring around the selected item (<kbd>Shift</kbd>: 15° steps). The dot on the ring marks the item's front. Keys: <kbd>R</kbd> / <kbd>Shift</kbd>+<kbd>R</kbd> ±90°, <kbd>E</kbd> / <kbd>Q</kbd> ±15°. |
| **Duplicate / delete** | <kbd>Ctrl</kbd>+<kbd>D</kbd> / <kbd>Del</kbd>, or the buttons in **Inspect**. **Lock** protects an item from changes, **Hide** hides it (show it again from **Placed**). |
| **Materials** | **Inspect** shows the selected item's material slots (e.g. upholstery, legs) with the colours and materials its catalogue entry allows. Click a swatch. |
| **Position** | **Inspect** also takes exact values: x, z, rotation, and the height of wall items. Sizes come from the catalogue only. |
| **Saving** | Every change is saved to `layouts/default.json` within a second (status top right). If the file changes on disk it is reloaded. If it is broken, editing pauses until it's fixed, so it is never overwritten. |
| **Plan underlay** | 2D only. Shows the original floor plan over the model with adjustable opacity, to check that the derived walls, doors and windows sit on its lines. |
| **Inspect** | Click a room, wall, door, window, fixture or piece of furniture to see its data. <kbd>Esc</kbd> clears the selection. |
| **Verify** | Room areas compared with the printed areas, the tape-measure checklist (click an item to see a magenta dimension line for exactly what to measure), and all uncertain values. |
| **Issues** | Problems found in the data, catalogue and layout files, with file, property path and a hint. |

Data, catalogue and layout files are reloaded automatically when they change on disk. A broken file shows an error
and does not crash the app.

Phase 2 limits: lamps and other `onTop` items stand on the floor until stacking arrives, wall items aren't snapped
to walls yet (move them there and set their height), and there is no undo yet. Phase 3 adds all three.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Start the tool and open the browser |
| `npm run validate` | Validate all data, catalogue and layout files with the same rules as the app; non-zero exit on errors |
| `npm test` | Unit tests (Vitest), including checks against the real data files |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint, including the architecture rules below |
| `npm run schemas` | Regenerate `schemas/*.schema.json` from the Zod schemas |
| `npm run checklist` | Regenerate `docs/measurement-checklist.md` from `data/apartment.json` |
| `npm run make-example-glb` | Rebuild `catalogue/example-stool-glb/model.glb`, the GLB example made from primitives |

## Folder structure

```text
CATALOGUE.md            how to add furniture (format, placement types, material slots, examples)
data/
  apartment.json        the fixed apartment: rooms, walls, doors, windows, kitchen, built-ins (+ provenance)
  materials.json        material presets (colours, wood, fabric, metal, …)
  underlay/floorplan.png  cropped floor plan without the address header, for the 2D underlay
catalogue/              furniture, one item per file (or per folder with its 3D model) – see CATALOGUE.md
layouts/
  default.json          the current layout, autosaved (created on the first change; named layouts in Phase 4)
schemas/                GENERATED JSON Schemas for editor validation – don't edit
docs/
  DATA.md               data formats, units and coordinate system
  measurement-checklist.md  what to measure on site
reference/              LOCAL ONLY (gitignored): the original floor plan PDF and photos
server/localFsApi.ts    Vite plugin: the local file API (the only code that touches the disk)
src/
  core/                 pure TypeScript: schemas, validation, layout commands, geometry (no Three.js, no React)
  data/                 loads the data folders through the file API, validates, reports issues, autosaves the layout
  state/                Zustand store (data, catalogue, layout, view, selection, preferences)
  engine/               Three.js: builders, furniture and 3D models, interaction, materials, views, overlays
  ui/                   React panels and toolbar
tools/
  validate.ts, gen-schemas.ts, gen-checklist.ts, make-example-glb.ts
  floorplan/            dev-only Python scripts that derived the apartment from the PDF
```

## Architecture

```mermaid
flowchart LR
  D[data/ · catalogue/ · layouts/] --> API[server/localFsApi.ts]
  API --> R[src/data<br/>parse + validate]
  R --> S[src/state<br/>store]
  S <--> E[src/engine<br/>Three.js]
  S <--> U[src/ui<br/>React]
  R --> K[src/core]
  E --> K
```

The most important property is the strict separation between the engine, the apartment data, the catalogue data
and the layout data:

- Data files are never imported by the code. They are fetched at runtime through the local file API
  (`GET /api/files?dir=…`), validated, and every problem becomes an entry in the Issues panel.
- The engine contains no room, wall or item ids. Everything it draws comes from the data. Furniture is built from
  its catalogue entry only, so adding an item never needs a code change.
- ESLint enforces the layers: nothing in `src/` may import data files (`.json`, 3D models, images), `src/core` may
  not import Three.js or React, and the engine may not import React.

**Why this stack.** Vite + TypeScript + Three.js run in the browser with one command and no packaging. React is
used only for panels. Zod schemas give runtime validation, TypeScript types and the generated JSON Schemas from
one definition. A tiny Vite plugin serves the data folders and pushes file changes. Unlike the File System Access
API it works in every browser, never asks for permission, can list folders for auto-discovery, and sees edits made
by GHCP immediately.

**Saving.** The same plugin has exactly one write endpoint, `PUT /api/layouts/<name>.json`. It accepts only layout
file names and at most 1 MB, rejects requests from other websites (Origin check), and writes atomically (a
temporary file, then a rename), so a crash can't leave a half-written layout. Each save names the version of the
file it is based on and is refused if the file was changed outside the app in the meantime, so an edit by you or
GHCP is never overwritten.

## Privacy

The original floor plan and the photos contain the street address and the apartment's interior. They stay in
`reference/`, which is gitignored. Only the cropped underlay without the address header is committed.
