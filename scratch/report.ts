import { hullPresets } from '../src/data'
import { defaultDesign } from '../src/state/defaults'
import { buildShipModel } from '../src/physics/masses'
import { computeDerived } from '../src/physics/derived'

for (const preset of hullPresets) {
  const design = defaultDesign(preset.id)
  const model = buildShipModel(design)
  const d = computeDerived(model)
  const m = model.masses
  console.log([
    preset.id.padEnd(14),
    `disp ${d.displacementTonnes.toFixed(0).padStart(5)}t`,
    `draft ${d.draftM.toFixed(2)}`,
    `GM ${d.gmM.toFixed(2)}`,
    `list ${d.staticListDeg.toFixed(2)}`,
    `KG ${m.centreOfGravity.y.toFixed(2)}`,
    `portFB ${d.gunportFreeboardM.toFixed(2)}`,
    `sail ${d.sailAreaM2.toFixed(0)}`,
    `spd ${d.maxSpeedEstimateKn.toFixed(1)}`,
    `cost ${d.totalCostPounds.toFixed(0)}`,
  ].join('  '))
  console.log('   t: ' + [
    `struct ${(m.structureKg/1000).toFixed(0)}`, `guns ${(m.gunsKg/1000).toFixed(0)}`,
    `rig ${(m.rigKg/1000).toFixed(0)}`, `ball ${(m.ballastKg/1000).toFixed(0)}`,
    `stores ${(m.storesKg/1000).toFixed(0)}`, `crew ${(m.crewKg/1000).toFixed(0)}`,
    `fit ${(m.fittingsKg/1000).toFixed(0)}`,
  ].join(' '))
}
