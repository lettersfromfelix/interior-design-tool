"""
python tools/textures/fabric-teddy-boucle-taupe.py — writes the texture of the fabric preset fabric.teddy-boucle-taupe
(the taupe teddy bouclé of Westwing's Wolke sofa, fabric SIC Euphoria 6): data/textures/fabric-teddy-boucle-taupe.jpg
(colour) and data/textures/fabric-teddy-boucle-taupe-normal.jpg (normal map).
Generated from code alone, no photo pixels: only the sizes and colours below were measured off Westwing's product
photo of the taupe sofa and its fabric swatch.

Requirements: Python 3.12 with numpy and Pillow (as for tools/floorplan).

Teddy bouclé is a deep, curly polyester pile: dense tufts of fibres, 0.5 to 1.2 cm across, splayed out like small fans,
their tips light and silky and the gaps between them dark. Neighbouring tufts lie the same way, and where the pile is
crushed one way or another it catches the light differently, so the fabric is mottled in soft light and dark patches,
some drawn out into streaks, from a few cm to about 20 cm across; they show clearly on the whole sofa. On Westwing's
photo of the sofa (256 cm wide, 5.3 px per cm) and its swatch (whose texture matches the sofa's at 17 px per cm) the
fabric is a muted, warm grey-brown: on average L* 48, chroma 7.5 to 9, hue 65°; the 10th and 90th percentiles of its
lightness about L* 25 and 67, and the dark parts a little warmer.

Here: tufts on a jittered grid, each a fan rising from its root to its rounded tip and lying along a direction that
turns slowly over the cloth (a few are curls, standing up); the tallest tuft wins where they overlap, so tips lie over
the roots of the next ones. The colour comes from that relief (light tips, dark gaps), the tips' sheen (more on the
tufts lying towards the image's top, and where the pile is lighter), the fibres and the mottling. It is made in CIELAB,
so that its mean, in linear light, has the lightness, chroma and hue measured above. The normal map holds the tufts.

The app's tone mapping darkens and saturates a mid-tone like this one (see albedo_of), so the colour map is that look
with the tone mapping's offset undone: lighter and greyer than the look, it renders as the look. The preset's `color`,
its swatch in the app, is the look's mean.

One square tile, TILE cm on a side, repeats over the fabric: `texture.repeat` of the preset in data/materials.json
must be TILE. Textures are mapped in cm (see src/engine/builders/uv.ts); the image's top is the item's back (-z) on top
faces and up on the sides. The normal map uses the OpenGL convention (green up), as three.js expects.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "data" / "textures"
NAME = "fabric-teddy-boucle-taupe"

# ---- sizes (cm) ----
TILE = 128  # one repeat: not close to a multiple of the Wolke's 90 and 96 cm blocks, so neighbours differ
N = 1280  # px per tile side: 10 px per cm
PX = TILE / N  # cm per px
SPACING = 0.6  # the tufts' grid
TUFT_LENGTH = (0.5, 1.1)  # from root to tip
TUFT_WIDTH = (0.6, 1.2)  # across the tip: fans, wider than long
TUFT_HEIGHT = 0.4
CURLS = 0.15  # the share of tufts standing up: round curls seen from above, their fibres fanning out all round
CURL_SIZE = (0.5, 0.9)  # their diameter
TURN = 1.5  # the size of the patches in which the tufts lie the same way
JITTER = np.radians(40)  # how much a tuft turns from its neighbours
STRANDS = 5.0  # fibre bundles across a tuft (pairs of light and dark)
SHEEN_FROM = -np.pi / 2  # tufts lying this way (towards the image's top) show the most sheen
MOTTLE = (18.0, 6.0, 8.0)  # the mottling: patches about 18 and 6 cm apart, and slow changes (blur radius, cm)
STREAK = (7.0, 1.6)  # streaks in it: their length and width (cm)
STREAK_TURN = 10.0  # the size of the patches in which the streaks run the same way (cm)
MOTTLE_MIX = (0.6, 0.5, 0.3, 0.5)  # the weights of the patches, the slow changes and the streaks
SOFT_NORMAL = 1.0  # px: the normal map's softness
SOFT_COLOUR = 0.45  # px: the colour's
GAP = 0.3  # the share of a tuft's height up to which it reads as a gap
STRENGTH = 0.8  # the normal map's slopes, as a share of the relief's

# ---- colour (CIELAB) ----
MEAN_L = 48.5  # the mean as it renders, in linear light (as are the mean's chroma and hue)
MEAN_CHROMA = 7.3
MEAN_HUE = 65.0
QUALITY = (88, 90)  # JPEG quality of the colour and normal maps
RELIEF_L = 13.0  # tips this much lighter than the middle, the low parts this much darker
GAP_L = 9.0  # the gaps between the tufts, darker still
SHEEN_L = 28.0  # the silky fibre ends on the tufts' tops, brighter where the pile is lighter
FACING_L = 8.0  # tufts lying towards the light lighter, away from it darker
STRAND_L = 3.5  # the fibre bundles
MOTTLE_L = 6.5  # the mottling's light and dark patches
TUFT_L = 3.0  # the tufts' differences
GRAIN_L = 5.5  # the fibres
CONTRAST = 1.35  # all of the above together
CHROMA_SLOPE = 0.02  # chroma per L*: a little more in the dark parts
HUE_SLOPE = 0.2  # degrees per L*: warmer (lower) in the dark parts, as on the photos


def periodic_blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian blur (sigma in px) that wraps round the tile's edges."""
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.fftfreq(a.shape[1])[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx**2 + fy**2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def smooth_noise(rng: np.random.Generator, sigma_cm: float) -> np.ndarray:
    """Tileable noise with blobs about `sigma_cm` in radius. Mean 0, std 1."""
    a = periodic_blur(rng.standard_normal((N, N)), sigma_cm / PX)
    return (a - a.mean()) / a.std()


def band_noise(rng: np.random.Generator, wavelength_cm: float, spread: float = 0.45) -> np.ndarray:
    """Tileable noise with its features about `wavelength_cm` apart (a band around that, `spread` wide on a log
    scale), not larger and not finer. Mean 0, std 1."""
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.fftfreq(N)[None, :]
    f = np.hypot(fx, fy) / PX  # cycles per cm
    g = np.exp(-(np.log(np.maximum(f, 1e-9) * wavelength_cm) ** 2) / (2 * spread**2))
    a = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((N, N))) * g))
    return (a - a.mean()) / a.std()


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


