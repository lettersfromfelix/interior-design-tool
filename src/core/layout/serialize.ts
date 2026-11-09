/**
 * Layout files are written for humans and GHCP: stable key order, values rounded to 0.1 cm / 0.1°, 2-space
 * indentation, and short objects (like one placed item) on a single line, so diffs stay small and readable.
 */
import type { LayoutFile, PlacedItem } from "../schema/layout";
import { normalizeRotation, round1 } from "./commands";

const LAYOUT_KEYS = ["$schema", "schemaVersion", "name", "description", "createdFrom", "updatedAt", "surfaces", "items"];
const ITEM_KEYS = ["uid", "item", "label", "position", "rotation", "elevation", "parent", "materials", "locked", "hidden"];

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Copy of `obj` with `keys` first, in that order, then any other keys; undefined values are dropped. */
function ordered(obj: object, keys: readonly string[]): Record<string, unknown> {
  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of [...keys, ...Object.keys(src)]) if (!(k in out) && src[k] !== undefined) out[k] = src[k];
  return out;
}

function inline(v: unknown): string {
  if (Array.isArray(v)) return v.length ? `[${v.map(inline).join(", ")}]` : "[]";
  if (isPlainObject(v)) {
    const e = Object.entries(v).filter(([, x]) => x !== undefined);
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(v) ?? "null";
}

/** JSON with 2-space indentation; nested objects and arrays stay on one line if they fit into `maxWidth`. */
export function formatJson(value: unknown, maxWidth = 120): string {
  const fmt = (v: unknown, indent: string, prefix: number, depth: number): string => {
    const one = inline(v);
    const container = Array.isArray(v) ? v.length > 0 : isPlainObject(v) && Object.keys(v).length > 0;
    if (!container || (depth > 0 && indent.length + prefix + one.length < maxWidth)) return one;
    const inner = `${indent}  `;
    if (Array.isArray(v)) return `[\n${v.map((x) => inner + fmt(x, inner, 0, depth + 1)).join(",\n")}\n${indent}]`;
    const lines = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => {
        const key = `${JSON.stringify(k)}: `;
        return inner + key + fmt(x, inner, key.length, depth + 1);
      });
    return `{\n${lines.join(",\n")}\n${indent}}`;
  };
  return fmt(value, "", 0, 0);
}

function placedForDisk(p: PlacedItem): Record<string, unknown> {
  return ordered(
    {
      ...p,
      position: [round1(p.position[0]), round1(p.position[1])],
      rotation: normalizeRotation(p.rotation),
      elevation: p.elevation === undefined ? undefined : round1(p.elevation),
    },
    ITEM_KEYS,
  );
}

/** The text written to layouts/<name>.json. `updatedAt` replaces the stored timestamp. */
export function serializeLayout(doc: LayoutFile, updatedAt?: string): string {
  const out = ordered({ ...doc, updatedAt: updatedAt ?? doc.updatedAt, items: doc.items.map(placedForDisk) }, LAYOUT_KEYS);
  return `${formatJson(out)}\n`;
}
