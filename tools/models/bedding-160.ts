/**
 * npx tsx tools/models/bedding-160.ts — writes the bedding for a 160 × 200 cm bed (bed-boxspring-160x200), in Swiss
 * standard sizes:
 * - catalogue/pillow-65x65.json: a 65 × 65 cm pillow, lying flat;
 * - catalogue/duvet-200x210.json: a 200 × 210 cm duvet, spread over the whole mattress;
 * - catalogue/bedspread-quilted-240x260.json: a quilted 240 × 260 cm bedspread over the duvet, from just below the
 *   pillows to the foot, its head edge folded back.
 * They are parametric items made of primitives, so the app draws, recolours and collides them like any other item; this
 * script only does the arithmetic.
 *
 * All three are `onTop` items, made in the frame of the surface they lie on: x = 0 in the middle of the mattress,
 * z = 0 halfway along it, y = 0 on its top, the foot end at +z. They stack: the duvet lies on the bed and carries the
 * pillows and the bedspread, and each also works on its own (the pillows or the bedspread straight on the mattress).
 * Items standing on each other never collide with each other, and everything stacked moves with the bed.
 *
 * The duvet and the bedspread hang over the sides and the foot (`hangsBelow`), and they are bigger than the mattress,
 * the duvet's top and any 160 or 150 cm bed's surface in both directions, so the app centres them and lays them square
 * on what they are dropped onto. Their boxes are symmetric about the middle of the bed; there is no drape at the head
 * end, so a bed pushed against the headboard box or a wall has room for them.
 *
 * From the side of the mattress outwards: the duvet's drape (2.1 cm, 0.4 cm off the mattress), then the bedspread's
 * (1.2 cm, 0.4 cm off the duvet), 4 cm in all. In the bed alcove of the wardrobe walls (177 cm wide), a 160 cm bed
 * leaves 8.5 cm on each side, so 4.5 cm stay free.
 *
 * Sizes as made up on the bed: the pillow 14 cm high; the duvet 6 cm thick (a lofty down duvet; it is wider and longer
 * than the mattress, so it hangs 14 cm down the sides and the foot); the bedspread 1.2 cm (quilted cotton), hanging 31
 * cm down, as a 240 × 260 cm bedspread does over a duvet on a 62 cm boxspring. Over the duvet it covers the duvet's
 * drapes; on its own it reaches 31 cm above the floor.
 */
import type { Part } from "../../src/core/schema/common";
import { box, r, tail, vec, writeItem, type R2 } from "./parametric";

const HW = 80; // half the mattress's width
const HL = 100; // half its length

const fmt = (n: number) => `${r(n)}`;

// --- the pillow (65 × 65, lying flat): a plump body with fully rounded edges and a soft hump on top
{
  const S = 65;
  const H = 14;
  const parts: Part[] = [
    box("body", [-31.5, 31.5], [0, 11], [-31.5, 31.5], "cover", { cornerRadius: 5.4 }),
    { name: "filling", shape: "sphere", radius: 1, scale: vec(29.5, 4, 29.5), ...tail(vec(0, H - 4, 0), "cover") } as Part,
  ];
  const path = writeItem({
    $schema: "../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: "pillow-65x65",
    name: "Pillow 65 × 65",
    category: "bedding",
    tags: ["bedroom", "pillow", "bed", "Swiss size"],
    dimensions: { width: S, depth: S, height: H },
    placement: { type: "onTop" },
    geometry: { type: "parametric", parts },
    materialSlots: { cover: { label: "Pillowcase", default: "fabric.cotton-white", allowed: ["fabric.*"] } },
    notes: `Generic pillow, not a specific product: ${S} × ${S} cm, the Swiss standard size, lying flat and about ${H} cm high. Put two at the head end of a 160 cm bed, on the duvet (duvet-200x210) or straight on the mattress; they then move with the bed. Pushed to the head end they leave about 18 cm of the duvet free before the bedspread (bedspread-quilted-240x260) begins.`,
  });
  console.log(`wrote ${path}: ${parts.length} parts, ${S} × ${S} × ${H}`);
}

