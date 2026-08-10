import { useEffect, useState } from 'react'
import { hullPresets } from '../data'
import { disposeThumbnailRenderer, renderPresetThumbnail } from '../scene/thumbnail'
import { useDesignerStore } from '../state/store'

/** The sea in the thumbnail; the sky is the card itself, showing through. */
const THUMB_SEA = '#16394a'
/** Rendered at 2x the plate size in the card, which is 720 x 338 CSS pixels. */
const THUMB_WIDTH = 720
const THUMB_HEIGHT = 338

/** Rendered once per session; the hull select screen is revisited often. */
const thumbnailCache = new Map<string, string>()

function useThumbnails(): Map<string, string> {
  const [thumbnails, setThumbnails] = useState(() => new Map(thumbnailCache))

  useEffect(() => {
    let cancelled = false
    const pending = hullPresets.map((preset) => preset.id).filter((id) => !thumbnailCache.has(id))
    if (pending.length === 0) return

    // One preset per frame: rendering five ships in a row would stall the
    // screen before it had drawn anything at all.
    const step = () => {
      if (cancelled) return
      const id = pending.shift()
      if (!id) return
      const url = renderPresetThumbnail(id, THUMB_WIDTH, THUMB_HEIGHT, THUMB_SEA)
      if (url) thumbnailCache.set(id, url)
      setThumbnails(new Map(thumbnailCache))
      if (pending.length > 0) requestAnimationFrame(step)
    }
    const handle = requestAnimationFrame(step)
    return () => {
      cancelled = true
      cancelAnimationFrame(handle)
    }
  }, [])

  useEffect(() => () => disposeThumbnailRenderer(), [])
  return thumbnails
}

export function HullSelect() {
  const selectPreset = useDesignerStore((state) => state.selectPreset)
  const thumbnails = useThumbnails()

  return (
    <div className="hull-select" data-testid="hull-select">
      <header className="hull-select-head">
        <p className="eyebrow">Navy Board · Ship design office</p>
        <h1>Choose a hull</h1>
        <p className="lede">
          Every hull below is a set of parameters, not a model. Pick one and deform her to
          taste: the stations that draw her also float her.
        </p>
      </header>

      <ul className="hull-list">
        {hullPresets.map((preset) => {
          const thumbnail = thumbnails.get(preset.id)
          return (
            <li key={preset.id}>
              <button
                type="button"
                className="hull-card"
                data-testid={`preset-${preset.id}`}
                onClick={() => selectPreset(preset.id)}
              >
                <span className="hull-card-plate">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={`Broadside profile of the ${preset.name}`}
                      data-testid={`preset-thumb-${preset.id}`}
                      width={THUMB_WIDTH}
                      height={THUMB_HEIGHT}
                    />
                  ) : (
                    <span className="hull-card-drawing">drawing…</span>
                  )}
                </span>
                <span className="hull-card-body">
                  <span className="hull-card-name">{preset.name}</span>
                  <span className="hull-card-blurb">{preset.blurb}</span>
                  <span className="hull-card-stats">
                    <span>
                      <em>{preset.params.keelLength.toFixed(0)} m</em>length
                    </span>
                    <span>
                      <em>{preset.params.beam.toFixed(1)} m</em>beam
                    </span>
                    <span>
                      <em>{preset.nominalGuns}</em>guns
                    </span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
