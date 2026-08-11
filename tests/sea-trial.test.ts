import { describe, expect, it } from 'vitest'
import { computeDerived } from '../src/physics/derived'
import {
  buildTrialEnvironment,
  gzAt,
  heelDeg,
  initialTrialState,
  offsetAt,
  restingHeel,
  runTrial,
  speedKn,
  stepTrial,
} from '../src/physics/integrate'
import type { TrialControls, TrialEnvironment, TrialState } from '../src/physics/integrate'
import { buildShipModel } from '../src/physics/masses'
import { defaultDesign } from '../src/state/defaults'
import type { Design, SailState } from '../src/export/schema'

/**
 * ACCEPTANCE sections D and E, as numbers. The screenshots are the other half
 * of these claims; these tests are the half that can fail loudly.
 */

const CALM = { directionRad: 0, speedKn: 0 }
/** A wind out of the starboard beam, which lays a ship over to port. */
const FROM_STARBOARD = Math.PI / 2

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
  return {
    wind: { directionRad: FROM_STARBOARD, speedKn },
    rudder,
    sails: sailsWhere(design, set),
  }
}

function launch(design: Design): { env: TrialEnvironment; state: TrialState } {
  const env = buildTrialEnvironment(buildShipModel(design))
  return { env, state: initialTrialState(env) }
}

/** The abomination of ACCEPTANCE E, at whatever beam we ask for. */
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

/** Every gun moved to the port side, keeping the heavier of the two counts. */
function lopside(design: Design): Design {
  const mounts = { ...design.mounts }
  for (const [id, config] of Object.entries(mounts)) {
    mounts[id] = { ...config, port: Math.max(config.port, config.starboard), starboard: 0 }
  }
  return { ...design, mounts }
}

const isPlainSail = (id: string) => id.endsWith('-course') || id.endsWith('-topsail')

describe('the stability curve', () => {
  it('is the same righting arm the static solver reports', () => {
    const model = buildShipModel(defaultDesign('frigate-38'))
    const env = buildTrialEnvironment(model)
    const derived = computeDerived(model)
    expect(env.gmM).toBeCloseTo(derived.gmM, 1)
    expect(offsetAt(env.curve, 0)).toBeCloseTo(derived.upright.offset, 2)
    expect(gzAt(env.curve, 0)).toBeCloseTo(0, 2)
    // She stands up harder the further she is pushed over, up to a point.
    expect(gzAt(env.curve, Math.PI / 9)).toBeGreaterThan(gzAt(env.curve, Math.PI / 18))
    expect(env.curve.maxRightingMomentNm).toBeGreaterThan(0)
  })

  it('finds no list for a symmetric ship and a real one for a lopsided ship', () => {
    const even = buildTrialEnvironment(buildShipModel(defaultDesign('frigate-38')))
    const listed = buildTrialEnvironment(buildShipModel(lopside(defaultDesign('frigate-38'))))
    expect(Math.abs((restingHeel(even) * 180) / Math.PI)).toBeLessThan(0.2)
    expect((restingHeel(listed) * 180) / Math.PI).toBeLessThan(-1)
  })
})

describe('a ship at her moorings', () => {
  it('lies upright and still with no wind on her', () => {
    const design = defaultDesign('frigate-38')
    const { env, state } = launch(design)
    const after = runTrial(env, state, controls(design, 0, () => false), 40)
    expect(Math.abs(heelDeg(after.state))).toBeLessThan(0.5)
    expect(speedKn(after.state)).toBeLessThan(0.1)
    expect(after.state.capsized).toBe(false)
  })

  it('rolls down into her list when her guns are all on one side', () => {
    const design = lopside(defaultDesign('frigate-38'))
    const { env, state } = launch(design)
    const after = runTrial(env, state, controls(design, 0, () => false), 60)
    // She settles to port, which is a negative heel, and stays there.
    expect(heelDeg(after.state)).toBeLessThan(-1)
    expect(heelDeg(after.state)).toBeCloseTo((restingHeel(env) * 180) / Math.PI, 0)
    expect(after.state.capsized).toBe(false)
  })
})

describe('demo one: the frigate', () => {
  const design = defaultDesign('frigate-38')
  design.cosmetics.copperSheathing = true

  it('holds a modest steady heel to leeward and gathers way', () => {
    const { env, state } = launch(design)
    const after = runTrial(env, state, controls(design, 15, isPlainSail), 90)
    const heel = heelDeg(after.state)
    expect(heel).toBeLessThan(-0.5)
    expect(heel).toBeGreaterThan(-8)
    expect(speedKn(after.state)).toBeGreaterThan(4)
    expect(after.state.capsized).toBe(false)
    // Her gunports stay well clear of the water, which is the whole point.
    expect(after.portsUnder).toBe(0)
  })

  it('holds her course with the helm amidships', () => {
    const { env, state } = launch(design)
    const after = runTrial(env, state, controls(design, 15, isPlainSail), 90)
    expect(Math.abs((after.state.headingRad * 180) / Math.PI)).toBeLessThan(30)
  })

  it('comes upright when the topsails are furled', () => {
    const { env, state } = launch(design)
    const under = runTrial(env, state, controls(design, 15, isPlainSail), 60)
    const heeled = heelDeg(under.state)
    const furled = runTrial(
      env,
      under.state,
      controls(design, 15, (id) => id.endsWith('-course')),
      6,
    )
    expect(Math.abs(heelDeg(furled.state))).toBeLessThan(Math.abs(heeled) - 0.4)
  })

  it('sails about half a knot faster for her copper', () => {
    const bare = { ...design, cosmetics: { ...design.cosmetics, copperSheathing: false } }
    const run = (d: Design) => {
      const { env, state } = launch(d)
      return speedKn(runTrial(env, state, controls(d, 15, isPlainSail), 150).state)
    }
    const gain = run(design) - run(bare)
    expect(gain).toBeGreaterThan(0.2)
    expect(gain).toBeLessThan(1.2)
  })

  it('answers her helm, and stops turning when it is put amidships', () => {
    const { env, state } = launch(design)
    const running = runTrial(env, state, controls(design, 15, isPlainSail), 60)
    const turning = runTrial(env, running.state, controls(design, 15, isPlainSail, 1), 30)
    expect(turning.state.headingRad).toBeGreaterThan(running.state.headingRad + 0.15)
    const straightened = runTrial(env, turning.state, controls(design, 15, isPlainSail, 0), 30)
    expect(Math.abs(straightened.state.yawRateRadS)).toBeLessThan(
      Math.abs(turning.state.yawRateRadS) / 2,
    )
  })
})

