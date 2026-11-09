import { area, isSimplePolygon, length } from "../geometry/polygon";
import { ApartmentFile, type Wall } from "../schema/apartment";
import type { MaterialPreset } from "../schema/materials";
import { fromZod, issue, parseJson, type Issue } from "./issues";
import { checkMaterialRef } from "./materials";

export interface AreaCheck {
  room: string;
  name: string;
  computed: number; // m²
  labelled: number; // m²
  deviation: number; // fraction
  ok: boolean;
}

export interface ApartmentResult {
  apartment?: ApartmentFile;
  issues: Issue[];
  areaChecks: AreaCheck[];
}

export const AREA_TOLERANCE = 0.015;

export function wallLength(w: Pick<Wall, "start" | "end">): number {
  return length(w.start, w.end);
}

/**
 * Validate data/apartment.json: schema first, then semantic rules
 * (unique ids, openings inside their walls, material references, printed room areas).
 */
export function validateApartment(
  text: string,
  materials: ReadonlyMap<string, MaterialPreset> = new Map(),
  file = "data/apartment.json",
): ApartmentResult {
  const parsed = parseJson(text, file);
  if (!parsed.ok) return { issues: [parsed.issue], areaChecks: [] };
  const res = ApartmentFile.safeParse(parsed.value);
  if (!res.success) return { issues: fromZod(file, res.error.issues), areaChecks: [] };
  const ap = res.data;
  const issues: Issue[] = [];

  // unique ids across all element kinds (checks may reference any of them)
  const seen = new Map<string, string>();
  const reg = (id: string, path: string) => {
    if (seen.has(id)) issues.push(issue("error", file, path, `duplicate id "${id}" (also used at ${seen.get(id)})`));
    else seen.set(id, path);
  };
  ap.rooms.forEach((r, i) => reg(r.id, `rooms[${i}].id`));
  ap.walls.forEach((w, i) => reg(w.id, `walls[${i}].id`));
  ap.openings.forEach((o, i) => reg(o.id, `openings[${i}].id`));
  ap.fixtures.forEach((f, i) => reg(f.id, `fixtures[${i}].id`));

  // rooms
  const areaChecks: AreaCheck[] = [];
  ap.rooms.forEach((r, i) => {
    const a = area(r.outline);
    if (a < 1) issues.push(issue("error", file, `rooms[${i}].outline`, "room outline has no area"));
    if (!isSimplePolygon(r.outline)) issues.push(issue("error", file, `rooms[${i}].outline`, "room outline intersects itself"));
    if (r.labelledArea) {
      const computed = a / 10_000;
      const deviation = (computed - r.labelledArea) / r.labelledArea;
      const ok = Math.abs(deviation) <= AREA_TOLERANCE;
      areaChecks.push({ room: r.id, name: r.name, computed, labelled: r.labelledArea, deviation, ok });
      if (!ok) {
        issues.push(
          issue("warning", file, `rooms[${i}].outline`, `area ${computed.toFixed(2)} m² differs from the printed ${r.labelledArea} m² by ${(deviation * 100).toFixed(1)} %`),
        );
      }
    }
    for (const key of ["floorMaterial", "wallMaterial"] as const) {
      const id = r[key];
      const bad = id && checkMaterialRef(id, materials, file, `rooms[${i}].${key}`);
      if (bad) issues.push(bad);
    }
  });

  // walls
  const walls = new Map(ap.walls.map((w) => [w.id, w]));
  ap.walls.forEach((w, i) => {
    if (wallLength(w) < 1) issues.push(issue("error", file, `walls[${i}]`, "wall is shorter than 1 cm"));
    const h = w.height ?? ap.ceilingHeight;
    if (h > ap.ceilingHeight + 0.01) issues.push(issue("warning", file, `walls[${i}].height`, "wall is higher than the ceiling"));
  });

  // openings
  const byWall = new Map<string, { i: number; a: number; b: number }[]>();
  ap.openings.forEach((o, i) => {
    const w = walls.get(o.wall);
    if (!w) {
      issues.push(issue("error", file, `openings[${i}].wall`, `unknown wall "${o.wall}"`));
      return;
    }
    const L = wallLength(w);
    const a = o.centerFromStart - o.width / 2;
    const b = o.centerFromStart + o.width / 2;
    if (a < -0.5 || b > L + 0.5) {
      issues.push(issue("error", file, `openings[${i}]`, `opening (${a.toFixed(1)}…${b.toFixed(1)} cm) does not fit into wall "${w.id}" (${L.toFixed(1)} cm)`));
    }
    const h = w.height ?? ap.ceilingHeight;
    if (o.sill + o.height > h + 0.01) {
      issues.push(issue("error", file, `openings[${i}].height`, `sill + height (${o.sill + o.height} cm) exceeds the wall height (${h} cm)`));
    }
    const list = byWall.get(o.wall) ?? [];
    for (const other of list) {
      if (a < other.b - 0.5 && b > other.a + 0.5) {
        issues.push(issue("error", file, `openings[${i}]`, `overlaps openings[${other.i}] in wall "${w.id}"`));
      }
    }
    list.push({ i, a, b });
    byWall.set(o.wall, list);
  });

  // fixtures
  ap.fixtures.forEach((f, i) => {
    f.parts.forEach((p, j) => {
      if (!(p.material in f.materials)) {
        issues.push(
          issue("error", file, `fixtures[${i}].parts[${j}].material`, `material slot "${p.material}" is not defined in fixtures[${i}].materials`),
        );
      }
    });
    for (const [slot, id] of Object.entries(f.materials)) {
      const bad = checkMaterialRef(id, materials, file, `fixtures[${i}].materials.${slot}`);
      if (bad) issues.push(bad);
    }
  });

  // material defaults
  for (const [key, id] of Object.entries(ap.defaults)) {
    const bad = checkMaterialRef(id, materials, file, `defaults.${key}`);
    if (bad) issues.push(bad);
  }

  // checklist
  (ap.checks ?? []).forEach((c, i) => {
    for (const ref of c.refs ?? []) {
      if (!seen.has(ref)) issues.push(issue("warning", file, `checks[${i}].refs`, `unknown element "${ref}"`));
    }
    if (c.measured !== undefined && Math.abs(c.measured - c.planValue) > 3) {
      issues.push(
        issue("info", file, `checks[${i}]`, `${c.id} measured ${c.measured} ${c.unit} vs model ${c.planValue} ${c.unit}`, "Ask GHCP to update the geometry."),
      );
    }
  });

  return { apartment: ap, issues, areaChecks };
}
