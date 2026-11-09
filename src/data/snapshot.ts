import type { ApartmentFile } from "../core/schema/apartment";
import type { MaterialPreset } from "../core/schema/materials";
import type { AreaCheck } from "../core/validate/apartment";
import type { Issue } from "../core/validate/issues";

/** Everything loaded from the data folders, validated. Replaced as a whole on every reload. */
export interface DataSnapshot {
  status: "loading" | "ready" | "error";
  /** Increments on every reload, so views can rebuild. */
  version: number;
  apartment?: ApartmentFile;
  materials: ReadonlyMap<string, MaterialPreset>;
  issues: Issue[];
  areaChecks: AreaCheck[];
  /** Set if the file API itself failed (not a data problem). */
  loadError?: string;
}

export const emptySnapshot = (): DataSnapshot => ({
  status: "loading",
  version: 0,
  materials: new Map(),
  issues: [],
  areaChecks: [],
});
