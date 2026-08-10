import { findGun } from '../data'
import type { ShipModel } from '../physics/masses'
import { totalSailArea } from '../physics/sailplan'
import type { CrewStation } from './schema'

/**
 * Crew stations for the future game (SPEC §8). These are derived from the
 * sockets and the armament, never edited: the designer has no UI for them.
 */

/** How many hands one mast needs to work its canvas. */
function sailHandlingCrew(areaM2: number): number {
  return Math.max(4, Math.round(areaM2 / 55))
}

export function buildCrewStations(model: ShipModel): CrewStation[] {
  const stations: CrewStation[] = []
  const hull = model.hull

  stations.push({
    id: 'helm',
    type: 'helm',
    position: { ...model.sockets.helm },
    crewRequired: Math.max(2, Math.round(hull.length / 16)),
  })

  for (const socket of model.sockets.mounts) {
    if (socket.kind === 'swivel') continue
    const config = model.design.mounts[socket.id]
    if (!config?.gunId) continue
    const gun = findGun(config.gunId)
    if (!gun) continue
    const port = Math.min(config.port, socket.maxPerSide)
    const starboard = Math.min(config.starboard, socket.maxPerSide)
    if (port + starboard === 0) continue

    // The station sits on the centreline of the deck, amidships of its battery,
    // because a crew crosses from one side to the other to serve either broadside.
    const positions = socket.positions.slice(0, Math.max(port, starboard))
    const x = positions.reduce((sum, p) => sum + p.x, 0) / Math.max(1, positions.length)
    const y = hull.decks[socket.deckIndex].y + 0.6

    if (socket.kind === 'chaser') {
      stations.push({
        id: socket.id,
        type: socket.id === 'bow-chaser' ? 'bow-chaser' : 'stern-chaser',
        position: { x, y, z: 0 },
        crewRequired: Math.max(port, starboard) * gun.crewPerGun,
        deck: socket.deckIndex,
        gunCount: port + starboard,
      })
      continue
    }

    stations.push({
      id: `battery-${socket.id}`,
      type: 'gun-battery',
      position: { x, y, z: 0 },
      // A crew serves one side at a time, so the heavier side sets the need.
      crewRequired: Math.max(port, starboard) * gun.crewPerGun,
      deck: socket.deckIndex,
      gunCount: port + starboard,
    })
  }

  for (const mast of model.sockets.masts) {
    const area = totalSailArea(model.sails.filter((s) => s.mastIndex === mast.index))
    stations.push({
      id: `sail-${mast.label.replace(/\s+/g, '-')}`,
      type: 'sail-handling',
      position: { x: mast.x, y: mast.deckY, z: 0 },
      crewRequired: sailHandlingCrew(area),
    })
    stations.push({
      id: `lookout-${mast.label.replace(/\s+/g, '-')}`,
      type: 'lookout',
      // The top: the platform at the head of the lower mast.
      position: { x: mast.x, y: mast.stepY + 0.46 * (mast.truckY - mast.stepY), z: 0 },
      crewRequired: 1,
    })
  }

  return stations
}
