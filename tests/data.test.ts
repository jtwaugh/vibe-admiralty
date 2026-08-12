import { describe, expect, it } from 'vitest'
import {
  cosmeticsFile,
  gunsFile,
  guns,
  presetsFile,
  sailsFile,
  timberFile,
  timberSpecies,
} from '../src/data'
import type { GunPattern } from '../src/data/schemas'
import { computeDerived } from '../src/physics/derived'
import { buildShipModel } from '../src/physics/masses'
import { defaultDesign } from '../src/state/defaults'
import type { Design } from '../src/export/schema'

const RATED_PATTERNS: GunPattern[] = ['long', 'medium', 'carronade']

describe('data files', () => {
  it('all parse against their zod schemas', () => {
    // Parsing happens at module load, so reaching here at all is the assertion;
    // these checks guard against a file being emptied or a key being dropped.
    expect(gunsFile.guns.length).toBeGreaterThan(10)
    expect(timberFile.species).toHaveLength(3)
    expect(timberFile.zones).toHaveLength(5)
    expect(presetsFile.presets).toHaveLength(5)
    expect(sailsFile.plans).toHaveLength(3)
    expect(cosmeticsFile.figureheads.length).toBeGreaterThanOrEqual(3)
    expect(cosmeticsFile.sternGalleries.length).toBeGreaterThanOrEqual(2)
    expect(cosmeticsFile.paintSchemes.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps every preset default inside its own slider ranges', () => {
    const sliderKeys = ['keelLength', 'beam', 'depthOfHold', 'freeboard', 'sheer'] as const
    for (const preset of presetsFile.presets) {
      for (const key of sliderKeys) {
        const range = preset.ranges[key]
        expect(preset.params[key]).toBeGreaterThanOrEqual(range.min)
        expect(preset.params[key]).toBeLessThanOrEqual(range.max)
      }
    }
  })

  it('has unique ids for every gun and preset', () => {
    const gunIds = new Set(guns.map((g) => g.id))
    expect(gunIds.size).toBe(guns.length)
    const presetIds = new Set(presetsFile.presets.map((p) => p.id))
    expect(presetIds.size).toBe(presetsFile.presets.length)
  })

  for (const pattern of RATED_PATTERNS) {
    it(`has masses and costs monotonic in shot weight for ${pattern} guns`, () => {
      const rated = guns
        .filter((g) => g.pattern === pattern)
        .sort((a, b) => a.shotWeightLb - b.shotWeightLb)
      expect(rated.length).toBeGreaterThan(2)
      for (let i = 1; i < rated.length; i++) {
        expect(rated[i].massKg).toBeGreaterThan(rated[i - 1].massKg)
        expect(rated[i].costPounds).toBeGreaterThan(rated[i - 1].costPounds)
      }
    })
  }

  it('keeps carronade lighter and cheaper than medium, and medium than long', () => {
    const byRating = new Map<number, Partial<Record<GunPattern, (typeof guns)[number]>>>()
    for (const gun of guns) {
      if (!RATED_PATTERNS.includes(gun.pattern)) continue
      const entry = byRating.get(gun.shotWeightLb) ?? {}
      entry[gun.pattern] = gun
      byRating.set(gun.shotWeightLb, entry)
    }
    let compared = 0
    for (const [, entry] of byRating) {
      const { carronade, medium, long } = entry
      if (carronade && medium) {
        expect(carronade.massKg).toBeLessThan(medium.massKg)
        expect(carronade.costPounds).toBeLessThan(medium.costPounds)
        compared++
      }
      if (medium && long) {
        expect(medium.massKg).toBeLessThan(long.massKg)
        expect(medium.costPounds).toBeLessThan(long.costPounds)
        compared++
      }
    }
    expect(compared).toBeGreaterThanOrEqual(6)
  })

  it('orders timber species by density and price together', () => {
    const sorted = [...timberSpecies].sort((a, b) => a.density - b.density)
    expect(sorted.map((s) => s.id)).toEqual(['baltic-fir', 'english-oak', 'live-oak'])
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].costPerTonnePounds).toBeGreaterThan(sorted[i - 1].costPerTonnePounds)
    }
  })
})

describe('cost and mass readouts', () => {
  const base = defaultDesign('third-rate-74')

  function withSpecies(speciesId: string): Design {
    return { ...base, timber: { ...base.timber, speciesId } }
  }

  it('costs more in live oak than English oak, and more than Baltic fir', () => {
    const fir = computeDerived(buildShipModel(withSpecies('baltic-fir'))).totalCostPounds
    const english = computeDerived(buildShipModel(withSpecies('english-oak'))).totalCostPounds
    const live = computeDerived(buildShipModel(withSpecies('live-oak'))).totalCostPounds
    expect(english).toBeGreaterThan(fir)
    expect(live).toBeGreaterThan(english)
  })

  it('displaces more in live oak than in Baltic fir', () => {
    const fir = computeDerived(buildShipModel(withSpecies('baltic-fir'))).displacementTonnes
    const live = computeDerived(buildShipModel(withSpecies('live-oak'))).displacementTonnes
    expect(live).toBeGreaterThan(fir)
  })

  it('charges for copper sheathing', () => {
    const bare = computeDerived(buildShipModel(base)).totalCostPounds
    const coppered = computeDerived(
      buildShipModel({
        ...base,
        cosmetics: { ...base.cosmetics, copperSheathing: true },
      }),
    ).totalCostPounds
    expect(coppered).toBeGreaterThan(bare)
  })

  it('prices a standard third rate between £30,000 and £80,000', () => {
    const total = computeDerived(buildShipModel(base)).totalCostPounds
    expect(total).toBeGreaterThan(30_000)
    expect(total).toBeLessThan(80_000)
  })

  it('counts broadside weight per side from the mounted guns', () => {
    const derived = computeDerived(buildShipModel(base))
    expect(derived.broadsideWeightPortLb).toBe(derived.broadsideWeightStarboardLb)
    expect(derived.broadsideWeightPortLb).toBeGreaterThan(500)
    expect(derived.crewEstimate).toBeGreaterThan(base.presetId ? 500 : 0)
  })
})
