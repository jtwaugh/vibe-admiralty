import * as THREE from 'three'

/**
 * The wake: a ribbon of disturbed water laid down along the track the ship has
 * actually sailed, so it curves when she turns, and a pair of bow waves peeling
 * off her stem. Both fade out with distance astern and with the way she has on.
 */

/** How many points of track the ribbon remembers. */
const TRAIL_POINTS = 64
/** How far apart they are laid down, metres. */
const TRAIL_SPACING = 4

type TrackPoint = {
  x: number
  z: number
  headingRad: number
  /** Speed when this bit of water was disturbed, metres per second. */
  speed: number
}

const WAKE_VERTEX = `
attribute float aAge;
attribute float aStrength;
varying float vAge;
varying float vStrength;
varying vec2 vUv;
void main() {
  vAge = aAge;
  vStrength = aStrength;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const WAKE_FRAGMENT = `
uniform float uTime;
varying float vAge;
varying float vStrength;
varying vec2 vUv;
void main() {
  // Broad and soft in the middle of the track, hard at the shoulders where the
  // water is still turning over.
  float across = abs(vUv.x * 2.0 - 1.0);
  float shoulder = smoothstep(0.35, 0.95, across);
  float core = 1.0 - smoothstep(0.0, 0.8, across);
  float churn = 0.5 + 0.5 * sin(vUv.y * 90.0 - uTime * 5.0 + across * 6.0);
  float foam = (core * 0.55 + shoulder * churn * 0.75) * vStrength;
  // Older water has settled.
  foam *= 1.0 - vAge;
  gl_FragColor = vec4(vec3(0.93, 0.96, 0.97), clamp(foam, 0.0, 1.0) * 0.8);
}
`

export class Wake {
  readonly group = new THREE.Group()
  private track: TrackPoint[] = []
  private ribbon: THREE.Mesh
  private geometry: THREE.BufferGeometry
  private material: THREE.ShaderMaterial
  private position: THREE.BufferAttribute
  private uv: THREE.BufferAttribute
  private age: THREE.BufferAttribute
  private strength: THREE.BufferAttribute
  private beamM: number

  constructor(beamM: number) {
    this.beamM = beamM
    this.group.name = 'Wake'
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: WAKE_VERTEX,
      fragmentShader: WAKE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    const count = TRAIL_POINTS * 2
    this.geometry = new THREE.BufferGeometry()
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3)
    this.uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2)
    this.age = new THREE.BufferAttribute(new Float32Array(count), 1)
    this.strength = new THREE.BufferAttribute(new Float32Array(count), 1)
    this.position.setUsage(THREE.DynamicDrawUsage)
    this.age.setUsage(THREE.DynamicDrawUsage)
    this.strength.setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('position', this.position)
    this.geometry.setAttribute('uv', this.uv)
    this.geometry.setAttribute('aAge', this.age)
    this.geometry.setAttribute('aStrength', this.strength)

    const indices: number[] = []
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    this.geometry.setIndex(indices)
    // The ribbon is rebuilt every frame in world coordinates; a fixed sphere
    // big enough for the whole track saves recomputing bounds.
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      TRAIL_POINTS * TRAIL_SPACING * 2,
    )

    this.ribbon = new THREE.Mesh(this.geometry, this.material)
    this.ribbon.name = 'WakeRibbon'
    this.ribbon.frustumCulled = false
    this.ribbon.renderOrder = 3
    this.group.add(this.ribbon)
  }

  /** Lay down another length of track and redraw the ribbon. */
  update(x: number, z: number, headingRad: number, speedMps: number, timeS: number) {
    this.material.uniforms.uTime.value = timeS
    const head = this.track[0]
    if (!head || Math.hypot(x - head.x, z - head.z) >= TRAIL_SPACING) {
      this.track.unshift({ x, z, headingRad, speed: Math.abs(speedMps) })
      if (this.track.length > TRAIL_POINTS) this.track.length = TRAIL_POINTS
    } else {
      // Keep the newest point pinned to the ship so the wake starts under her.
      head.x = x
      head.z = z
      head.headingRad = headingRad
      head.speed = Math.abs(speedMps)
    }

    const positions = this.position.array as Float32Array
    const uvs = this.uv.array as Float32Array
    const ages = this.age.array as Float32Array
    const strengths = this.strength.array as Float32Array

    for (let i = 0; i < TRAIL_POINTS; i++) {
      const point = this.track[Math.min(i, this.track.length - 1)] ?? {
        x,
        z,
        headingRad,
        speed: 0,
      }
      const age = i / (TRAIL_POINTS - 1)
      // The wake spreads as it falls astern, the way a real one does.
      const width = this.beamM * (0.55 + 1.5 * age)
      const side = { x: -Math.sin(point.headingRad), z: Math.cos(point.headingRad) }
      // A ship barely moving leaves nothing; the foam builds quickly with way.
      const strength = Math.min(1, Math.pow(point.speed / 3.2, 1.4)) * (i < this.track.length ? 1 : 0)
      for (const sign of [-1, 1]) {
        const v = i * 2 + (sign < 0 ? 0 : 1)
        positions[v * 3] = point.x + side.x * width * sign
        positions[v * 3 + 1] = 0.14
        positions[v * 3 + 2] = point.z + side.z * width * sign
        uvs[v * 2] = sign < 0 ? 0 : 1
        uvs[v * 2 + 1] = age
        ages[v] = age
        strengths[v] = strength
      }
    }

    this.position.needsUpdate = true
    this.uv.needsUpdate = true
    this.age.needsUpdate = true
    this.strength.needsUpdate = true
  }

  /** Wipe the track, so returning to the dock does not keep an old wake. */
  reset() {
    this.track = []
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/**
 * The bow wave: two thin wedges of white water peeling off the stem. Unlike the
 * wake these ride with the ship, because they are made by her stem and stay
 * there.
 */
export class BowWave {
  readonly group = new THREE.Group()
  private material: THREE.MeshBasicMaterial
  private meshes: THREE.Mesh[] = []

  constructor(hullLength: number, beamM: number, waterlineY: number) {
    this.group.name = 'BowWave'
    this.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#eef5f6'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    for (const side of [-1, 1]) {
      // A long thin triangle running aft and outboard from the stem.
      const shape = new THREE.BufferGeometry()
      const nose = hullLength * 0.48
      shape.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            nose, waterlineY + 0.14, 0,
            nose - hullLength * 0.55, waterlineY + 0.14, side * beamM * 0.95,
            nose - hullLength * 0.34, waterlineY + 0.14, side * beamM * 0.16,
          ],
          3,
        ),
      )
      shape.computeVertexNormals()
      const mesh = new THREE.Mesh(shape, this.material)
      mesh.name = `BowWave_${side > 0 ? 'starboard' : 'port'}`
      mesh.renderOrder = 3
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
  }

  setSpeed(speedMps: number) {
    const strength = Math.min(1, Math.max(0, (Math.abs(speedMps) - 0.4) / 3.4))
    this.material.opacity = strength * 0.75
    this.group.visible = strength > 0.02
    for (const mesh of this.meshes) mesh.scale.setScalar(0.6 + 0.5 * strength)
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose()
    this.material.dispose()
  }
}
