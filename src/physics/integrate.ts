import type { SailState } from '../export/schema'
import { GUNPORT_HEIGHT, GUNPORT_WIDTH } from '../hull/sockets'
import { halfBreadthAt } from '../hull/stations'
import {
  GRAVITY,
  SEA_WATER_DENSITY,
  floatAtHeel,
  hullSections,
  openingProjections,
  solveFloating,
} from './hydrostatics'
import type { HullSection } from './hydrostatics'
import type { ShipModel } from './masses'
import { KNOTS_TO_MPS, windLoad } from './wind'
import type { WindConditions, WindLoad } from './wind'

/**
 * The sea trial (SPEC §7): hydrostatics plus a rigid body. Heel, surge and yaw
 * are integrated against the righting arm the station clipping gives us, so
 * nothing about capsizing, listing or foundering is scripted. What kills these
 * ships is not usually the righting arm running out on its own: it is the lee
 * gunports going under while she is held over, and that is modelled here too.
 */

/** How far either way the righting arm is sampled, and how finely. */
const CURVE_LIMIT_DEG = 100
const CURVE_STEP_DEG = 2

/** Past this heel there is no coming back and she is lying on her rig. */
const CAPSIZE_ANGLE_DEG = 72
/** She cannot roll past this: the masts and yards are in the water. */
const MAX_HEEL_DEG = 100

/**
 * Radius of gyration in roll and in yaw, as fractions of beam and length. The
 * usual naval architect's rules of thumb.
 */
const ROLL_GYRADIUS_FACTOR = 0.38
const YAW_GYRADIUS_FACTOR = 0.25
/** Water dragged along with the hull when it rolls and when it surges. */
const ROLL_ADDED_MASS = 1.25
const SURGE_ADDED_MASS = 1.08

/**
 * Roll damping as a fraction of critical, for a hull of ordinary breadth, and
 * how steeply it grows with beam. SPEC §7 asks that extreme beam wallow with
 * high roll damping; bilge and eddy damping really do climb steeply with
 * breadth, so a beamy hull is nearly dead-beat and a narrow one rolls on.
 */
const ROLL_DAMPING_RATIO = 0.2
const ROLL_DAMPING_BEAM_POWER = 3.5
/** The beam an ordinary ship of a given length carries. */
const ORDINARY_BEAM_RATIO = 0.27

/**
 * Total resistance coefficient of a wooden bottom on the zone the copper would
 * cover, chosen so a frigate under her courses and topsails in a fifteen knot
 * breeze settles at about six and a half knots.
 */
const FRICTION_COEFFICIENT = 0.0092
/**
 * A ship of fifteen hundred tons really does take three or four minutes to
 * gather way, which is unwatchable in a widget. Surge alone is integrated on a
 * compressed time constant; heel, the hydrostatics and the failure states are
 * untouched by this, and they are what the acceptance tests measure.
 */
const SURGE_RESPONSE = 8
/** Copper keeps the weed off; SPEC §5 wants it worth about half a knot. */
const COPPER_FRICTION_SCALE = 0.86
/** Wave-making blows up as she approaches her hull speed. */
const WAVE_RESISTANCE_COEFFICIENT = 0.0035
const WAVE_RESISTANCE_POWER = 6

/** Hard over, radians. */
const MAX_RUDDER_RAD = (35 * Math.PI) / 180
const RUDDER_LIFT_COEFFICIENT = 1.5
/**
 * Yaw drag, calibrated so a frigate under way with the rudder hard over turns
 * in about four of her own lengths, which is what these ships did.
 */
const YAW_DRAG = 0.4
/**
 * A hull turning across her own length drags water sideways, and a bluff, beamy
 * section sheds far more of it than a deep narrow one. This is where SPEC §7's
 * sluggish yaw at extreme beam comes from.
 */
const YAW_SECTION_POWER = 1.2
/** Linear part of the yaw damping, so she stops turning when the helm centres. */
const YAW_DAMPING_LINEAR = 0.03

