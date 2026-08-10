// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { exportGltfJson, gltfNodeNames } from '../src/export/gltf-export'
import { hullSections, solveFloating } from '../src/physics/hydrostatics'
import { buildShipModel } from '../src/physics/masses'
import type { Design } from '../src/export/schema'
import { defaultDesign } from '../src/state/defaults'

/**
 * The node names are the export contract (SPEC §8): a future engine animates by
 * looking them up, so they are asserted on the parsed glTF, not on the scene.
 * jsdom has no 2d canvas, so the materials fall back to flat colour; the
 * hierarchy, which is what the contract covers, is identical either way.
 */
async function exportNames(design: Design): Promise<string[]> {
  const model = buildShipModel(design)
  const float = solveFloating(
    hullSections(model.hull),
    model.masses.totalKg,
    model.masses.centreOfGravity,
  )
  return gltfNodeNames(await exportGltfJson(model, float.offset))
}

describe('glTF export', () => {
  it('names the hull, masts, sails, rudder and every armed mount', async () => {
    const design = defaultDesign('frigate-38')
    const names = await exportNames(design)

    expect(names).toContain('Hull')
    expect(names).toContain('Rudder')
    for (const index of [1, 2, 3]) expect(names).toContain(`Mast_${index}`)
    for (const tier of ['course', 'topsail', 'topgallant']) {
      expect(names).toContain(`Sail_main_${tier}`)
      expect(names).toContain(`Yard_${tier}`)
    }
    expect(names).toContain('Sail_fore_jib')
    expect(names).toContain('Sail_mizzen_spanker')

    for (const [id, config] of Object.entries(design.mounts)) {
      const armed = config.gunId !== null && config.port + config.starboard > 0
      expect(names.includes(`Mount_${id}`)).toBe(armed)
    }
  })

  it('leaves the mount markers out of the exported model', async () => {
    const names = await exportNames(defaultDesign('sloop'))
    expect(names.some((name) => name.startsWith('Marker_'))).toBe(false)
  })

  it('exports the single-masted sloop with one mast node', async () => {
    const names = await exportNames(defaultDesign('sloop'))
    expect(names).toContain('Mast_1')
    expect(names).not.toContain('Mast_2')
    expect(names).toContain('Sail_main_course')
  })
})
