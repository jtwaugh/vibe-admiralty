import * as THREE from 'three'
import type { ShipModel } from '../physics/masses'
import { buildShipMesh } from './ship-mesh'
import type { ShipMesh } from './ship-mesh'

export type CameraMode = 'broadside' | 'orbit'

export type ViewerAttitude = {
  /** Height of the load waterline above the ship's baseline. */
  waterlineY: number
  heelRad: number
  trimRad: number
}

/** A long lens keeps the broadside view close to a true elevation. */
const BROADSIDE_FOV = 13
const ORBIT_FOV = 26

function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 0, 256)
  // Sky only. The horizon comes from the sea itself, not from a painted band.
  gradient.addColorStop(0, '#35638f')
  gradient.addColorStop(0.55, '#8fb4d4')
  gradient.addColorStop(0.88, '#d3dfe6')
  gradient.addColorStop(1, '#e3e7e4')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 4, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class ShipViewer {
  readonly scene = new THREE.Scene()
  private renderer: THREE.WebGLRenderer
  private camera: THREE.PerspectiveCamera
  private ship: ShipMesh | null = null
  private shipPivot = new THREE.Group()
  private sea: THREE.Mesh
  private frame = 0
  private mode: CameraMode = 'broadside'
  private orbitAngle = 0.7
  private focus = new THREE.Vector3()
  private frameWidth = 60
  private frameHeight = 40
  private eyeY = 3
  private radius = 100
  private disposed = false

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene.background = skyTexture()
    this.scene.fog = new THREE.Fog(new THREE.Color('#b9cdda'), 700, 3200)

    this.camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 1, 6000)
    this.scene.add(this.shipPivot)

    const sun = new THREE.DirectionalLight(0xfff2dd, 2.6)
    sun.position.set(-90, 140, 120)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 20
    sun.shadow.camera.far = 460
    const extent = 60
    sun.shadow.camera.left = -extent
    sun.shadow.camera.right = extent
    sun.shadow.camera.top = extent
    sun.shadow.camera.bottom = -extent
    sun.shadow.bias = -0.0012
    this.scene.add(sun)
    this.scene.add(new THREE.HemisphereLight(0xbcd6ea, 0x2b4055, 1.1))

    const seaMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1d5a76'),
      roughness: 0.28,
      metalness: 0.1,
    })
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), seaMaterial)
    this.sea.rotation.x = -Math.PI / 2
    this.sea.receiveShadow = true
    this.scene.add(this.sea)

    this.loop = this.loop.bind(this)
    this.frame = requestAnimationFrame(this.loop)
  }

  setModel(model: ShipModel, attitude: ViewerAttitude) {
    this.ship?.dispose()
    this.shipPivot.clear()
    this.ship = buildShipMesh(model, attitude.waterlineY)
    this.shipPivot.add(this.ship.group)
    this.setAttitude(attitude)

    // Frame the whole ship: keel to truck vertically, stem to stern plus the
    // bowsprit horizontally. The focus sits low so the hull, not empty sky,
    // occupies the middle of the picture.
    const truck = Math.max(...model.sockets.masts.map((m) => m.truckY)) - attitude.waterlineY
    this.frameHeight = truck * 1.24
    this.frameWidth = model.hull.length * 1.4
    this.focus.set(0, this.frameHeight * 0.42, 0)
    // The eye sits below the rail so the broadside view never looks down into
    // the ship over her own bulwark, and above the water so the sea hides the
    // underwater body. See DECISIONS.md.
    this.eyeY = (model.hull.railY - attitude.waterlineY) * 0.55
  }

  setAttitude(attitude: ViewerAttitude) {
    if (!this.ship) return
    // The ship rotates about its own centre of flotation, then drops so the
    // load waterline sits on the sea surface.
    this.ship.group.position.set(0, -attitude.waterlineY, 0)
    this.shipPivot.rotation.set(0, 0, 0)
    this.shipPivot.rotateX(attitude.heelRad)
    this.shipPivot.rotateZ(attitude.trimRad)
  }

  setCameraMode(mode: CameraMode) {
    this.mode = mode
  }

  setOrbitAngle(radians: number) {
    this.orbitAngle = radians
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  /** Distance at which the framing box just fits the viewport. */
  private fitRadius(fovDegrees: number): number {
    const halfFov = (fovDegrees * Math.PI) / 360
    const byHeight = this.frameHeight / 2 / Math.tan(halfFov)
    const byWidth = this.frameWidth / 2 / (Math.tan(halfFov) * this.camera.aspect)
    return Math.max(byHeight, byWidth)
  }

  private updateCamera() {
    const fov = this.mode === 'broadside' ? BROADSIDE_FOV : ORBIT_FOV
    if (this.camera.fov !== fov) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.radius = this.fitRadius(fov)
    if (this.mode === 'broadside') {
      this.camera.position.set(0, this.eyeY, this.radius)
      this.camera.lookAt(0, this.focus.y, 0)
      return
    }
    this.camera.position.set(
      Math.sin(this.orbitAngle) * this.radius * 0.9,
      this.eyeY + this.frameHeight * 0.3,
      Math.cos(this.orbitAngle) * this.radius * 0.9,
    )
    this.camera.lookAt(this.focus)
  }

  private loop() {
    if (this.disposed) return
    const { clientWidth, clientHeight } = this.canvas
    if (clientWidth > 0 && this.canvas.width !== Math.floor(clientWidth * this.renderer.getPixelRatio())) {
      this.resize(clientWidth, clientHeight)
    }
    this.updateCamera()
    this.renderer.render(this.scene, this.camera)
    this.frame = requestAnimationFrame(this.loop)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.ship?.dispose()
    this.sea.geometry.dispose()
    this.renderer.dispose()
  }
}
