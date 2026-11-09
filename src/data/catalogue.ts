/** The validated furniture catalogue: every valid item file in catalogue/, by id. */
import type { AssetEntry, FileEntry } from "../core/files";
import { hashText } from "../core/hash";
import type { CatalogueItem } from "../core/schema/catalogue";
import type { MaterialPreset } from "../core/schema/materials";
import { assetIndex, validateCatalogue } from "../core/validate/catalogue";
import type { Issue } from "../core/validate/issues";

export interface CatalogueEntry {
  item: CatalogueItem;
  /** Repository-relative path of the item file. */
  file: string;
  /** Changes whenever the item file or its model file changes (used for caching and live reload). */
  rev: string;
  /** URL of the model file (model items only), including the revision so a changed file is fetched again. */
  modelUrl?: string;
  /** Number of warnings for this item (shown as a badge). */
  warnings: number;
}

export interface CatalogueSnapshot {
  status: "loading" | "ready";
  /** Increments on every rebuild. */
  version: number;
  /** Valid items by id, in file order. */
  entries: ReadonlyMap<string, CatalogueEntry>;
  issues: Issue[];
}

export interface DirListing {
  files: FileEntry[];
  assets: AssetEntry[];
}

export const emptyCatalogue = (): CatalogueSnapshot => ({ status: "loading", version: 0, entries: new Map(), issues: [] });

const urlFor = (repoPath: string, rev: string) => `/${repoPath.split("/").map(encodeURIComponent).join("/")}?rev=${rev}`;

/** Validate the catalogue folder against the current materials and apartment. Never throws. */
export function buildCatalogue(
  listing: DirListing,
  presets: ReadonlyMap<string, MaterialPreset>,
  ceilingHeight: number | undefined,
  version: number,
): CatalogueSnapshot {
  const res = validateCatalogue(listing.files, { presets, assets: assetIndex(listing.assets.map((a) => a.path)), ceilingHeight });
  const texts = new Map(listing.files.map((f) => [f.path, f.text ?? ""]));
  const mtimes = new Map(listing.assets.map((a) => [a.path, a.mtime]));
  const entries = new Map<string, CatalogueEntry>();
  for (const v of res.items) {
    const model = v.modelPath ? `-${Math.round(mtimes.get(v.modelPath) ?? 0).toString(36)}` : "";
    const rev = hashText(texts.get(v.file) ?? "") + model;
    entries.set(v.item.id, {
      item: v.item,
      file: v.file,
      rev,
      modelUrl: v.modelPath ? urlFor(v.modelPath, rev) : undefined,
      warnings: v.warnings,
    });
  }
  return { status: "ready", version, entries, issues: res.issues };
}
