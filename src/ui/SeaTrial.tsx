import { useEffect, useMemo, useRef, useState } from 'react'
import type { SailTier } from '../data/schemas'
import type { Design, SailState } from '../export/schema'
import { buildTrialEnvironment, heelDeg, speedKn } from '../physics/integrate'
import type { TrialStep } from '../physics/integrate'
import type { ShipModel } from '../physics/masses'
import { KNOTS_TO_MPS } from '../physics/wind'
import { analyse, useDesignerStore } from '../state/store'
import { WindDial } from './WindDial'
import { Viewer } from './Viewer'

/**
 * The sea trial (SPEC §3): she is in open water, the wind is on the dial, and
 * the crew set and furl on command. Everything on this screen is an input to
 * the physics or a readout from it; nothing here decides what happens to her.
 */

/** The sail groups the crew work as one, in the order they are handed. */
const GROUPS: { id: string; label: string; tiers: SailTier[] }[] = [
  { id: 'courses', label: 'Courses', tiers: ['course'] },
  { id: 'topsails', label: 'Topsails', tiers: ['topsail'] },
  { id: 'topgallants', label: 'Topgallants', tiers: ['topgallant'] },
  { id: 'jibs', label: 'Jibs', tiers: ['jib'] },
  { id: 'spanker', label: 'Spanker', tiers: ['spanker'] },
]

/** The HUD is redrawn this often; the physics runs at every frame regardless. */
const HUD_INTERVAL_MS = 120

function compass(radians: number): string {
  const degrees = ((((radians * 180) / Math.PI) % 360) + 360) % 360
  return `${degrees.toFixed(0)}°`
}

