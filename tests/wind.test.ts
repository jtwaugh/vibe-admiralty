import { describe, expect, it } from 'vitest'
import { buildHull } from '../src/hull/stations'
import { buildSockets } from '../src/hull/sockets'
import { getPreset } from '../src/data'
import { buildSailPlan } from '../src/physics/sailplan'
import type { SailInstance } from '../src/physics/sailplan'
import {
  KNOTS_TO_MPS,
  apparentWind,
  sailForce,
  trimAngle,
  windLoad,
} from '../src/physics/wind'
import type { SailState } from '../src/export/schema'

/** The frigate's rig, which is the one the acceptance demos sail. */
function frigateSails(): SailInstance[] {
  const preset = getPreset('frigate-38')
  const hull = buildHull(preset.params)
  return buildSailPlan(hull, buildSockets(hull, preset), 'standard')
}

const sails = frigateSails()
const course = sails.find((s) => s.tier === 'course')!
const jib = sails.find((s) => s.tier === 'jib')!

/** Wind of a given strength coming from a bearing off the bow, ship stopped. */
function fromBearing(bearingDeg: number, knots = 20) {
  return { speedMps: knots * KNOTS_TO_MPS, bearingRad: (bearingDeg * Math.PI) / 180 }
}

function allSails(state: SailState): Record<string, SailState> {
  const out: Record<string, SailState> = {}
  for (const sail of sails) out[sail.id] = state
  return out
}

const options = {
  waterlineY: 4.8,
  draftM: 4.8,
  centreOfLateralResistanceX: -1.4,
}

describe('apparent wind', () => {
  it('is the true wind when the ship is stopped', () => {
    const apparent = apparentWind({ directionRad: Math.PI / 2, speedKn: 20 }, 0, 0)
    expect(apparent.speedMps).toBeCloseTo(20 * KNOTS_TO_MPS, 6)
    // The wind's source is on the starboard beam.
    expect((apparent.bearingRad * 180) / Math.PI).toBeCloseTo(90, 6)
  })

  it('falls away as she runs before it, and rises as she beats into it', () => {
    const wind = { directionRad: 0, speedKn: 20 }
    // directionRad 0 is a wind out of +x, so a ship heading +x has it ahead.
    const beating = apparentWind(wind, 0, 3)
    const running = apparentWind(wind, Math.PI, 3)
    expect(beating.speedMps).toBeGreaterThan(20 * KNOTS_TO_MPS)
    expect(running.speedMps).toBeLessThan(20 * KNOTS_TO_MPS)
    expect(Math.abs(beating.bearingRad)).toBeCloseTo(0, 6)
    expect(Math.abs(running.bearingRad)).toBeCloseTo(Math.PI, 6)
  })
})

describe('trimming', () => {
  it('bisects the apparent wind until the rig will brace no further', () => {
    const limit = (30 * Math.PI) / 180
    // Wind well aft: the yards go square, bisecting the angle.
    expect(trimAngle(Math.PI, limit)).toBeCloseTo(Math.PI / 2, 6)
    expect(trimAngle(Math.PI / 2, limit)).toBeCloseTo(Math.PI / 4, 6)
    // Wind forward of that: the yards are hard against the shrouds.
    expect(trimAngle((30 * Math.PI) / 180, limit)).toBeCloseTo(limit, 6)
  })
})

describe('the force on one sail', () => {
  it('grows with the square of the wind', () => {
    const light = sailForce(course, fromBearing(90, 10))
    const strong = sailForce(course, fromBearing(90, 20))
    expect(strong.driveN / light.driveN).toBeCloseTo(4, 1)
  })

  it('drives hardest and heels least with the wind dead astern', () => {
    const astern = sailForce(course, fromBearing(180))
    const abeam = sailForce(course, fromBearing(90))
    expect(astern.driveN).toBeGreaterThan(abeam.driveN)
    expect(Math.abs(astern.sideN)).toBeLessThan(1e-6)
    expect(Math.abs(abeam.sideN)).toBeGreaterThan(0)
  })

  it('pushes the ship over to leeward, away from the wind', () => {
    expect(sailForce(course, fromBearing(90)).sideN).toBeLessThan(0)
    expect(sailForce(course, fromBearing(-90)).sideN).toBeGreaterThan(0)
  })

  it('is taken aback when the wind comes from ahead of the braces', () => {
    // A square sail cannot be braced past 32 degrees, so at 10 degrees off the
    // bow the wind is on the wrong side of the cloth and shoves her astern.
    const aback = sailForce(course, fromBearing(10))
    expect(aback.driveN).toBeLessThan(0)
    expect(aback.pressure).toBeLessThan(0)
  })

  it('lets the headsails lie closer to the wind than the square sails', () => {
    // Twenty-five degrees off the bow is inside the yards' bracing limit but
    // well outside the jib's, so the course is aback while the jib still draws.
    const closeHauled = fromBearing(25)
    expect(sailForce(course, closeHauled).driveN).toBeLessThan(0)
    expect(sailForce(jib, closeHauled).driveN).toBeGreaterThan(0)
    // Further off the wind both draw, but the headsail still does more per
    // square metre of cloth.
    const reaching = fromBearing(45)
    const perAreaCourse = sailForce(course, reaching).driveN / course.areaM2
    const perAreaJib = sailForce(jib, reaching).driveN / jib.areaM2
    expect(perAreaJib).toBeGreaterThan(perAreaCourse)
  })

  it('loses force as the ship lies over and shows the wind less cloth', () => {
    const upright = sailForce(course, fromBearing(90), 0)
    const heeled = sailForce(course, fromBearing(90), Math.PI / 3)
    expect(Math.abs(heeled.driveN)).toBeLessThan(Math.abs(upright.driveN) * 0.6)
  })
})

describe('the whole rig', () => {
  it('gives nothing at all when every sail is furled', () => {
    const load = windLoad(
      sails,
      allSails('furled'),
      { directionRad: Math.PI / 2, speedKn: 30 },
      0,
      0,
      options,
    )
    expect(load.driveN).toBe(0)
    expect(load.sideN).toBe(0)
    expect(load.heelMomentNm).toBe(0)
  })

  it('heels her away from the wind, and harder the more canvas she shows', () => {
    const wind = { directionRad: Math.PI / 2, speedKn: 20 }
    const all = windLoad(sails, allSails('set'), wind, 0, 0, options)
    const courses: Record<string, SailState> = {}
    for (const sail of sails) courses[sail.id] = sail.tier === 'course' ? 'set' : 'furled'
    const few = windLoad(sails, courses, wind, 0, 0, options)

    // Wind from starboard rolls her to port, which is a negative heel moment.
    expect(all.heelMomentNm).toBeLessThan(0)
    expect(all.heelMomentNm).toBeLessThan(few.heelMomentNm)
    expect(all.driveN).toBeGreaterThan(few.driveN)
  })

  it('reports a billow pressure for every set sail and none for a furled one', () => {
    const states = allSails('set')
    states[course.id] = 'furled'
    const load = windLoad(
      sails,
      states,
      { directionRad: Math.PI / 2, speedKn: 20 },
      0,
      0,
      options,
    )
    expect(load.pressureBySail[course.id]).toBe(0)
    expect(load.pressureBySail[jib.id]).toBeGreaterThan(0)
    for (const value of Object.values(load.pressureBySail)) {
      expect(Math.abs(value)).toBeLessThanOrEqual(1)
    }
  })
})
