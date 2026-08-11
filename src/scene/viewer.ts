import * as THREE from 'three'
import type { SailState } from '../export/schema'
import {
  initialTrialState,
  offsetAt,
  stepTrial,
} from '../physics/integrate'
import type { TrialEnvironment, TrialState, TrialStep } from '../physics/integrate'
import type { ShipModel } from '../physics/masses'
import type { WindConditions } from '../physics/wind'
import { Ocean } from './ocean'
import { RigAnimator, setRudderAngle } from './rig-animator'
import { buildShipMesh } from './ship-mesh'
import type { ShipMesh } from './ship-mesh'
import { BowWave, Wake } from './wake'

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

/** What the helm and the sail handlers are asking for, moment to moment. */
export type TrialInputs = {
  wind: WindConditions
  rudder: number
  sails: Record<string, SailState>
}

/** A long lens keeps the broadside view close to a true elevation. */
const BROADSIDE_FOV = 13
const ORBIT_FOV = 26
/** The sea trial wants to see her whole attitude, not read her like a drawing. */
const TRIAL_FOV = 30
/**
 * Abaft the starboard beam, which is where the sun is: from ahead the sails are
 * edge on and lit from behind, and the whole rig reads as grey card. From here
 * the light rakes across the canvas and every sail shows its belly.
 */
const TRIAL_BEARING = -0.42

/** The trial is integrated at a fixed step, however fast the frames come. */
const PHYSICS_STEP = 0.02
const MAX_STEPS_PER_FRAME = 6

