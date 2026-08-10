import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { ShipModel } from '../physics/masses'
import { buildShipMesh } from '../scene/ship-mesh'
import { downloadBlob, exportFilename } from './json-export'

/**
 * glTF export (SPEC §8). The named node hierarchy is the contract: a future
 * engine animates by looking names up, so the model is exported exactly as the
 * viewer builds it, in ship-local coordinates with the baseline at y = 0.
 * Mount markers are invisible and the exporter skips them.
 */
export async function exportGltfJson(
  model: ShipModel,
  waterlineY: number,
): Promise<Record<string, unknown>> {
  const ship = buildShipMesh(model, waterlineY)
  try {
    const exporter = new GLTFExporter()
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      exporter.parse(
        ship.group,
        (gltf) => resolve(gltf as Record<string, unknown>),
        (error) => reject(error),
        { binary: false, onlyVisible: true },
      )
    })
    return result
  } finally {
    ship.dispose()
  }
}

/** Every node name in an exported document, for tests and for sanity. */
export function gltfNodeNames(gltf: Record<string, unknown>): string[] {
  const nodes = (gltf.nodes ?? []) as { name?: string }[]
  return nodes.map((node) => node.name ?? '')
}

export async function downloadGltf(model: ShipModel, waterlineY: number, name: string) {
  const gltf = await exportGltfJson(model, waterlineY)
  const blob = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' })
  downloadBlob(blob, exportFilename(name, 'gltf'))
}
