import { describe, expect, it } from 'vitest'
import { computeDerived } from '../src/physics/derived'
import {
  buildTrialEnvironment,
  heelDeg,
  initialTrialState,
  restingHeel,
  runTrial,
  stepTrial,
} from '../src/physics/integrate'
import type { TrialControls, TrialEnvironment, TrialState } from '../src/physics/integrate'
import { buildShipModel } from '../src/physics/masses'
import { defaultDesign } from '../src/state/defaults'
import type { Design, SailState } from '../src/export/schema'

/**
 * DECISIONS.md quotes measured figures to justify where the model departs from
 * ACCEPTANCE.md. Prose cannot fail a build, so those figures drifted: the wide
 * hull's roll period, her turning circle and the Lopside's capsize wind were all
 * wrong by the time anyone checked, and one of them was recorded twice with two
 * different values.
 *
 * This file is the fix. Every number quoted in DECISIONS.md is re-measured here.
 * If one of these fails, the honest repair is to re-measure and correct the
 * prose, not to widen the tolerance.
 */

const FROM_STARBOARD = Math.PI / 2

/**
 * Assert a measurement still rounds to the figure DECISIONS.md prints. Pinning
 * to the printed precision is the point: a tolerance loose enough to accept a
 * neighbouring value is what let "5.2 lengths" sit in the prose unchallenged
 * while the model said 5.3.
 */
function readsAs(measured: number, printed: number, decimals: number) {
  expect(Number(measured.toFixed(decimals))).toBe(printed)
}

function sailsWhere(design: Design, set: (id: string) => boolean): Record<string, SailState> {
  const states: Record<string, SailState> = {}
  for (const id of Object.keys(design.rig.sails)) states[id] = set(id) ? 'set' : 'furled'
  return states
}

function controls(
  design: Design,
  speedKn: number,
  set: (id: string) => boolean = () => true,
  rudder = 0,
): TrialControls {
  return { wind: { directionRad: FROM_STARBOARD, speedKn }, rudder, sails: sailsWhere(design, set) }
}

function launch(design: Design): { env: TrialEnvironment; state: TrialState } {
  const env = buildTrialEnvironment(buildShipModel(design))
  return { env, state: initialTrialState(env) }
}

/** The abomination of ACCEPTANCE E, matching the helper in sea-trial.test.ts. */
function abomination(beam: number): Design {
  const design = defaultDesign('sloop')
  design.hull = { ...design.hull, beam }
  design.rig = { ...design.rig, sailPlanId: 'over-canvased' }
  design.timber = {
    ...design.timber,
    speciesId: 'baltic-fir',
    zones: { ...design.timber.zones, bulwarks: 'heavy' },
  }
  const mounts = { ...design.mounts }
  for (const id of Object.keys(mounts)) {
    if (id === 'swivel-rail') continue
    mounts[id] = { gunId: 'long-32', port: 9, starboard: 9 }
  }
  design.mounts = mounts
  return design
}

function lopside(design: Design): Design {
  const mounts = { ...design.mounts }
  for (const [id, config] of Object.entries(mounts)) {
    mounts[id] = { ...config, port: Math.max(config.port, config.starboard), starboard: 0 }
  }
  return { ...design, mounts }
}

/**
 * Release from fifteen degrees in a dead calm and describe the return: when she
 * first reaches upright, how far she swings past it, and when she is finally
 * inside two degrees for good. All measured against her own resting heel.
 */
function rollDecay(design: Design): { uprightS: number; overswingDeg: number; settleS: number } {
  const { env } = launch(design)
  const rest = (restingHeel(env) * 180) / Math.PI
  let current: TrialState = {
    ...initialTrialState(env),
    heelRad: (-15 * Math.PI) / 180,
    heelRateRadS: 0,
  }
  const idle = controls(design, 0, () => false)
  let uprightS = NaN
  let overswingDeg = 0
  let settleS = 0
  let previous = -15 - rest
  for (let t = 0; t < 60; t += 0.02) {
    current = stepTrial(env, current, idle, 0.02).state
    const heel = heelDeg(current) - rest
    if (Number.isNaN(uprightS) && previous < 0 && heel >= 0) uprightS = current.timeS
    if (!Number.isNaN(uprightS)) overswingDeg = Math.max(overswingDeg, heel)
    if (Math.abs(heel) > 2) settleS = current.timeS
    previous = heel
  }
  return { uprightS, overswingDeg, settleS }
}

/** Steady turning circle in her own lengths, held at a matched 3 m/s. */
function turningCircleLengths(design: Design): number {
  const trial = launch(design)
  let current: TrialState = { ...trial.state, speedMps: 3 }
  const helm = controls(design, 0, () => false, 1)
  for (let t = 0; t < 90; t += 0.02) {
    current = { ...stepTrial(trial.env, current, helm, 0.02).state, speedMps: 3 }
  }
  return 3 / Math.abs(current.yawRateRadS) / trial.env.model.hull.length
}

