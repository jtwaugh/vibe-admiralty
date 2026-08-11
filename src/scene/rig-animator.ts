import * as THREE from 'three'
import type { SailState } from '../export/schema'
import { trimAngle } from '../physics/wind'
import type { ApparentWind } from '../physics/wind'
import {
  buildSetSailGeometry,
  foreAndAftCorners,
  foreAndAftSailGeometry,
  setBillow,
} from './sails'
import type { SailHandle } from './ship-mesh'

/**
 * Handing the sails. A square sail is loosed by letting it fall from its yard,
 * which is a scale on the mesh; a headsail is hoisted up its stay and a spanker
 * hauled out along its boom, which needs the cloth rebuilt from its moving
 * corners. Either way it takes about two seconds, as SPEC §7 asks.
 */

/** Seconds to set or furl a sail. */
export const HAND_SECONDS = 2

/** Below this a sail is drawn as a bundle; above it as cloth. */
const CLOTH_THRESHOLD = 0.02

type SailProgress = {
  handle: SailHandle
  /** 0 furled, 1 set. */
  progress: number
  /** Progress the fore-and-aft geometry was last built at. */
  builtAt: number
}

export class RigAnimator {
  private sails: SailProgress[]

  constructor(handles: SailHandle[], states: Record<string, SailState>) {
    this.sails = handles.map((handle) => ({
      handle,
      progress: (states[handle.sail.id] ?? 'furled') === 'set' ? 1 : 0,
      builtAt: -1,
    }))
    for (const entry of this.sails) this.apply(entry, 0)
  }

  /**
   * Advance every sail towards the state the crew have been ordered to, and
   * put the wind's pressure into each sail's own billow uniform.
   */
  update(
    dtSeconds: number,
    states: Record<string, SailState>,
    pressureBySail: Record<string, number>,
    apparent: ApparentWind,
  ) {
    const step = dtSeconds / HAND_SECONDS
    for (const entry of this.sails) {
      const target = (states[entry.handle.sail.id] ?? 'furled') === 'set' ? 1 : 0
      if (entry.progress < target) entry.progress = Math.min(target, entry.progress + step)
      else if (entry.progress > target) entry.progress = Math.max(target, entry.progress - step)
      this.apply(entry, pressureBySail[entry.handle.sail.id] ?? 0, apparent)
    }
  }

  private apply(entry: SailProgress, pressure: number, apparent?: ApparentWind) {
    const { handle, progress } = entry

    // Brace the yards to the same angle the wind model trimmed them to, so the
    // canvas the player sees is the canvas the physics pushed on (rule 4).
    const side = apparent ? Math.sign(apparent.bearingRad) || 1 : 1
    const trim = apparent
      ? trimAngle(apparent.bearingRad, (handle.sail.minTrimDeg * Math.PI) / 180)
      : Math.PI / 2
    if (handle.square) handle.group.rotation.y = side * (Math.PI / 2 - trim)
    const setting = progress > CLOTH_THRESHOLD
    handle.cloth.visible = setting
    handle.furl.visible = progress < 1 - CLOTH_THRESHOLD

    // The bundle shrinks away as the cloth comes out of it.
    const bundle = Math.max(0.05, 1 - progress)
    handle.furl.scale.set(1, bundle, bundle)

    if (handle.square) {
      // The sail hangs from the origin of its own mesh, so scaling it in y
      // drops it from the yard exactly as loosing it does.
      handle.cloth.scale.y = Math.max(0.001, progress)
    } else if (Math.abs(progress - entry.builtAt) > 0.02) {
      // Head and clew move, so this cloth has to be rebuilt as it goes out.
      const corners = foreAndAftCorners(handle.sail, handle.mastX, progress)
      const geometry = foreAndAftSailGeometry(corners)
      handle.cloth.geometry.dispose()
      handle.cloth.geometry = geometry
      entry.builtAt = progress
    }

    // A square sail bellies away from its own braced plane, which the group's
    // rotation already carries; a fore-and-aft sail bellies to leeward.
    const direction = handle.square ? 1 : -side
    setBillow(handle.material, pressure * progress * direction)
  }

  /** Put every sail back where the design says it is, and stop animating. */
  dispose() {
    for (const entry of this.sails) {
      if (!entry.handle.square) {
        // Leave the cloth at its full shape so the designer draws it correctly.
        const shape = buildSetSailGeometry(
          entry.handle.sail,
          entry.handle.mastX,
          entry.handle.mastStepY,
        )
        entry.handle.cloth.geometry.dispose()
        entry.handle.cloth.geometry = shape.geometry
        entry.handle.cloth.position.copy(shape.position)
      }
      entry.handle.cloth.scale.set(1, 1, 1)
      entry.handle.furl.scale.set(1, 1, 1)
      setBillow(entry.handle.material, 0.35)
    }
  }
}

/** Deflect the rudder blade to match the tiller, for the look of the thing. */
export function setRudderAngle(rudder: THREE.Mesh, fraction: number) {
  rudder.rotation.y = -Math.max(-1, Math.min(1, fraction)) * (35 * Math.PI) / 180
}
