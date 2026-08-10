import type { Hull, Station, Vec2 } from '../hull/stations'
import { sectionPolygon } from '../hull/stations'

export type Vec3 = { x: number; y: number; z: number }

/** Density of sea water, kg/m^3. */
export const SEA_WATER_DENSITY = 1025
export const GRAVITY = 9.80665

/** A transverse slice of the hull: a closed polygon in the (z, y) plane. */
export type HullSection = {
  x: number
  polygon: Vec2[]
}

export function hullSections(hull: Hull): HullSection[] {
  return hull.stations.map((s: Station) => ({ x: s.x, polygon: sectionPolygon(s) }))
}

// ---------------------------------------------------------------------------
// Polygon primitives
// ---------------------------------------------------------------------------

export function polygonArea(poly: Vec2[]): number {
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    sum += a.z * b.y - b.z * a.y
  }
  return Math.abs(sum) / 2
}

export type AreaMoment = { area: number; centroid: Vec2 }

export function polygonAreaMoment(poly: Vec2[]): AreaMoment {
  if (poly.length < 3) return { area: 0, centroid: { z: 0, y: 0 } }
  let signed = 0
  let cz = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const cross = a.z * b.y - b.z * a.y
    signed += cross
    cz += (a.z + b.z) * cross
    cy += (a.y + b.y) * cross
  }
  signed /= 2
  if (Math.abs(signed) < 1e-12) return { area: 0, centroid: { z: 0, y: 0 } }
  return {
    area: Math.abs(signed),
    centroid: { z: cz / (6 * signed), y: cy / (6 * signed) },
  }
}

/**
 * Sutherland-Hodgman clip of a polygon against the half plane
 * `nz * z + ny * y <= c`, i.e. the part of the section below the waterplane.
 */
export function clipBelowPlane(poly: Vec2[], nz: number, ny: number, c: number): Vec2[] {
  if (poly.length === 0) return []
  const out: Vec2[] = []
  const value = (p: Vec2) => nz * p.z + ny * p.y - c
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]
    const next = poly[(i + 1) % poly.length]
    const dCur = value(cur)
    const dNext = value(next)
    const curIn = dCur <= 0
    const nextIn = dNext <= 0
    if (curIn) out.push(cur)
    if (curIn !== nextIn) {
      const t = dCur / (dCur - dNext)
      out.push({ z: cur.z + (next.z - cur.z) * t, y: cur.y + (next.y - cur.y) * t })
    }
  }
  return out
}

/** Submerged area and centroid of one station under a given waterplane line. */
export function submergedSection(
  polygon: Vec2[],
  nz: number,
  ny: number,
  c: number,
): AreaMoment {
  return polygonAreaMoment(clipBelowPlane(polygon, nz, ny, c))
}

/**
 * Composite Simpson over uniformly spaced samples, falling back to the
 * trapezoid rule when the sample count is even.
 */
export function integrateUniform(values: number[], dx: number): number {
  const n = values.length
  if (n < 2) return 0
  if (n % 2 === 1) {
    let sum = values[0] + values[n - 1]
    for (let i = 1; i < n - 1; i++) sum += values[i] * (i % 2 === 1 ? 4 : 2)
    return (sum * dx) / 3
  }
  let sum = 0
  for (let i = 0; i < n - 1; i++) sum += (values[i] + values[i + 1]) / 2
  return sum * dx
}

// ---------------------------------------------------------------------------
// Attitude
// ---------------------------------------------------------------------------

/**
 * Rotate a ship-local vector into world axes (y up). Heel is a rotation about
 * the ship's longitudinal axis (positive = starboard down); trim is about the
 * transverse axis (positive = bow up).
 */
export function toWorld(v: Vec3, heelRad: number, trimRad: number): Vec3 {
  const ct = Math.cos(trimRad)
  const st = Math.sin(trimRad)
  const cf = Math.cos(heelRad)
  const sf = Math.sin(heelRad)
  const x1 = v.x * ct - v.y * st
  const y1 = v.x * st + v.y * ct
  const z1 = v.z
  return { x: x1, y: y1 * cf - z1 * sf, z: y1 * sf + z1 * cf }
}

