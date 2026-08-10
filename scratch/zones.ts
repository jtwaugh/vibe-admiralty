import { buildHull } from '../src/hull/stations'
import { hullZoneSurfaces } from '../src/hull/areas'
import { getPreset, timberFile } from '../src/data'
import { buildShipModel } from '../src/physics/masses'
import { defaultDesign } from '../src/state/defaults'

const preset = getPreset('frigate-38')
const hull = buildHull(preset.params)
const s = hullZoneSurfaces(hull)
for (const [k, v] of Object.entries(s)) {
  const zone = timberFile.zones.find((z) => z.id === k)!
  const m = v.areaM2 * zone.thicknessM.standard * 0.75 * 1000 * timberFile.structuralFactor
  console.log(k.padEnd(10), `area ${v.areaM2.toFixed(0)} m2`, `y ${v.centroid.y.toFixed(2)}`, `mass ${(m/1000).toFixed(0)} t`)
}
const model = buildShipModel(defaultDesign('frigate-38'))
for (const it of model.masses.items) {
  console.log('  ', it.label.padEnd(28), `${(it.massKg/1000).toFixed(1)} t`, `y ${it.position.y.toFixed(2)}`)
}
