import { useEffect, useState } from 'react'
import { findGun, guns } from '../data'
import type { Gun } from '../data/schemas'
import type { MountConfig } from '../export/schema'
import type { MountSocket } from '../hull/sockets'

/**
 * The mount modal (SPEC §5). Port and starboard are always independent; the
 * match-sides toggle is a convenience, not the model. Nothing here knows what a
 * gun is beyond what guns.json says.
 */

const PATTERN_NAMES: Record<Gun['pattern'], string> = {
  long: 'Long guns',
  medium: 'Medium (Congreve)',
  carronade: 'Carronades',
  swivel: 'Swivels',
}

function Stepper({
  label,
  value,
  max,
  onChange,
  testId,
}: {
  label: string
  value: number
  max: number
  onChange(value: number): void
  testId: string
}) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-row">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          disabled={value <= 0}
          aria-label={`One fewer ${label} gun`}
          data-testid={`${testId}-less`}
        >
          –
        </button>
        <output data-testid={testId}>{value}</output>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`One more ${label} gun`}
          data-testid={`${testId}-more`}
        >
          +
        </button>
      </div>
      <span className="stepper-max">of {max}</span>
    </div>
  )
}

export function MountModal({
  socket,
  config,
  onChange,
  onClose,
}: {
  socket: MountSocket
  config: MountConfig
  onChange(patch: Partial<MountConfig>): void
  onClose(): void
}) {
  const [matchSides, setMatchSides] = useState(config.port === config.starboard)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const choices = guns.filter((gun) =>
    socket.kind === 'swivel' ? gun.pattern === 'swivel' : gun.pattern !== 'swivel',
  )
  const patterns = [...new Set(choices.map((gun) => gun.pattern))]
  const gun = config.gunId ? findGun(config.gunId) : undefined

  const setSide = (side: 'port' | 'starboard', value: number) => {
    if (matchSides) onChange({ port: value, starboard: value })
    else onChange({ [side]: value })
  }

  const total = config.port + config.starboard
  const mountedTonnes = gun ? (total * gun.massKg) / 1000 : 0
  const mountedCost = gun ? total * gun.costPounds : 0

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={socket.label}
        data-testid="mount-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">Mount</p>
            <h2>{socket.label}</h2>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            data-testid="mount-close"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          <div className="gun-choices">
            <button
              type="button"
              className={config.gunId === null ? 'gun-row selected' : 'gun-row'}
              onClick={() => onChange({ gunId: null })}
              data-testid="gun-none"
            >
              <span className="gun-name">Leave the port bare</span>
              <span className="gun-figures">no gun</span>
            </button>
            {patterns.map((pattern) => (
              <section key={pattern}>
                <h3 className="gun-pattern">{PATTERN_NAMES[pattern]}</h3>
                {choices
                  .filter((choice) => choice.pattern === pattern)
                  .map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className={config.gunId === choice.id ? 'gun-row selected' : 'gun-row'}
                      onClick={() => onChange({ gunId: choice.id })}
                      data-testid={`gun-${choice.id}`}
                    >
                      <span className="gun-name">{choice.name}</span>
                      <span className="gun-figures">
                        {(choice.massKg / 1000).toFixed(2)} t · £{choice.costPounds} ·{' '}
                        {choice.crewPerGun} hands
                      </span>
                    </button>
                  ))}
              </section>
            ))}
          </div>

          <div className="mount-counts">
            <Stepper
              label="Port"
              value={config.port}
              max={socket.maxPerSide}
              onChange={(value) => setSide('port', value)}
              testId="mount-port"
            />
            <label className="match-sides">
              <input
                type="checkbox"
                checked={matchSides}
                data-testid="mount-match"
                onChange={(event) => {
                  setMatchSides(event.target.checked)
                  if (event.target.checked) onChange({ starboard: config.port })
                }}
              />
              <span>Match sides</span>
            </label>
            <Stepper
              label="Starboard"
              value={config.starboard}
              max={socket.maxPerSide}
              onChange={(value) => setSide('starboard', value)}
              testId="mount-starboard"
            />

            <dl className="mount-figures">
              <div>
                <dt>Mounted</dt>
                <dd data-testid="mount-total">{total} guns</dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd>{mountedTonnes.toFixed(1)} t</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>£{mountedCost.toLocaleString('en-GB')}</dd>
              </div>
            </dl>
            {config.port !== config.starboard ? (
              <p className="mount-hint">
                An uneven battery shifts her centre of gravity: watch the static list.
              </p>
            ) : null}
          </div>
        </div>

        <footer className="modal-foot">
          <button type="button" className="button primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
