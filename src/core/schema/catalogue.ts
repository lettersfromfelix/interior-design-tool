import { z } from "zod";
import { Id, MaterialId, Part, PartialVec3, PositiveCm, Vec2 } from "./common";

/** Material slot value that keeps the 3D model's own material (GLB/GLTF items only). */
export const ORIGINAL = "@original";

/** A preset id ("wood.oak-natural") or "@original". */
export const SlotChoice = z.union([MaterialId, z.literal(ORIGINAL)]);

const AllowedEntry = z
  .string()
  .regex(
    /^(@original|[a-z0-9-]+\.([a-z0-9-]+|\*))$/,
    'use a preset id ("wood.oak-natural"), a whole group ("wood.*") or "@original"',
  );

export const MaterialSlot = z.strictObject({
  /** Shown in the properties panel, e.g. "Upholstery". Defaults to the slot name. */
  label: z.string().min(1).optional(),
  /** Preset used until you pick another one; "@original" keeps the model's own material. */
  default: SlotChoice,
  /** Presets offered for this slot: preset ids and/or whole groups ("fabric.*"). Omitted = all presets. */
  allowed: z.array(AllowedEntry).min(1).optional(),
});

export const Placement = z.discriminatedUnion("type", [
  /** Stands on the floor. */
  z.strictObject({ type: z.literal("floor") }),
  /** Hangs on a wall; elevation = floor to the item's bottom edge (cm). */
  z.strictObject({
    type: z.literal("wall"),
    defaultElevation: z.number().min(0),
    minElevation: z.number().min(0).optional(),
    maxElevation: z.number().min(0).optional(),
  }),
  /**
   * Stands on another item's surface (lamp on a sideboard). `alsoOnFloor` allows it on the floor too. `hangsBelow`:
   * how far its parts hang below the surface it stands on (cm), e.g. the sides of a duvet or a tablecloth.
   */
  z.strictObject({ type: z.literal("onTop"), alsoOnFloor: z.boolean().optional(), hangsBelow: PositiveCm.optional() }),
  /** Hangs from the ceiling: the item's top touches the ceiling (include the cord in the geometry). */
  z.strictObject({ type: z.literal("ceiling") }),
]);

/** Built from primitives (see docs/DATA.md "Parts"), in item-local cm: origin at the bottom centre, front = +z. */
export const ParametricGeometry = z.strictObject({
  type: z.literal("parametric"),
  parts: z.array(Part).min(1),
});

/** A GLB/GLTF file, scaled to `dimensions`. */
export const ModelGeometry = z.strictObject({
  type: z.literal("model"),
  /** Path relative to the item file, e.g. "model.glb". */
  src: z.string().regex(/^[^\\:]+\.(glb|gltf)$/i, 'a relative path to a .glb or .gltf file, e.g. "model.glb"'),
  /** "stretch" (default): scale each axis to `dimensions`. "uniform": keep the proportions, fit inside, centred. */
  fit: z.enum(["stretch", "uniform"]).optional(),
  /** Degrees, applied before fitting, so that the front faces +z and up is +y. Same convention as part rotations. */
  rotation: PartialVec3.optional(),
  /** Model material name -> slot name. Unmapped materials keep their look. */
  materialMap: z.record(z.string().min(1), z.string().min(1)).optional(),
});

export const Geometry = z.discriminatedUnion("type", [ParametricGeometry, ModelGeometry]);

/** A horizontal area that `onTop` items can stand on (stacking). */
export const Surface = z.strictObject({
  name: z.string().min(1).optional(),
  /** Above the item's bottom (cm). */
  height: PositiveCm,
  width: PositiveCm,
  depth: PositiveCm,
  /** Centre [x, z] in item-local cm; default [0, 0]. */
  center: Vec2.optional(),
  /** Free height above the surface, e.g. up to the next shelf. */
  maxItemHeight: PositiveCm.optional(),
});

/** Free space needed beyond the footprint (cm), e.g. for doors, drawers or pulling out a chair. */
export const Clearance = z.strictObject({
  front: z.number().min(0).optional(),
  back: z.number().min(0).optional(),
  left: z.number().min(0).optional(),
  right: z.number().min(0).optional(),
  note: z.string().optional(),
});

export const Price = z.strictObject({
  amount: z.number().min(0),
  currency: z.string().regex(/^[A-Z]{3}$/, 'a three-letter currency code, e.g. "CHF"'),
});

export const CatalogueItem = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  /** kebab-case, unique; should equal the file name (or the folder name for item.json). */
  id: Id,
  name: z.string().min(1),
  /** kebab-case: seating, table, storage, bed, lighting, decor, rug, … New categories just appear. */
  category: Id,
  tags: z.array(z.string().min(1)).optional(),
  /** Authoritative real size (cm): width along x, depth along z (front = +z), height along y. */
  dimensions: z.strictObject({ width: PositiveCm, depth: PositiveCm, height: PositiveCm }),
  placement: Placement,
  geometry: Geometry,
  /** Slot name -> definition. Parametric parts reference slots by name (`material`). */
  materialSlots: z.record(z.string().min(1), MaterialSlot),
  surfaces: z.array(Surface).optional(),
  clearance: Clearance.optional(),
  /** Shape used for collision checks. Default: parametric "parts", model "box". Rugs: "none". */
  collision: z.enum(["parts", "box", "none"]).optional(),
  /** Optional finer collision shape for model items. Their `material` is ignored. */
  collisionParts: z.array(Part).optional(),
  price: Price.optional(),
  productUrl: z.url({ protocol: /^https?$/ }).optional(),
  notes: z.string().optional(),
});

export type SlotChoice = z.infer<typeof SlotChoice>;
export type MaterialSlot = z.infer<typeof MaterialSlot>;
export type Placement = z.infer<typeof Placement>;
export type PlacementType = Placement["type"];
export type ModelGeometry = z.infer<typeof ModelGeometry>;
export type Surface = z.infer<typeof Surface>;
export type CatalogueItem = z.infer<typeof CatalogueItem>;

/** How far the item's parts may reach below its bottom (cm): `hangsBelow` of an onTop item, otherwise 0. */
export const hangsBelow = (item: Pick<CatalogueItem, "placement">): number =>
  item.placement.type === "onTop" ? (item.placement.hangsBelow ?? 0) : 0;
