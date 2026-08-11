import * as THREE from 'three'

/**
 * The sea (SPEC §9): an animated shader plane, and the wake the ship lays down
 * across it. The waves are a picture and nothing else — SPEC §7 is explicit
 * that they carry no force — but the hull rides on them so she sits in the
 * water rather than on top of it, and the same wave sum is evaluated on the
 * CPU for that so the two can never disagree.
 */

/** One directional wave: length in metres, steepness, and heading offset. */
type WaveTrain = {
  lengthM: number
  amplitudeFactor: number
  /** Degrees off the wind's own direction. */
  spreadDeg: number
  speedFactor: number
}

/**
 * Four trains at slightly different headings: enough for the sea to look like
 * water rather than corrugated iron, few enough to evaluate on the CPU.
 */
const WAVE_TRAINS: WaveTrain[] = [
  { lengthM: 74, amplitudeFactor: 1.0, spreadDeg: 0, speedFactor: 1.0 },
  { lengthM: 41, amplitudeFactor: 0.62, spreadDeg: 24, speedFactor: 1.15 },
  { lengthM: 23, amplitudeFactor: 0.42, spreadDeg: -31, speedFactor: 1.3 },
  { lengthM: 13, amplitudeFactor: 0.24, spreadDeg: 57, speedFactor: 1.5 },
]

/** Wave height for a given wind, metres. A gentle sea even in a hard blow. */
function seaAmplitude(windSpeedKn: number): number {
  return 0.22 + 0.05 * windSpeedKn
}

/**
 * Height of the sea at a world point. This is the same sum the vertex shader
 * runs; the ship's visual heave and the wake both read it here.
 */
function seaHeight(
  x: number,
  z: number,
  timeS: number,
  windDirectionRad: number,
  windSpeedKn: number,
): number {
  const amplitude = seaAmplitude(windSpeedKn)
  let height = 0
  for (const train of WAVE_TRAINS) {
    const heading = windDirectionRad + (train.spreadDeg * Math.PI) / 180
    const k = (2 * Math.PI) / train.lengthM
    // Deep water: a wave's celerity is set by its own length.
    const speed = Math.sqrt(9.81 / k) * train.speedFactor
    const phase = k * (x * Math.cos(heading) + z * Math.sin(heading)) - k * speed * timeS
    height += amplitude * train.amplitudeFactor * Math.sin(phase)
  }
  return height
}

/** Slope of the sea at a world point, for tipping the ship with the swell. */
function seaSlope(
  x: number,
  z: number,
  timeS: number,
  windDirectionRad: number,
  windSpeedKn: number,
): { dx: number; dz: number } {
  const step = 3
  const h = (px: number, pz: number) =>
    seaHeight(px, pz, timeS, windDirectionRad, windSpeedKn)
  return {
    dx: (h(x + step, z) - h(x - step, z)) / (2 * step),
    dz: (h(x, z + step) - h(x, z - step)) / (2 * step),
  }
}

const WAVE_UNIFORMS = WAVE_TRAINS.map((train) => train)

/** The wave sum as GLSL, generated from the same table the CPU reads. */
function waveGlsl(): string {
  const lines = WAVE_UNIFORMS.map((train) => {
    const k = (2 * Math.PI) / train.lengthM
    const speed = Math.sqrt(9.81 / k) * train.speedFactor
    const heading = `uWindDirection + ${((train.spreadDeg * Math.PI) / 180).toFixed(5)}`
    return `
    {
      float heading = ${heading};
      vec2 dir = vec2(cos(heading), sin(heading));
      float phase = ${k.toFixed(6)} * dot(p, dir) - ${(k * speed).toFixed(6)} * uTime;
      float a = uAmplitude * ${train.amplitudeFactor.toFixed(4)};
      height += a * sin(phase);
      slope += a * ${k.toFixed(6)} * cos(phase) * dir;
    }`
  })
  return `
  void waveAt(vec2 p, out float height, out vec2 slope) {
    height = 0.0;
    slope = vec2(0.0);
    ${lines.join('\n')}
  }`
}

const VERTEX_SHADER = `
uniform float uTime;
uniform float uAmplitude;
uniform float uWindDirection;
uniform vec2 uCentre;
uniform float uEdge;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
varying float vFade;
${waveGlsl()}
void main() {
  vec3 local = position;
  // The plane is recentred under the ship every frame, but the waves are a
  // function of where they are in the world, so the sea never swims with her.
  vec2 world = local.xz + uCentre;
  float height;
  vec2 slope;
  waveAt(world, height, slope);
  vNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vCrest = height / max(0.001, uAmplitude);
  // The near grid fades into the flat sea beyond it rather than ending in a
  // visible ring.
  vFade = 1.0 - smoothstep(0.62, 0.97, length(local.xz) / uEdge);
  vWorld = vec3(world.x, height, world.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local.x, height, local.z, 1.0);
}
`

