/**
 * npx tsx tools/models/guest-bed-sideboard-160.ts — writes catalogue/guest-bed-sideboard-160-closed.json and
 * catalogue/guest-bed-sideboard-160-open.json: a guest bed folded into a sideboard (a cabinet bed, "Kommodenbett"),
 * closed and open. Own design after real cabinet beds (Night & Day Cube, Arason Creden-ZzZ, AFI Hamilton), with a
 * thinner mattress so that, closed, it has a sideboard's proportions.
 *
 * Closed: an oak sideboard, 160 × 55 × 82 cm on legs, with three doors in front, which are one panel. Inside, a
 * 140 × 200 cm foam mattress of 10 cm, folded three times (3 × 66.7 cm, 30 cm thick), stands upright with the folded
 * bed frame. Open: the front folds down onto folding legs as the middle section, the foot section unfolds from it, and
 * the mattress lies flat on them and on a deck inside the cabinet: sleeping surface at 42 cm, 206 cm from the wall. The
 * back, sides and top stay where they are, as the headboard; the top is still a shelf.
 *
 * Both items have the same width and back line, so the open one snaps to the wall where the closed one stood. Built in
 * cm with d = distance from the wall (the back line) and y up.
 */
import type { Part } from "../../src/core/schema/common";
import { box, r, tail, vec, writeItem } from "./parametric";

const W = 160;
const D = 55; // closed, doors included
const H = 82;
const OPEN_DEPTH = 206;
const LEGS = 10; // height of the oak legs
const T = 2; // board thickness
const BACK = 1.2;
const CARCASS = D - T - 1.5; // the doors stand in front of the carcass, the handles in front of the doors
const DOORS = { n: 3, gap: 0.4, y: [LEGS + T, H - T] as [number, number] };
const MATTRESS = { w: 140, l: 200, t: 10 };
const DECK = 32; // top of the deck, under the mattress
const doorW = (W - 2 * T - (DOORS.n - 1) * DOORS.gap) / DOORS.n;
const panel = DOORS.y[1] - DOORS.y[0]; // the front panel's height, which becomes the middle section's length

const ID = "guest-bed-sideboard-160";
const BODY = { label: "Body", default: "wood.oak-natural", allowed: ["wood.*", "lacquer.*"] };
const FRONTS = { label: "Fronts", default: "wood.oak-natural", allowed: ["wood.*", "lacquer.*"] };

const leg = (z: (d: number) => number, d: number, name: string): Part =>
  ({ name, shape: "cylinder", radius: 1.4, radiusTop: 2, height: LEGS, ...tail(vec(W / 2 - 6, LEGS / 2, z(d)), "body", { mirror: ["x"] }) }) as Part;

function closed(): Part[] {
  const z = (d: number) => d - D / 2;
  const x0 = -W / 2 + T + doorW / 2;
  return [
    leg(z, 6, "legs, back"),
    leg(z, CARCASS - 6, "legs, front"),
    box("carcass", [-W / 2, W / 2], [LEGS, H], [z(0), z(CARCASS)], "body"),
    box("doors", [x0 - doorW / 2, x0 + doorW / 2], DOORS.y, [z(CARCASS), z(CARCASS + T)], "fronts", { repeat: { count: DOORS.n, step: { x: doorW + DOORS.gap, y: 0, z: 0 } } }),
    box("handles", [x0 - 7, x0 + 7], [H - 9.6, H - 8.4], [z(CARCASS + T), z(D)], "handles", { repeat: { count: DOORS.n, step: { x: doorW + DOORS.gap, y: 0, z: 0 } }, plan: "hidden" }),
  ];
}

function open(): Part[] {
  const z = (d: number) => d - OPEN_DEPTH / 2;
  const x0 = -W / 2 + T + doorW / 2;
  const middle: [number, number] = [CARCASS, CARCASS + panel];
  const fold = MATTRESS.l / 3;
  const head = BACK + 0.3;
  return [
    leg(z, 6, "legs, back"),
    leg(z, CARCASS - 6, "legs, front"),
    // the cabinet, open at the front: the headboard
    box("sides", [W / 2 - T, W / 2], [LEGS, H - T], [z(0), z(CARCASS)], "body", { mirror: ["x"] }),
    box("top", [-W / 2, W / 2], [H - T, H], [z(0), z(CARCASS)], "body"),
    box("bottom", [-W / 2 + T, W / 2 - T], [LEGS, LEGS + T], [z(0), z(CARCASS)], "body"),
    box("back", [-W / 2 + T, W / 2 - T], [LEGS + T, H - T], [z(0), z(BACK)], "body"),
    box("deck, in the cabinet", [-W / 2 + T, W / 2 - T], [DECK - T, DECK], [z(BACK), z(CARCASS)], "body"),
    // the front panel folded down as the middle section (its three doors side by side), then the foot section
    box("middle section (the doors)", [x0 - doorW / 2, x0 + doorW / 2], [DECK - T, DECK], [z(middle[0]), z(middle[1])], "fronts", { repeat: { count: DOORS.n, step: { x: doorW + DOORS.gap, y: 0, z: 0 } } }),
    box("foot section", [-W / 2 + T, W / 2 - T], [DECK - T, DECK], [z(middle[1]), z(OPEN_DEPTH - 3)], "body"),
    box("foot rail", [-W / 2 + T, W / 2 - T], [DECK - 8, DECK + 2], [z(OPEN_DEPTH - 3), z(OPEN_DEPTH)], "body", { cornerRadius: 0.5 }),
    box("folding legs", [W / 2 - T - 8, W / 2 - T - 4], [0, DECK - T], [z(middle[1] - 6), z(middle[1] - 2)], "body", { mirror: ["x"], repeat: { count: 2, step: { x: 0, y: 0, z: OPEN_DEPTH - 3 - middle[1] } } }),
    box("mattress", [-MATTRESS.w / 2, MATTRESS.w / 2], [DECK, DECK + MATTRESS.t], [z(head), z(head + fold)], "mattress", { cornerRadius: 2.5, repeat: { count: 3, step: { x: 0, y: 0, z: fold } } }),
  ];
}

