/** Material slot rules shared by validation, the renderer and the properties panel. */
import type { CatalogueItem, MaterialSlot } from "../schema/catalogue";
import { ORIGINAL } from "../schema/catalogue";

export { ORIGINAL };

export const isModelItem = (item: Pick<CatalogueItem, "geometry">): boolean => item.geometry.type === "model";

/** Does an `allowed` entry ("wood.oak-natural", "wood.*" or "@original") match a choice? */
export function matchesAllowed(entry: string, choice: string): boolean {
  if (entry.endsWith(".*")) return choice !== ORIGINAL && choice.startsWith(entry.slice(0, -1));
  return entry === choice;
}

/** Is `choice` (a preset id or "@original") allowed in this slot? Existence of the preset is not checked here. */
export function isAllowed(slot: MaterialSlot, choice: string, model: boolean): boolean {
  if (choice === ORIGINAL) return model && (slot.default === ORIGINAL || (slot.allowed ?? []).includes(ORIGINAL));
  if (!slot.allowed) return true;
  return slot.allowed.some((a) => matchesAllowed(a, choice));
}

/** Choices offered for a slot, in the order of data/materials.json ("@original" first for model items). */
export function allowedChoices(slot: MaterialSlot, presetIds: Iterable<string>, model: boolean): string[] {
  const out: string[] = [];
  if (isAllowed(slot, ORIGINAL, model)) out.push(ORIGINAL);
  for (const id of presetIds) if (isAllowed(slot, id, model)) out.push(id);
  return out;
}

const isAvailable = (choice: string, presets: ReadonlySet<string> | ReadonlyMap<string, unknown>, model: boolean) =>
  choice === ORIGINAL ? model : presets.has(choice);

/**
 * The choice that is actually used for a slot: the placed item's choice if it exists and is allowed, otherwise the
 * slot default. `fallback` is true if the placed item's choice had to be replaced. `value` is "" if even the default
 * is unknown (the renderer then uses neutral grey).
 */
export function resolveSlot(
  slot: MaterialSlot,
  choice: string | undefined,
  presets: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  model: boolean,
): { value: string; fallback: boolean } {
  if (choice !== undefined && isAllowed(slot, choice, model) && isAvailable(choice, presets, model)) {
    return { value: choice, fallback: false };
  }
  const value = isAvailable(slot.default, presets, model) ? slot.default : "";
  return { value, fallback: choice !== undefined };
}

/** Resolved choice for every slot of an item. */
export function resolveMaterials(
  item: CatalogueItem,
  chosen: Readonly<Record<string, string>> | undefined,
  presets: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): Record<string, string> {
  const model = isModelItem(item);
  const out: Record<string, string> = {};
  for (const [name, slot] of Object.entries(item.materialSlots)) out[name] = resolveSlot(slot, chosen?.[name], presets, model).value;
  return out;
}
