import { useEffect, useRef, useState } from 'react'
import type { ShipModel } from '../physics/masses'
import { ShipViewer } from '../scene/viewer'
import type { CameraMode, MarkerProjection, ViewerAttitude } from '../scene/viewer'

type Props = {
  model: ShipModel
  attitude: ViewerAttitude
  cameraMode: CameraMode
  /** Show the mount markers on the hull and make them clickable. */
  markers?: boolean
  activeMountId?: string | null
  onMountClick?(socketId: string): void
  /** Label for each socket, used as the marker's tooltip. */
  mountLabels?: Record<string, string>
}

export function Viewer({
  model,
  attitude,
  cameraMode,
  markers = false,
  activeMountId = null,
  onMountClick,
  mountLabels = {},
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<ShipViewer | null>(null)
  const clickRef = useRef(onMountClick)
  const [projections, setProjections] = useState<MarkerProjection[]>([])

  clickRef.current = onMountClick

  useEffect(() => {
    if (!canvasRef.current) return
    const viewer = new ShipViewer(canvasRef.current)
    viewer.onMountClick = (socketId) => clickRef.current?.(socketId)
    viewer.onMarkersMoved = setProjections
    viewerRef.current = viewer
    return () => {
      viewer.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    viewerRef.current?.setModel(model, attitude)
    viewerRef.current?.setMarkersVisible(markers)
    viewerRef.current?.setActiveMarker(activeMountId)
    // The mesh is rebuilt whenever the design changes; attitude alone is cheap.
  }, [model])

  useEffect(() => {
    viewerRef.current?.setAttitude(attitude)
  }, [attitude])

  useEffect(() => {
    viewerRef.current?.setCameraMode(cameraMode)
  }, [cameraMode])

  useEffect(() => {
    viewerRef.current?.setMarkersVisible(markers)
  }, [markers])

  useEffect(() => {
    viewerRef.current?.setActiveMarker(activeMountId)
  }, [activeMountId])

  return (
    <div className="viewer">
      <canvas ref={canvasRef} className="viewer-canvas" data-testid="viewer-canvas" />
      {markers
        ? bestPerMount(projections).map((projection) => (
              <button
                key={projection.key}
                type="button"
                className={
                  projection.socketId === activeMountId ? 'mount-hit active' : 'mount-hit'
                }
                style={{ left: `${projection.x}px`, top: `${projection.y}px` }}
                data-testid={`mount-marker-${projection.socketId}`}
                title={mountLabels[projection.socketId] ?? projection.socketId}
                onClick={() => clickRef.current?.(projection.socketId)}
              >
                <span className="visually-hidden">
                  {mountLabels[projection.socketId] ?? projection.socketId}
                </span>
              </button>
            ))
        : null}
    </div>
  )
}

/**
 * A mount carries a marker on each side of the ship. Only the one facing the
 * camera most squarely gets a hit area, so a mount is always one target.
 */
function bestPerMount(projections: MarkerProjection[]): MarkerProjection[] {
  const best = new Map<string, MarkerProjection>()
  for (const projection of projections) {
    if (!projection.visible) continue
    const current = best.get(projection.socketId)
    if (!current || projection.facing > current.facing) best.set(projection.socketId, projection)
  }
  return [...best.values()]
}