// --- the duvet (200 × 210): a lofty top over the whole mattress, hanging down the sides and the foot
const DUVET = { t: 6, gap: 0.4, drape: 2.1, hang: 14, head: -99 };
const DX = HW + DUVET.gap + DUVET.drape; // outside of its drapes
const DZ = HL + DUVET.gap + DUVET.drape;
{
  const { t, hang } = DUVET;
  const rc = t / 2 - 0.1; // the top's rounded edges, and the corners seen from above
  const inX: R2 = [HW + DUVET.gap, DX];
  const parts: Part[] = [
    box("top", [-DX, DX], [0, t], [DUVET.head, DZ], "duvet", { cornerRadius: rc }),
    // the loft: the middle rises 1 cm above the edges (hidden under the bedspread's top)
    { name: "loft", shape: "sphere", radius: 1, scale: vec(HW - 2, 3, HL - 4), ...tail(vec(0, t - 2, (DUVET.head + DZ) / 2), "duvet", { plan: "hidden" }) } as Part,
    box("sides", inX, [-hang, t / 2], [DUVET.head + 1.5, DZ - rc], "duvet", { cornerRadius: 1, mirror: ["x"] }),
    box("foot", [-(DX - rc), DX - rc], [-hang, t / 2], [HL + DUVET.gap, DZ], "duvet", { cornerRadius: 1 }),
    {
      name: "foot corners",
      shape: "cylinder",
      radius: rc,
      height: r(hang + t / 2),
      ...tail(vec(DX - rc, (t / 2 - hang) / 2, DZ - rc), "duvet", { mirror: ["x"] }),
    } as Part,
  ];
  const width = r(2 * DX);
  const depth = r(2 * Math.max(DZ, -DUVET.head));
  const path = writeItem({
    $schema: "../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: "duvet-200x210",
    name: "Duvet 200 × 210",
    category: "bedding",
    tags: ["bedroom", "duvet", "bed", "Swiss size"],
    dimensions: { width, depth, height: t },
    placement: { type: "onTop", hangsBelow: hang },
    geometry: { type: "parametric", parts },
    materialSlots: { duvet: { label: "Duvet cover", default: "fabric.cotton-white", allowed: ["fabric.*"] } },
    surfaces: [{ name: "top", height: t, width: 2 * HW, depth: 2 * HL - 4 }],
    notes: `Generic duvet, not a specific product: 200 × 210 cm, the Swiss size for a 160 cm bed, made up over a 160 × 200 mattress (bed-boxspring-160x200). It covers the whole mattress, ${t} cm thick, and hangs ${hang} cm down the sides and the foot; the item's box (${fmt(width)} × ${fmt(depth)} cm) is the duvet as it lies on the bed, ${fmt(DX - HW)} cm wider than the mattress on each side. Drop it on the bed: it is centred and lies square on it. Its top is a surface for the pillows (pillow-65x65) and the bedspread (bedspread-quilted-240x260), which then move with it. On a 150 cm bed (bed-boxspring-150x200-headboard) it is ${fmt(DX - 75)} cm wider than the mattress on each side.`,
  });
  console.log(`wrote ${path}: ${parts.length} parts, ${fmt(width)} × ${fmt(depth)} × ${t}, hangs ${hang} cm`);
}

