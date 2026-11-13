/**
 * npx tsx tools/models/speaker-krk-rokit-5-g4.ts — writes catalogue/speaker-krk-rokit-5-g4.json.
 *
 * One KRK ROKIT 5 Generation 4 (RP5G4) powered studio monitor, 28.5 × 19 × 24.1 cm (H × W × D): a black cabinet with
 * rounded edges on a foam pad, a raised front baffle with the yellow Kevlar drivers (a 5" woofer, and a 1" tweeter in a
 * waveguide), the KRK badge, and the front bass port as a slot under the baffle. Positions after KRK's front photo.
 */
import type { Part } from "../../src/core/schema/common";
import { box, r, tail, vec, writeItem, type Extra } from "./parametric";

const ID = "speaker-krk-rokit-5-g4";
const [W, D, H] = [19, 24.1, 28.5];
const PAD = 0.4; // the foam pad under the cabinet
const FRONT = { shell: 11.15, baffle: 11.45 }; // z of the cabinet's and the baffle's front faces; the drivers stand 0.6 cm proud
const WOOFER = { y: H - 16.5, frame: 6.1, roll: 5.15, cone: 4.75, cap: 1.85 };
const TWEETER = { y: H - 5.8, guide: 3, throat: 2.25, dome: 1.4 };
const BADGE = { x: -4.9, y: H - 9.1, w: 1.9, h: 1.5 };
const PORT = { w: 15.9, y: [2.3, 4.2] as const };

type V = { x: number; y: number; z: number };
const AXIS_Z: Extra = { rotation: { x: 90 } }; // cylinders and rings facing forwards
const cyl = (name: string, radius: number, height: number, at: V, material: string, e: Extra = AXIS_Z): Part =>
  ({ name, shape: "cylinder", radius: r(radius), height: r(height), ...tail(at, material, e) }) as Part;
// no part is hidden in the plan: catalogue cards show only what the plan shows, and the front parts don't show from above
const ring = (name: string, radius: number, tube: number, at: V, material: string): Part =>
  ({ name, shape: "torus", radius: r(radius), tube: r(tube), ...tail(at, material, AXIS_Z) }) as Part;
const dome = (name: string, radius: number, depth: number, at: V, material: string): Part =>
  ({ name, shape: "sphere", radius: r(radius), scale: vec(1, 1, depth / radius), ...tail(at, material) }) as Part;

const parts: Part[] = [
  box("foam pad", [-9, 9], [0, PAD], [-11.6, 11.6], "trim", { plan: "hidden" }),
  box("cabinet", [-W / 2, W / 2], [PAD, H], [-D / 2, FRONT.shell], "cabinet", { cornerRadius: 1.3 }),
  box("baffle", [-8.7, 8.7], [4.6, 27.4], [FRONT.shell - 0.25, FRONT.baffle], "cabinet", { cornerRadius: 0.5 }),
  box("port", [-PORT.w / 2, PORT.w / 2], PORT.y, [FRONT.shell - 1, FRONT.shell + 0.05], "trim", { cornerRadius: 0.45 }),
  // the woofer: its frame (a ring on the baffle), the rubber roll, the cone set back inside it and the dust cap
  ring("woofer frame", WOOFER.frame - 0.3, 0.3, vec(0, WOOFER.y, FRONT.baffle), "trim"),
  ring("woofer surround", WOOFER.roll, 0.4, vec(0, WOOFER.y, FRONT.baffle + 0.1), "trim"),
  cyl("woofer cone", WOOFER.cone, 0.06, vec(0, WOOFER.y, FRONT.baffle + 0.05), "cone"),
  dome("woofer dust cap", WOOFER.cap, 0.45, vec(0, WOOFER.y, FRONT.baffle + 0.08), "trim"),
  // the tweeter in its waveguide
  cyl("tweeter waveguide", TWEETER.guide, 0.04, vec(0, TWEETER.y, FRONT.baffle + 0.02), "trim"),
  ring("tweeter waveguide throat", TWEETER.throat, 0.4, vec(0, TWEETER.y, FRONT.baffle + 0.05), "trim"),
  dome("tweeter dome", TWEETER.dome, 0.5, vec(0, TWEETER.y, FRONT.baffle + 0.05), "cone"),
  // the badge: black, with a yellow bar at its right end
  box("badge", [BADGE.x - BADGE.w / 2, BADGE.x + BADGE.w / 2], [BADGE.y - BADGE.h / 2, BADGE.y + BADGE.h / 2], [FRONT.baffle - 0.05, FRONT.baffle + 0.1], "trim"),
  box("badge bar", [BADGE.x + BADGE.w / 2 - 0.35, BADGE.x + BADGE.w / 2], [BADGE.y - BADGE.h / 2, BADGE.y + BADGE.h / 2], [FRONT.baffle - 0.05, FRONT.baffle + 0.12], "cone"),
];

const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Speaker, KRK ROKIT 5 G4",
  category: "media",
  tags: ["office", "speaker", "studio monitor", "audio", "krk"],
  dimensions: { width: W, depth: D, height: H },
  placement: { type: "onTop" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    cabinet: { label: "Cabinet", default: "plastic.graphite", allowed: ["plastic.graphite", "plastic.deep-black", "lacquer.black", "lacquer.white"] },
    trim: { label: "Drivers' rims and port", default: "plastic.deep-black", allowed: ["plastic.deep-black"] },
    cone: { label: "Drivers", default: "fabric.aramid-yellow", allowed: ["fabric.aramid-yellow"] },
  },
  productUrl: "https://www.krkmusic.com/products/rokit-5-generation-4-powered-studio-monitor-black",
  notes: `KRK ROKIT 5 Generation 4 (RP5G4), a powered 5-inch near-field studio monitor: ${H} × ${W} × ${D} cm (H × W × D), 4.85 kg. One speaker per item: place two and turn them in towards the listener. A black cabinet with rounded edges on a foam pad, the yellow Kevlar drivers (a 5-inch woofer, and a 1-inch tweeter in a waveguide) and the front bass port under the baffle.`,
});
console.log(`wrote ${path}: ${parts.length} parts`);
