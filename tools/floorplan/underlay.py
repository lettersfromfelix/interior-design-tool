#!/usr/bin/env python3
"""Render the floor-plan underlay image (cropped to the apartment, without the address header).

    python tools/floorplan/underlay.py

Writes data/underlay/floorplan.png (committed) and tools/floorplan/out/underlay.json, which
build_apartment.py copies into data/apartment.json -> "underlay" (image placement in model cm).
"""
from __future__ import annotations

import json

import fitz
from PIL import Image

from pdfgeom import ORIGIN_PT, REPO, load_plan

CLIP_PT = (118.0, 186.0, 548.0, 500.0)  # apartment + a margin; excludes header text and footer notes
DPI = 600


def main():
    plan = load_plan()
    K = plan.pt_to_cm
    clip = fitz.Rect(*CLIP_PT)
    pix = plan.page.get_pixmap(dpi=DPI, clip=clip, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    img = img.quantize(colors=48, method=Image.Quantize.MEDIANCUT)
    out = REPO / "data" / "underlay" / "floorplan.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)
    x_cm = (CLIP_PT[0] - ORIGIN_PT[0]) * K
    z_cm = (CLIP_PT[1] - ORIGIN_PT[1]) * K
    meta = {
        "image": "data/underlay/floorplan.png",
        "x": round(x_cm, 2),
        "z": round(z_cm, 2),
        "widthCm": round((CLIP_PT[2] - CLIP_PT[0]) * K, 2),
        "heightCm": round((CLIP_PT[3] - CLIP_PT[1]) * K, 2),
        "rotation": 0,
        "defaultOpacity": 0.5,
    }
    (REPO / "tools" / "floorplan" / "out").mkdir(parents=True, exist_ok=True)
    (REPO / "tools" / "floorplan" / "out" / "underlay.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {out.relative_to(REPO)} {img.size[0]}x{img.size[1]} px ({out.stat().st_size // 1024} KB), "
          f"{img.size[0] / meta['widthCm']:.2f} px/cm, placement {meta}")


if __name__ == "__main__":
    main()
