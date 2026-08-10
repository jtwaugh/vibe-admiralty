import { getPreset } from '../data'
import type { HullPreset, TimberZoneId } from '../data/schemas'
import { buildHull } from '../hull/stations'
import { buildSockets } from '../hull/sockets'
import { buildSailPlan } from '../physics/sailplan'
import type { Design, MountConfig, SailState } from '../export/schema'

/** The gun a battery is armed with by default, by socket and preset size. */
function defaultGunFor(socketId: string, preset: HullPreset): string | null {
  const rating = preset.nominalGuns
  if (socketId.startsWith('battery-deck-')) {
    const deck = Number(socketId.slice('battery-deck-'.length))
    if (preset.params.deckCount > 1) return deck === 0 ? 'long-32' : 'long-18'
    if (rating >= 38) return 'long-18'
    if (rating >= 28) return 'long-12'
    if (rating >= 18) return 'long-9'
    return 'long-6'
  }
  if (socketId === 'quarterdeck' || socketId === 'forecastle') {
    return rating >= 60 ? 'carronade-32' : 'carronade-24'
  }
  if (socketId === 'bow-chaser' || socketId === 'stern-chaser') {
    return rating >= 38 ? 'long-9' : 'long-6'
  }
  if (socketId === 'swivel-rail') return 'swivel-half'
  return null
}

export function defaultDesign(presetId: string, name?: string): Design {
  const preset = getPreset(presetId)
  const hull = buildHull(preset.params)
  const sockets = buildSockets(hull, preset)

  const mounts: Record<string, MountConfig> = {}
  for (const socket of sockets.mounts) {
    const gunId = defaultGunFor(socket.id, preset)
    // Chasers and swivels start bare; the main batteries start fully manned.
    const full = socket.kind === 'battery' ? socket.maxPerSide : 0
    mounts[socket.id] = { gunId, port: full, starboard: full }
  }

  const zones: Record<TimberZoneId, 'light' | 'standard' | 'heavy'> = {
    bottom: 'standard',
    wales: 'standard',
    topsides: 'standard',
    bulwarks: 'standard',
    deck: 'standard',
  }

  const sails: Record<string, SailState> = {}
  for (const sail of buildSailPlan(hull, sockets, 'standard')) {
    sails[sail.id] = 'furled'
  }

  return {
    name: name ?? `HMS ${preset.name}`,
    presetId,
    hull: { ...preset.params },
    timber: { speciesId: 'english-oak', zones, nettings: true },
    rig: { sailPlanId: 'standard', sails },
    cosmetics: {
      figureheadId: 'lion',
      sternGalleryId: 'gallery',
      paintSchemeId: 'nelson-chequer',
      copperSheathing: false,
    },
    mounts,
  }
}

/** Empty every mount, used by tests that want a bare hull. */
export function disarm(design: Design): Design {
  const mounts: Record<string, MountConfig> = {}
  for (const [id, config] of Object.entries(design.mounts)) {
    mounts[id] = { ...config, port: 0, starboard: 0 }
  }
  return { ...design, mounts }
}