describe('demo two: the abomination', () => {
  const narrow = abomination(6.6)

  it('warns of it at the dock: her metacentric height is gone', () => {
    const derived = computeDerived(buildShipModel(narrow))
    expect(derived.gmM).toBeLessThan(0.2)
    expect(derived.capsizesAtRest).toBe(true)
  })

  it('goes over within twenty seconds of setting everything, unprompted', () => {
    const { env, state } = launch(narrow)
    const controlSet = controls(narrow, 25)
    let step = { state, load: null, portsUnder: 0 } as ReturnType<typeof stepTrial>
    let capsizedAt = Infinity
    let current = state
    for (let t = 0; t < 20; t += 0.02) {
      step = stepTrial(env, current, controlSet, 0.02)
      current = step.state
      if (current.capsized && capsizedAt === Infinity) capsizedAt = current.timeS
    }
    expect(capsizedAt).toBeLessThan(20)
    // Her masts are in the water.
    expect(Math.abs(heelDeg(current))).toBeGreaterThan(80)
  })

  it('fills through her own gunports and settles below the waterplane', () => {
    const { env, state } = launch(narrow)
    const after = runTrial(env, state, controls(narrow, 25), 60)
    expect(after.portsUnder).toBeGreaterThan(0)
    expect(after.state.floodedKg).toBeGreaterThan(0)
    expect(after.state.founderedM).toBeGreaterThan(0)
  })

  it('survives at full beam instead, but sails on her ear and turns wide', () => {
    const wide = abomination(11.2)
    const { env, state } = launch(wide)
    const after = runTrial(env, state, controls(wide, 25), 60)
    expect(after.state.capsized).toBe(false)
    expect(after.portsUnder).toBe(0)
    // She lies down to the wind and stays there rather than standing up again.
    expect(heelDeg(after.state)).toBeLessThan(-5)

    // A beamy hull drags far more water round with her: SPEC section 7's
    // sluggish yaw. Compared at the same speed so the rudder is doing the same
    // work in both, this is the hull's own doing and not the rig's.
    const circle = (design: Design) => {
      const trial = launch(design)
      let current: TrialState = { ...trial.state, speedMps: 3 }
      const helm = controls(design, 0, () => false, 1)
      for (let t = 0; t < 90; t += 0.02) {
        current = { ...stepTrial(trial.env, current, helm, 0.02).state, speedMps: 3 }
      }
      return 3 / Math.abs(current.yawRateRadS) / trial.env.model.hull.length
    }
    expect(circle(wide)).toBeGreaterThan(circle(defaultDesign('sloop')) * 1.2)
  })

  it('is more heavily damped in roll the beamier she is', () => {
    const narrowEnv = buildTrialEnvironment(buildShipModel(narrow))
    const wideEnv = buildTrialEnvironment(buildShipModel(abomination(11.2)))
    const damping = (env: TrialEnvironment) =>
      env.rollDampingNmsPerRad / Math.sqrt(env.rollInertia * env.massKg)
    expect(damping(wideEnv)).toBeGreaterThan(damping(narrowEnv) * 2)
  })
})

describe('demo two, variant three: the lopside', () => {
  const design = lopside(defaultDesign('frigate-38'))

  it('shows her list at the dock and carries it into the water', () => {
    const derived = computeDerived(buildShipModel(design))
    expect(derived.staticListDeg).toBeLessThan(-1)
    expect(derived.capsizesAtRest).toBe(false)

    const { env, state } = launch(design)
    const afloat = runTrial(env, state, controls(design, 0, () => false), 60)
    expect(heelDeg(afloat.state)).toBeCloseTo(derived.staticListDeg, 0)
  })

  it('is pressed further over by a wind on the side she is already down', () => {
    const { env, state } = launch(design)
    const calm = runTrial(env, state, controls(design, 0, () => false), 60)
    const blown = runTrial(env, calm.state, controls(design, 20), 60)
    expect(heelDeg(blown.state)).toBeLessThan(heelDeg(calm.state) - 3)
    // Twenty knots is not enough to finish a sound frigate; see DECISIONS.md.
    expect(blown.state.capsized).toBe(false)
  })

  it('goes over when the wind is strong enough to bury her lee ports', () => {
    const { env, state } = launch(design)
    const squall = runTrial(env, state, controls(design, 50), 60)
    expect(squall.state.capsized).toBe(true)
    expect(squall.state.floodedKg).toBeGreaterThan(0)
    expect(heelDeg(squall.state)).toBeLessThan(-80)
  })
})