def lab_to_srgb(L: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """CIELAB (D65) to sRGB, 0..255 (float, unclipped)."""
    fy = (L + 16) / 116
    fx = fy + a / 500
    fz = fy - b / 200
    inv = lambda f: np.where(f > 6 / 29, f**3, 3 * (6 / 29) ** 2 * (f - 4 / 29))
    xyz = np.stack([inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883], axis=-1)
    m = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    lin = np.clip(xyz @ m.T, 0, 1)
    return 255 * np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)


def to_linear(srgb: np.ndarray) -> np.ndarray:
    c = srgb / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(lin: np.ndarray) -> np.ndarray:
    return 255 * np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)


def lightness(srgb: np.ndarray) -> np.ndarray:
    y = to_linear(srgb) @ np.array([0.2126, 0.7152, 0.0722])
    return 116 * np.where(y > (6 / 29) ** 3, np.cbrt(y), y / (3 * (6 / 29) ** 2) + 4 / 29) - 16


def lab_of(srgb: np.ndarray) -> tuple[float, float, float]:
    """L*, chroma and hue (degrees) of one sRGB colour (0..255)."""
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = to_linear(srgb) @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    a, b = 500 * (f[0] - f[1]), 200 * (f[1] - f[2])
    return float(116 * f[1] - 16), float(np.hypot(a, b)), float(np.degrees(np.arctan2(b, a)) % 360)


