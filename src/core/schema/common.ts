import { z } from "zod";

/** Centimetres. */
export const Cm = z.number().describe("centimetres");
export const PositiveCm = z.number().positive().describe("centimetres (> 0)");
/** Plan coordinates [x, z] in cm: x = right on the floor plan, z = down on the floor plan. */
export const Vec2 = z.tuple([z.number(), z.number()]).describe("[x, z] in cm (plan coordinates)");
/** 3D point [x, y, z] in cm, y = up. */
export const Point3 = z.tuple([z.number(), z.number(), z.number()]).describe("[x, y, z] in cm, y up");
export const Vec3 = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
export const PartialVec3 = z.strictObject({
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
});

export const Id = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use kebab-case: lowercase letters, digits and single dashes");

/** Material preset id: "<group>.<name>", e.g. "wood.oak-natural". */
export const MaterialId = z
  .string()
  .regex(/^[a-z0-9-]+\.[a-z0-9-]+$/, 'material ids look like "<group>.<name>", e.g. "wood.oak-natural"');

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colours are "#RRGGBB"');

export const Confidence = z.enum(["high", "medium", "low"]);
export const Source = z.enum(["plan", "photo", "assumed", "user", "measured"]);

export const FieldProvenance = z.strictObject({
  confidence: Confidence,
  source: Source,
  note: z.string().optional(),
});

/** Where a value comes from and how sure we are. `fields` overrides individual properties (dot paths). */
export const Provenance = z.strictObject({
  confidence: Confidence,
  source: Source,
  note: z.string().optional(),
  fields: z.record(z.string(), FieldProvenance).optional(),
});

const PartBase = z.strictObject({
  name: z.string().optional(),
  /** Centre of the part (extrusion / lathe: centre of the base) in item-local cm. */
  position: Vec3,
  /** Degrees. y = clockwise seen from above (like item rotation); x / z = tilt (right-hand rule). */
  rotation: PartialVec3.optional(),
  /** Material slot name. */
  material: z.string().min(1),
  /** Add mirrored copies with negated x and/or z, e.g. ["x", "z"] for four table legs. */
  mirror: z.array(z.enum(["x", "z"])).max(2).optional(),
  /** Add `count - 1` further copies, each offset by `step`. */
  repeat: z.strictObject({ count: z.number().int().min(1).max(200), step: Vec3 }).optional(),
  /**
   * Add `count - 1` further copies, each rotated by a further `step` degrees (clockwise seen from above) around the
   * vertical axis through the item's origin, e.g. the bars of a round railing or chairs around a round table.
   */
  repeatAround: z
    .strictObject({ count: z.number().int().min(1).max(360), step: z.number().min(-360).max(360) })
    .optional(),
  /**
   * How the part shows in the 2D plan. "solid" (default): as seen from above. "dashed": only as a dashed outline of its
   * footprint, the drawing convention for things overhead (e.g. wall cabinets), so it doesn't hide what is below it.
   */
  plan: z.enum(["solid", "dashed"]).optional(),
  provenance: Provenance.optional(),
});

export const BoxPart = PartBase.extend({
  shape: z.literal("box"),
  size: z.strictObject({ x: PositiveCm, y: PositiveCm, z: PositiveCm }),
  cornerRadius: z.number().min(0).optional(),
});
export const CylinderPart = PartBase.extend({
  shape: z.literal("cylinder"),
  radius: z.number().min(0),
  radiusTop: z.number().min(0).optional(),
  height: PositiveCm,
});
export const SpherePart = PartBase.extend({
  shape: z.literal("sphere"),
  radius: PositiveCm,
  scale: Vec3.optional(),
});
/** Partial ring or revolution: degrees, starting at the local +x axis and running clockwise seen from above. */
const Arc = z.number().gt(0).max(360);

export const TorusPart = PartBase.extend({
  shape: z.literal("torus"),
  radius: PositiveCm,
  tube: PositiveCm,
  arc: Arc.optional(),
});
export const ExtrusionPart = PartBase.extend({
  shape: z.literal("extrusion"),
  /** Footprint polygon [x, z] (cm, relative to `position`), extruded upwards by `height`. */
  points: z.array(Vec2).min(3),
  height: PositiveCm,
});
export const LathePart = PartBase.extend({
  shape: z.literal("lathe"),
  /** Profile points [radius, y] (cm, relative to `position`), revolved around the vertical axis. */
  profile: z.array(z.tuple([z.number().min(0), z.number()])).min(2),
  arc: Arc.optional(),
});

export const Part = z.discriminatedUnion("shape", [
  BoxPart,
  CylinderPart,
  SpherePart,
  TorusPart,
  ExtrusionPart,
  LathePart,
]);

export type Vec2 = z.infer<typeof Vec2>;
export type Point3 = z.infer<typeof Point3>;
export type Vec3 = z.infer<typeof Vec3>;
export type Confidence = z.infer<typeof Confidence>;
export type Provenance = z.infer<typeof Provenance>;
export type Part = z.infer<typeof Part>;
