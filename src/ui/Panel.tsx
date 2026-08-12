import type { ReactNode } from 'react'

/**
 * The left panel's vocabulary: a group that opens, a draughtsman's scale for
 * continuous values, a choice list, and a switch. Every control writes straight
 * to the design store (SPEC §6).
 */

export function PanelGroup({
  title,
  note,
  defaultOpen = false,
  children,
  testId,
}: {
  title: string
  note?: string
  defaultOpen?: boolean
  children: ReactNode
  testId?: string
}) {
  return (
    <details className="group" open={defaultOpen} data-testid={testId}>
      <summary className="group-summary">
        <span className="group-title">{title}</span>
        {note ? <span className="group-note">{note}</span> : null}
      </summary>
      <div className="group-body">{children}</div>
    </details>
  )
}

export function Scale({
  label,
  value,
  min,
  max,
  step = 0.1,
  unit,
  hint,
  onChange,
  testId,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  /**
   * The solved consequence of this slider, shown under the track. Draught and
   * displacement are results, not inputs, so the sliders that move them say so
   * rather than pretending to set them.
   */
  hint?: string
  onChange(value: number): void
  testId?: string
}) {
  return (
    <label className="control scale">
      <span className="control-label">
        {label}
        <span className="control-value">
          {value.toFixed(step < 0.05 ? 2 : 1)}
          {unit ? <span className="control-unit"> {unit}</span> : null}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testId}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="scale-ends">
        <span>{min.toFixed(1)}</span>
        {hint ? <span className="scale-hint">{hint}</span> : null}
        <span>{max.toFixed(1)}</span>
      </span>
    </label>
  )
}

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange(value: T): void
  testId?: string
}) {
  return (
    <label className="control choice">
      <span className="control-label">{label}</span>
      <select
        value={value}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Switch({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string
  checked: boolean
  onChange(checked: boolean): void
  testId?: string
}) {
  return (
    <label className="control switch">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="control-label">{label}</span>
    </label>
  )
}
