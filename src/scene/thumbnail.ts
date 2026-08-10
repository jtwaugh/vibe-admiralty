import * as THREE from 'three'
import { solveFloating } from '../physics/hydrostatics'
import { hullSections } from '../physics/hydrostatics'
import { buildShipModel } from '../physics/masses'
import { defaultDesign } from '../state/defaults'
import { buildShipMesh } from './ship-mesh'

/**
 * Small broadside renders for the hull select screen. One WebGL context is
 * shared by every thumbnail: five live canvases would burn five contexts, and
 * a browser only grants a handful.
 */

let renderer: THREE.WebGLRenderer | null = null

function sharedRenderer(width: number, height: number): THREE.WebGLRenderer | null {
  if (typeof document === 'undefined') return null
  if (!renderer) {
    const canvas = document.createElement('canvas')
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    } catch {
      return null
    }
    renderer.setPixelRatio(1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.outputColorSpace = THREE.SRGBColorSpace
  }
  renderer.setSize(width, height, false)
  return renderer
}

/**
 * A broadside profile of a preset as a PNG data URL. The sky is transparent so
 * the card shows through; the sea is painted, so the underwater body is hidden
 * exactly as it is in the designer.
 */
export function renderPresetThumbnail(
  presetId: string,
  width: number,
  height: number,
  seaColor: string,
): string | null {
  const gl = sharedRenderer(width, height)
  if (!gl) return null

  const model = buildShipModel(defaultDesign(presetId))
  const float = solveFloating(
    hullSections(model.hull),
    model.masses.totalKg,
    model.masses.centreOfGravity,
  )
  const ship = buildShipMesh(model, float.offset)
  ship.group.position.y = -float.offset

  const scene = new THREE.Scene()
  scene.add(ship.group)
  scene.add(new THREE.HemisphereLight(0xd6e6f2, 0x24323d, 1.5))
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2)
  sun.position.set(-60, 90, 110)
  scene.add(sun)

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(seaColor) }),
  )
  sea.rotation.x = -Math.PI / 2
  scene.add(sea)

  const truck = Math.max(...model.sockets.masts.map((m) => m.truckY)) - float.offset
  const frameHeight = truck * 1.1
  const stern = -model.hull.length / 2
  const ahead = Math.max(model.hull.length / 2, model.sockets.bowsprit.tipX + 1.5)
  const frameWidth = (ahead - stern) * 1.04
  const centreX = (ahead + stern) / 2
  const camera = new THREE.PerspectiveCamera(14, width / height, 1, 4000)
  const halfFov = (14 * Math.PI) / 360
  const distance = Math.max(
    frameHeight / 2 / Math.tan(halfFov),
    frameWidth / 2 / (Math.tan(halfFov) * camera.aspect),
  )
  camera.position.set(centreX, frameHeight * 0.3, distance)
  camera.lookAt(centreX, frameHeight * 0.44, 0)

  gl.render(scene, camera)
  const url = gl.domElement.toDataURL('image/png')

  ship.dispose()
  sea.geometry.dispose()
  ;(sea.material as THREE.Material).dispose()
  return url
}

/** Free the shared context when the hull select screen goes away. */
export function disposeThumbnailRenderer() {
  renderer?.dispose()
  renderer = null
}