/** How much of the swell shows in the ship's attitude, as an angle multiplier. */
const WAVE_MOTION = 0.55

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
  /** World place and sinkage. Rotations hang below it, so the waterplane the
   * hydrostatics solved for lies exactly on the sea at any heel. */
  private shipRoot = new THREE.Group()
  private yawGroup = new THREE.Group()
  private shipPivot = new THREE.Group()
  private sun: THREE.DirectionalLight
  private fill: THREE.DirectionalLight
  private dock: THREE.Mesh
  private ocean: Ocean | null = null
  private wake: Wake | null = null
  private bowWave: BowWave | null = null
  private rig: RigAnimator | null = null
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
  private clock = new THREE.Clock()

  // Sea trial
  private trial: TrialEnvironment | null = null
  private trialState: TrialState | null = null
  private inputs: TrialInputs | null = null
  private accumulator = 0
  private attitude: ViewerAttitude = { waterlineY: 0, heelRad: 0, trimRad: 0 }

  /** Called when the user clicks a mount marker on the hull. */
  onMountClick: ((socketId: string) => void) | null = null
  /** Called when marker screen positions change, for the DOM overlay. */
  onMarkersMoved: ((markers: MarkerProjection[]) => void) | null = null
  /** Called with the trial's state every frame it advances. */
  onTelemetry: ((step: TrialStep) => void) | null = null

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

    this.camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 1, 12000)
    this.shipRoot.add(this.yawGroup)
    this.yawGroup.add(this.shipPivot)
    this.scene.add(this.shipRoot)

    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6)
    this.sun.position.set(-90, 140, 120)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.near = 20
    this.sun.shadow.camera.far = 460
    const extent = 60
    this.sun.shadow.camera.left = -extent
    this.sun.shadow.camera.right = extent
    this.sun.shadow.camera.top = extent
    this.sun.shadow.camera.bottom = -extent
    this.sun.shadow.bias = -0.0012
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)
    this.scene.add(new THREE.HemisphereLight(0xbcd6ea, 0x2b4055, 1.1))

    // Light coming back off the water. Without it the side of the ship the sun
    // is not on goes to a flat near-black, and half of every orbit is dead.
    this.fill = new THREE.DirectionalLight(0xa8c4d8, 0.75)
    this.fill.position.set(80, 45, -120)
    this.scene.add(this.fill)
    this.scene.add(this.fill.target)

    // The dock's water: flat, because the designer view is meant to read like
    // an elevation and because the tests measure the ship against it. The sea
    // trial swaps in the real ocean.
    const dockMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1d5a76'),
      roughness: 0.28,
      metalness: 0.1,
    })
    this.dock = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), dockMaterial)
    this.dock.rotation.x = -Math.PI / 2
    // The sea takes no shadow: a shadow map stretched over a 6 km plane at a
    // grazing sun angle streaks and shimmers, and open water would not hold a
    // hard shadow anyway. The ship still shadows herself.
    this.dock.receiveShadow = false
    this.scene.add(this.dock)

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

    if (this.trial) this.attachRig(model)
  }

  setAttitude(attitude: ViewerAttitude) {
    this.attitude = attitude
    if (!this.ship) return
    // The rotations are applied below the world placement, so the waterplane
    // the hydrostatics solved for lands on the sea at any angle of heel.
    this.ship.group.position.set(0, 0, 0)
    this.shipRoot.position.set(0, -attitude.waterlineY, 0)
    this.yawGroup.rotation.set(0, 0, 0)
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

  // -------------------------------------------------------------------------
  // Sea trial
  // -------------------------------------------------------------------------

  /** Put her in open water and start the clock. */
  startSeaTrial(env: TrialEnvironment, inputs: TrialInputs) {
    this.trial = env
    this.trialState = initialTrialState(env)
    this.inputs = inputs
    this.accumulator = 0

    this.dock.visible = false
    this.ocean?.dispose()
    this.ocean = new Ocean({
      sunDirection: this.sun.position.clone(),
      fog: this.scene.fog as THREE.Fog | null,
    })
    this.scene.add(this.ocean.group)
    this.ocean.setWind(inputs.wind.directionRad, inputs.wind.speedKn)

    this.wake?.dispose()
    this.wake = new Wake(env.model.hull.params.beam)
    this.scene.add(this.wake.group)

    this.bowWave?.dispose()
    this.bowWave = new BowWave(
      env.model.hull.length,
      env.model.hull.params.beam,
      offsetAt(env.curve, 0),
    )
    this.shipPivot.add(this.bowWave.group)

    this.setMarkersVisible(false)
    this.attachRig(env.model)
    this.orbitAngle = TRIAL_BEARING
    this.mode = 'orbit'
  }

  private attachRig(model: ShipModel) {
    if (!this.ship) return
    this.rig?.dispose()
    this.rig = new RigAnimator(
      this.ship.sails,
      this.inputs?.sails ?? model.design.rig.sails,
    )
  }

  setTrialInputs(inputs: TrialInputs) {
    this.inputs = inputs
    this.ocean?.setWind(inputs.wind.directionRad, inputs.wind.speedKn)
  }

  /** Back to the dock: flat water, no wake, sails as the design has them. */
  stopSeaTrial() {
    this.trial = null
    this.trialState = null
    this.inputs = null
    this.dock.visible = true
    if (this.ocean) {
      this.scene.remove(this.ocean.group)
      this.ocean.dispose()
      this.ocean = null
    }
    if (this.wake) {
      this.scene.remove(this.wake.group)
      this.wake.dispose()
      this.wake = null
    }
    if (this.bowWave) {
      this.shipPivot.remove(this.bowWave.group)
      this.bowWave.dispose()
      this.bowWave = null
    }
    this.rig?.dispose()
    this.rig = null
    this.shipRoot.position.set(0, -this.attitude.waterlineY, 0)
    this.yawGroup.rotation.set(0, 0, 0)
    this.mode = 'broadside'
  }

  private advanceTrial(dt: number) {
    const env = this.trial
    const inputs = this.inputs
    if (!env || !inputs || !this.trialState) return

    this.accumulator += dt
    let steps = 0
    let latest: TrialStep | null = null
    while (this.accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_FRAME) {
      latest = stepTrial(env, this.trialState, inputs, PHYSICS_STEP)
      this.trialState = latest.state
      this.accumulator -= PHYSICS_STEP
      steps++
    }
    // A frame that arrives very late is not allowed to run the ship forward
    // faster than real time; drop the backlog instead.
    if (this.accumulator > PHYSICS_STEP * MAX_STEPS_PER_FRAME) this.accumulator = 0
    if (!latest) return

    const state = this.trialState
    const time = this.clock.elapsedTime
    const ocean = this.ocean

    // Her attitude: the hydrostatics for heel and float, the swell for the
    // rest. SPEC §7 keeps waves out of the forces, so this part is only ever
    // a picture.
    let waveHeel = 0
    let waveTrim = 0
    let heave = 0
    if (ocean) {
      heave = ocean.heightAt(state.positionX, state.positionZ, time)
      const slope = ocean.slopeAt(state.positionX, state.positionZ, time)
      const forward = { x: Math.cos(state.headingRad), z: Math.sin(state.headingRad) }
      const starboard = { x: -Math.sin(state.headingRad), z: Math.cos(state.headingRad) }
      waveTrim = Math.atan(slope.dx * forward.x + slope.dz * forward.z) * WAVE_MOTION
      waveHeel = -Math.atan(slope.dx * starboard.x + slope.dz * starboard.z) * WAVE_MOTION
    }

    this.shipRoot.position.set(
      state.positionX,
      heave - offsetAt(env.curve, state.heelRad) - state.founderedM,
      state.positionZ,
    )
    // A rotation of +y in three.js turns +x towards -z, so a heading measured
    // from +x towards +z is its negative.
    this.yawGroup.rotation.set(0, -state.headingRad, 0)
    this.shipPivot.rotation.set(0, 0, 0)
    this.shipPivot.rotateX(state.heelRad + waveHeel)
    this.shipPivot.rotateZ(state.trimRad + waveTrim)

    // The sun and its shadow camera travel with her, or she sails out of them.
    this.sun.position.set(state.positionX - 90, 140, state.positionZ + 120)
    this.sun.target.position.set(state.positionX, 0, state.positionZ)
    this.fill.position.set(state.positionX + 80, 45, state.positionZ - 120)
    this.fill.target.position.set(state.positionX, 0, state.positionZ)

    ocean?.update(time, state.positionX, state.positionZ)
    this.wake?.update(
      state.positionX,
      state.positionZ,
      state.headingRad,
      state.speedMps,
      time,
    )
    this.bowWave?.setSpeed(state.sunk ? 0 : state.speedMps)

    // The rig is braced and filled from the same apparent wind the sails were
    // pushed by, not from a second copy of it.
    this.rig?.update(dt, inputs.sails, latest.load.pressureBySail, latest.load.apparent)
    if (this.ship) setRudderAngle(this.ship.rudder, inputs.rudder)

    this.onTelemetry?.(latest)
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
    if (this.trial && this.trialState) {
      // The eye keeps her in frame and holds its bearing on the world, so a
      // turn is something you watch her do rather than something the sea does.
      this.camera.fov = TRIAL_FOV
      this.camera.updateProjectionMatrix()
      const { positionX, positionZ, heelRad, founderedM } = this.trialState
      // A ship on her beam ends is a long low thing, not a tall one: the eye
      // comes down and in as she goes over, or the money shot ends up a speck
      // at the bottom of the frame with the camera staring at empty sky.
      const upright = Math.abs(Math.cos(heelRad))
      // A ship laid flat is no smaller than an upright one, she is only lower:
      // her rig is as long lying down as it was standing up, so the eye keeps
      // its distance and only drops.
      const distance = this.fitRadius(TRIAL_FOV) * 1.2
      const lookY = this.frameHeight * (0.08 + 0.26 * upright) - founderedM
      this.camera.position.set(
        positionX + Math.sin(this.orbitAngle) * distance,
        // The eye does not follow her down: it stays above the sea and watches
        // her go, which is the only way the last of it reads at all.
        Math.max(6, this.frameHeight * (0.14 + 0.3 * upright)),
        positionZ + Math.cos(this.orbitAngle) * distance,
      )
      this.camera.lookAt(positionX, lookY, positionZ)
      return
    }

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
      if ((this.mode === 'orbit' || this.trial) && this.dragMoved > 3) {
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
    const dt = Math.min(0.1, this.clock.getDelta())
    const { clientWidth, clientHeight } = this.canvas
    if (clientWidth > 0 && this.canvas.width !== Math.floor(clientWidth * this.renderer.getPixelRatio())) {
      this.resize(clientWidth, clientHeight)
    }
    if (this.trial) this.advanceTrial(dt)
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
    this.ocean?.dispose()
    this.wake?.dispose()
    this.bowWave?.dispose()
    this.dock.geometry.dispose()
    this.renderer.dispose()
  }
}