describe('the roll figures quoted in DECISIONS.md', () => {
  it('gives the standard sloop GM 0.70 m and the wide abomination 1.84 m', () => {
    readsAs(computeDerived(buildShipModel(defaultDesign('sloop'))).gmM, 0.7, 2)
    readsAs(computeDerived(buildShipModel(abomination(11.2))).gmM, 1.84, 2)
  })

  // The two are easy to confuse, and the prose once did: a plain sloop opened
  // out to the same beam is a different ship from the wide abomination.
  it('gives the plain sloop at beam 11.2 m a GM of 2.19 m, not 1.84', () => {
    const plain = defaultDesign('sloop')
    const wide = { ...plain, hull: { ...plain.hull, beam: 11.2 } }
    readsAs(computeDerived(buildShipModel(wide)).gmM, 2.19, 2)
  })

  it('rolls the standard sloop upright in 2.6 s, 6.8 deg past, still working at ten', () => {
    const { uprightS, overswingDeg, settleS } = rollDecay(defaultDesign('sloop'))
    readsAs(uprightS, 2.6, 1)
    readsAs(overswingDeg, 6.8, 1)
    expect(settleS).toBeGreaterThan(9)
    expect(settleS).toBeLessThan(12)
  })

  it('brings the wide abomination up in 3.3 s and dead-beats her inside 2.6 s', () => {
    const { uprightS, overswingDeg, settleS } = rollDecay(abomination(11.2))
    readsAs(uprightS, 3.3, 1)
    // Barely a degree of overswing: this is what "nearly dead-beat" means.
    expect(overswingDeg).toBeLessThan(2)
    readsAs(settleS, 2.6, 1)
  })

  // The claim the entry rests on: her first swing is the slower of the two, so
  // the old "a stiff hull rolls quicker" argument was backwards as well as stale.
  it('takes the wide hull longer to reach upright than the standard sloop', () => {
    expect(rollDecay(abomination(11.2)).uprightS).toBeGreaterThan(
      rollDecay(defaultDesign('sloop')).uprightS,
    )
  })
})

describe('the wallow figures quoted in DECISIONS.md', () => {
  it('turns the wide abomination in 5.3 lengths and the standard sloop in 3.8', () => {
    readsAs(turningCircleLengths(abomination(11.2)), 5.3, 1)
    readsAs(turningCircleLengths(defaultDesign('sloop')), 3.8, 1)
  })

  it('lays the wide abomination over at a steady 11 deg under every sail in 25 kn', () => {
    const wide = abomination(11.2)
    const { env, state } = launch(wide)
    const after = runTrial(env, state, controls(wide, 25), 60)
    readsAs(heelDeg(after.state), -11, 0)
    expect(after.state.capsized).toBe(false)
  })
})

describe('the Lopside figures quoted in DECISIONS.md', () => {
  const design = lopside(defaultDesign('frigate-38'))
  const halfBeam = design.hull.beam / 2

  /** Height of the lee gunport sill above the water at a given heel. */
  const leeSillM = (uprightSillM: number, heelDegrees: number) =>
    uprightSillM - halfBeam * Math.sin(Math.abs((heelDegrees * Math.PI) / 180))

  it('lists her 3.4 deg at the dock with her lee sills 2.68 m clear', () => {
    const derived = computeDerived(buildShipModel(design))
    readsAs(derived.staticListDeg, -3.4, 1)
    readsAs(leeSillM(derived.gunportFreeboardM, derived.staticListDeg), 2.68, 2)
  })

  it('settles her at 8.7 deg in 20 kn with the sills 2.12 m clear, and holds it', () => {
    const uprightSill = computeDerived(buildShipModel(design)).gunportFreeboardM
    const { env, state } = launch(design)
    const after = runTrial(env, state, controls(design, 20), 120)
    readsAs(heelDeg(after.state), -8.7, 1)
    readsAs(leeSillM(uprightSill, heelDeg(after.state)), 2.12, 2)
    expect(after.portsUnder).toBe(0)
    expect(after.state.capsized).toBe(false)
  })

  it('kills her at about 36 kn, and not before 35', () => {
    const { env, state } = launch(design)
    const survives = runTrial(env, state, controls(design, 35), 120)
    expect(survives.state.capsized).toBe(false)
    const dies = runTrial(env, state, controls(design, 36), 120)
    expect(dies.state.capsized).toBe(true)
    // The demo runs at 50 kn, comfortably past the threshold, so the camera
    // never catches her in the ambiguous band.
    expect(runTrial(env, state, controls(design, 50), 120).state.capsized).toBe(true)
  })
})
