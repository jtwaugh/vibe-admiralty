import { defaultDesign } from '../src/state/defaults'
import { buildShipModel } from '../src/physics/masses'
import { computeDerived } from '../src/physics/derived'
import { hullPresets } from '../src/data'

const preset = hullPresets.find(p => p.id === 'sloop')!
for (const ballast of [75, 55, 40, 30]) {
  ;(preset as any).ballastTonnes = ballast
  for (const beam of [6.0, 6.6]) {
    const base = defaultDesign('sloop')
    const armed = { ...base, hull: { ...base.hull, beam },
      mounts: { ...base.mounts, 'battery-deck-0': { gunId: 'long-32', port: 7, starboard: 0 } } }
    const a = computeDerived(buildShipModel(armed))
    const std = computeDerived(buildShipModel({ ...base, hull: { ...base.hull, beam: 8.6 } }))
    console.log(`ballast ${ballast} beam ${beam}: armed list ${a.staticListDeg.toFixed(1)} flood ${a.downfloodingDeg.port} capsize ${a.capsizesAtRest} GM ${a.gmM.toFixed(2)} | stock GM ${std.gmM.toFixed(2)} draft ${std.draftM.toFixed(2)} disp ${std.displacementTonnes.toFixed(0)}`)
  }
}
