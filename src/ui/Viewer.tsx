import { useEffect, useRef } from 'react'
import type { ShipModel } from '../physics/masses'
import { ShipViewer } from '../scene/viewer'
import type { CameraMode, ViewerAttitude } from '../scene/viewer'

type Props = {
  model: ShipModel
  attitude: ViewerAttitude
  cameraMode: CameraMode
}

export function Viewer({ model, attitude, cameraMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<ShipViewer | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const viewer = new ShipViewer(canvasRef.current)
    viewerRef.current = viewer
    return () => {
      viewer.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    viewerRef.current?.setModel(model, attitude)
    // The mesh is rebuilt whenever the design changes; attitude alone is cheap.
  }, [model])

  useEffect(() => {
    viewerRef.current?.setAttitude(attitude)
  }, [attitude])

  useEffect(() => {
    viewerRef.current?.setCameraMode(cameraMode)
  }, [cameraMode])

  return <canvas ref={canvasRef} className="viewer-canvas" data-testid="viewer-canvas" />
}