def build(seed: int):
    rng = np.random.default_rng(seed)
    # the way the pile lies: a direction that turns slowly over the cloth
    dx, dy = smooth_noise(rng, TURN), smooth_noise(rng, TURN)
    lie = np.arctan2(dy, dx)
    height = np.zeros((N, N))  # the tufts (cm)
    owner = np.full((N, N), -1)
    across = np.zeros((N, N))  # where across the tuft on top (-1..1, relative to its width there)
    cells = int(round(TILE / SPACING))
    step = TILE / cells
    tone, phase, facing = [], [], []
    for gy in range(cells):
        for gx in range(cells):
            cx = (gx + rng.uniform(0, 1)) * step
            cy = (gy + rng.uniform(0, 1)) * step
            h0 = TUFT_HEIGHT * (1 + rng.normal(0, 0.12))
            tone.append(rng.normal(0, 1))
            phase.append(rng.uniform(0, 2 * np.pi))
            if rng.random() < CURLS:
                facing.append(0.5)
                rad = rng.uniform(*CURL_SIZE) / 2
                js = np.arange(int(np.floor((cx - rad) / PX)), int(np.ceil((cx + rad) / PX)) + 1)
                is_ = np.arange(int(np.floor((cy - rad) / PX)), int(np.ceil((cy + rad) / PX)) + 1)
                ds = (js + 0.5) * PX - cx
                dt = (is_ + 0.5) * PX - cy
                r2 = (ds[None, :] ** 2 + dt[:, None] ** 2) / rad**2
                inside = r2 < 1
                z = h0 * np.sqrt(np.clip(1 - r2, 0, None))
                b = np.arctan2(dt[:, None], ds[None, :]) / np.pi  # its fibres fan out all round
            else:
                th = lie[int(cy / PX) % N, int(cx / PX) % N] + rng.normal(0, JITTER)
                facing.append(0.5 + 0.5 * np.cos(th - SHEEN_FROM))
                half_l = rng.uniform(*TUFT_LENGTH) / 2
                half_w = rng.uniform(*TUFT_WIDTH) / 2
                ext = half_l + half_w
                js = np.arange(int(np.floor((cx - ext) / PX)), int(np.ceil((cx + ext) / PX)) + 1)
                is_ = np.arange(int(np.floor((cy - ext) / PX)), int(np.ceil((cy + ext) / PX)) + 1)
                ds = (js + 0.5) * PX - cx
                dt = (is_ + 0.5) * PX - cy
                # along the tuft from its root (-1) to its tip (1), and across it, relative to its width there: lines
                # across it fan out from the root, like its fibres
                a = (ds[None, :] * np.cos(th) + dt[:, None] * np.sin(th)) / half_l
                u = (a + 1) / 2
                w = 0.35 + 0.65 * np.clip(u, 0, 1) ** 0.7
                b = (-ds[None, :] * np.sin(th) + dt[:, None] * np.cos(th)) / (half_w * w)
                tip = np.clip((a - 0.55) / 0.45, 0, None)  # the rounded tip
                r2 = b**2 + tip**2
                inside = (a > -1) & (r2 < 1)
                z = h0 * np.clip(u, 0, 1) ** 0.6 * np.sqrt(np.clip(1 - r2, 0, None))
            ii, jj = np.ix_(is_ % N, js % N)
            win = inside & (z > height[ii, jj])
            height[ii, jj] = np.where(win, z, height[ii, jj])
            owner[ii, jj] = np.where(win, len(tone) - 1, owner[ii, jj])
            across[ii, jj] = np.where(win, b, across[ii, jj])

    # fibres along the way the pile lies (a few fixed directions, blended)
    angles = np.linspace(0, np.pi, 6, endpoint=False)
    grains = [streaky_noise(rng, t, 3.5, 0.7) for t in angles]
    wsum = np.zeros((N, N))
    grain = np.zeros((N, N))
    for t, g in zip(angles, grains):
        wt = np.cos(lie - t) ** 8
        grain += wt * g
        wsum += wt
    grain /= np.maximum(wsum, 1e-6)
    grain = (grain - grain.mean()) / grain.std()
    on = owner >= 0
    o = np.maximum(owner, 0)
    # the fibre bundles fanning out in each tuft
    strands = np.where(on, np.cos(np.pi * STRANDS * across + np.array(phase)[o]), 0)

    # ---- the normal map: x along +u (right), y along +v (up the image); from the tufts and their fibre bundles, a
    # little softer than the colour (the finest fibres are in the colour only)
    relief = periodic_blur(height + 0.02 * strands * on, SOFT_NORMAL)
    d_ds = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) / (2 * PX)
    d_dt = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) / (2 * PX)
    n = np.stack([-STRENGTH * d_ds, STRENGTH * d_dt, np.ones_like(relief)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    normal = np.round((n + 1) * 127.5).clip(0, 255).astype(np.uint8)

    # ---- the colour, in CIELAB: light tips, dark gaps between the tufts; where the pile is lighter, more tips catch
    # the light and fewer gaps show, and the tufts lying towards the light show their silky sides. The light and dark
    # patches are those of a crushed pile: soft and irregular, some drawn out into streaks.
    sway = np.arctan2(smooth_noise(rng, STREAK_TURN), smooth_noise(rng, STREAK_TURN))
    streak_angles = np.linspace(0, np.pi, 6, endpoint=False)
    streaks, wsum = np.zeros((N, N)), np.zeros((N, N))
    for angle in streak_angles:
        wt = np.cos(sway - angle) ** 8
        streaks += wt * streaky_noise(rng, angle, STREAK[0] / PX, STREAK[1] / PX)
        wsum += wt
    streaks /= np.maximum(wsum, 1e-6)
    streaks = (streaks - streaks.mean()) / streaks.std()
    mottle = np.tanh(
        MOTTLE_MIX[0] * band_noise(rng, MOTTLE[0])
        + MOTTLE_MIX[1] * band_noise(rng, MOTTLE[1])
        + MOTTLE_MIX[2] * smooth_noise(rng, MOTTLE[2])
        + MOTTLE_MIX[3] * streaks
    )
    m01 = (1 + mottle) / 2
    face = np.where(on, np.array(facing)[o], 0.5)
    sharp = periodic_blur(height, SOFT_COLOUR)
    t = np.clip(sharp, 0, None) / sharp.max()
    gap = 1 - smoothstep(0.0, GAP, t)
    L = (
        RELIEF_L * (2 * t**1.3 - 1)
        - GAP_L * gap * (0.5 + 1.0 * (1 - m01))
        + SHEEN_L * smoothstep(0.75, 1.0, t) * ((1 + strands) / 2) ** 1.5 * (0.3 + 1.4 * face**2) * (0.2 + 1.6 * m01)
        + FACING_L * (face - 0.5) * t
        + STRAND_L * strands * t
        + MOTTLE_L * mottle
        + TUFT_L * np.where(on, np.array(tone)[o], 0)
        + GRAIN_L * grain
    )
    L = CONTRAST * (L - L.mean())
    L += rng.normal(0, 1.0, (N, N))

    def colour_of(offset: float, hue0: float, chroma0: float) -> np.ndarray:
        LL = np.clip(L + offset, 6, 94)
        chroma = np.clip(chroma0 - CHROMA_SLOPE * (LL - MEAN_L), 0, None)
        hue = np.radians(hue0 + HUE_SLOPE * (LL - MEAN_L))
        return lab_to_srgb(LL, chroma * np.cos(hue), chroma * np.sin(hue))

    def mean_of(colour: np.ndarray) -> tuple[float, float, float]:
        return lab_of(to_srgb(to_linear(colour).reshape(-1, 3).mean(axis=0)))

    # the lightness offset, hue and chroma that make the mean, in linear light, MEAN_L, MEAN_HUE and MEAN_CHROMA
    offset, hue0, chroma0 = 0.0, MEAN_HUE, MEAN_CHROMA
    for _ in range(4):
        lo, hi = -50.0, 100.0
        for _ in range(30):
            offset = (lo + hi) / 2
            if mean_of(colour_of(offset, hue0, chroma0))[0] < MEAN_L:
                lo = offset
            else:
                hi = offset
        _, c, h = mean_of(colour_of(offset, hue0, chroma0))
        hue0 += MEAN_HUE - h
        chroma0 *= MEAN_CHROMA / c
    look = np.clip(colour_of(offset, hue0, chroma0), 0, 255)
    return look, albedo_of(look), normal, relief


def albedo_of(look: np.ndarray) -> np.ndarray:
    """The colour to give the material so that, lit at full strength and through the app's tone mapping, it shows
    `look`.

    The app renders with three.js's NeutralToneMapping (Khronos PBR Neutral), which first takes an offset off all
    three channels (in linear light): 0.04, or for dark colours whose smallest channel x is under 0.08, x - 6.25 x².
    It is meant to cancel the 4 % specular reflection of a lit surface, which a matte fabric lit without an environment
    map hardly has, so a mid-tone renders darker and more saturated: this taupe about 5 L* darker. The offset is undone
    here: a smallest channel m of the look comes from 0.4 √m below 0.04, and from m + 0.04 above."""
    t = to_linear(look)
    m = t.min(axis=-1)
    smallest = np.where(m < 0.04, 0.4 * np.sqrt(m), m + 0.04)
    albedo = t + (smallest - m)[..., None]
    return np.round(to_srgb(np.clip(albedo, 0, 1))).clip(0, 255).astype(np.uint8)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=OUT, help="folder to write to (default: data/textures)")
    ap.add_argument("--seed", type=int, default=11)
    args = ap.parse_args()
    look, colour, normal, relief = build(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    c_path, n_path = args.out / f"{NAME}.jpg", args.out / f"{NAME}-normal.jpg"
    Image.fromarray(colour, "RGB").save(c_path, quality=QUALITY[0], subsampling=0, optimize=True)
    Image.fromarray(normal, "RGB").save(n_path, quality=QUALITY[1], subsampling=0, optimize=True)
    print(f"wrote {c_path} ({c_path.stat().st_size // 1024} KB) and {n_path} ({n_path.stat().st_size // 1024} KB)")
    print(f"tile {TILE:g} cm ({N} px, {N / TILE:.1f} px per cm); relief 0..{relief.max():.2f} cm")
    for name, img in (("as it renders", look), ("the colour map", colour.astype(float))):
        flat = img.reshape(-1, 3)
        L, C, h = lab_of(to_srgb(to_linear(flat).mean(axis=0)))
        Lp = lightness(flat)
        print(f"{name}: mean L* {L:.1f}, C {C:.1f}, h {h:.0f}; L* 10th percentile {np.percentile(Lp, 10):.1f}, 90th {np.percentile(Lp, 90):.1f}, std {Lp.std():.1f}")
    mean = to_srgb(to_linear(look.reshape(-1, 3)).mean(axis=0))
    print(f"the preset's colour (its swatch: the mean as it renders) #{''.join(f'{round(v):02X}' for v in mean)}")


if __name__ == "__main__":
    main()
