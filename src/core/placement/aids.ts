/** Placement aids: each one can be switched on and off in the toolbar (saved as a UI preference). */

export type CollisionMode = "off" | "warn" | "block";

export interface Aids {
  /** Items whose back comes near a wall turn to it and stand flush (and slide into corners). */
  wallSnap: boolean;
  grid: boolean;
  /** Grid size in cm. Along the wall for wall-snapped and wall items. */
  gridSize: number;
  /** Rotate in 15° steps (Shift: 90°, Alt: free). Off: free rotation (Shift still 90°). */
  rotationSnap: boolean;
  /** Off, warn (red/amber highlight and a list) or block (items stop at obstacles and slide along them). */
  collisions: CollisionMode;
  /** Distances from the moving item to the nearest wall, fixture or item. */
  distances: boolean;
  /** Clearance zones of the items (free space they need), with a warning when something is in the way. */
  clearance: boolean;
}

export const GRID_SIZES = [1, 5, 10, 25, 50] as const;

export const DEFAULT_AIDS: Aids = {
  wallSnap: true,
  grid: false,
  gridSize: 10,
  rotationSnap: true,
  collisions: "warn",
  distances: true,
  clearance: true,
};

/** Rotation step (degrees, 0 = free) for the pressed modifier keys. */
export function rotationStep(aids: Pick<Aids, "rotationSnap">, keys: { shiftKey?: boolean; altKey?: boolean }): number {
  if (keys.altKey) return 0;
  if (keys.shiftKey) return 90;
  return aids.rotationSnap ? 15 : 0;
}

/** Aids from stored preferences, with defaults for anything missing or invalid. */
export function readAids(raw: unknown): Aids {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Aids, unknown>>;
  const bool = (k: keyof Aids) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_AIDS[k] as boolean));
  return {
    wallSnap: bool("wallSnap"),
    grid: bool("grid"),
    gridSize: (GRID_SIZES as readonly number[]).includes(r.gridSize as number) ? (r.gridSize as number) : DEFAULT_AIDS.gridSize,
    rotationSnap: bool("rotationSnap"),
    collisions: r.collisions === "off" || r.collisions === "warn" || r.collisions === "block" ? r.collisions : DEFAULT_AIDS.collisions,
    distances: bool("distances"),
    clearance: bool("clearance"),
  };
}
