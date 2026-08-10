import { defaultDesign } from '../src/state/defaults'
import { buildShipModel } from '../src/physics/masses'
import { computeDerived } from '../src/physics/derived'
import { gzCurve, hullSections } from '../src/physics/hydrostatics'

for (const beam of [6.6, 7.2, 8.6]) {
  const base = defaultDesign('sloop')
  const d = { ...base, hull: { ...base.hull, beam },
    mounts: { ...base.mounts, 'battery-deck-0': { gunId: 'long-32', port: 7, starboard: 0 } } }
  const m = buildShipModel(d)
  const r = computeDerived(m)
  console.log(`beam ${beam}  disp ${r.displacementTonnes.toFixed(0)}t draft ${r.draftM.toFixed(2)} GM ${r.gmM.toFixed(3)} list ${r.staticListDeg.toFixed(1)} capsize ${r.capsizesAtRest} zG ${m.masses.centreOfGravity.z.toFixed(3)} KG ${m.masses.centreOfGravity.y.toFixed(2)}`)
  const c = gzCurve(hullSections(m.hull), m.masses.totalKg, m.masses.centreOfGravity, [0,5,10,20,30,40,50,60,70])
  console.log('   GZ ' + c.map(p=>`${p.heelDeg}:${p.gz.toFixed(2)}`).join(' '))
}

console.log('--- downflooding ---')
for (const beam of [6.6, 7.2, 8.6]) {
  const base = defaultDesign('sloop')
  const d = { ...base, hull: { ...base.hull, beam },
    mounts: { ...base.mounts, 'battery-deck-0': { gunId: 'long-32', port: 7, starboard: 0 } } }
  const r = computeDerived(buildShipModel(d))
  console.log(`beam ${beam} list ${r.staticListDeg.toFixed(1)} flood ${JSON.stringify(r.downfloodingDeg)} portFB ${r.gunportFreeboardM.toFixed(2)} capsize ${r.capsizesAtRest}`)
}
