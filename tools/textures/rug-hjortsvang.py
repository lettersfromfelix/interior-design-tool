"""
python tools/textures/rug-hjortsvang.py — writes the texture of the rug preset rug.hjortsvang-off-white (IKEA's
HJORTSVANG rug): data/textures/rug-hjortsvang.jpg (colour) and data/textures/rug-hjortsvang-normal.jpg (normal map).
Generated from code alone, no photo pixels: only the sizes and colours below were measured off IKEA's product photos.

Requirements: Python 3.12 with numpy and Pillow (as for tools/floorplan).

The rug's surface is rows of thick, undyed wool braided across its width, one row after the other along its length.
Each row is a braid of two passes of slanted lobes: the upper pass slants down to the right, the lower one up to the
right, so the two meet along the row's middle in chevrons, like a plait. The lobes rise towards that middle and dive
at the row's edges, where deep grooves part the rows. On IKEA's photo of the whole rug the rows are 3.54 cm apart and
the lobes 1.95 cm; here they are 230 / 64 = 3.59 cm and 1.98 cm, so that the rug's ends fall between two rows.

One square tile, TILE cm on a side, repeats over the rug: `texture.repeat` of the preset in data/materials.json must
be TILE. Textures are mapped in cm from the middle of a part (see src/engine/builders/uv.ts), and the rug's ends lie
2 tiles from its middle. In the image the rows run left to right (along the rug's width, x) and are stacked
downwards; the image's top is the rug's back (-z). The normal map uses the OpenGL convention (green up), as three.js
expects; it is a JPEG at quality 95, half the size of a PNG and less than 2° off on average. The colour holds a little
shading in the grooves, so the relief reads under any light.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "data" / "textures"

# ---- sizes (cm) ----
RUG_LENGTH = 230
ROW = RUG_LENGTH / 64  # a braid row
ROWS = 16  # rows per tile
TILE = ROWS * ROW  # 57.5 cm
LOBES = 29  # lobes per pass and row, per tile
PITCH = TILE / LOBES  # 1.98 cm
N = 1024  # px per tile side
PX = TILE / N  # cm per px
THETA = np.radians(38)  # the lobes' slant from the row
HALF = ROW / 2  # one pass
LENGTH = 1.15 * HALF / np.sin(THETA)  # a lobe, along its slant: across its pass and a little beyond
WIDTH = 1.1 * PITCH * np.sin(THETA)  # across its slant: it touches its neighbours
LOBE_HEIGHT = 0.75
GAMMA = 0.55  # the lobes' cross-section: (1 - r²)^GAMMA, plump with steep flanks
TIPS = 3  # the lobes' ends: blunt (2 would be an ellipse)
RISE = 0.35  # how much higher a lobe is towards the row's middle than at its own middle
DIP = 0.45  # how much lower the braid is at its edges than in its middle
SOFT = 1.0  # px: the creases' softness
STRENGTH = 0.8  # the normal map's slopes, as a share of the relief's

# ---- colour (sRGB) ----
WOOL = np.array([248.0, 240.0, 228.0])  # undyed wool, lit
FIBRES = np.array([128.0, 119.0, 109.0])  # the darker grey-brown fibres in some lobes
GROOVE = 0.8  # the colour in the deepest grooves, as a share of the lit colour
STREAKS = 0.12  # the share of lobes with darker fibres


def periodic_blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian blur (sigma in px) that wraps round the tile's edges."""
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.fftfreq(a.shape[1])[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx**2 + fy**2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def streaky_noise(rng: np.random.Generator, angle: float, along_px: float, across_px: float) -> np.ndarray:
    """Tileable noise, smooth along `angle` (radians, x right, y down) and fine across it: fibres. Mean 0, std 1."""
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.fftfreq(N)[None, :]
    f_along = fx * np.cos(angle) + fy * np.sin(angle)
    f_across = -fx * np.sin(angle) + fy * np.cos(angle)
    g = np.exp(-2 * np.pi**2 * ((f_along * along_px) ** 2 + (f_across * across_px) ** 2))
    a = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((N, N))) * g))
    return (a - a.mean()) / a.std()


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def build(seed: int):
    rng = np.random.default_rng(seed)
    height = np.zeros((N, N))  # the lobes, before the braid's dip (cm)
    owner = np.full((N, N), -1)  # the lobe on top
    across = np.zeros((N, N))  # where across that lobe (-1..1)
    passes, shade, warmth, streak = [], [], [], []
    for row in range(ROWS):
        phase = rng.uniform(0, PITCH)  # rows don't line up
        for p, sign in ((0, 1), (1, -1)):
            middle = row * ROW + (0.53 if p == 0 else 1.47) * HALF  # both passes reach a little past the row's middle
            for k in range(LOBES):
                lobe = len(passes)
                passes.append(p)
                shade.append(1 + rng.normal(0, 0.025))
                warmth.append(rng.normal(0, 1))
                streak.append((rng.uniform(-0.6, 0.6), rng.uniform(0.12, 0.3), rng.uniform(0.25, 0.55)) if rng.random() < STREAKS else None)
                sc = phase + p * PITCH / 2 + k * PITCH + rng.normal(0, 0.06) * PITCH
                tc = middle + rng.normal(0, 0.04) * HALF
                th = sign * (THETA + np.radians(rng.normal(0, 3)))
                half_l = LENGTH / 2 * (1 + rng.normal(0, 0.06))
                half_w = WIDTH / 2 * (1 + rng.normal(0, 0.06))
                h0 = LOBE_HEIGHT * (1 + rng.normal(0, 0.08))
                ex = abs(half_l * np.cos(th)) + abs(half_w * np.sin(th))
                et = abs(half_l * np.sin(th)) + abs(half_w * np.cos(th))
                js = np.arange(int(np.floor((sc - ex) / PX)), int(np.ceil((sc + ex) / PX)) + 1)
                is_ = np.arange(int(np.floor((tc - et) / PX)), int(np.ceil((tc + et) / PX)) + 1)
                ds = (js + 0.5) * PX - sc
                dt = (is_ + 0.5) * PX - tc
                a = ds[None, :] * np.cos(th) + dt[:, None] * np.sin(th)
                b = -ds[None, :] * np.sin(th) + dt[:, None] * np.cos(th)
                r2 = np.abs(a / half_l) ** TIPS + (b / half_w) ** 2
                # towards its right end, the lobe nears the row's middle and rises
                z = h0 * np.clip(1 - r2, 0, None) ** GAMMA * (1 + RISE * a / half_l)
                ii, jj = np.ix_(is_ % N, js % N)
                win = (r2 < 1) & (z > height[ii, jj])
                height[ii, jj] = np.where(win, z, height[ii, jj])
                owner[ii, jj] = np.where(win, lobe, owner[ii, jj])
                across[ii, jj] = np.where(win, b / half_w, across[ii, jj])

    # the braid as a whole: highest along its middle, lowest at its edges
    t = (np.arange(N) + 0.5) * PX
    dip = 1 - DIP * (1 - np.cos(2 * np.pi * (t - HALF) / ROW)) / 2
    passes, shade, warmth = np.array(passes), np.array(shade), np.array(warmth)
    on = owner >= 0
    p_of = np.where(on, passes[np.maximum(owner, 0)], 0)
    # fibres along each pass's slant
    fibres_down = streaky_noise(rng, THETA, 22, 1.2)
    fibres_up = streaky_noise(rng, -THETA, 22, 1.2)
    fibres = np.where(p_of == 0, fibres_down, fibres_up)
    relief = height * dip[:, None] + 0.025 * fibres * on
    relief = periodic_blur(relief, SOFT)

    # ---- the normal map: x along +u (right), y along +v (up the image)
    d_ds = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) / (2 * PX)
    d_dt = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) / (2 * PX)
    n = np.stack([-STRENGTH * d_ds, STRENGTH * d_dt, np.ones_like(relief)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    normal = np.round((n + 1) * 127.5).clip(0, 255).astype(np.uint8)

    # ---- the colour
    o = np.maximum(owner, 0)
    colour = WOOL[None, None, :] * np.where(on, shade[o], 1)[..., None]
    colour += np.where(on, warmth[o], 0)[..., None] * np.array([2.0, 1.0, -2.0])
    dark = np.zeros((N, N))
    for lobe, s in enumerate(streak):
        if s is None:
            continue
        mid, width, depth = s
        mask = owner == lobe
        dark[mask] = depth * np.exp(-(((across[mask] - mid) / width) ** 2)) * np.clip(0.6 + 0.4 * fibres[mask], 0, 1)
    colour = colour * (1 - dark[..., None]) + FIBRES[None, None, :] * dark[..., None]
    colour *= (1 + 0.05 * fibres)[..., None]
    top = relief.max()
    ao = GROOVE + (1 - GROOVE) * smoothstep(0, 0.8 * top, relief)
    colour *= ao[..., None]
    colour *= (1 + 0.02 * rng.standard_normal((N, N)))[..., None]
    colour = np.round(colour).clip(0, 255).astype(np.uint8)
    return colour, normal, relief


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=OUT, help="folder to write to (default: data/textures)")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    colour, normal, relief = build(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    c_path, n_path = args.out / "rug-hjortsvang.jpg", args.out / "rug-hjortsvang-normal.jpg"
    Image.fromarray(colour, "RGB").save(c_path, quality=90, subsampling=0, optimize=True)
    Image.fromarray(normal, "RGB").save(n_path, quality=95, subsampling=0, optimize=True)
    mean = colour.reshape(-1, 3).mean(axis=0)
    print(f"wrote {c_path} ({c_path.stat().st_size // 1024} KB) and {n_path} ({n_path.stat().st_size // 1024} KB)")
    print(f"tile {TILE:g} cm ({N} px, {N / TILE:.1f} px per cm): {ROWS} rows of {ROW:.3f} cm, {LOBES} lobes of {PITCH:.3f} cm per pass")
    print(f"relief 0..{relief.max():.2f} cm; mean colour #{''.join(f'{round(v):02X}' for v in mean)} (the preset's swatch colour)")


if __name__ == "__main__":
    main()