// --- the bedspread (240 × 260, quilted): over the duvet from just below the pillows to the foot, hanging down the
// sides and the foot; its head edge is folded back
{
  const t = 1.2;
  const gap = 0.4;
  const hang = 31;
  const roll = 2.4; // radius of the rounded edges where it turns down
  const head = -15; // the fold at its head edge: 18 cm below pillows pushed to the head end
  const band = 20; // the folded-back band
  const OX = DX + gap + t; // outside of its drapes
  const OZ = DZ + gap + t;
  const inX: R2 = [DX + gap, OX];
  const parts: Part[] = [
    box("top", [-(OX - roll), OX - roll], [0, t], [head, OZ - roll], "quilt", { cornerRadius: t / 2 - 0.05 }),
    box("folded-back band", [-(OX - roll), OX - roll], [t, 2 * t], [head, head + band], "quilt", { cornerRadius: t / 2 - 0.05 }),
    {
      name: "fold",
      shape: "cylinder",
      radius: t,
      height: r(2 * (OX - roll)),
      ...tail(vec(0, t, head), "quilt", { rotation: { z: 90 } }),
    } as Part,
    {
      name: "side edges",
      shape: "cylinder",
      radius: roll,
      height: r(OZ - roll - head),
      ...tail(vec(OX - roll, t - roll, (head + OZ - roll) / 2), "quilt", { rotation: { x: 90 }, mirror: ["x"] }),
    } as Part,
    {
      name: "foot edge",
      shape: "cylinder",
      radius: roll,
      height: r(2 * (OX - roll)),
      ...tail(vec(0, t - roll, OZ - roll), "quilt", { rotation: { z: 90 } }),
    } as Part,
    { name: "foot edge corners", shape: "sphere", radius: roll, ...tail(vec(OX - roll, t - roll, OZ - roll), "quilt", { mirror: ["x"] }) } as Part,
    box("sides", inX, [-hang, t - roll], [head, OZ - roll], "quilt", { cornerRadius: t / 2 - 0.05, mirror: ["x"] }),
    box("foot", [-(OX - roll), OX - roll], [-hang, t - roll], [OZ - t, OZ], "quilt", { cornerRadius: t / 2 - 0.05 }),
    {
      name: "foot corners",
      shape: "cylinder",
      radius: roll,
      height: r(hang + t - roll),
      ...tail(vec(OX - roll, (t - roll - hang) / 2, OZ - roll), "quilt", { mirror: ["x"] }),
    } as Part,
  ];
  const width = r(2 * OX);
  const depth = r(2 * OZ);
  const height = r(2 * t);
  const path = writeItem({
    $schema: "../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: "bedspread-quilted-240x260",
    name: "Bedspread 240 × 260, quilted",
    category: "bedding",
    tags: ["bedroom", "bedspread", "quilt", "bed", "Swiss size"],
    dimensions: { width, depth, height },
    placement: { type: "onTop", hangsBelow: hang },
    geometry: { type: "parametric", parts },
    materialSlots: { quilt: { label: "Bedspread", default: "fabric.quilted-rose", allowed: ["fabric.*"] } },
    surfaces: [{ name: "top", height: t, width: r(2 * (OX - roll)), depth: r(OZ - roll - head - band), center: [0, r((OZ - roll + head + band) / 2)] }],
    notes: `Generic quilted bedspread, not a specific product: 240 × 260 cm (German: Tagesdecke), for a 160 × 200 bed, like the dusty pink one in the user's inspiration photo. Drop it on the duvet (duvet-200x210): it is centred and lies square on it, from ${fmt(-head - HL)} cm below the head end of the mattress (just below the pillows) to the foot, its head edge folded back ${band} cm, and hangs ${hang} cm down the sides and the foot, over the duvet's drapes. It works straight on the mattress too. The item's box (${fmt(width)} × ${fmt(depth)} cm) is the bedspread as it lies on the bed. The quilting is the material's stitched pattern: fabric.quilted-rose (default), fabric.quilted-light-blue and fabric.quilted-sand; plain fabrics show it unquilted. Its top is a surface for cushions and throws.`,
  });
  console.log(`wrote ${path}: ${parts.length} parts, ${fmt(width)} × ${fmt(depth)} × ${height}, hangs ${hang} cm, head edge at z ${head}`);
}