/** Discharge coefficient of an open gunport taking water. */
const PORT_DISCHARGE = 0.6
/** How far to leeward the water she takes in ends up, as a fraction of beam. */
const FLOOD_LEVER_FACTOR = 0.32
/** Water this heavy relative to the ship and she is lost whatever she does. */
const FOUNDER_FLOOD_FRACTION = 0.25
/** How fast a lost ship settles below the waterplane, metres per second. */
const FOUNDER_RATE_MPS = 0.35
/** She lies over for this long before she starts going down. */
const FOUNDER_DELAY_S = 2.5

/**
 * The righting arm and the floating attitude at every heel, sampled once when
 * the ship is launched. Solving the waterplane afresh at sixty frames a second
 * would cost far more than interpolating a curve, and the design does not
 * change during a trial.
 */
export type StabilityCurve = {
  /** Heel angles in degrees, from -CURVE_LIMIT_DEG upwards in even steps. */
  heelDeg: number[]
  /** Righting arm at each sample, metres. Positive resists positive heel. */
  gz: number[]
  /** Waterplane offset at each sample: the height to draw her at. */
  offset: number[]
  draft: number[]
  trimRad: number
  /** Projection of every opening along the waterplane normal, per sample. */
  openingProjection: number[][]
  /** Peak righting moment either way, newton-metres. */
  maxRightingMomentNm: number
  /** Heel at which the righting arm vanishes each way, degrees. NaN if never. */
  vanishingDeg: { port: number; starboard: number }
  /** Heel at which the first opening dips under, degrees. NaN if never. */
  downfloodingDeg: { port: number; starboard: number }
}

export function buildStabilityCurve(
  sections: HullSection[],
  massKg: number,
  centreOfGravity: { x: number; y: number; z: number },
  openings: { x: number; y: number; z: number }[],
): StabilityCurve {
  const upright = solveFloating(sections, massKg, centreOfGravity)
  const trimRad = upright.trimRad
  const heelDeg: number[] = []
  for (let d = -CURVE_LIMIT_DEG; d <= CURVE_LIMIT_DEG; d += CURVE_STEP_DEG) heelDeg.push(d)

  const gz: number[] = []
  const offset: number[] = []
  const draft: number[] = []
  const openingProjection: number[][] = []
  for (const d of heelDeg) {
    const heelRad = (d * Math.PI) / 180
    const state = floatAtHeel(sections, massKg, centreOfGravity, heelRad, { trimRad })
    gz.push(state.gz)
    offset.push(state.offset)
    draft.push(state.draft)
    openingProjection.push(openingProjections(openings, heelRad, trimRad))
  }

  const weight = massKg * GRAVITY
  let maxRightingMomentNm = 0
  for (let i = 0; i < heelDeg.length; i++) {
    const moment = weight * gz[i] * Math.sign(heelDeg[i] || 1)
    if (moment > maxRightingMomentNm) maxRightingMomentNm = moment
  }

  // The vanishing angle: where the arm that has been resisting heel gives up.
  const vanishing = { port: NaN, starboard: NaN }
  for (let i = 0; i < heelDeg.length - 1; i++) {
    const d = heelDeg[i]
    if (d > 0 && Number.isNaN(vanishing.starboard) && gz[i] > 0 && gz[i + 1] <= 0) {
      vanishing.starboard = d
    }
    if (d < 0 && gz[i] >= 0 && gz[i + 1] < 0) vanishing.port = heelDeg[i + 1]
  }

  const downflooding = { port: NaN, starboard: NaN }
  for (let i = 0; i < heelDeg.length; i++) {
    const under = openingProjection[i].some((v) => v < offset[i])
    if (!under) continue
    const d = heelDeg[i]
    if (d > 0 && Number.isNaN(downflooding.starboard)) downflooding.starboard = d
    if (d < 0) downflooding.port = d
  }

  return {
    heelDeg,
    gz,
    offset,
    draft,
    trimRad,
    openingProjection,
    maxRightingMomentNm,
    vanishingDeg: vanishing,
    downfloodingDeg: downflooding,
  }
}

