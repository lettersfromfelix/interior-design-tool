import { z } from "zod";
import { HexColor, MaterialId, PositiveCm } from "./common";

export const PatternType = z.enum(["wood-grain", "planks", "tiles", "weave", "noise"]);

export const MaterialPreset = z.strictObject({
  /** "<group>.<name>"; the group is the part before the dot (wood, fabric, metal, paint, floor, …). */
  id: MaterialId,
  name: z.string().min(1),
  color: HexColor,
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  opacity: z.number().min(0).max(1).optional(),
  emissive: HexColor.optional(),
  emissiveIntensity: z.number().min(0).optional(),
  /** Procedural texture generated locally at real-world scale. */
  pattern: z
    .strictObject({
      type: PatternType,
      color2: HexColor,
      /** Size of one repeat in cm (tile edge, plank width, grain spacing, …). */
      scale: PositiveCm,
      strength: z.number().min(0).max(1).optional(),
      /** Tiles: joint colour and width (cm). Default: a shade between `color` and `color2`, 0.3 cm. */
      jointColor: HexColor.optional(),
      jointWidth: z.number().positive().max(5).optional(),
      /** Tiles: how much the tiles differ in tone (0 = all alike, 1 = strongly, as in natural stone). */
      variation: z.number().min(0).max(1).optional(),
      /** Tiles: soft clouds and veins in `color2` (0–1), as in marble or limestone. */
      veins: z.number().min(0).max(1).optional(),
      /** Tiles: small dark flecks (0–1), e.g. fossil fragments in limestone; colour `fleckColor` (default: dark `color2`). */
      flecks: z.number().min(0).max(1).optional(),
      fleckColor: HexColor.optional(),
    })
    .optional(),
  /** Optional image textures (paths relative to the repository root, e.g. data/textures/oak.jpg). */
  texture: z
    .strictObject({
      map: z.string().min(1),
      normalMap: z.string().min(1).optional(),
      /** Real-world size of one texture repeat in cm. */
      repeat: PositiveCm,
    })
    .optional(),
});

export const MaterialsFile = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  presets: z.array(MaterialPreset).min(1),
});

export type PatternType = z.infer<typeof PatternType>;
export type MaterialPreset = z.infer<typeof MaterialPreset>;
export type MaterialsFile = z.infer<typeof MaterialsFile>;

export const materialGroup = (id: string): string => id.slice(0, id.indexOf("."));