const FRAGMENT_SHADER = `
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uSun;
uniform vec3 uSunDirection;
uniform float uFoam;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
varying float vFade;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(cameraPosition - vWorld);
  // Water is dark looked into and bright looked across: Schlick's fresnel is
  // most of what makes a flat plane read as sea.
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, view), 0.0), 4.0);
  vec3 body = mix(uDeep, uShallow, clamp(vCrest * 0.5 + 0.5, 0.0, 1.0));
  vec3 colour = mix(body, uSky, fresnel * 0.86);

  // Two speculars: a broad sheen that gives the sea its sheet-metal look at a
  // distance, and a tight one for the glitter on the near crests.
  vec3 halfway = normalize(uSunDirection + view);
  float specular = max(dot(normal, halfway), 0.0);
  colour += uSun * pow(specular, 28.0) * 0.32;
  colour += uSun * pow(specular, 260.0) * 1.4;

  // A little foam where the crests are steepest.
  float foam = smoothstep(0.72, 1.0, vCrest) * uFoam;
  colour = mix(colour, vec3(0.92, 0.95, 0.96), foam * 0.5);

  #ifdef USE_FOG
    float depth = length(vWorld - cameraPosition);
    float factor = smoothstep(fogNear, fogFar, depth);
    colour = mix(colour, fogColor, factor);
  #endif
  gl_FragColor = vec4(colour, vFade);
}
`

/** Half width of the displaced grid, metres. Beyond it the sea is flat. */
const NEAR_HALF = 1800
const NEAR_SEGMENTS = 320
const FAR_SIZE = 9000
/**
 * The flat water sits below the deepest wave trough. Left level with the sea it
 * sliced up through them and scattered hard-edged dark facets over the swell;
 * this far out the step is a tenth of a degree and fog has it long before then.
 */
const FAR_DEPTH = -4

export type OceanOptions = {
  sunDirection: THREE.Vector3
  fog: THREE.Fog | null
}

export class Ocean {
  readonly group = new THREE.Group()
  private near: THREE.Mesh
  private far: THREE.Mesh
  private material: THREE.ShaderMaterial
  private windDirectionRad = 0
  private windSpeedKn = 12

  constructor(options: OceanOptions) {
    this.group.name = 'Ocean'

    const deep = new THREE.Color('#0b3346')
    const shallow = new THREE.Color('#1a5f78')

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: seaAmplitude(12) },
        uWindDirection: { value: 0 },
        uCentre: { value: new THREE.Vector2() },
        uEdge: { value: NEAR_HALF },
        uDeep: { value: deep },
        uShallow: { value: shallow },
        uSky: { value: new THREE.Color('#9dc0d8') },
        uSun: { value: new THREE.Color('#fff4d8') },
        uSunDirection: { value: options.sunDirection.clone().normalize() },
        uFoam: { value: 0.5 },
        fogColor: { value: options.fog ? options.fog.color : new THREE.Color() },
        fogNear: { value: options.fog ? options.fog.near : 1 },
        fogFar: { value: options.fog ? options.fog.far : 1e6 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      defines: options.fog ? { USE_FOG: '' } : {},
    })

    const nearGeometry = new THREE.PlaneGeometry(
      NEAR_HALF * 2,
      NEAR_HALF * 2,
      NEAR_SEGMENTS,
      NEAR_SEGMENTS,
    )
    nearGeometry.rotateX(-Math.PI / 2)
    this.near = new THREE.Mesh(nearGeometry, this.material)
    this.near.name = 'SeaNear'
    this.near.renderOrder = 1
    this.group.add(this.near)

    // The flat water beyond the displaced grid, so the horizon is unbroken.
    const farMaterial = new THREE.MeshStandardMaterial({
      color: deep.clone().lerp(shallow, 0.45),
      roughness: 0.22,
      metalness: 0.1,
    })
    const farGeometry = new THREE.PlaneGeometry(FAR_SIZE, FAR_SIZE)
    farGeometry.rotateX(-Math.PI / 2)
    this.far = new THREE.Mesh(farGeometry, farMaterial)
    this.far.name = 'SeaFar'
    this.far.position.y = FAR_DEPTH
    this.group.add(this.far)
  }

  setWind(directionRad: number, speedKn: number) {
    this.windDirectionRad = directionRad
    this.windSpeedKn = speedKn
    this.material.uniforms.uWindDirection.value = directionRad
    this.material.uniforms.uAmplitude.value = seaAmplitude(speedKn)
    this.material.uniforms.uFoam.value = Math.min(1, 0.2 + speedKn / 34)
  }

  /** Recentre the sea under the ship and advance the swell. */
  update(timeS: number, centreX: number, centreZ: number) {
    // Snapped to the grid so the vertices do not crawl through the wave field.
    const step = (NEAR_HALF * 2) / NEAR_SEGMENTS
    const x = Math.round(centreX / step) * step
    const z = Math.round(centreZ / step) * step
    this.near.position.set(x, 0, z)
    this.far.position.set(x, FAR_DEPTH, z)
    this.material.uniforms.uCentre.value.set(x, z)
    this.material.uniforms.uTime.value = timeS
  }

  heightAt(x: number, z: number, timeS: number): number {
    return seaHeight(x, z, timeS, this.windDirectionRad, this.windSpeedKn)
  }

  slopeAt(x: number, z: number, timeS: number) {
    return seaSlope(x, z, timeS, this.windDirectionRad, this.windSpeedKn)
  }

  dispose() {
    this.near.geometry.dispose()
    this.far.geometry.dispose()
    this.material.dispose()
    ;(this.far.material as THREE.Material).dispose()
  }
}
