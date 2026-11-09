import { z } from "zod";
import { Id, MaterialId, Part, Point3, PositiveCm, Provenance, Vec2 } from "./common";

export const Underlay = z.strictObject({
  /** Image path relative to the repository root. */
  image: z.string().min(1),
  /** Model position (cm) of the image's top-left corner. */
  x: z.number(),
  z: z.number(),
  widthCm: PositiveCm,
  heightCm: PositiveCm.optional(),
  /** Degrees, clockwise seen from above. */
  rotation: z.number().optional(),
  defaultOpacity: z.number().min(0).max(1),
});

export const Room = z.strictObject({
  id: Id,
  name: z.string().min(1),
  kind: z.enum(["indoor", "balcony"]),
  /** Outline as drawn in the plan (BWF): interior walls at their centre line, exterior walls at the inner face. */
  outline: z.array(Vec2).min(3),
  /** Area printed on the floor plan (m²), used for the automatic area check. */
  labelledArea: z.number().positive().nullable().optional(),
  floorMaterial: MaterialId.optional(),
  wallMaterial: MaterialId.optional(),
  hasCeiling: z.boolean().optional(),
  provenance: Provenance,
});

export const Wall = z.strictObject({
  id: Id,
  kind: z.enum(["interior", "exterior", "party", "glazing"]),
  /** Centre line start / end. */
  start: Vec2,
  end: Vec2,
  thickness: PositiveCm,
  /** Default: the apartment's ceiling height. */
  height: PositiveCm.optional(),
  /** Rooms on either side, as seen on the plan when walking from start to end (informational). */
  sides: z.strictObject({ left: Id.optional(), right: Id.optional() }).optional(),
  provenance: Provenance,
});

const Side = z.enum(["left", "right"]);

export const Opening = z
  .strictObject({
    id: Id,
    kind: z.enum(["door", "window"]),
    /** Host wall id. */
    wall: Id,
    /** Distance along the wall centre line from `start` to the centre of the opening. */
    centerFromStart: z.number(),
    /** Opening in the wall (reveal to reveal). */
    width: PositiveCm,
    height: PositiveCm,
    sill: z.number().min(0),
    door: z
      .strictObject({
        /** Jamb with the hinges: the one nearer to the wall's start or end. */
        hinge: z.enum(["start", "end"]),
        /** Side of the wall (seen from start to end) the leaf swings into. */
        opensTo: Side,
        leaves: z.union([z.literal(1), z.literal(2)]),
        leafWidth: PositiveCm.optional(),
        style: z.enum(["solid", "glazed"]),
        isEntrance: z.boolean().optional(),
      })
      .optional(),
    window: z
      .strictObject({
        sashes: z.number().int().min(1),
        operation: z.enum(["casement", "tilt-turn", "fixed"]),
        opensTo: Side.optional(),
        /** Juliet railing outside the window: vertical flat bars between a top and a bottom rail. */
        railing: z
          .strictObject({
            /** Floor to the top of the railing. */
            height: PositiveCm,
            /** Centre-to-centre distance of the vertical bars. */
            barSpacing: PositiveCm,
            /** Flat-bar section: width across the railing line × thickness along it. The rails use the same section, lying flat. */
            barWidth: PositiveCm,
            barThickness: PositiveCm,
          })
          .optional(),
      })
      .optional(),
    provenance: Provenance,
  })
  .superRefine((o, ctx) => {
    if (o.kind === "door" && !o.door) ctx.addIssue({ code: "custom", message: 'doors need a "door" object', path: ["door"] });
    if (o.kind === "window" && !o.window)
      ctx.addIssue({ code: "custom", message: 'windows need a "window" object', path: ["window"] });
  });

export const Fixture = z.strictObject({
  id: Id,
  name: z.string().min(1),
  kind: z.enum(["kitchen", "built-in", "sanitary", "appliance", "column", "railing", "other"]),
  /** Origin of the fixture (parts are relative to it), plan coordinates. */
  position: Vec2,
  elevation: z.number().optional(),
  /** Degrees, clockwise seen from above; 0 = local +z (front) points down the plan. */
  rotation: z.number(),
  parts: z.array(Part).min(1),
  /** Material slot -> preset id. */
  materials: z.record(z.string(), MaterialId),
  /** Takes part in collision checks (furniture, walk mode). Default true. */
  collides: z.boolean().optional(),
  provenance: Provenance,
});

/** One item of the tape-measure checklist. */
export const Check = z.strictObject({
  id: z.string().regex(/^M\d{2}$/),
  title: z.string(),
  how: z.string(),
  priority: z.enum(["must", "nice"]),
  unit: z.enum(["cm", "deg"]),
  /** Value currently used by the model. */
  planValue: z.number(),
  /** Your tape-measure result (fill in, then ask GHCP to update the geometry). */
  measured: z.number().optional(),
  from: Point3.optional(),
  to: Point3.optional(),
  refs: z.array(z.string()).optional(),
});

const MaterialDefaults = z.strictObject({
  wallMaterial: MaterialId,
  floorMaterial: MaterialId,
  ceilingMaterial: MaterialId,
  doorLeafMaterial: MaterialId,
  doorFrameMaterial: MaterialId,
  windowFrameMaterial: MaterialId,
  sashMaterial: MaterialId,
  glassMaterial: MaterialId,
  railingMaterial: MaterialId,
});

export const ApartmentFile = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  name: z.string(),
  ceilingHeight: PositiveCm,
  north: z.strictObject({
    /** Compass bearing (degrees) of "up" on the floor plan (-z). */
    planUpBearing: z.number(),
  }),
  location: z.strictObject({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    timeZone: z.string(),
  }),
  defaults: MaterialDefaults,
  source: z
    .strictObject({
      pdfScale: z.string(),
      ptToCm: z.number().positive(),
      originPt: z.tuple([z.number(), z.number()]),
      note: z.string().optional(),
    })
    .optional(),
  underlay: Underlay.optional(),
  provenance: Provenance.optional(),
  rooms: z.array(Room).min(1),
  walls: z.array(Wall).min(1),
  openings: z.array(Opening),
  fixtures: z.array(Fixture),
  checks: z.array(Check).optional(),
});

export type Underlay = z.infer<typeof Underlay>;
export type Room = z.infer<typeof Room>;
export type Wall = z.infer<typeof Wall>;
export type Opening = z.infer<typeof Opening>;
export type Fixture = z.infer<typeof Fixture>;
export type Check = z.infer<typeof Check>;
export type ApartmentFile = z.infer<typeof ApartmentFile>;