/** Fractional index into the curve for a heel in radians, clamped to its ends. */
function curveIndex(curve: StabilityCurve, heelRad: number): { i: number; t: number } {
  const deg = (heelRad * 180) / Math.PI
  const raw = (deg + CURVE_LIMIT_DEG) / CURVE_STEP_DEG
  const clamped = Math.max(0, Math.min(curve.heelDeg.length - 1.0001, raw))
  const i = Math.floor(clamped)
  return { i, t: clamped - i }
}

function sample(values: number[], at: { i: number; t: number }): number {
  const a = values[at.i]
  const b = values[Math.min(values.length - 1, at.i + 1)]
  return a + (b - a) * at.t
}

/** Righting arm at an arbitrary heel, interpolated from the curve. */
export function gzAt(curve: StabilityCurve, heelRad: number): number {
  return sample(curve.gz, curveIndex(curve, heelRad))
}

/** Height of the waterplane above the baseline at an arbitrary heel. */
export function offsetAt(curve: StabilityCurve, heelRad: number): number {
  return sample(curve.offset, curveIndex(curve, heelRad))
}

// ---------------------------------------------------------------------------
// The ship as the trial sees her
// ---------------------------------------------------------------------------

export type TrialEnvironment = {
  model: ShipModel
  curve: StabilityCurve
  massKg: number
  weightN: number
  rollInertia: number
  rollDampingNmsPerRad: number
  yawInertia: number
  yawDampingCoefficient: number
  surgeMassKg: number
  wettedAreaM2: number
  frictionCoefficient: number
  hullSpeedMps: number
  rudderAreaM2: number
  rudderLeverM: number
  centreOfLateralResistanceX: number
  /** Area of one gunport, and how many there are. */
  openingAreaM2: number
  waterplaneAreaM2: number
  floodLeverM: number
  uprightOffsetM: number
  uprightDraftM: number
  gmM: number
}

/** Area of the waterplane at the upright floating attitude, square metres. */
function waterplaneArea(model: ShipModel, offset: number): number {
  const hull = model.hull
  const stations = hull.stations
  const dx = stations[1].x - stations[0].x
  let area = 0
  for (const station of stations) {
    area += 2 * halfBreadthAt(hull, station.u, offset) * dx
  }
  return Math.max(1, area)
}

export function buildTrialEnvironment(model: ShipModel): TrialEnvironment {
  const sections = hullSections(model.hull)
  const massKg = model.masses.totalKg
  const cg = model.masses.centreOfGravity
  const curve = buildStabilityCurve(sections, massKg, cg, model.sockets.openings)
  const upright = solveFloating(sections, massKg, cg)

  const beam = model.hull.params.beam
  const length = model.hull.length
  // Small-angle metacentric height, read off the curve either side of upright.
  const phi = (2 * Math.PI) / 180
  const gmM = (gzAt(curve, phi) - gzAt(curve, -phi)) / (2 * Math.sin(phi))

  const rollInertia = massKg * Math.pow(ROLL_GYRADIUS_FACTOR * beam, 2) * ROLL_ADDED_MASS
  const stiffness = massKg * GRAVITY * Math.max(0.15, gmM)
  const beamRatio = beam / (ORDINARY_BEAM_RATIO * length)
  const dampingRatio = ROLL_DAMPING_RATIO * Math.pow(beamRatio, ROLL_DAMPING_BEAM_POWER)
  const rollDampingNmsPerRad = 2 * dampingRatio * Math.sqrt(rollInertia * stiffness)

  const yawInertia =
    massKg *
    (Math.pow(YAW_GYRADIUS_FACTOR * length, 2) + Math.pow(0.35 * beam, 2))
  const centreOfLateralResistanceX = lateralPlaneCentroidX(model, upright.offset)
  const draft = Math.max(0.5, upright.draft)
  const yawDampingCoefficient =
    (YAW_DRAG *
      SEA_WATER_DENSITY *
      draft *
      Math.pow(beam / draft, YAW_SECTION_POWER) *
      Math.pow(length, 4)) /
    32

  const rudder = rudderPlan(model, upright.offset)

  return {
    model,
    curve,
    massKg,
    weightN: massKg * GRAVITY,
    rollInertia,
    rollDampingNmsPerRad,
    yawInertia,
    yawDampingCoefficient,
    surgeMassKg: massKg * SURGE_ADDED_MASS,
    wettedAreaM2: Math.max(1, model.wettedAreaM2),
    frictionCoefficient:
      FRICTION_COEFFICIENT *
      (model.design.cosmetics.copperSheathing ? COPPER_FRICTION_SCALE : 1),
    // Hull speed, 1.34 knots per root foot of waterline, in metres per second.
    hullSpeedMps: 2.43 * Math.sqrt(Math.max(1, 0.94 * length)) * KNOTS_TO_MPS,
    rudderAreaM2: rudder.areaM2,
    rudderLeverM: rudder.leverM,
    centreOfLateralResistanceX,
    openingAreaM2: GUNPORT_WIDTH * GUNPORT_HEIGHT,
    waterplaneAreaM2: waterplaneArea(model, upright.offset),
    floodLeverM: FLOOD_LEVER_FACTOR * beam,
    uprightOffsetM: upright.offset,
    uprightDraftM: upright.draft,
    gmM,
  }
}