/** World "up" expressed in ship-local axes; the normal of the waterplane. */
export function waterplaneNormal(heelRad: number, trimRad: number): Vec3 {
  return {
    x: Math.cos(heelRad) * Math.sin(trimRad),
    y: Math.cos(heelRad) * Math.cos(trimRad),
    z: -Math.sin(heelRad),
  }
}

export type Attitude = {
  heelRad: number
  trimRad: number
  /** Offset of the waterplane along its normal, in ship-local axes. */
  offset: number
}

export type Displacement = {
  volume: number
  /** Centre of buoyancy in ship-local axes. */
  centre: Vec3
}

/** Displaced volume and centre of buoyancy for a given attitude. */
export function displacementAt(
  sections: HullSection[],
  attitude: Attitude,
): Displacement {
  const n = waterplaneNormal(attitude.heelRad, attitude.trimRad)
  const areas: number[] = []
  const my: number[] = []
  const mz: number[] = []
  for (const s of sections) {
    const c = attitude.offset - n.x * s.x
    const { area, centroid } = submergedSection(s.polygon, n.z, n.y, c)
    areas.push(area)
    my.push(area * centroid.y)
    mz.push(area * centroid.z)
  }
  const dx = sections.length > 1 ? sections[1].x - sections[0].x : 0
  const volume = integrateUniform(areas, dx)
  if (volume <= 1e-9) return { volume: 0, centre: { x: 0, y: 0, z: 0 } }
  const mxAll = integrateUniform(areas.map((a, i) => a * sections[i].x), dx)
  return {
    volume,
    centre: {
      x: mxAll / volume,
      y: integrateUniform(my, dx) / volume,
      z: integrateUniform(mz, dx) / volume,
    },
  }
}

// ---------------------------------------------------------------------------
// Solvers
// ---------------------------------------------------------------------------

export type FloatOptions = {
  waterDensity?: number
  /** Solve trim so the longitudinal buoyancy lever vanishes. Default true. */
  freeTrim?: boolean
  /** Hold trim at this angle instead of solving for it. */
  trimRad?: number
}

export type FloatState = {
  /** Waterplane offset along its normal. Equals draft when upright. */
  offset: number
  heelRad: number
  trimRad: number
  volume: number
  centreOfBuoyancy: Vec3
  /** Transverse righting arm GZ, metres. Positive resists positive heel. */
  gz: number
  /** Longitudinal buoyancy lever; zero once trim is solved. */
  longitudinalLever: number
  /** Depth of the lowest point of the hull below the waterplane. */
  draft: number
  /** True when the hull cannot displace enough water to float the mass. */
  swamped: boolean
}

