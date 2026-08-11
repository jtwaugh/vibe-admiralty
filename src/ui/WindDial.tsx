import { useRef } from 'react'

/**
 * The wind dial: a compass rose with an arrow showing where the wind is blowing
 * from, and the ship's own head drawn inside it so the relative angle is
 * readable at a glance. Dragging it sets the wind; the range input beside it in
 * the panel does the same thing for the keyboard and for the tests, because a
 * small circular target is not a control everyone can hit.
 */

type Props = {
  directionRad: number
  speedKn: number
  /** Where the ship's bow is pointing, for the little hull in the middle. */
  headingRad: number
  onChange(directionRad: number): void
}

const SIZE = 132

export function WindDial({ directionRad, speedKn, headingRad, onChange }: Props) {
  const ref = useRef<SVGSVGElement>(null)

  const pointAt = (event: { clientX: number; clientY: number }) => {
    const element = ref.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const dx = event.clientX - (box.left + box.width / 2)
    const dy = event.clientY - (box.top + box.height / 2)
    // Screen y runs down; the dial is drawn with +x to the right and +z down,
    // which is the same frame the physics uses for the wind's bearing.
    onChange(Math.atan2(dy, dx))
  }

  const degrees = (directionRad * 180) / Math.PI
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30)

  return (
    <svg
      ref={ref}
      className="wind-dial"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={`Wind from ${(((degrees % 360) + 360) % 360).toFixed(0)} degrees at ${speedKn.toFixed(0)} knots`}
      data-testid="wind-dial"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pointAt(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) pointAt(event)
      }}
    >
      <circle className="dial-face" cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 3} />
      {ticks.map((tick) => (
        <line
          key={tick}
          className={tick % 90 === 0 ? 'dial-tick major' : 'dial-tick'}
          x1={SIZE / 2}
          y1={6}
          x2={SIZE / 2}
          y2={tick % 90 === 0 ? 16 : 12}
          transform={`rotate(${tick} ${SIZE / 2} ${SIZE / 2})`}
        />
      ))}

      {/* The ship, seen from above, pointing where she is heading. */}
      <g transform={`rotate(${(headingRad * 180) / Math.PI + 90} ${SIZE / 2} ${SIZE / 2})`}>
        <path
          className="dial-ship"
          d={`M ${SIZE / 2} ${SIZE / 2 - 22} L ${SIZE / 2 + 7} ${SIZE / 2 + 6}
              Q ${SIZE / 2} ${SIZE / 2 + 16} ${SIZE / 2 - 7} ${SIZE / 2 + 6} Z`}
        />
      </g>

      {/* The wind, blowing from its bearing towards the middle. */}
      <g transform={`rotate(${degrees + 90} ${SIZE / 2} ${SIZE / 2})`}>
        <line
          className="dial-arrow"
          x1={SIZE / 2}
          y1={12}
          x2={SIZE / 2}
          y2={SIZE / 2 - 26}
        />
        <path
          className="dial-arrow-head"
          d={`M ${SIZE / 2} ${SIZE / 2 - 20} l -6 -10 l 12 0 Z`}
        />
        <circle className="dial-grip" cx={SIZE / 2} cy={16} r={7} />
      </g>
    </svg>
  )
}
