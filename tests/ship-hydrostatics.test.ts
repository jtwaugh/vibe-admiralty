import { describe, expect, it } from 'vitest'
import { getPreset, hullPresets } from '../src/data'
import type { Design } from '../src/export/schema'
import { computeDerived } from '../src/physics/derived'
import {
  hullSections,
  metacentricHeight,
  solveEquilibriumHeel,
} from '../src/physics/hydrostatics'
import type { MassItem } from '../src/physics/masses'
import { buildShipModel, combineMasses } from '../src/physics/masses'
import { defaultDesign } from '../src/state/defaults'

function withMount(design: Design, id: string, patch: Partial<Design['mounts'][string]>): Design {
  return {
    ...design,
    mounts: { ...design.mounts, [id]: { ...design.mounts[id], ...patch } },
  }
}

/** GM of a ship model with extra mass items added to its inventory. */
function gmWithExtra(design: Design, extra: MassItem[]): number {
  const model = buildShipModel(design)
  const masses = combineMasses([...model.masses.items, ...extra])
  return metacentricHeight(hullSections(model.hull), masses.totalKg, masses.centreOfGravity)
}

describe('frigate hydrostatics', () => {
  const design = defaultDesign('frigate-38')
  const derived = computeDerived(buildShipModel(design))

  it('floats in the expected draft and stability band with standard everything', () => {
    expect(derived.draftM).toBeGreaterThan(4)
    expect(derived.draftM).toBeLessThan(7)
    expect(derived.gmM).toBeGreaterThan(0.5)
    expect(derived.gmM).toBeLessThan(2.5)
  })

  it('draws more water as the depth of hold increases', () => {
    const preset = getPreset('frigate-38')
    const { min, max } = preset.ranges.depthOfHold
    const drafts = [0, 1, 2, 3].map((i) => {
      const depthOfHold = min + ((max - min) * i) / 3
      const deeper = { ...design, hull: { ...design.hull, depthOfHold } }
      return computeDerived(buildShipModel(deeper)).draftM
    })
    for (let i = 1; i < drafts.length; i++) {
      expect(drafts[i]).toBeGreaterThan(drafts[i - 1])
    }
  })

  // Ballast and stores scale with length, so a stretched hull displaces more
  // without sitting appreciably deeper. If this drifts, the scaling in
  // masses.ts has come adrift from the geometry.
  it('displaces more but keeps her draft when she is stretched', () => {
    const preset = getPreset('frigate-38')
    const ends = [preset.ranges.keelLength.min, preset.ranges.keelLength.max].map((keelLength) =>
      computeDerived(buildShipModel({ ...design, hull: { ...design.hull, keelLength } })),
    )
    const [short, long] = ends
    expect(long.displacementTonnes).toBeGreaterThan(short.displacementTonnes * 1.15)
    expect(long.draftM).toBeGreaterThan(short.draftM * 0.9)
    expect(long.draftM).toBeLessThan(short.draftM * 1.1)
  })

  it('reports no static list when the armament is symmetric', () => {
    expect(derived.capsizesAtRest).toBe(false)
    expect(Math.abs(derived.staticListDeg)).toBeLessThan(0.05)
  })

  it('loses GM when 20 tonnes moves from the waterline to the bulwark rail', () => {
    const model = buildShipModel(design)
    const waterlineY = model.hull.params.depthOfHold * 0.62
    const bulwarkY = model.hull.railY - 0.3

    const low = gmWithExtra(design, [
      { label: 'test weight', group: 'fittings', massKg: 20_000, position: { x: 0, y: waterlineY, z: 0 } },
    ])
    const high = gmWithExtra(design, [
      { label: 'test weight', group: 'fittings', massKg: 20_000, position: { x: 0, y: bulwarkY, z: 0 } },
    ])
    expect(high).toBeLessThan(low)
  })

  it('loses GM when quarterdeck carronades are replaced by long 24-pounders', () => {
    const carronades = withMount(design, 'quarterdeck', { gunId: 'carronade-32' })
    const longGuns = withMount(design, 'quarterdeck', { gunId: 'long-24' })
    const gmCarronade = computeDerived(buildShipModel(carronades)).gmM
    const gmLong = computeDerived(buildShipModel(longGuns)).gmM
    expect(gmLong).toBeLessThan(gmCarronade)
  })
})

describe('asymmetric loading', () => {
  const base = defaultDesign('frigate-38')

  it('lists to port when every battery is loaded to port only, in zero wind', () => {
    let design = base
    for (const id of Object.keys(design.mounts)) {
      const config = design.mounts[id]
      design = withMount(design, id, { port: config.port, starboard: 0 })
    }
    const derived = computeDerived(buildShipModel(design))
    expect(derived.capsizesAtRest).toBe(false)
    // Port is negative z, so a port list is a negative heel.
    expect(derived.staticListDeg).toBeLessThan(-0.5)
  })

  it('increases the list monotonically as more mass moves to one side', () => {
    const angles: number[] = []
    for (const starboard of [14, 12, 10, 8, 6, 4, 2, 0]) {
      const design = withMount(base, 'battery-deck-0', { port: 14, starboard })
      angles.push(computeDerived(buildShipModel(design)).staticListDeg)
    }
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]).toBeLessThan(angles[i - 1])
    }
    expect(Math.abs(angles[0])).toBeLessThan(0.05)
  })
})

describe('capsize at rest', () => {
  it('finds no equilibrium for a narrow sloop carrying long 32s on one side', () => {
    const base = defaultDesign('sloop')
    const narrow: Design = {
      ...base,
      hull: { ...base.hull, beam: 6.6 },
    }
    const design = withMount(narrow, 'battery-deck-0', {
      gunId: 'long-32',
      port: 7,
      starboard: 0,
    })
    const model = buildShipModel(design)
    const result = solveEquilibriumHeel(
      hullSections(model.hull),
      model.masses.totalKg,
      model.masses.centreOfGravity,
      () => 0,
      { openings: model.sockets.openings },
    )
    expect(result.capsized).toBe(true)
    expect(computeDerived(model).capsizesAtRest).toBe(true)
  })

  it('keeps its feet when the same guns are shared between both sides', () => {
    const base = defaultDesign('sloop')
    const narrow: Design = { ...base, hull: { ...base.hull, beam: 6.6 } }
    const design = withMount(narrow, 'battery-deck-0', {
      gunId: 'long-32',
      port: 4,
      starboard: 3,
    })
    const derived = computeDerived(buildShipModel(design))
    expect(derived.capsizesAtRest).toBe(false)
  })
})

// The acceptance guard for the slider ranges in presets.json. Every preset must
// stay a working ship at every extreme of every hull slider; if one of these
// fails, narrow the offending range rather than loosening the test.
describe('every preset survives the ends of its hull sliders', () => {
  const sliderKeys = ['keelLength', 'beam', 'depthOfHold', 'freeboard', 'sheer'] as const

  for (const preset of hullPresets) {
    for (const key of sliderKeys) {
      for (const end of ['min', 'max'] as const) {
        it(`${preset.id} floats upright at ${end} ${key}`, () => {
          const base = defaultDesign(preset.id)
          const design: Design = {
            ...base,
            hull: { ...base.hull, [key]: preset.ranges[key][end] },
          }
          const derived = computeDerived(buildShipModel(design))
          expect(derived.capsizesAtRest).toBe(false)
          expect(derived.gmM).toBeGreaterThan(0)
          expect(derived.gunportFreeboardM).toBeGreaterThan(0)
          expect(Number.isFinite(derived.draftM)).toBe(true)
        })
      }
    }
  }
})
