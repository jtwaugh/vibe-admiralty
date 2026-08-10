import type { DerivedStats } from '../physics/derived'

/**
 * The Navy Board ledger line: the eight readouts SPEC §6 asks for, plus the
 * heel gauge, which is the one place this tool shows a number as a picture.
 */

/** A hull section on her waterline, tilted to the static list. */
function HeelGauge({ degrees, alarming }: { degrees: number; alarming: boolean }) {
  const tilt = Number.isFinite(degrees) ? Math.max(-60, Math.min(60, degrees)) : 55
  return (
    <svg
      className={alarming ? 'heel-gauge alarming' : 'heel-gauge'}
      viewBox="-20 -18 40 30"
      aria-hidden="true"
    >
      <line className="gauge-water" x1="-19" y1="0" x2="19" y2="0" />
      <g transform={`rotate(${tilt})`}>
        <path className="gauge-hull" d="M-8 -9 L-6.6 2 Q0 5.4 6.6 2 L8 -9 Z" />
        <line className="gauge-mast" x1="0" y1="-8" x2="0" y2="-16" />
      </g>
    </svg>
  )
}

function Stat({
  label,
  value,
  note,
  tone,
  testId,
  children,
}: {
  label: string
  value: string
  note?: string
  tone?: 'warn' | 'alarm'
  testId: string
  children?: React.ReactNode
}) {
  return (
    <div className={tone ? `stat ${tone}` : 'stat'} data-testid={testId}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {children}
        {value}
      </span>
      {note ? <span className="stat-note">{note}</span> : null}
    </div>
  )
}

export function StatsBar({ derived }: { derived: DerivedStats }) {
  const capsizes = derived.capsizesAtRest
  const list = derived.staticListDeg
  const tender = derived.gmM < 0.35
  const portsAwash = derived.gunportFreeboardM < 0

  const warnings: string[] = []
  if (capsizes) warnings.push('No equilibrium: she lies over at her moorings.')
  else if (Math.abs(list) > 2)
    warnings.push(
      `Standing list of ${Math.abs(list).toFixed(1)}° to ${list < 0 ? 'port' : 'starboard'}.`,
    )
  if (tender && !capsizes) warnings.push('Metacentric height near zero: she will be crank under canvas.')
  if (portsAwash) warnings.push('Lower gunports are at or under the water.')

  return (
    <div className="ledger">
      {warnings.length > 0 ? (
        <p className="ledger-warning" data-testid="stats-warning">
          {warnings.join(' ')}
        </p>
      ) : null}
      <div className="stats" data-testid="derived-stats">
        <Stat
          label="Displacement"
          value={`${derived.displacementTonnes.toFixed(0)} t`}
          testId="stat-displacement"
        />
        <Stat
          label="Draft"
          value={`${derived.draftM.toFixed(2)} m`}
          note={portsAwash ? 'ports awash' : undefined}
          tone={portsAwash ? 'alarm' : undefined}
          testId="stat-draft"
        />
        <Stat
          label="GM"
          value={`${derived.gmM.toFixed(2)} m`}
          note={derived.gmM < 0 ? 'unstable' : tender ? 'crank' : undefined}
          tone={derived.gmM < 0 ? 'alarm' : tender ? 'warn' : undefined}
          testId="stat-gm"
        />
        <Stat
          label="Static list"
          value={capsizes ? 'capsizes' : `${Math.abs(list).toFixed(1)}°`}
          note={capsizes ? 'at rest' : Math.abs(list) < 0.05 ? 'upright' : list < 0 ? 'to port' : 'to starboard'}
          tone={capsizes ? 'alarm' : Math.abs(list) > 2 ? 'warn' : undefined}
          testId="stat-list"
        >
          <HeelGauge degrees={list} alarming={capsizes} />
        </Stat>
        <Stat
          label="Broadside"
          value={`${derived.broadsideWeightPortLb.toFixed(0)} / ${derived.broadsideWeightStarboardLb.toFixed(0)} lb`}
          note="port / starboard"
          testId="stat-broadside"
        />
        <Stat
          label="Ordnance"
          value={`${derived.totalGunWeightTonnes.toFixed(1)} t`}
          testId="stat-gun-weight"
        />
        <Stat label="Crew" value={`${derived.crewEstimate}`} testId="stat-crew" />
        <Stat
          label="Cost"
          value={`£${Math.round(derived.totalCostPounds).toLocaleString('en-GB')}`}
          testId="stat-cost"
        />
      </div>
    </div>
  )
}