/**
 * The centre of lateral resistance: the centroid of the submerged profile she
 * presents to a sideways push, taken from the station keel line rather than
 * assumed. A rig whose centre of effort stands forward of this makes her bear
 * away; one abaft it makes her gripe.
 */
function lateralPlaneCentroidX(model: ShipModel, waterlineY: number): number {
  let area = 0
  let moment = 0
  for (const station of model.hull.stations) {
    const depth = Math.max(0, waterlineY - station.keelY)
    area += depth
    moment += depth * station.x
  }
  return area > 0 ? moment / area : 0
}

/**
 * The rudder as the physics sees it: the same blade the scene hangs astern, and
 * only the part of it that is in the water. A hull floating high steers badly
 * because half her rudder is in the air.
 */
function rudderPlan(model: ShipModel, waterlineY: number): { areaM2: number; leverM: number } {
  const hull = model.hull
  const chord = hull.length * 0.036
  const foot = 0.15
  const head = hull.decks[0].y + 0.6
  const wetted = Math.max(0.5, Math.min(head, waterlineY) - foot)
  return {
    areaM2: chord * wetted,
    leverM: Math.abs(-hull.length / 2 - -0.03 * hull.length),
  }
}

// ---------------------------------------------------------------------------
// The state, and one step of it
// ---------------------------------------------------------------------------

export type TrialState = {
  timeS: number
  /** Positive is starboard down. */
  heelRad: number
  heelRateRadS: number
  headingRad: number
  yawRateRadS: number
  speedMps: number
  /** Distance run, metres. */
  distanceM: number
  /** Where she is on the sea, metres; the wake is laid down along this track. */
  positionX: number
  positionZ: number
  /** Water taken in through submerged gunports, kilograms. */
  floodedKg: number
  /** Height of the waterplane above her baseline: where to draw the sea. */
  waterlineY: number
  trimRad: number
  gz: number
  /** True once she is past recovery and lying on her rig. */
  capsized: boolean
  /** How long she has been past saving; she lies over before she goes down. */
  lostForS: number
  /** How far the whole ship has settled below the waterplane, metres. */
  founderedM: number
  sunk: boolean
}

export type TrialControls = {
  wind: WindConditions
  /** Rudder as a fraction of hard over; positive puts the bow to starboard. */
  rudder: number
  sails: Record<string, SailState>
}

export type TrialStep = {
  state: TrialState
  load: WindLoad
  /** How many gunports are under water right now. */
  portsUnder: number
}

/**
 * She goes into the water upright and at rest, the way a ship comes off the
 * slip, and finds her own attitude from there: a ship with her guns all to one
 * side rolls down into her list, and one with no stability at all keeps going.
 * Starting her at the answer would be scripting the failure states SPEC §7
 * insists must emerge.
 */
export function initialTrialState(env: TrialEnvironment, headingRad = 0): TrialState {
  const heelRad = 0
  return {
    timeS: 0,
    heelRad,
    heelRateRadS: 0,
    headingRad,
    yawRateRadS: 0,
    speedMps: 0,
    distanceM: 0,
    positionX: 0,
    positionZ: 0,
    floodedKg: 0,
    waterlineY: offsetAt(env.curve, heelRad),
    trimRad: env.curve.trimRad,
    gz: gzAt(env.curve, heelRad),
    capsized: false,
    lostForS: 0,
    founderedM: 0,
    sunk: false,
  }
}