/** Extent of the hull along the waterplane normal, used to bracket the solve. */
function offsetBracket(sections: HullSection[], heelRad: number, trimRad: number) {
  const n = waterplaneNormal(heelRad, trimRad)
  let lo = Infinity
  let hi = -Infinity
  for (const s of sections) {
    for (const p of s.polygon) {
      const v = n.x * s.x + n.y * p.y + n.z * p.z
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  return { lo, hi }
}

/** Bisect the waterplane offset until the displaced volume matches the target. */
export function solveOffsetForVolume(
  sections: HullSection[],
  targetVolume: number,
  heelRad: number,
  trimRad: number,
): { offset: number; displacement: Displacement; swamped: boolean; deepest: number } {
  const { lo, hi } = offsetBracket(sections, heelRad, trimRad)
  const full = displacementAt(sections, { heelRad, trimRad, offset: hi })
  if (full.volume < targetVolume) {
    return { offset: hi, displacement: full, swamped: true, deepest: lo }
  }
  let a = lo
  let b = hi
  let mid = (a + b) / 2
  let disp = displacementAt(sections, { heelRad, trimRad, offset: mid })
  for (let i = 0; i < 40; i++) {
    mid = (a + b) / 2
    disp = displacementAt(sections, { heelRad, trimRad, offset: mid })
    if (disp.volume > targetVolume) b = mid
    else a = mid
    if (b - a < 1e-6) break
  }
  return { offset: mid, displacement: disp, swamped: false, deepest: lo }
}

/**
 * Float the hull at a prescribed heel: solve the waterplane offset for
 * equilibrium of vertical force and, unless disabled, the trim angle that
 * zeroes the longitudinal buoyancy lever.
 */
export function floatAtHeel(
  sections: HullSection[],
  massKg: number,
  centreOfGravity: Vec3,
  heelRad: number,
  options: FloatOptions = {},
): FloatState {
  const rho = options.waterDensity ?? SEA_WATER_DENSITY
  const fixedTrim = options.trimRad
  const freeTrim = fixedTrim === undefined && (options.freeTrim ?? true)
  const targetVolume = massKg / rho

  const evaluate = (trimRad: number) => {
    const solved = solveOffsetForVolume(sections, targetVolume, heelRad, trimRad)
    const lever = toWorld(
      {
        x: solved.displacement.centre.x - centreOfGravity.x,
        y: solved.displacement.centre.y - centreOfGravity.y,
        z: solved.displacement.centre.z - centreOfGravity.z,
      },
      heelRad,
      trimRad,
    )
    return { solved, lever }
  }

  let trimRad = fixedTrim ?? 0
  let result = evaluate(trimRad)
  if (freeTrim) {
    // The longitudinal lever falls as the bow lifts, so bisect on trim.
    const limit = (20 * Math.PI) / 180
    let a = -limit
    let b = limit
    const fa = evaluate(a).lever.x
    const fb = evaluate(b).lever.x
    if (fa * fb < 0) {
      for (let i = 0; i < 24; i++) {
        const mid = (a + b) / 2
        const f = evaluate(mid).lever.x
        if (f > 0 === fa > 0) a = mid
        else b = mid
        if (b - a < 1e-5) break
      }
      trimRad = (a + b) / 2
      result = evaluate(trimRad)
    }
  }

  // Draft is the depth of the deepest point of the hull below the waterplane.
  const draft = result.solved.offset - result.solved.deepest

  return {
    offset: result.solved.offset,
    heelRad,
    trimRad,
    volume: result.solved.displacement.volume,
    centreOfBuoyancy: result.solved.displacement.centre,
    gz: result.lever.z,
    longitudinalLever: result.lever.x,
    draft,
    swamped: result.solved.swamped,
  }
}

/** Upright floating solution: draft, trim and displaced volume. */
export function solveFloating(
  sections: HullSection[],
  massKg: number,
  centreOfGravity: Vec3,
  options: FloatOptions = {},
): FloatState {
  return floatAtHeel(sections, massKg, centreOfGravity, 0, options)
}

/** Righting arm at a given heel, with the hull free to find its own draft. */
export function rightingArm(
  sections: HullSection[],
  massKg: number,
  centreOfGravity: Vec3,
  heelRad: number,
  options: FloatOptions = {},
): number {
  return floatAtHeel(sections, massKg, centreOfGravity, heelRad, options).gz
}

/**
 * Small-angle metacentric height. Taking the difference of GZ either side of
 * upright cancels the constant offset produced by a laterally displaced centre
 * of gravity, so this is the true GM even for an asymmetric ship.
 */
export function metacentricHeight(
  sections: HullSection[],
  massKg: number,
  centreOfGravity: Vec3,
  options: FloatOptions = {},
): number {
  const phi = (1 * Math.PI) / 180
  const plus = rightingArm(sections, massKg, centreOfGravity, phi, options)
  const minus = rightingArm(sections, massKg, centreOfGravity, -phi, options)
  return (plus - minus) / (2 * Math.sin(phi))
}

export type GzPoint = { heelDeg: number; gz: number }

export function gzCurve(
  sections: HullSection[],
  massKg: number,
  centreOfGravity: Vec3,
  heelDegrees: number[],
  options: FloatOptions = {},
): GzPoint[] {
  return heelDegrees.map((heelDeg) => ({
    heelDeg,
    gz: rightingArm(sections, massKg, centreOfGravity, (heelDeg * Math.PI) / 180, options),
  }))
}

/**
 * A heeling moment in newton-metres as a function of heel, positive when it
 * rolls the ship to starboard. Wind supplies one of these in the sea trial;
 * at the dock it is zero and any list comes from the centre of gravity alone.
 */
export type HeelingMoment = (heelRad: number) => number

export type EquilibriumResult = {
  /** Equilibrium heel in degrees, positive to starboard. */
  heelDeg: number
  capsized: boolean
  state: FloatState
  /** Peak righting moment found in the scan, newton-metres. */
  maxRightingMoment: number
}

const SCAN_LIMIT_DEG = 88
const SCAN_STEP_DEG = 2

/**
 * Find the stable equilibrium heel: the angle nearest upright where the
 * righting moment balances the applied heeling moment and the balance is
 * restoring. If no such angle exists the ship capsizes; nothing is scripted.
 */
export function solveEquilibriumHeel(
  sections: HullSection[],
  massKg: number,
  centreOfGravity: Vec3,
  heeling: HeelingMoment = () => 0,
  options: FloatOptions = {},
): EquilibriumResult {
  const weight = massKg * GRAVITY
  // Trim is solved once upright and then held while heel is scanned; free trim
  // at every heel angle costs an order of magnitude more work and moves the
  // transverse righting arm by a negligible amount (see DECISIONS.md).
  const upright = solveFloating(sections, massKg, centreOfGravity, options)
  const scanOptions: FloatOptions = { ...options, trimRad: upright.trimRad }

  const states = new Map<number, FloatState>()
  const stateAt = (deg: number) => {
    let s = states.get(deg)
    if (!s) {
      s = floatAtHeel(sections, massKg, centreOfGravity, (deg * Math.PI) / 180, scanOptions)
      states.set(deg, s)
    }
    return s
  }
  // Net moment, positive when the hull is winning. The buoyant force equals the
  // ship's weight because the offset solve matched displaced volume to mass.
  const net = (deg: number) => weight * stateAt(deg).gz - heeling((deg * Math.PI) / 180)

  const degrees: number[] = []
  for (let d = -SCAN_LIMIT_DEG; d <= SCAN_LIMIT_DEG; d += SCAN_STEP_DEG) degrees.push(d)

  let maxRighting = 0
  for (const d of degrees) {
    const m = weight * stateAt(d).gz * Math.sign(d || 1)
    if (m > maxRighting) maxRighting = m
  }

  // A stable equilibrium is where the net moment rises through zero: below it
  // the ship rolls further over, above it the hull pushes back.
  let best: number | null = null
  for (let i = 0; i < degrees.length - 1; i++) {
    const d0 = degrees[i]
    const d1 = degrees[i + 1]
    const f0 = net(d0)
    const f1 = net(d1)
    if (f0 <= 0 && f1 > 0) {
      let a = d0
      let b = d1
      for (let k = 0; k < 24; k++) {
        const mid = (a + b) / 2
        if (net(mid) <= 0) a = mid
        else b = mid
      }
      const root = (a + b) / 2
      if (best === null || Math.abs(root) < Math.abs(best)) best = root
    }
  }

  if (best === null) {
    const s = floatAtHeel(
      sections,
      massKg,
      centreOfGravity,
      (SCAN_LIMIT_DEG * Math.PI) / 180,
      scanOptions,
    )
    return { heelDeg: NaN, capsized: true, state: s, maxRightingMoment: maxRighting }
  }
  const state = floatAtHeel(sections, massKg, centreOfGravity, (best * Math.PI) / 180, options)
  return { heelDeg: best, capsized: false, state, maxRightingMoment: maxRighting }
}
