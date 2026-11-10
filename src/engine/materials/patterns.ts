/**
 * Procedural textures, generated locally (no image files needed).
 * Each texture represents a known real-world size so it can be applied with cm-based UVs.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { MaterialPreset } from "../../core/schema/materials";

export type Pattern = NonNullable<MaterialPreset["pattern"]>;
type RGB = [number, number, number];
type Ctx = CanvasRenderingContext2D;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const css = (c: RGB, alpha = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
/** Lighter or darker (`light`, relative) and warmer or cooler (`warm`, −1…1). */
const shade = (c: RGB, light: number, warm: number): RGB => [
  byte(c[0] * (1 + light) + warm * 10),
  byte(c[1] * (1 + light) + warm * 4),
  byte(c[2] * (1 + light) - warm * 12),
];

/** Tiles per row in one texture repeat: one tile, or a block of differing tiles (natural stone). */
const tilesPerRepeat = (p: Pattern): number => (p.variation || p.veins || p.flecks ? 5 : 1);

/** Draw `fn` at the 9 wrap-around offsets so blobs crossing an edge tile seamlessly. */
function wrapped(n: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const dx of [-n, 0, n]) {
    for (const dy of [-n, 0, n]) {
      if (x + dx + r < 0 || x + dx - r > n || y + dy + r < 0 || y + dy - r > n) continue;
      fn(x + dx, y + dy);
    }
  }
}

