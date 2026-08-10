import { z } from 'zod'

/**
 * Zod schemas for every data file under src/data.
 * Data files are the source of truth for parts; component code must never
 * hard-code a gun rating, timber species or preset.
 */

export const gunPatternSchema = z.enum(['long', 'medium', 'carronade', 'swivel'])
export type GunPattern = z.infer<typeof gunPatternSchema>

export const gunSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pattern: gunPatternSchema,
  /** Nominal shot weight in pounds. 0.5 for swivels. */
  shotWeightLb: z.number().positive(),
  /** Total mounted mass: barrel plus carriage, kilograms. */
  massKg: z.number().positive(),
  costPounds: z.number().positive(),
  /** Barrel length in metres, used for the gun mesh. */
  barrelLengthM: z.number().positive(),
  /** Bore diameter in metres, used for the gun mesh. */
  boreM: z.number().positive(),
  crewPerGun: z.number().int().positive(),
})
export type Gun = z.infer<typeof gunSchema>

export const gunsFileSchema = z.object({
  guns: z.array(gunSchema).min(1),
})

export const timberSpeciesSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Specific gravity; also the relative multiplier on hull structural mass. */
  density: z.number().positive(),
  /** Relative price per unit mass of worked timber. */
  costPerTonnePounds: z.number().positive(),
  /** Base colour for the topside material. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})
export type TimberSpecies = z.infer<typeof timberSpeciesSchema>

export const timberZoneIdSchema = z.enum([
  'bottom',
  'wales',
  'topsides',
  'bulwarks',
  'deck',
])
export type TimberZoneId = z.infer<typeof timberZoneIdSchema>

export const thicknessStepSchema = z.enum(['light', 'standard', 'heavy'])
export type ThicknessStep = z.infer<typeof thicknessStepSchema>

export const timberZoneSchema = z.object({
  id: timberZoneIdSchema,
  name: z.string().min(1),
  /** Plank thickness in metres for each of the three steps. */
  thicknessM: z.object({
    light: z.number().positive(),
    standard: z.number().positive(),
    heavy: z.number().positive(),
  }),
  /**
   * Frames, knees, beams and fastenings are not modelled as surfaces. The
   * planking mass of this zone is multiplied by this to stand in for the whole
   * structure, and the factor is much larger low down, where the floors,
   * futtocks and keelson are, than it is in a bulwark.
   */
  structureFactor: z.number().positive(),
})
export type TimberZone = z.infer<typeof timberZoneSchema>

export const timberFileSchema = z.object({
  species: z.array(timberSpeciesSchema).min(1),
  zones: z.array(timberZoneSchema).length(5),
  /** Hammock nettings: mass per metre of rail, and cost per metre. */
  nettings: z.object({
    massKgPerMetre: z.number().positive(),
    costPoundsPerMetre: z.number().positive(),
  }),
  copperSheathing: z.object({
    /** Sheet mass per square metre of wetted surface. */
    massKgPerSquareMetre: z.number().positive(),
    costPoundsPerSquareMetre: z.number().positive(),
    /** Effective speed bonus in knots, per SPEC §5. */
    speedBonusKn: z.number(),
  }),
})

export const sternTypeSchema = z.enum(['square', 'round'])
export type SternType = z.infer<typeof sternTypeSchema>

export const hullParamsSchema = z.object({
  /** Overall hull length on the baseline, metres. */
  keelLength: z.number().positive(),
  /** Maximum moulded breadth, metres. */
  beam: z.number().positive(),
  /** Baseline (top of keel) to the lowest gun deck, metres. */
  depthOfHold: z.number().positive(),
  /** Weather deck to the top of the rail, metres. */
  freeboard: z.number().positive(),
  sheer: z.number().min(0).max(1),
  bowFullness: z.number().min(0).max(1),
  sternType: sternTypeSchema,
  deckCount: z.number().int().min(1).max(3),
})
export type HullParams = z.infer<typeof hullParamsSchema>

const rangeSchema = z
  .object({ min: z.number(), max: z.number() })
  .refine((r) => r.max > r.min, 'range max must exceed min')

export const hullPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  blurb: z.string().min(1),
  nominalGuns: z.number().int().positive(),
  params: hullParamsSchema,
  ranges: z.object({
    beam: rangeSchema,
    freeboard: rangeSchema,
    sheer: rangeSchema,
  }),
  mastCount: z.number().int().min(1).max(3),
  /** Maximum guns per side on each gun deck, lowest deck first. */
  gunsPerSideByDeck: z.array(z.number().int().nonnegative()).min(1),
  /** Maximum guns per side on the quarterdeck and forecastle batteries. */
  quarterdeckGunsPerSide: z.number().int().nonnegative(),
  forecastleGunsPerSide: z.number().int().nonnegative(),
  swivelsPerSide: z.number().int().nonnegative(),
  /** Permanent iron and shingle ballast, tonnes, stowed low in the hold. */
  ballastTonnes: z.number().nonnegative(),
  /** Water, provisions, powder, shot and boats, tonnes, stowed in the hold. */
  storesTonnes: z.number().nonnegative(),
  /** Ship's company excluding gun crews, which are derived from armament. */
  baseCrew: z.number().int().positive(),
  /** Yard price of the bare hull before timber and armament multipliers. */
  hullBaseCostPounds: z.number().positive(),
})
export type HullPreset = z.infer<typeof hullPresetSchema>

export const presetsFileSchema = z.object({
  presets: z.array(hullPresetSchema).min(1),
})

export const sailTierSchema = z.enum([
  'course',
  'topsail',
  'topgallant',
  'jib',
  'spanker',
])
export type SailTier = z.infer<typeof sailTierSchema>

export const sailPlanIdSchema = z.enum(['reduced', 'standard', 'over-canvased'])
export type SailPlanId = z.infer<typeof sailPlanIdSchema>

export const sailDefSchema = z.object({
  tier: sailTierSchema,
  /**
   * Area as a fraction of beam x beam, scaled by the hull size in
   * buildSailPlan; keeps sail area proportional to the ship.
   */
  areaFactor: z.number().positive(),
  /**
   * Height of the centre of effort above the weather deck, as a multiple of
   * the ship's beam.
   */
  heightFactor: z.number().positive(),
  /** Aerodynamic force coefficient at the optimum apparent wind angle. */
  coefficient: z.number().positive(),
})
export type SailDef = z.infer<typeof sailDefSchema>

export const sailsFileSchema = z.object({
  /** Square sails carried on every mast. */
  squareSails: z.array(sailDefSchema).min(1),
  /** Fore-and-aft groups carried once per ship. */
  foreAndAft: z.array(sailDefSchema).min(1),
  plans: z.array(
    z.object({
      id: sailPlanIdSchema,
      name: z.string().min(1),
      areaScale: z.number().positive(),
    }),
  ).length(3),
  /** Mass of a mast, its yards and standing rigging, per square metre of sail. */
  rigMassKgPerSquareMetre: z.number().positive(),
  rigCostPoundsPerSquareMetre: z.number().positive(),
})

export const cosmeticsFileSchema = z.object({
  figureheads: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      massKg: z.number().nonnegative(),
      costPounds: z.number().nonnegative(),
    }),
  ).min(1),
  sternGalleries: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      massKg: z.number().nonnegative(),
      costPounds: z.number().nonnegative(),
    }),
  ).min(1),
  paintSchemes: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      hullColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      stripeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      /** Number of horizontal stripes drawn on the topsides. */
      stripes: z.number().int().nonnegative(),
      costPounds: z.number().nonnegative(),
    }),
  ).min(1),
})
