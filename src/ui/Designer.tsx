import { useMemo, useRef, useState } from 'react'
import { cosmeticsFile, findGun, getPreset, sailPlans, timberSpecies, timberZones } from '../data'
import type { SailPlanId, ThicknessStep, TimberZoneId } from '../data/schemas'
import { downloadGltf } from '../export/gltf-export'
import { buildDocument, designFromDocument, downloadDocument, parseDocument } from '../export/json-export'
import type { Design } from '../export/schema'
import { analyse, useDesignerStore } from '../state/store'
import { MountModal } from './MountModal'
import { Choice, PanelGroup, Scale, Switch } from './Panel'
import { StatsBar } from './StatsBar'
import { Viewer } from './Viewer'

const THICKNESS_OPTIONS: { value: ThicknessStep; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'standard', label: 'Standard' },
  { value: 'heavy', label: 'Heavy' },
]

export function Designer({ design }: { design: Design }) {
  const store = useDesignerStore()
  const preset = getPreset(design.presetId)
  const { model, derived } = analyse(design)
  const [busy, setBusy] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const attitude = useMemo(
    () => ({
      waterlineY: derived.upright.offset,
      heelRad: Number.isFinite(derived.staticListDeg)
        ? (derived.staticListDeg * Math.PI) / 180
        : 0,
      trimRad: derived.upright.trimRad,
    }),
    [derived],
  )

  const mountLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const socket of model.sockets.mounts) labels[socket.id] = socket.label
    return labels
  }, [model])

  const activeSocket = model.sockets.mounts.find((socket) => socket.id === store.activeMountId)

  const exportJson = () => {
    downloadDocument(buildDocument(model, derived))
  }

  const exportGltf = async () => {
    setBusy(true)
    try {
      await downloadGltf(model, derived.upright.offset, design.name)
    } finally {
      setBusy(false)
    }
  }

  const importJson = async (file: File) => {
    const text = await file.text()
    store.loadDesign(designFromDocument(parseDocument(text)))
  }

  return (
    <div className="designer" data-testid="designer">
      <header className="topbar">
        <button
          type="button"
          className="button ghost"
          onClick={store.backToHulls}
          data-testid="btn-back"
        >
          ← Hulls
        </button>

        <label className="ship-name">
          <span className="visually-hidden">Ship name</span>
          <input
            value={design.name}
            data-testid="ship-name"
            onChange={(event) => store.setName(event.target.value)}
          />
        </label>

        <span className="topbar-preset">{preset.name}</span>

        <div className="topbar-actions">
          <button
            type="button"
            className="button ghost"
            data-testid="camera-toggle"
            onClick={() =>
              store.setCameraMode(store.cameraMode === 'broadside' ? 'orbit' : 'broadside')
            }
          >
            {store.cameraMode === 'broadside' ? 'Orbit' : 'Broadside'}
          </button>
          <button
            type="button"
            className="button ghost"
            data-testid="btn-import"
            onClick={() => importRef.current?.click()}
          >
            Import
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            data-testid="import-file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importJson(file)
              event.target.value = ''
            }}
          />
          <button
            type="button"
            className="button"
            onClick={exportJson}
            data-testid="btn-export-json"
          >
            Export JSON
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void exportGltf()}
            disabled={busy}
            data-testid="btn-export-gltf"
          >
            {busy ? 'Exporting…' : 'Export glTF'}
          </button>
          <button
            type="button"
            className="button primary"
            data-testid="btn-launch"
            onClick={store.launch}
            title="Take her out and see whether she swims"
          >
            Launch
          </button>
        </div>
      </header>

      <aside className="panel">
        <PanelGroup
          title="Hull"
          note={`${design.hull.keelLength.toFixed(0)} m · ${design.hull.deckCount} gun deck${design.hull.deckCount > 1 ? 's' : ''}`}
          defaultOpen
          testId="group-hull"
        >
          <Scale
            label="Beam"
            unit="m"
            value={design.hull.beam}
            min={preset.ranges.beam.min}
            max={preset.ranges.beam.max}
            step={0.1}
            onChange={(value) => store.setHullParam('beam', value)}
            testId="slider-beam"
          />
          <Scale
            label="Freeboard"
            unit="m"
            value={design.hull.freeboard}
            min={preset.ranges.freeboard.min}
            max={preset.ranges.freeboard.max}
            step={0.05}
            onChange={(value) => store.setHullParam('freeboard', value)}
            testId="slider-freeboard"
          />
          <Scale
            label="Sheer"
            value={design.hull.sheer}
            min={preset.ranges.sheer.min}
            max={preset.ranges.sheer.max}
            step={0.01}
            onChange={(value) => store.setHullParam('sheer', value)}
            testId="slider-sheer"
          />
        </PanelGroup>

        <PanelGroup title="Timber" note={design.timber.speciesId.replace('-', ' ')} testId="group-timber">
          <Choice
            label="Species"
            value={design.timber.speciesId}
            options={timberSpecies.map((species) => ({ value: species.id, label: species.name }))}
            onChange={store.setTimberSpecies}
            testId="select-species"
          />
          {timberZones.map((zone) => (
            <Choice
              key={zone.id}
              label={zone.name}
              value={design.timber.zones[zone.id] ?? 'standard'}
              options={THICKNESS_OPTIONS}
              onChange={(step) => store.setTimberZone(zone.id as TimberZoneId, step)}
              testId={`select-zone-${zone.id}`}
            />
          ))}
          <Switch
            label="Hammock nettings"
            checked={design.timber.nettings}
            onChange={store.setNettings}
            testId="toggle-nettings"
          />
        </PanelGroup>

        <PanelGroup title="Rig" note={`${model.sailAreaM2.toFixed(0)} m² of canvas`} testId="group-rig">
          <Choice
            label="Sail plan"
            value={design.rig.sailPlanId}
            options={sailPlans.map((plan) => ({ value: plan.id as SailPlanId, label: plan.name }))}
            onChange={store.setSailPlan}
            testId="select-sailplan"
          />
          <p className="panel-note">
            Sails are handed at sea. She lies at her moorings with everything furled.
          </p>
        </PanelGroup>

        <PanelGroup title="Cosmetics" testId="group-cosmetics">
          <Choice
            label="Figurehead"
            value={design.cosmetics.figureheadId}
            options={cosmeticsFile.figureheads.map((f) => ({ value: f.id, label: f.name }))}
            onChange={(value) => store.setCosmetic('figureheadId', value)}
            testId="select-figurehead"
          />
          <Choice
            label="Stern gallery"
            value={design.cosmetics.sternGalleryId}
            options={cosmeticsFile.sternGalleries.map((g) => ({ value: g.id, label: g.name }))}
            onChange={(value) => store.setCosmetic('sternGalleryId', value)}
            testId="select-stern-gallery"
          />
          <Choice
            label="Paint scheme"
            value={design.cosmetics.paintSchemeId}
            options={cosmeticsFile.paintSchemes.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(value) => store.setCosmetic('paintSchemeId', value)}
            testId="select-paint"
          />
        </PanelGroup>

        <PanelGroup
          title="Copper"
          note={design.cosmetics.copperSheathing ? 'sheathed' : 'bare'}
          testId="group-copper"
        >
          <Switch
            label="Copper sheathing"
            checked={design.cosmetics.copperSheathing}
            onChange={(value) => store.setCosmetic('copperSheathing', value)}
            testId="toggle-copper"
          />
          <p className="panel-note">
            Keeps the worm out and the weed off: a little more weight low down, a little
            more speed, and a great deal more money.
          </p>
        </PanelGroup>

        <PanelGroup title="Ordnance" note={`${model.gunCrew} gunners`} defaultOpen testId="group-mounts">
          {model.sockets.mounts.map((socket) => {
            const config = design.mounts[socket.id]
            const gun = config?.gunId ? findGun(config.gunId) : undefined
            return (
              <button
                key={socket.id}
                type="button"
                className={socket.id === store.activeMountId ? 'mount-row active' : 'mount-row'}
                onClick={() => store.openMount(socket.id)}
                data-testid={`mount-row-${socket.id}`}
              >
                <span className="mount-row-name">{socket.label}</span>
                <span className="mount-row-gun">{gun ? gun.name : 'bare'}</span>
                <span className="mount-row-count">
                  {config ? `${config.port} / ${config.starboard}` : '0 / 0'}
                </span>
              </button>
            )
          })}
        </PanelGroup>
      </aside>

      <main className="stage">
        <Viewer
          model={model}
          attitude={attitude}
          cameraMode={store.cameraMode}
          markers
          activeMountId={store.activeMountId}
          onMountClick={store.openMount}
          mountLabels={mountLabels}
        />
      </main>

      <footer className="footer">
        <StatsBar derived={derived} />
      </footer>

      {activeSocket ? (
        <MountModal
          socket={activeSocket}
          config={design.mounts[activeSocket.id] ?? { gunId: null, port: 0, starboard: 0 }}
          onChange={(patch) => store.setMount(activeSocket.id, patch)}
          onClose={store.closeMount}
        />
      ) : null}
    </div>
  )
}
