import type { DerivedStats } from '../physics/derived'
import type { ShipModel } from '../physics/masses'
import { SCHEMA_VERSION, designSchema, shipwrightDocumentSchema } from './schema'
import type { Design, Derived, ShipwrightDocument } from './schema'
import { buildCrewStations } from './stations'

/**
 * The JSON export contract (SPEC §8). The document carries the whole design
 * plus derived readouts and crew stations, and importing it must reproduce the
 * design exactly.
 */

/** Round for a readable file; the design itself is exported verbatim. */
function round(value: number, places = 3): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

/**
 * A ship with no equilibrium is reported as lying on her beam ends. JSON has no
 * NaN, and the boolean beside it says what really happened.
 */
function listDegreesFor(derived: DerivedStats): number {
  if (derived.capsizesAtRest || !Number.isFinite(derived.staticListDeg)) return 90
  return round(derived.staticListDeg, 2)
}

export function derivedForExport(derived: DerivedStats): Derived {
  return {
    displacementTonnes: round(derived.displacementTonnes, 1),
    draftM: round(derived.draftM, 2),
    gmM: round(derived.gmM, 3),
    staticListDeg: listDegreesFor(derived),
    capsizesAtRest: derived.capsizesAtRest,
    totalGunWeightTonnes: round(derived.totalGunWeightTonnes, 2),
    broadsideWeightPortLb: round(derived.broadsideWeightPortLb, 1),
    broadsideWeightStarboardLb: round(derived.broadsideWeightStarboardLb, 1),
    crewEstimate: derived.crewEstimate,
    maxSpeedEstimateKn: round(derived.maxSpeedEstimateKn, 2),
    totalCostPounds: Math.round(derived.totalCostPounds),
  }
}

export function buildDocument(model: ShipModel, derived: DerivedStats): ShipwrightDocument {
  const design = model.design
  const document: ShipwrightDocument = {
    schemaVersion: SCHEMA_VERSION,
    name: design.name,
    hull: { presetId: design.presetId, params: design.hull },
    timber: design.timber,
    rig: design.rig,
    mounts: design.mounts,
    cosmetics: design.cosmetics,
    derived: derivedForExport(derived),
    stations: buildCrewStations(model).map((station) => ({
      ...station,
      position: {
        x: round(station.position.x, 3),
        y: round(station.position.y, 3),
        z: round(station.position.z, 3),
      },
    })),
  }
  // Validate on the way out, per SPEC §8, so a bad export never reaches disk.
  return shipwrightDocumentSchema.parse(document)
}

export function serialiseDocument(document: ShipwrightDocument): string {
  return JSON.stringify(document, null, 2)
}

/** Read a document back and recover the design it describes. */
export function designFromDocument(document: ShipwrightDocument): Design {
  return designSchema.parse({
    name: document.name,
    presetId: document.hull.presetId,
    hull: document.hull.params,
    timber: document.timber,
    rig: document.rig,
    cosmetics: document.cosmetics,
    mounts: document.mounts,
  })
}

export function parseDocument(text: string): ShipwrightDocument {
  return shipwrightDocumentSchema.parse(JSON.parse(text))
}

/** "HMS Surprise" -> "hms-surprise.shipwright.json" */
export function exportFilename(name: string, extension: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'ship'
  return `${slug}.${extension}`
}

/** Hand a blob to the browser as a download; there is no server (SPEC §2). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadDocument(document_: ShipwrightDocument) {
  const blob = new Blob([serialiseDocument(document_)], { type: 'application/json' })
  downloadBlob(blob, exportFilename(document_.name, 'shipwright.json'))
}
