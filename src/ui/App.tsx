import { useMemo, useState } from 'react'
import { hullPresets } from '../data'
import { computeDerived } from '../physics/derived'
import { buildShipModel } from '../physics/masses'
import { defaultDesign } from '../state/defaults'
import { Viewer } from './Viewer'
import type { CameraMode } from '../scene/viewer'

/**
 * Phase 1 shell: pick a preset and look at the ship it produces. The full
 * designer UI arrives in phase 2.
 */
export function App() {
  const [presetId, setPresetId] = useState('frigate-38')
  const [cameraMode, setCameraMode] = useState<CameraMode>('broadside')

  const { model, derived } = useMemo(() => {
    const built = buildShipModel(defaultDesign(presetId))
    return { model: built, derived: computeDerived(built) }
  }, [presetId])

  const attitude = useMemo(
    () => ({
      waterlineY: derived.upright.offset,
      heelRad: Number.isNaN(derived.staticListDeg)
        ? 0
        : (derived.staticListDeg * Math.PI) / 180,
      trimRad: derived.upright.trimRad,
    }),
    [derived],
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>Shipwright</h1>
        <nav className="preset-list">
          {hullPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={preset.id === presetId ? 'preset active' : 'preset'}
              onClick={() => setPresetId(preset.id)}
              data-testid={`preset-${preset.id}`}
            >
              {preset.name}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="camera-toggle"
          onClick={() => setCameraMode(cameraMode === 'broadside' ? 'orbit' : 'broadside')}
          data-testid="camera-toggle"
        >
          {cameraMode === 'broadside' ? 'Orbit' : 'Broadside'}
        </button>
      </header>

      <main className="stage">
        <Viewer model={model} attitude={attitude} cameraMode={cameraMode} />
      </main>

      <footer className="stats" data-testid="derived-stats">
        <Stat label="Displacement" value={`${derived.displacementTonnes.toFixed(0)} t`} />
        <Stat label="Draft" value={`${derived.draftM.toFixed(2)} m`} />
        <Stat label="GM" value={`${derived.gmM.toFixed(2)} m`} />
        <Stat label="List" value={`${derived.staticListDeg.toFixed(1)}°`} />
        <Stat
          label="Broadside"
          value={`${derived.broadsideWeightStarboardLb.toFixed(0)} lb`}
        />
        <Stat label="Crew" value={`${derived.crewEstimate}`} />
        <Stat label="Cost" value={`£${Math.round(derived.totalCostPounds).toLocaleString()}`} />
      </footer>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}
