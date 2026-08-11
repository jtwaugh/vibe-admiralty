import type { SailState } from '../export/schema'
import type { SailInstance } from './sailplan'

/**
 * The wind on the canvas (SPEC §7). Every set sail is a flat plate: the crew
 * trim it to bisect the apparent wind, the plate carries a normal force
 * proportional to the sail area, the dynamic pressure and the sine of the angle
 * of attack, and that force resolves into drive and heel. Nothing here is a
 * fluid simulation, and nothing here is scripted: a square rig cannot brace its
 * yards past its limit, which is the whole reason these ships sailed so badly
 * to windward.
 *
 * Ship axes: +x forward, +y up, +z starboard. Angles are radians.
 */

/** Air at 15 °C, kg/m^3. */
export const AIR_DENSITY = 1.225
export const KNOTS_TO_MPS = 0.514444

/**
 * Pressure at which a sail is drawing as full as it ever draws. It is low,
 * because canvas is not a balloon: a sail is either full or it is shaking, and
 * anything above a light air has it as full as it is going to get.
 */
const FULL_PRESSURE_PA = 14

export type WindConditions = {
  /**
   * Compass-free bearing the true wind blows *from*, measured in world axes
   * from +x towards +z. The sea trial's dial writes this.
   */
  directionRad: number
  speedKn: number
}

/** Apparent wind resolved into the ship's own axes. */
export type ApparentWind = {
  speedMps: number
  /**
   * Bearing of the wind's source off the bow: 0 is dead ahead, +pi/2 is the
   * starboard beam, +-pi is dead astern.
   */
  bearingRad: number
}

/**
 * The wind the ship feels: the true wind less her own motion through it. A ship
 * running fast off the wind feels much less of it, which is why she stops
 * accelerating long before the true wind would say she should.
 */
export function apparentWind(
  wind: WindConditions,
  headingRad: number,
  speedMps: number,
): ApparentWind {
  const trueSpeed = wind.speedKn * KNOTS_TO_MPS
  // Velocity of the air over the ground, then over the deck.
  const airX = -trueSpeed * Math.cos(wind.directionRad) - speedMps * Math.cos(headingRad)
  const airZ = -trueSpeed * Math.sin(wind.directionRad) - speedMps * Math.sin(headingRad)
  // Into ship axes: forward is (cos h, sin h), starboard is (-sin h, cos h).
  const forward = airX * Math.cos(headingRad) + airZ * Math.sin(headingRad)
  const starboard = -airX * Math.sin(headingRad) + airZ * Math.cos(headingRad)
  return {
    speedMps: Math.hypot(forward, starboard),
    // The source of the wind is opposite the direction it blows.
    bearingRad: Math.atan2(-starboard, -forward),
  }
}

/**
 * Angle of the sail's chord from the centreline: pi/2 is a yard squared across
 * the ship, small angles are a sail sheeted hard in fore and aft. The crew
 * bisect the apparent wind, which is the standard rule of thumb, and cannot
 * brace closer than the rig allows.
 */
export function trimAngle(bearingRad: number, minTrimRad: number): number {
  const half = Math.abs(bearingRad) / 2
  return Math.min(Math.PI / 2, Math.max(minTrimRad, half))
}

export type SailForce = {
  sailId: string
  /** Force along +x, newtons. Negative when the sail is aback. */
  driveN: number
  /** Force along +z, newtons. Blows to leeward, so it opposes the wind's side. */
  sideN: number
  /**
   * How hard the wind is on this cloth, -1..1, for the billow in the sail
   * shader. Negative means the sail is taken aback and bellies the wrong way.
   */
  pressure: number
}

/**
 * Force on one sail. `sin(bearing - trim)` is the angle of attack term: when the
 * wind comes from closer to the bow than the yards can be braced, it goes
 * negative, the sail is aback, and it pushes the ship backwards. That is not a
 * special case in the code and it should not be one.
 */
export function sailForce(
  sail: SailInstance,
  apparent: ApparentWind,
  heelRad = 0,
): SailForce {
  const bearing = Math.abs(apparent.bearingRad)
  const side = Math.sign(apparent.bearingRad) || 1
  const trim = trimAngle(apparent.bearingRad, (sail.minTrimDeg * Math.PI) / 180)
  const attack = Math.sin(bearing - trim)
  const pressureQ = 0.5 * AIR_DENSITY * apparent.speedMps * apparent.speedMps
  // As the ship lies over, the sails present less of themselves to the wind.
  const projection = Math.max(0, Math.cos(heelRad))
  const normalN = pressureQ * sail.areaM2 * sail.coefficient * attack * projection
  return {
    sailId: sail.id,
    driveN: normalN * Math.sin(trim),
    sideN: -side * normalN * Math.cos(trim),
    pressure: Math.max(-1, Math.min(1, (pressureQ * attack) / FULL_PRESSURE_PA)),
  }
}

export type WindLoad = {
  apparent: ApparentWind
  /** Total force along +x, newtons. */
  driveN: number
  /** Total force along +z, newtons. */
  sideN: number
  /** Moment rolling her to starboard, newton-metres. */
  heelMomentNm: number
  /** Moment turning her bow to starboard, newton-metres. */
  yawMomentNm: number
  /** Billow pressure per sail id, for the scene. */
  pressureBySail: Record<string, number>
}

export type WindLoadOptions = {
  /** Height of the load waterline above the ship's baseline. */
  waterlineY: number
  /** Draft, used to place the water's reaction to the side force. */
  draftM: number
  /** Longitudinal centre of lateral resistance, ship-local x. */
  centreOfLateralResistanceX: number
  heelRad?: number
}

/**
 * Sum the whole rig. The side force's lever is measured from the centre of
 * effort down to the middle of the underwater body, because that is where the
 * water pushes back; both ends of that lever swing in as the ship heels, so the
 * heeling moment falls with the square of the cosine, which is what lets a ship
 * find a steady angle instead of going straight over.
 */
export function windLoad(
  sails: SailInstance[],
  states: Record<string, SailState>,
  wind: WindConditions,
  headingRad: number,
  speedMps: number,
  options: WindLoadOptions,
): WindLoad {
  const apparent = apparentWind(wind, headingRad, speedMps)
  const heelRad = options.heelRad ?? 0
  const lean = Math.max(0, Math.cos(heelRad))
  let driveN = 0
  let sideN = 0
  let heelMomentNm = 0
  let yawMomentNm = 0
  const pressureBySail: Record<string, number> = {}

  for (const sail of sails) {
    if ((states[sail.id] ?? 'furled') !== 'set') {
      pressureBySail[sail.id] = 0
      continue
    }
    const force = sailForce(sail, apparent, heelRad)
    pressureBySail[sail.id] = force.pressure
    driveN += force.driveN
    sideN += force.sideN
    const arm = sail.coeY - options.waterlineY + options.draftM / 2
    heelMomentNm += force.sideN * arm * lean
    yawMomentNm += force.sideN * (sail.coeX - options.centreOfLateralResistanceX)
    // Weather helm. Once she is over, the whole rig stands out to leeward of
    // the hull that is resisting it, so the drive and the hull's drag make a
    // couple in the horizontal plane that swings her bow up into the wind. This
    // is why a hard-pressed square rigger rounds up, and why she does not
    // quietly bear away to nothing when the helm is amidships.
    yawMomentNm -= force.driveN * arm * Math.sin(heelRad)
  }

  return { apparent, driveN, sideN, heelMomentNm, yawMomentNm, pressureBySail }
}