const extra = OPEN_DEPTH - D;
const sleep = DECK + MATTRESS.t;
const pathClosed = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: `${ID}-closed`,
  name: "Guest bed in a sideboard 160 (closed)",
  category: "storage",
  tags: ["guest bed", "cabinet bed", "kommodenbett", "convertible", "sideboard", "guest room", "office", "closed"],
  dimensions: { width: W, depth: D, height: H },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts: closed() },
  materialSlots: { body: BODY, fronts: FRONTS, handles: { label: "Handles", default: "metal.brass", allowed: ["metal.*"] } },
  surfaces: [{ name: "top", height: H, width: W - 2, depth: CARCASS - 2, center: [0, r(CARCASS / 2 - D / 2)] }],
  clearance: { front: 60, note: `Room in front of the sideboard; opening the bed takes ${extra} cm (see the open item)` },
  notes: `Own design: a guest bed folded into a sideboard (cabinet bed, Kommodenbett), closed: ${W} × ${D} × ${H} cm on ${LEGS} cm oak legs, with three doors in front that are one panel. Inside, a ${MATTRESS.w} × ${MATTRESS.l} cm foam mattress of ${MATTRESS.t} cm, folded three times, stands upright with the folded bed frame. Its open counterpart is ${ID}-open: the front folds down onto folding legs as the middle section, the foot section unfolds from it and the mattress lies flat at ${sleep} cm, ${OPEN_DEPTH} cm from the wall, so opening it takes ${extra} cm more room in front. Both have the same width and back line, so the open one snaps to the same wall position. Proportions after real cabinet beds (Night & Day Cube 163 × 67 × 93, open 204; Arason Creden-ZzZ; AFI Hamilton), which are taller because of their 15 cm mattresses.`,
});
const pathOpen = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: `${ID}-open`,
  name: "Guest bed in a sideboard 160 (open)",
  category: "bed",
  tags: ["guest bed", "cabinet bed", "kommodenbett", "convertible", "guest room", "open", "double bed"],
  dimensions: { width: W, depth: OPEN_DEPTH, height: H },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts: open() },
  materialSlots: { body: BODY, fronts: FRONTS, mattress: { label: "Mattress", default: "fabric.cotton-white", allowed: ["fabric.*"] } },
  surfaces: [
    { name: "bed", height: sleep, width: MATTRESS.w - 4, depth: MATTRESS.l - 4, center: [0, r(BACK + 0.3 + MATTRESS.l / 2 - OPEN_DEPTH / 2)] },
    { name: "top", height: H, width: W - 2, depth: CARCASS - 4, center: [0, r(CARCASS / 2 - OPEN_DEPTH / 2)] },
  ],
  clearance: { left: 50, right: 50, note: "Room to get in and make the bed: about 60 cm beside the mattress" },
  notes: `Own design: a guest bed folded into a sideboard (cabinet bed, Kommodenbett), open: a ${MATTRESS.w} × ${MATTRESS.l} cm foam mattress of ${MATTRESS.t} cm (three sections) at ${sleep} cm, ${OPEN_DEPTH} cm from the wall. The front panel lies on folding legs as the middle section, the foot section has unfolded from it, and the head end lies on a deck inside the cabinet, whose back, sides and top stay as the headboard (the top is still a shelf). Its closed counterpart is ${ID}-closed, a sideboard ${W} × ${D} × ${H} cm: open, it reaches ${extra} cm further into the room. Both have the same width and back line, so this one snaps to the same wall position.`,
});
console.log(`wrote ${pathClosed} and ${pathOpen}; middle section ${r(panel)} cm, foot section ${r(OPEN_DEPTH - 3 - CARCASS - panel)} cm`);
