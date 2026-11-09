import { z } from "zod";
import { MaterialId, Vec2 } from "./common";
import { SlotChoice } from "./catalogue";

/** One placed piece of furniture. */
export const PlacedItem = z.strictObject({
  /** Unique within the layout, e.g. "sofa-3-seater-1". */
  uid: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'letters, digits, "-" and "_", e.g. "sofa-3-seater-1"'),
  /** Catalogue item id. Unknown ids are kept and shown as a red placeholder box. */
  item: z.string().min(1),
  label: z.string().min(1).optional(),
  /** Plan [x, z] of the item's origin (bottom centre), cm. With `parent`: relative to the parent item. */
  position: Vec2,
  /** Degrees, clockwise seen from above; 0 = front faces +z (down the plan). With `parent`: relative to it. */
  rotation: z.number(),
  /** Wall items: floor to the item's bottom edge (cm). Other placement types derive it. */
  elevation: z.number().min(0).optional(),
  /** Stands on surface `surface` (index) of another placed item (Phase 3: stacking). */
  parent: z.strictObject({ uid: z.string().min(1), surface: z.number().int().min(0) }).optional(),
  /** Material slot -> preset id or "@original". Omitted slots use the catalogue default. */
  materials: z.record(z.string().min(1), SlotChoice).optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

/** Wall colours and floor materials of a layout (Phase 4). */
export const LayoutSurfaces = z.strictObject({
  walls: z
    .strictObject({
      /** Room id -> paint preset. */
      rooms: z.record(z.string().min(1), MaterialId).optional(),
      /** "<wallId>:left|right" -> paint preset (overrides the room colour). */
      faces: z.record(z.string().min(1), MaterialId).optional(),
    })
    .optional(),
  /** Room id -> floor preset. */
  floors: z.record(z.string().min(1), MaterialId).optional(),
});

export const LayoutFile = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Name of the layout this one was duplicated from. */
  createdFrom: z.string().optional(),
  /** ISO timestamp, set by the app on every save. */
  updatedAt: z.string().optional(),
  surfaces: LayoutSurfaces.optional(),
  items: z.array(PlacedItem),
});

export type PlacedItem = z.infer<typeof PlacedItem>;
export type LayoutSurfaces = z.infer<typeof LayoutSurfaces>;
export type LayoutFile = z.infer<typeof LayoutFile>;
