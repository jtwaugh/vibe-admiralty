import gunsRaw from './guns.json'
import timberRaw from './timber.json'
import presetsRaw from './presets.json'
import sailsRaw from './sails.json'
import cosmeticsRaw from './cosmetics.json'
import {
  cosmeticsFileSchema,
  gunsFileSchema,
  presetsFileSchema,
  sailsFileSchema,
  timberFileSchema,
} from './schemas'
import type { Gun, HullPreset, TimberSpecies, TimberZone, TimberZoneId } from './schemas'

/** Every data file is validated once, at module load, per CLAUDE.md rule 5. */
export const gunsFile = gunsFileSchema.parse(gunsRaw)
export const timberFile = timberFileSchema.parse(timberRaw)
export const presetsFile = presetsFileSchema.parse(presetsRaw)
export const sailsFile = sailsFileSchema.parse(sailsRaw)
export const cosmeticsFile = cosmeticsFileSchema.parse(cosmeticsRaw)

export const guns = gunsFile.guns
export const timberSpecies = timberFile.species
export const timberZones = timberFile.zones
export const hullPresets = presetsFile.presets
export const sailPlans = sailsFile.plans

const gunsById = new Map<string, Gun>(guns.map((g) => [g.id, g]))
const speciesById = new Map<string, TimberSpecies>(timberSpecies.map((s) => [s.id, s]))
const zonesById = new Map<TimberZoneId, TimberZone>(timberZones.map((z) => [z.id, z]))
const presetsById = new Map<string, HullPreset>(hullPresets.map((p) => [p.id, p]))

export function getGun(id: string): Gun {
  const gun = gunsById.get(id)
  if (!gun) throw new Error(`unknown gun id: ${id}`)
  return gun
}

export function findGun(id: string): Gun | undefined {
  return gunsById.get(id)
}

export function getSpecies(id: string): TimberSpecies {
  const s = speciesById.get(id)
  if (!s) throw new Error(`unknown timber species: ${id}`)
  return s
}

export function getZone(id: TimberZoneId): TimberZone {
  const z = zonesById.get(id)
  if (!z) throw new Error(`unknown timber zone: ${id}`)
  return z
}

export function getPreset(id: string): HullPreset {
  const p = presetsById.get(id)
  if (!p) throw new Error(`unknown hull preset: ${id}`)
  return p
}

/** Guns that can be mounted in a broadside battery or chaser position. */
export const batteryGuns = guns.filter((g) => g.pattern !== 'swivel')
export const swivelGun = getGun('swivel-half')

export * from './schemas'
