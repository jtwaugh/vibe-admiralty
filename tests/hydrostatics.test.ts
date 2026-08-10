import { describe, expect, it } from 'vitest'
import {
  gzCurve,
  metacentricHeight,
  polygonArea,
  solveFloating,
  submergedSection,
} from '../src/physics/hydrostatics'
import { bargeAnalytic, boxBarge } from './barge'

const L = 40
const B = 10
const D = 6
const FRESH = 1000
const MASS = 1_000_000 // 1000 tonnes

const barge = boxBarge(L, B, D)

describe('box barge, analytic cases', () => {
  it('solves draft and displaced volume to within 1% of the closed form', () => {
    const analytic = bargeAnalytic(L, B, MASS, FRESH)
    expect(analytic.draft).toBeCloseTo(2.5, 6)

    const state = solveFloating(barge, MASS, { x: 0, y: 3, z: 0 }, { waterDensity: FRESH })
    expect(state.swamped).toBe(false)
    expect(state.draft).toBeGreaterThan(analytic.draft * 0.99)
    expect(state.draft).toBeLessThan(analytic.draft * 1.01)
    expect(state.volume).toBeGreaterThan(analytic.volume * 0.99)
    expect(state.volume).toBeLessThan(analytic.volume * 1.01)
  })

  it('matches the analytic small-angle GM to within 2%', () => {
    const kg = 3.0
    const { kb, bm } = bargeAnalytic(L, B, MASS, FRESH)
    const analyticGm = kb + bm - kg

    const gm = metacentricHeight(barge, MASS, { x: 0, y: kg, z: 0 }, { waterDensity: FRESH })
    expect(gm).toBeGreaterThan(analyticGm * 0.98)
    expect(gm).toBeLessThan(analyticGm * 1.02)
  })

  it('has a GZ curve that starts at zero, rises, and vanishes before 90 degrees', () => {
    // A high centre of gravity so stability vanishes inside the scanned range.
    const cg = { x: 0, y: 3.5, z: 0 }
    const angles = [0, 2, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 88]
    const curve = gzCurve(barge, MASS, cg, angles, { waterDensity: FRESH })

    expect(curve[0].gz).toBeCloseTo(0, 6)
    for (const point of curve.slice(1, 5)) {
      expect(point.gz).toBeGreaterThan(0)
    }
    const peak = Math.max(...curve.map((p) => p.gz))
    expect(peak).toBeGreaterThan(0.2)

    const vanishing = curve.find((p) => p.heelDeg > 0 && p.gz <= 0)
    expect(vanishing).toBeDefined()
    expect(vanishing!.heelDeg).toBeLessThan(90)
  })

  it('increases draft monotonically with mass across random loadings', () => {
    const masses = [
      120_000, 310_000, 455_000, 640_000, 812_000, 900_000, 1_150_000, 1_400_000,
      1_760_000, 2_050_000,
    ]
    let previous = 0
    for (const mass of masses) {
      const state = solveFloating(barge, mass, { x: 0, y: 3, z: 0 }, { waterDensity: FRESH })
      expect(state.swamped).toBe(false)
      expect(state.draft).toBeGreaterThan(previous)
      previous = state.draft
    }
    expect(solveFloating(barge, 2 * MASS, { x: 0, y: 3, z: 0 }, { waterDensity: FRESH }).draft)
      .toBeGreaterThan(solveFloating(barge, MASS, { x: 0, y: 3, z: 0 }, { waterDensity: FRESH }).draft)
  })
})

describe('station clipping', () => {
  const polygon = barge[0].polygon
  const fullArea = polygonArea(polygon)

  it('contributes zero area when the whole station is above the waterplane', () => {
    const clipped = submergedSection(polygon, 0, 1, -0.5)
    expect(clipped.area).toBe(0)
  })

  it('contributes its full area when the whole station is below the waterplane', () => {
    const clipped = submergedSection(polygon, 0, 1, D + 3)
    expect(clipped.area).toBeCloseTo(fullArea, 9)
    expect(clipped.centroid.y).toBeCloseTo(D / 2, 9)
    expect(clipped.centroid.z).toBeCloseTo(0, 9)
  })

  it('clips partially submerged stations to the exact rectangle', () => {
    const clipped = submergedSection(polygon, 0, 1, 2.5)
    expect(clipped.area).toBeCloseTo(B * 2.5, 9)
    expect(clipped.centroid.y).toBeCloseTo(1.25, 9)
  })
})