/**
 * The heel she lies at with no wind on her: the angle nearest upright where the
 * righting arm crosses zero the right way. A symmetric ship finds zero; one
 * with her guns all to port finds her list.
 */
export function restingHeel(env: TrialEnvironment): number {
  const { curve } = env
  let best: number | null = null
  for (let i = 0; i < curve.heelDeg.length - 1; i++) {
    const g0 = curve.gz[i]
    const g1 = curve.gz[i + 1]
    // Righting arm rising through zero: below it she falls away, above it the
    // hull pushes back, so this is where she settles.
    if (g0 <= 0 && g1 > 0) {
      const t = g0 === g1 ? 0 : -g0 / (g1 - g0)
      const deg = curve.heelDeg[i] + t * CURVE_STEP_DEG
      if (best === null || Math.abs(deg) < Math.abs(best)) best = deg
    }
  }
  if (best === null) {
    // No equilibrium at all: she lies over on whichever side her weight is.
    const side = gzAt(curve, 0) > 0 ? -1 : 1
    return (side * CAPSIZE_ANGLE_DEG * Math.PI) / 180
  }
  return (best * Math.PI) / 180
}

/** Resistance of the hull at a given speed through the water, newtons. */
export function resistanceN(env: TrialEnvironment, speedMps: number): number {
  const froude = Math.abs(speedMps) / env.hullSpeedMps
  const wave = WAVE_RESISTANCE_COEFFICIENT * Math.pow(froude, WAVE_RESISTANCE_POWER)
  const coefficient = env.frictionCoefficient + Math.min(0.4, wave)
  return (
    0.5 *
    SEA_WATER_DENSITY *
    env.wettedAreaM2 *
    coefficient *
    speedMps *
    Math.abs(speedMps)
  )
}

/**
 * One step of the trial. Explicit Euler at a small fixed step: the roll spring
 * is stiff enough that anything larger than about a fiftieth of a second walks
 * away, so the caller feeds this a fixed step and calls it as often as it needs.
 */