export function SeaTrial({ design }: { design: Design }) {
  const store = useDesignerStore()

  // The hull cannot change while she is at sea, so the model, the mesh and the
  // stability curve are all taken once at launch. Handing sails costs nothing
  // after that: it touches the rig animator and nothing else. Reading them off
  // the live design instead would re-solve her hydrostatics on every click.
  const launched = useRef<{ model: ShipModel; waterlineY: number } | null>(null)
  if (!launched.current) {
    const { model, derived } = analyse(design)
    launched.current = { model, waterlineY: derived.upright.offset }
  }
  const trialModel = launched.current.model
  const env = useMemo(() => buildTrialEnvironment(trialModel), [trialModel])

  const [rudder, setRudder] = useState(0)
  const [telemetry, setTelemetry] = useState<TrialStep | null>(null)
  const latest = useRef<TrialStep | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (latest.current) setTelemetry(latest.current)
    }, HUD_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  // The helm answers to A and D as well as to the tiller, per SPEC §7.
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      const key = event.key.toLowerCase()
      if (key === 'a') setRudder(-1)
      else if (key === 'd') setRudder(1)
      else return
      event.preventDefault()
    }
    const release = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (key === 'a' || key === 'd') setRudder(0)
    }
    window.addEventListener('keydown', press)
    window.addEventListener('keyup', release)
    return () => {
      window.removeEventListener('keydown', press)
      window.removeEventListener('keyup', release)
    }
  }, [])

  const inputs = useMemo(
    () => ({ wind: store.wind, rudder, sails: design.rig.sails }),
    [store.wind, rudder, design.rig.sails],
  )

  const waterlineY = launched.current.waterlineY
  const attitude = useMemo(
    () => ({ waterlineY, heelRad: 0, trimRad: 0 }),
    [waterlineY],
  )

  const groupState = (tiers: SailTier[]): SailState => {
    const ids = trialModel.sails.filter((sail) => tiers.includes(sail.tier))
    return ids.some((sail) => design.rig.sails[sail.id] === 'set') ? 'set' : 'furled'
  }

  const handGroup = (tiers: SailTier[], state: SailState) => {
    for (const sail of trialModel.sails) {
      if (tiers.includes(sail.tier)) store.setSailState(sail.id, state)
    }
  }

  const state = telemetry?.state
  const heel = state ? heelDeg(state) : 0
  const knots = state ? speedKn(state) : 0
  const apparentKn = telemetry ? telemetry.load.apparent.speedMps / KNOTS_TO_MPS : 0
  const setCount = trialModel.sails.filter(
    (sail) => design.rig.sails[sail.id] === 'set',
  ).length

  const notices: string[] = []
  if (state?.sunk) notices.push('She is gone.')
  else if (state?.capsized) notices.push('She is over. Her masts are in the water.')
  else if (telemetry && telemetry.portsUnder > 0) {
    notices.push(`${telemetry.portsUnder} gunports under water and filling.`)
  } else if (Math.abs(heel) > 20) notices.push('She is pressed down hard.')
  if (state && state.floodedKg > 1000 && !state.sunk) {
    notices.push(`${Math.round(state.floodedKg / 1000)} t of water in her.`)
  }

  return (
    <div className="designer sea-trial" data-testid="sea-trial">
      <header className="topbar">
        <button
          type="button"
          className="button ghost"
          data-testid="btn-return"
          onClick={store.returnToDock}
        >
          ← Return to dock
        </button>
        <span className="ship-name-plate">{design.name}</span>
        <span className="topbar-preset">Sea trial</span>
        <div className="topbar-actions">
          <span className="trial-clock" data-testid="trial-clock">
            {state ? `${state.timeS.toFixed(0)} s` : '0 s'}
          </span>
        </div>
      </header>

      <aside className="panel">
        <section className="trial-group" data-testid="wind-controls">
          <h2 className="trial-heading">Weather</h2>
          <WindDial
            directionRad={store.wind.directionRad}
            speedKn={store.wind.speedKn}
            headingRad={state?.headingRad ?? 0}
            onChange={(directionRad) => store.setWind({ directionRad })}
          />
          <label className="control scale">
            <span className="control-label">
              Wind from
              <span className="control-value" data-testid="wind-direction-value">
                {compass(store.wind.directionRad)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              data-testid="wind-direction"
              value={Math.round((((store.wind.directionRad * 180) / Math.PI) % 360 + 360) % 360)}
              onChange={(event) =>
                store.setWind({ directionRad: (Number(event.target.value) * Math.PI) / 180 })
              }
            />
          </label>
          <label className="control scale">
            <span className="control-label">
              Wind speed
              <span className="control-value" data-testid="wind-speed-value">
                {store.wind.speedKn.toFixed(0)}
                <span className="control-unit">kn</span>
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              data-testid="wind-speed"
              value={store.wind.speedKn}
              onChange={(event) => store.setWind({ speedKn: Number(event.target.value) })}
            />
          </label>
        </section>

        <section className="trial-group" data-testid="sail-controls">
          <h2 className="trial-heading">
            Canvas
            <span className="trial-heading-note">{setCount} set</span>
          </h2>
          {GROUPS.map((group) => {
            const present = trialModel.sails.some((sail) => group.tiers.includes(sail.tier))
            if (!present) return null
            const set = groupState(group.tiers) === 'set'
            return (
              <button
                key={group.id}
                type="button"
                className={set ? 'sail-row set' : 'sail-row'}
                data-testid={`sail-${group.id}`}
                aria-pressed={set}
                onClick={() => handGroup(group.tiers, set ? 'furled' : 'set')}
              >
                <span className="sail-row-name">{group.label}</span>
                <span className="sail-row-state">{set ? 'set' : 'furled'}</span>
              </button>
            )
          })}
          <div className="sail-all">
            <button
              type="button"
              className="button ghost"
              data-testid="sails-all-set"
              onClick={() => store.setAllSails('set')}
            >
              Make sail
            </button>
            <button
              type="button"
              className="button ghost"
              data-testid="sails-all-furled"
              onClick={() => store.setAllSails('furled')}
            >
              Furl all
            </button>
          </div>
        </section>

        <section className="trial-group">
          <h2 className="trial-heading">
            Helm
            <span className="trial-heading-note">A and D</span>
          </h2>
          <label className="control scale">
            <span className="control-label">
              Tiller
              <span className="control-value" data-testid="tiller-value">
                {rudder === 0 ? 'amidships' : rudder < 0 ? 'to port' : 'to starboard'}
              </span>
            </span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              data-testid="tiller"
              value={rudder}
              onChange={(event) => setRudder(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className="button ghost"
            data-testid="tiller-centre"
            onClick={() => setRudder(0)}
          >
            Helm amidships
          </button>
        </section>
      </aside>

      <main className="stage">
        <Viewer
          model={trialModel}
          attitude={attitude}
          cameraMode="orbit"
          trial={env}
          trialInputs={inputs}
          onTelemetry={(step) => {
            latest.current = step
          }}
        />
      </main>

      <footer className="footer">
        <div className="ledger">
          {notices.length > 0 ? (
            <p className="ledger-warning" data-testid="trial-notice">
              {notices.join(' ')}
            </p>
          ) : null}
          <div className="stats" data-testid="trial-hud">
            <div className="stat" data-testid="hud-speed">
              <span className="stat-label">Speed</span>
              <span className="stat-value">{knots.toFixed(1)} kn</span>
            </div>
            <div className="stat" data-testid="hud-heel">
              <span className="stat-label">Heel</span>
              <span className="stat-value">{Math.abs(heel).toFixed(1)}°</span>
              <span className="stat-note">
                {Math.abs(heel) < 0.4 ? 'upright' : heel < 0 ? 'to port' : 'to starboard'}
              </span>
            </div>
            <div className="stat" data-testid="hud-heading">
              <span className="stat-label">Heading</span>
              <span className="stat-value">{compass(state?.headingRad ?? 0)}</span>
            </div>
            <div className="stat" data-testid="hud-apparent">
              <span className="stat-label">Apparent wind</span>
              <span className="stat-value">{apparentKn.toFixed(0)} kn</span>
              <span className="stat-note">
                {telemetry ? relativeBearing(telemetry.load.apparent.bearingRad) : 'calm'}
              </span>
            </div>
            <div className="stat" data-testid="hud-drive">
              <span className="stat-label">Drive</span>
              <span className="stat-value">
                {telemetry ? (telemetry.load.driveN / 1000).toFixed(0) : '0'} kN
              </span>
            </div>
            <div className="stat" data-testid="hud-gz">
              <span className="stat-label">Righting arm</span>
              <span className="stat-value">{(state?.gz ?? 0).toFixed(2)} m</span>
              <span className="stat-note">GZ at this heel</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

/** Where the wind is coming from, in the language a helmsman would use. */
function relativeBearing(radians: number): string {
  const degrees = (Math.abs(radians) * 180) / Math.PI
  const side = radians < 0 ? 'port' : 'starboard'
  if (degrees < 12) return 'dead ahead'
  if (degrees > 168) return 'dead astern'
  if (degrees < 67) return `on the ${side} bow`
  if (degrees < 113) return `on the ${side} beam`
  return `on the ${side} quarter`
}
