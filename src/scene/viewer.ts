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

/** Where a mount marker lands on screen, in CSS pixels within the canvas. */
export type MarkerProjection = {
  socketId: string
  /** Unique per marker; a mount carries one marker on each side. */
  key: string
  x: number
  y: number
  /** How square on the marker is to the camera, -1 to 1. */
  facing: number
  /** False when the marker faces away from the camera or is off screen. */
  visible: boolean
}

/** A long lens keeps the broadside view close to a true elevation. */
const BROADSIDE_FOV = 13
const ORBIT_FOV = 26

function skyTexture(): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
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
  /** Longitudinal centre of the framing box: the ship plus her bowsprit. */
  private frameCentreX = 0
  private eyeY = 3
  private radius = 100
  private disposed = false
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private dragging = false
  private dragMoved = 0
  private lastPointerX = 0
  private markersDirty = true

  /** Called when the user clicks a mount marker on the hull. */
  onMountClick: ((socketId: string) => void) | null = null
  /** Called when marker screen positions change, for the DOM overlay. */
  onMarkersMoved: ((markers: MarkerProjection[]) => void) | null = null

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
    // The sea takes no shadow: a shadow map stretched over a 6 km plane at a
    // grazing sun angle streaks and shimmers, and open water would not hold a
    // hard shadow anyway. The ship still shadows herself.
    this.sea.receiveShadow = false
    this.scene.add(this.sea)

    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)

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
    // The bowsprit reaches well beyond the stem, so the frame is measured from
    // the stern to the bowsprit tip and centred on that, not on the hull.
    const stern = -model.hull.length / 2
    const ahead = Math.max(model.hull.length / 2, model.sockets.bowsprit.tipX + 1.5)
    this.frameWidth = (ahead - stern) * 1.06
    this.frameCentreX = (ahead + stern) / 2
    this.focus.set(this.frameCentreX, this.frameHeight * 0.42, 0)
    // The eye sits below the rail so the broadside view never looks down into
    // the ship over her own bulwark, and above the water so the sea hides the
    // underwater body. See DECISIONS.md.
    this.eyeY = (model.hull.railY - attitude.waterlineY) * 0.55
    this.markersDirty = true
  }

  setAttitude(attitude: ViewerAttitude) {
    if (!this.ship) return
    // The ship rotates about its own centre of flotation, then drops so the
    // load waterline sits on the sea surface.
    this.ship.group.position.set(0, -attitude.waterlineY, 0)
    this.shipPivot.rotation.set(0, 0, 0)
    this.shipPivot.rotateX(attitude.heelRad)
    this.shipPivot.rotateZ(attitude.trimRad)
    this.markersDirty = true
  }

  setCameraMode(mode: CameraMode) {
    this.mode = mode
    this.markersDirty = true
  }

  setOrbitAngle(radians: number) {
    this.orbitAngle = radians
    this.markersDirty = true
  }

  setMarkersVisible(visible: boolean) {
    if (this.ship) this.ship.markers.visible = visible
    this.markersDirty = true
  }

  /** Highlight the marker whose modal is open. */
  setActiveMarker(socketId: string | null) {
    const ship = this.ship
    if (!ship) return
    for (const target of ship.markerTargets) {
      const ring = target.parent?.children.find((child) => child !== target) as
        | THREE.Mesh
        | undefined
      if (!ring) continue
      const active = target.userData.socketId === socketId
      ring.material = active ? ship.materials.markerActive : ship.materials.marker
      ring.scale.setScalar(active ? 1.3 : 1)
    }
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
    this.markersDirty = true
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
      this.camera.position.set(this.frameCentreX, this.eyeY, this.radius)
      this.camera.lookAt(this.frameCentreX, this.focus.y, 0)
      return
    }
    // The orbit eye stands a little further off than the fitting distance, so
    // the hull never runs off the bottom of the frame when the camera lifts.
    this.camera.position.set(
      this.frameCentreX + Math.sin(this.orbitAngle) * this.radius * 1.06,
      this.eyeY + this.frameHeight * 0.26,
      Math.cos(this.orbitAngle) * this.radius * 1.06,
    )
    this.camera.lookAt(this.frameCentreX, this.frameHeight * 0.46, 0)
  }

  /** Screen position of every mount marker, for the clickable DOM overlay. */
  private projectMarkers(): MarkerProjection[] {
    if (!this.ship) return []
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    const world = new THREE.Vector3()
    const toCamera = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const orientation = new THREE.Quaternion()
    return this.ship.markerTargets.map((target, index) => {
      target.getWorldPosition(world)
      // A marker on the far side of the ship faces away from the camera.
      toCamera.copy(this.camera.position).sub(world).normalize()
      normal.set(0, 0, 1).applyQuaternion(target.getWorldQuaternion(orientation))
      const facing = normal.dot(toCamera)
      const projected = world.clone().project(this.camera)
      return {
        socketId: String(target.userData.socketId),
        key: `${target.userData.socketId}-${index}`,
        facing,
        x: ((projected.x + 1) / 2) * width,
        y: ((1 - projected.y) / 2) * height,
        visible:
          facing > 0.08 &&
          projected.z < 1 &&
          projected.x > -1.02 &&
          projected.x < 1.02 &&
          projected.y > -1.02 &&
          projected.y < 1.02,
      }
    })
  }

  private pointerAt(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
  }

  /** Raycast the mount markers, which are real geometry on the hull. */
  pickMount(event: PointerEvent): string | null {
    if (!this.ship || !this.ship.markers.visible) return null
    this.pointerAt(event)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.ship.markerTargets, false)
    const socketId = hits[0]?.object.userData.socketId
    return typeof socketId === 'string' ? socketId : null
  }

  private onPointerDown(event: PointerEvent) {
    this.dragging = true
    this.dragMoved = 0
    this.lastPointerX = event.clientX
  }

  private onPointerMove(event: PointerEvent) {
    if (this.dragging) {
      const delta = event.clientX - this.lastPointerX
      this.lastPointerX = event.clientX
      this.dragMoved += Math.abs(delta)
      if (this.mode === 'orbit' && this.dragMoved > 3) {
        this.setOrbitAngle(this.orbitAngle - delta * 0.006)
      }
      return
    }
    this.canvas.style.cursor = this.pickMount(event) ? 'pointer' : 'default'
  }

  private onPointerUp(event: PointerEvent) {
    const wasDragging = this.dragging
    this.dragging = false
    if (!wasDragging || this.dragMoved > 4) return
    if (event.target !== this.canvas) return
    const socketId = this.pickMount(event)
    if (socketId) this.onMountClick?.(socketId)
  }

  private loop() {
    if (this.disposed) return
    const { clientWidth, clientHeight } = this.canvas
    if (clientWidth > 0 && this.canvas.width !== Math.floor(clientWidth * this.renderer.getPixelRatio())) {
      this.resize(clientWidth, clientHeight)
    }
    this.updateCamera()
    this.renderer.render(this.scene, this.camera)
    if (this.markersDirty) {
      this.markersDirty = false
      this.onMarkersMoved?.(this.projectMarkers())
    }
    this.frame = requestAnimationFrame(this.loop)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.ship?.dispose()
    this.sea.geometry.dispose()
    this.renderer.dispose()
  }
}
