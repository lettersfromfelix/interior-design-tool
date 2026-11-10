# Floor-plan extraction (dev-only)

These scripts derive `data/apartment.json` and the underlay image from the original floor plan
PDF. They are only needed if the apartment geometry has to be re-derived from scratch. Normal
corrections (for example tape measurements) are made directly in `data/apartment.json`.

Requirements: Python 3.12 with PyMuPDF (`fitz`), Pillow and numpy. The PDF itself is
**local-only**: copy it to `reference/floorplan.pdf`. It is gitignored because it contains the
street address. The underlay image made from it, `data/underlay/floorplan.png`, is gitignored as
well and never published; after a fresh clone, run `underlay.py` once to get the **Plan underlay**
toggle back in the 2D view (without the image the toggle is hidden).

```powershell
python tools/floorplan/underlay.py          # data/underlay/floorplan.png (cropped, no address; local only) + out/underlay.json
python tools/floorplan/build_apartment.py   # data/apartment.json (refuses to overwrite measured data unless --force)
python tools/floorplan/preview.py           # out/apartment_preview.png: the JSON drawn over the underlay
```

## How the geometry is derived

The PDF is a vector drawing (CAD export) at **1:100**. The script `pdfgeom.py` reads its paths with
PyMuPDF and sorts them by drawing style.

| Plan element | Drawing style | Used for |
|---|---|---|
| Room fills | blue-grey `(0.706, 0.804, 0.82)` | room outlines + printed areas |
| Wall poche | white fills with a 0.99 pt outline | walls (cut at window height) |
| Medium lines | 0.43 pt | doors (arcs = swing), windows (sash arcs), kitchen, sanitary, railings |
| Hairlines | 0.06 pt | furniture suggestion; ignored |
| Scale bar | 0.28 pt | calibration (ticks at 0/1/2.5/5 m → 28.346 pt/m, residual < 0.01 pt) |
| North arrow | 1.42 pt needle | `north.planUpBearing` (≈ 49°) |

Room outlines follow the Swiss BWF convention. Interior walls are drawn at their **centre
line**. Exterior and party walls are drawn at their **inner face**.

`walls.py` and `walls_build.py` build the walls in these steps:

1. Walk along every room-outline edge and cast rays into the wall poche, on both sides of the
   edge, every 1 cm.
2. Turn runs of constant poche depth into wall pieces. Thickness is `tp + tm` and the centre-line
   offset is `(tp − tm) / 2`.
3. Bridge door gaps that have a swing arc next to them. These become door openings, and the
   swing side and hinge come from the arc.
4. Merge collinear pieces with the same thickness. Then extend the ends through corners and
   T-junctions, and split each wall wherever the room on one of its sides changes.
5. Create façade and balcony glazing walls (assumed 12 cm deep) along outline edges that have no
   poche but do have sash or balcony-door arcs.

`fixtures.py` builds the fixed elements:

- the kitchen, built-in wardrobe, column and sanitary fixtures, from their exact rectangles in
  the PDF;
- the two shafts (outline notches);
- the round balconies, by fitting a RANSAC circle to the railing.

`checklist.py` creates the tape-measure checklist (`checks` in `apartment.json`, M01…M32).

## Confidence

Every element carries `provenance`. What is read from the plan's vector geometry is `high`.
Interpretations of plan symbols are `medium`. Heights and finishes, which the plan doesn't
contain, are `low` until measured.