function blobs(ctx: Ctx, n: number, rand: () => number, count: number, color: () => string, rMin: number, rMax: number): void {
  for (let i = 0; i < count; i++) {
    const r = rMin + rand() * (rMax - rMin);
    ctx.fillStyle = color();
    wrapped(n, rand() * n, rand() * n, r, (x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/** Wavy line along x that wraps seamlessly (integer number of periods). */
function grainLine(ctx: Ctx, n: number, y0: number, amp: number, periods: number, phase: number): void {
  for (const dy of [-n, 0, n]) {
    ctx.beginPath();
    for (let x = 0; x <= n; x += 4) {
      const y = y0 + dy + amp * Math.sin((2 * Math.PI * periods * x) / n + phase);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function tiles(ctx: Ctx, n: number, base: RGB, c2: RGB, p: Pattern, rand: () => number, s: number): number {
  const k = tilesPerRepeat(p);
  const t = n / k;
  const pxPerCm = t / p.scale;
  if (k === 1) {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, n, n);
    blobs(ctx, n, rand, 700, () => css(mix(base, c2, rand()), 0.1 * s), n / 120, n / 22);
  } else {
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) stoneTile(ctx, i * t, j * t, t, pxPerCm, base, c2, p, rand, s);
  }
  // joints on the tile edges; those on the texture's border are split between its two sides
  const w = Math.max(1.5, (p.jointWidth ?? 0.3) * pxPerCm);
  ctx.fillStyle = p.jointColor ?? css(mix(base, c2, 0.5 + 0.5 * s));
  for (let i = 0; i <= k; i++) {
    ctx.fillRect(i * t - w / 2, 0, w, n);
    ctx.fillRect(0, i * t - w / 2, n, w);
  }
  return p.scale * k;
}

/** One tile of a block of differing tiles: own tone, mottling, clouds and veins, flecks. */
function stoneTile(ctx: Ctx, x0: number, y0: number, t: number, pxPerCm: number, base: RGB, c2: RGB, p: Pattern, rand: () => number, s: number): void {
  const v = p.variation ?? 0;
  const tone = shade(base, (rand() - 0.5) * 0.3 * v, (rand() - 0.5) * 2 * v);
  const white: RGB = [255, 255, 255];
  const at = (): [number, number] => [x0 + rand() * t, y0 + rand() * t];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, t, t);
  ctx.clip();
  ctx.fillStyle = css(tone);
  ctx.fillRect(x0, y0, t, t);
  for (let i = 0; i < 60; i++) {
    const [x, y] = at();
    ctx.fillStyle = css(mix(tone, c2, rand()), 0.1 * s);
    ctx.beginPath();
    ctx.arc(x, y, t * (0.01 + rand() * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
  const veins = p.veins ?? 0;
  if (veins > 0) {
    ctx.filter = `blur(${(t / 25).toFixed(1)}px)`;
    for (let i = 0; i < 7; i++) {
      const [x, y] = at();
      const light = rand() < 0.6;
      ctx.fillStyle = css(light ? mix(tone, white, 0.45) : c2, (light ? 0.35 : 0.22) * veins);
      ctx.beginPath();
      ctx.ellipse(x, y, t * (0.08 + rand() * 0.2), t * (0.04 + rand() * 0.1), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // wandering lines, mostly in one direction per tile (each tile is a different cut of the stone)
    ctx.filter = `blur(${Math.max(0.4, pxPerCm * 0.06).toFixed(2)}px)`;
    const dir = rand() * Math.PI;
    for (let i = 0; i < 5; i++) {
      let a = dir + (rand() - 0.5) * 0.8;
      let [x, y] = at();
      x -= Math.cos(a) * t;
      y -= Math.sin(a) * t;
      const light = rand() < 0.5;
      ctx.strokeStyle = css(light ? mix(tone, white, 0.5) : mix(c2, [0, 0, 0], 0.15), (0.25 + rand() * 0.35) * veins);
      ctx.lineWidth = pxPerCm * (0.05 + rand() * 0.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let step = 0; step < 60; step++) {
        a += (rand() - 0.5) * 0.5;
        x += (Math.cos(a) * t) / 24;
        y += (Math.sin(a) * t) / 24;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.filter = "none";
  }
  const flecks = p.flecks ?? 0;
  if (flecks > 0) {
    const color = p.fleckColor ? rgb(p.fleckColor) : mix(c2, [40, 28, 18], 0.55);
    const count = Math.round(flecks * 0.04 * p.scale * p.scale);
    for (let i = 0; i < count; i++) {
      const [x, y] = at();
      ctx.fillStyle = css(color, 0.45 + rand() * 0.5);
      ctx.beginPath();
      ctx.ellipse(x, y, pxPerCm * (0.2 + rand() * 0.7), pxPerCm * (0.05 + rand() * 0.08), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function planks(ctx: Ctx, n: number, base: RGB, c2: RGB, p: Pattern, rand: () => number, s: number): number {
  const lanes = 6;
  const h = n / lanes;
  const dark = mix(c2, [0, 0, 0], 0.35);
  for (let i = 0; i < lanes; i++) {
    const tone = mix(base, c2, rand() * s);
    ctx.fillStyle = css(tone);
    ctx.fillRect(0, i * h, n, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, i * h, n, h);
    ctx.clip();
    for (let k = 0; k < 14; k++) {
      ctx.strokeStyle = css(c2, (0.12 + rand() * 0.25) * s);
      ctx.lineWidth = 0.6 + rand() * 1.4;
      grainLine(ctx, n, i * h + rand() * h, 0.5 + rand() * 2.5, 1 + Math.floor(rand() * 3), rand() * 6.28);
    }
    ctx.restore();
    ctx.fillStyle = css(dark, 0.55 * s + 0.2);
    ctx.fillRect(0, i * h, n, Math.max(1, n / 400)); // seam between lanes
    ctx.fillRect(Math.floor(rand() * n), i * h, Math.max(1, n / 400), h); // butt joint
  }
  return p.scale * lanes;
}

function woodGrain(ctx: Ctx, n: number, base: RGB, c2: RGB, p: Pattern, rand: () => number, s: number): number {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, n, n);
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = css(c2, (0.12 + rand() * 0.4) * s);
    ctx.lineWidth = 0.5 + rand() * 2.5;
    grainLine(ctx, n, rand() * n, 1 + rand() * 6, 1 + Math.floor(rand() * 3), rand() * 6.28);
  }
  return p.scale;
}

function weave(ctx: Ctx, n: number, base: RGB, c2: RGB, p: Pattern, rand: () => number, s: number): number {
  const threads = 8;
  const c = n / threads;
  for (let i = 0; i < threads; i++) {
    for (let j = 0; j < threads; j++) {
      const over = (i + j) % 2 === 0;
      const t = (over ? 0.25 : 0.75) * s + (rand() - 0.5) * 0.15 * s;
      const col = mix(base, c2, Math.max(0, Math.min(1, t)));
      const g = over ? ctx.createLinearGradient(i * c, 0, i * c + c, 0) : ctx.createLinearGradient(0, j * c, 0, j * c + c);
      g.addColorStop(0, css(mix(col, c2, 0.35 * s)));
      g.addColorStop(0.5, css(col));
      g.addColorStop(1, css(mix(col, c2, 0.35 * s)));
      ctx.fillStyle = g;
      ctx.fillRect(i * c, j * c, c, c);
    }
  }
  return p.scale;
}

function noise(ctx: Ctx, n: number, base: RGB, c2: RGB, p: Pattern, rand: () => number, s: number): number {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, n, n);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = css(c2, rand() * 0.6 * s);
    ctx.fillRect(rand() * n, rand() * n, 1.5, 1.5);
  }
  return p.scale;
}

const painters = { tiles, planks, "wood-grain": woodGrain, weave, noise } as const;
const resolution: Record<Pattern["type"], number> = { tiles: 512, planks: 1024, "wood-grain": 512, weave: 128, noise: 256 };

/** Canvas size: a block of tiles gets about 10 px per cm (up to 2048), so that thin joints stay sharp. */
function textureSize(p: Pattern): number {
  const k = p.type === "tiles" ? tilesPerRepeat(p) : 1;
  if (k === 1) return resolution[p.type];
  return Math.min(2048, Math.max(256, 2 ** Math.ceil(Math.log2(p.scale * k * 10))));
}

/** Create the texture for a pattern. `sizeCm` is the real-world size of one texture repeat. */
export function patternTexture(key: string, baseHex: string, p: Pattern, anisotropy: number): { texture: Texture; sizeCm: number } {
  const n = textureSize(p);
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas not available");
  const sizeCm = painters[p.type](ctx, n, rgb(baseHex), rgb(p.color2), p, mulberry32(hash(key)), p.strength ?? 0.5);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.repeat.set(1 / sizeCm, 1 / sizeCm);
  return { texture, sizeCm };
}
