import { z } from 'zod'
import {
  hullParamsSchema,
  sailPlanIdSchema,
  thicknessStepSchema,
  timberZoneIdSchema,
} from '../data/schemas'

export const SCHEMA_VERSION = 1

/**
 * One mount's configuration. Port and starboard counts are always independent;
 * asymmetry is the normal case, not a special case (SPEC §5).
 */
export const mountConfigSchema = z.object({
  gunId: z.string().nullable(),
  port: z.number().int().nonnegative(),
  starboard: z.number().int().nonnegative(),
})
export type MountConfig = z.infer<typeof mountConfigSchema>

export const sailStateSchema = z.enum(['set', 'furled'])
export type SailState = z.infer<typeof sailStateSchema>

export const timberDesignSchema = z.object({
  speciesId: z.string(),
  zones: z.record(timberZoneIdSchema, thicknessStepSchema),
  nettings: z.boolean(),
})
export type TimberDesign = z.infer<typeof timberDesignSchema>

export const rigDesignSchema = z.object({
  sailPlanId: sailPlanIdSchema,
  sails: z.record(z.string(), sailStateSchema),
})
export type RigDesign = z.infer<typeof rigDesignSchema>

export const cosmeticsDesignSchema = z.object({
  figureheadId: z.string(),
  sternGalleryId: z.string(),
  paintSchemeId: z.string(),
  copperSheathing: z.boolean(),
})
export type CosmeticsDesign = z.infer<typeof cosmeticsDesignSchema>

/** The complete, self-contained description of a ship. */
export const designSchema = z.object({
  name: z.string(),
  presetId: z.string(),
  hull: hullParamsSchema,
  timber: timberDesignSchema,
  rig: rigDesignSchema,
  cosmetics: cosmeticsDesignSchema,
  mounts: z.record(z.string(), mountConfigSchema),
})
export type Design = z.infer<typeof designSchema>

export const derivedSchema = z.object({
  displacementTonnes: z.number(),
  draftM: z.number(),
  gmM: z.number(),
  staticListDeg: z.number(),
  capsizesAtRest: z.boolean(),
  totalGunWeightTonnes: z.number(),
  broadsideWeightPortLb: z.number(),
  broadsideWeightStarboardLb: z.number(),
  crewEstimate: z.number(),
  maxSpeedEstimateKn: z.number(),
  totalCostPounds: z.number(),
})
export type Derived = z.infer<typeof derivedSchema>

export const crewStationSchema = z.object({
  id: z.string(),
  type: z.enum([
    'helm',
    'gun-battery',
    'sail-handling',
    'lookout',
    'bow-chaser',
    'stern-chaser',
  ]),
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  crewRequired: z.number().int().positive(),
  deck: z.number().int().nonnegative().optional(),
  gunCount: z.number().int().nonnegative().optional(),
})
export type CrewStation = z.infer<typeof crewStationSchema>

export const shipwrightDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string(),
  hull: z.object({
    presetId: z.string(),
    params: hullParamsSchema,
  }),
  timber: timberDesignSchema,
  rig: rigDesignSchema,
  mounts: z.record(z.string(), mountConfigSchema),
  cosmetics: cosmeticsDesignSchema,
  derived: derivedSchema,
  stations: z.array(crewStationSchema),
})
export type ShipwrightDocument = z.infer<typeof shipwrightDocumentSchema>
