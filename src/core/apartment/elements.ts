import { area, length } from "../geometry/polygon";
import type { ApartmentFile, Check, Fixture, Opening, Room, Wall } from "../schema/apartment";
import type { Confidence, Provenance } from "../schema/common";

export type ElementRef =
  | { kind: "room"; element: Room }
  | { kind: "wall"; element: Wall }
  | { kind: "opening"; element: Opening }
  | { kind: "fixture"; element: Fixture };

export function findElement(ap: ApartmentFile, id: string): ElementRef | undefined {
  const room = ap.rooms.find((e) => e.id === id);
  if (room) return { kind: "room", element: room };
  const wall = ap.walls.find((e) => e.id === id);
  if (wall) return { kind: "wall", element: wall };
  const opening = ap.openings.find((e) => e.id === id);
  if (opening) return { kind: "opening", element: opening };
  const fixture = ap.fixtures.find((e) => e.id === id);
  if (fixture) return { kind: "fixture", element: fixture };
  return undefined;
}

export function elementTitle(ref: ElementRef): string {
  switch (ref.kind) {
    case "room":
      return ref.element.name;
    case "wall":
      return `${ref.element.kind[0].toUpperCase()}${ref.element.kind.slice(1)} wall`;
    case "opening":
      return ref.element.kind === "door" ? (ref.element.door?.isEntrance ? "Entrance door" : "Door") : "Window";
    case "fixture":
      return ref.element.name;
  }
}

const cm = (v: number) => `${v.toFixed(1)} cm`;

/** Human-readable key facts of an element for the Inspect panel. */
export function elementFacts(ap: ApartmentFile, ref: ElementRef): [string, string][] {
  const roomName = (id?: string) => (id ? (ap.rooms.find((r) => r.id === id)?.name ?? id) : "outside");
  switch (ref.kind) {
    case "room": {
      const r = ref.element;
      const facts: [string, string][] = [
        ["Area (model)", `${(area(r.outline) / 10_000).toFixed(2)} m²`],
        ["Area (printed)", r.labelledArea ? `${r.labelledArea} m²` : "–"],
        ["Floor", r.floorMaterial ?? `${ap.defaults.floorMaterial} (default)`],
      ];
      if (r.kind === "indoor") facts.push(["Walls", r.wallMaterial ?? `${ap.defaults.wallMaterial} (default)`]);
      return facts;
    }
    case "wall": {
      const w = ref.element;
      return [
        ["Length (centre line)", cm(length(w.start, w.end))],
        ["Thickness", cm(w.thickness)],
        ["Height", cm(w.height ?? ap.ceilingHeight)],
        ["Left side", roomName(w.sides?.left)],
        ["Right side", roomName(w.sides?.right)],
      ];
    }
    case "opening": {
      const o = ref.element;
      const facts: [string, string][] = [
        ["Width (reveal to reveal)", cm(o.width)],
        ["Height", cm(o.height)],
        ["Sill", cm(o.sill)],
        ["Wall", o.wall],
        ["Centre from wall start", cm(o.centerFromStart)],
      ];
      if (o.door) {
        facts.push(
          ["Leaf", `${o.door.leaves} × ${o.door.leafWidth ? cm(o.door.leafWidth) : "?"}, ${o.door.style}`],
          ["Hinge / opens to", `${o.door.hinge} / ${o.door.opensTo}`],
        );
      }
      if (o.window) {
        facts.push(["Sashes", `${o.window.sashes} (${o.window.operation})`]);
        const r = o.window.railing;
        if (r) facts.push(["Railing", `${cm(r.height)}, flat bars ${r.barWidth} × ${r.barThickness} cm every ${r.barSpacing} cm`]);
      }
      return facts;
    }
    case "fixture": {
      const f = ref.element;
      return [
        ["Kind", f.kind],
        ["Position", `${f.position[0].toFixed(1)}, ${f.position[1].toFixed(1)}`],
        ["Rotation", `${f.rotation}°`],
        ["Parts", String(f.parts.length)],
        ["Materials", Object.entries(f.materials).map(([slot, id]) => `${slot}: ${id}`).join(", ")],
      ];
    }
  }
}

export const checksFor = (ap: ApartmentFile, id: string): Check[] => (ap.checks ?? []).filter((c) => c.refs?.includes(id));

export interface UncertainValue {
  id: string;
  title: string;
  /** Property path, or undefined for the element as a whole. */
  field?: string;
  confidence: Exclude<Confidence, "high">;
  source: string;
  note?: string;
}

/** Every element, part and field whose provenance is not "high" — the values to verify with a tape measure. */
export function uncertainValues(ap: ApartmentFile): UncertainValue[] {
  const out: UncertainValue[] = [];
  /** `prefix` names a fixture part; its own provenance is reported as field `prefix`, its fields as `prefix.field`. */
  const add = (id: string, title: string, p: Provenance, prefix?: string) => {
    const path = (field?: string) => (prefix && field ? `${prefix}.${field}` : (prefix ?? field));
    if (p.confidence !== "high") out.push({ id, title, field: path(), confidence: p.confidence, source: p.source, note: p.note });
    for (const [field, f] of Object.entries(p.fields ?? {})) {
      if (f.confidence !== "high") {
        out.push({ id, title, field: path(field), confidence: f.confidence, source: f.source, note: f.note });
      }
    }
  };
  for (const r of ap.rooms) add(r.id, r.name, r.provenance);
  for (const w of ap.walls) add(w.id, elementTitle({ kind: "wall", element: w }), w.provenance);
  for (const o of ap.openings) add(o.id, elementTitle({ kind: "opening", element: o }), o.provenance);
  for (const f of ap.fixtures) {
    add(f.id, f.name, f.provenance);
    f.parts.forEach((part, i) => {
      if (part.provenance) add(f.id, f.name, part.provenance, part.name ?? `parts[${i}]`);
    });
  }
  const rank = { low: 0, medium: 1 };
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
}

export interface UncertainGroup {
  confidence: UncertainValue["confidence"];
  field?: string;
  source: string;
  note?: string;
  items: { id: string; title: string }[];
}

/** Uncertain values sharing the same reason (confidence, field, source, note), e.g. "all door heights". */
export function groupUncertain(values: readonly UncertainValue[]): UncertainGroup[] {
  const groups = new Map<string, UncertainGroup>();
  for (const v of values) {
    const key = [v.confidence, v.field ?? "", v.source, v.note ?? ""].join("|");
    let g = groups.get(key);
    if (!g) {
      g = { confidence: v.confidence, field: v.field, source: v.source, note: v.note, items: [] };
      groups.set(key, g);
    }
    g.items.push({ id: v.id, title: v.title });
  }
  return [...groups.values()];
}