export function stepTrial(
  env: TrialEnvironment,
  state: TrialState,
  controls: TrialControls,
  dtSeconds: number,
): TrialStep {
  const { curve } = env
  const index = curveIndex(curve, state.heelRad)
  const gz = sample(curve.gz, index)
  const offset = sample(curve.offset, index)
  const draft = sample(curve.draft, index)

  // --- water she has taken in -------------------------------------------
  const sinkage = state.floodedKg / (SEA_WATER_DENSITY * env.waterplaneAreaM2)
  const waterline = offset + sinkage
  const projections = curve.openingProjection[index.i]
  let portsUnder = 0
  let inflow = 0
  for (const projection of projections) {
    const depth = waterline - projection
    if (depth <= 0) continue
    portsUnder++
    inflow += PORT_DISCHARGE * env.openingAreaM2 * Math.sqrt(2 * GRAVITY * depth)
  }
  const floodedKg = state.floodedKg + inflow * SEA_WATER_DENSITY * dtSeconds

  // --- what the wind is doing to her ------------------------------------
  const load = windLoad(
    env.model.sails,
    controls.sails,
    controls.wind,
    state.headingRad,
    state.speedMps,
    {
      waterlineY: waterline,
      draftM: draft,
      centreOfLateralResistanceX: env.centreOfLateralResistanceX,
      heelRad: state.heelRad,
    },
  )

  // --- roll --------------------------------------------------------------
  // Water in the hold lies to leeward and its weight holds her down there; it
  // also robs the righting arm, which is the free surface she now carries.
  const floodSide = Math.sign(state.heelRad) || 1
  const floodMomentNm =
    floodedKg * GRAVITY * env.floodLeverM * floodSide * Math.cos(state.heelRad)
  const intactFraction = env.massKg / (env.massKg + floodedKg)
  const rightingNm = -env.weightN * gz * intactFraction
  const dampingNm = -env.rollDampingNmsPerRad * state.heelRateRadS
  const rollAcceleration =
    (load.heelMomentNm + floodMomentNm + rightingNm + dampingNm) / env.rollInertia

  let heelRate = state.heelRateRadS + rollAcceleration * dtSeconds
  let heel = state.heelRad + heelRate * dtSeconds
  const maxHeel = (MAX_HEEL_DEG * Math.PI) / 180
  if (Math.abs(heel) >= maxHeel) {
    // Her masts and yards are in the water; they will not let her go further.
    heel = Math.sign(heel) * maxHeel
    heelRate = 0
  }

  // --- surge -------------------------------------------------------------
  const driveN = load.driveN * Math.cos(heel)
  const speedMps =
    state.speedMps +
    (((driveN - resistanceN(env, state.speedMps)) * SURGE_RESPONSE) / env.surgeMassKg) *
      dtSeconds

  // --- yaw ---------------------------------------------------------------
  const rudderRad = Math.max(-1, Math.min(1, controls.rudder)) * MAX_RUDDER_RAD
  const rudderNm =
    0.5 *
    SEA_WATER_DENSITY *
    speedMps *
    Math.abs(speedMps) *
    env.rudderAreaM2 *
    RUDDER_LIFT_COEFFICIENT *
    Math.sin(rudderRad) *
    env.rudderLeverM
  const yawDampingNm =
    -env.yawDampingCoefficient *
    (YAW_DAMPING_LINEAR + Math.abs(state.yawRateRadS)) *
    state.yawRateRadS
  const yawAcceleration =
    (load.yawMomentNm + rudderNm + yawDampingNm) / env.yawInertia
  const yawRate = state.yawRateRadS + yawAcceleration * dtSeconds

  // --- is she lost? ------------------------------------------------------
  const capsized =
    state.capsized || Math.abs(heel) > (CAPSIZE_ANGLE_DEG * Math.PI) / 180
  const swamped = floodedKg > FOUNDER_FLOOD_FRACTION * env.massKg
  const timeS = state.timeS + dtSeconds
  // She lies over for a moment before the water finds its way below and takes
  // her down; the delay is what makes the capsize readable.
  const lostForS = capsized || swamped ? state.lostForS + dtSeconds : 0
  const founderedM = Math.max(0, lostForS - FOUNDER_DELAY_S) * FOUNDER_RATE_MPS

  return {
    state: {
      timeS,
      heelRad: heel,
      heelRateRadS: heelRate,
      headingRad: state.headingRad + yawRate * dtSeconds,
      yawRateRadS: yawRate,
      speedMps,
      distanceM: state.distanceM + speedMps * dtSeconds,
      positionX: state.positionX + speedMps * Math.cos(state.headingRad) * dtSeconds,
      positionZ: state.positionZ + speedMps * Math.sin(state.headingRad) * dtSeconds,
      floodedKg,
      waterlineY: waterline,
      trimRad: curve.trimRad,
      gz,
      capsized,
      lostForS,
      founderedM,
      sunk: founderedM > env.model.hull.depth + 4,
    },
    load,
    portsUnder,
  }
}

/**
 * Run the trial forward for a stretch of time at a fixed step. Tests use this;
 * so does the scene, one animation frame at a time.
 */
export function runTrial(
  env: TrialEnvironment,
  state: TrialState,
  controls: TrialControls,
  seconds: number,
  stepSeconds = 0.02,
): TrialStep {
  let current: TrialStep = { state, load: emptyLoad(), portsUnder: 0 }
  const steps = Math.max(1, Math.round(seconds / stepSeconds))
  for (let i = 0; i < steps; i++) {
    current = stepTrial(env, current.state, controls, stepSeconds)
  }
  return current
}

function emptyLoad(): WindLoad {
  return {
    apparent: { speedMps: 0, bearingRad: 0 },
    driveN: 0,
    sideN: 0,
    heelMomentNm: 0,
    yawMomentNm: 0,
    pressureBySail: {},
  }
}

export function speedKn(state: TrialState): number {
  return state.speedMps / KNOTS_TO_MPS
}

export function heelDeg(state: TrialState): number {
  return (state.heelRad * 180) / Math.PI
}
