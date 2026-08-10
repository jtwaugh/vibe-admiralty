import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { schemaText } from '../scripts/schema'
import { computeDerived } from '../src/physics/derived'
import { buildShipModel } from '../src/physics/masses'
import type { Design } from '../src/export/schema'
import { SCHEMA_VERSION } from '../src/export/schema'
import {
  buildDocument,
  designFromDocument,
  exportFilename,
  parseDocument,
  serialiseDocument,
} from '../src/export/json-export'
import { buildCrewStations } from '../src/export/stations'
import { defaultDesign } from '../src/state/defaults'

const schemaPath = fileURLToPath(new URL('../shipwright.schema.json', import.meta.url))
const checkedInSchema = readFileSync(schemaPath, 'utf8')

function documentFor(design: Design) {
  const model = buildShipModel(design)
  return buildDocument(model, computeDerived(model))
}

function portOnly(design: Design): Design {
  const mounts = { ...design.mounts }
  for (const [id, config] of Object.entries(mounts)) {
    mounts[id] = { ...config, starboard: 0 }
  }
  return { ...design, mounts }
}

describe('shipwright.schema.json', () => {
  it('is up to date with the zod schema', () => {
    // Regenerate with `npm run schema` when the export contract changes.
    expect(checkedInSchema).toBe(schemaText())
  })

  it('validates an exported document', () => {
    const ajv = new Ajv({ strict: false })
    const validate = ajv.compile(JSON.parse(checkedInSchema))
    const document = documentFor(defaultDesign('frigate-38'))
    const ok = validate(JSON.parse(serialiseDocument(document)))
    expect(validate.errors ?? []).toEqual([])
    expect(ok).toBe(true)
    expect(document.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('rejects a document with a missing field', () => {
    const ajv = new Ajv({ strict: false })
    const validate = ajv.compile(JSON.parse(checkedInSchema))
    const document = JSON.parse(serialiseDocument(documentFor(defaultDesign('sloop'))))
    delete document.derived
    expect(validate(document)).toBe(false)
  })
})

describe('json export', () => {
  it('carries port and starboard counts for every battery mount', () => {
    const design = defaultDesign('third-rate-74')
    const document = documentFor(design)
    for (const [id, config] of Object.entries(design.mounts)) {
      expect(document.mounts[id].port).toBe(config.port)
      expect(document.mounts[id].starboard).toBe(config.starboard)
    }
  })

  it('reports the static list and the total cost in derived', () => {
    const document = documentFor(portOnly(defaultDesign('frigate-38')))
    expect(document.derived.staticListDeg).toBeLessThan(-0.5)
    expect(document.derived.totalCostPounds).toBeGreaterThan(1000)
    expect(document.derived.broadsideWeightStarboardLb).toBe(0)
    expect(document.derived.broadsideWeightPortLb).toBeGreaterThan(0)
  })

  it('reports a capsizing ship as lying on her beam ends rather than as NaN', () => {
    const base = defaultDesign('sloop')
    const design: Design = {
      ...base,
      hull: { ...base.hull, beam: base.hull.beam * 0.77 },
      mounts: {
        ...base.mounts,
        'battery-deck-0': { gunId: 'long-32', port: 7, starboard: 0 },
      },
    }
    const document = documentFor(design)
    expect(document.derived.capsizesAtRest).toBe(true)
    expect(document.derived.staticListDeg).toBe(90)
    expect(JSON.stringify(document)).not.toContain('null')
  })

  it('round-trips a design through export and import, exactly', () => {
    const original = portOnly(defaultDesign('frigate-38'))
    const text = serialiseDocument(documentFor(original))
    const restored = designFromDocument(parseDocument(text))
    expect(restored).toEqual(original)
  })

  it('round-trips every preset', () => {
    for (const presetId of ['sloop', 'brig', 'frigate-28', 'frigate-38', 'third-rate-74']) {
      const original = defaultDesign(presetId)
      const restored = designFromDocument(parseDocument(serialiseDocument(documentFor(original))))
      expect(restored).toEqual(original)
    }
  })

  it('names the file after the ship', () => {
    expect(exportFilename('HMS Surprise', 'shipwright.json')).toBe(
      'hms-surprise.shipwright.json',
    )
    expect(exportFilename('  ', 'gltf')).toBe('ship.gltf')
  })
})

describe('crew stations', () => {
  const design = defaultDesign('frigate-38')
  const model = buildShipModel(design)
  const stations = buildCrewStations(model)

  it('gives the frigate one helm, one battery per armed deck, and a mast pair each', () => {
    const byType = (type: string) => stations.filter((station) => station.type === type)
    expect(byType('helm')).toHaveLength(1)
    // Gun deck, quarterdeck and forecastle are all armed in the default design.
    expect(byType('gun-battery')).toHaveLength(3)
    expect(byType('sail-handling')).toHaveLength(3)
    expect(byType('lookout')).toHaveLength(3)
  })

  it('adds chaser stations only when the chasers are armed', () => {
    expect(stations.some((station) => station.type === 'bow-chaser')).toBe(false)
    const armed = {
      ...design,
      mounts: {
        ...design.mounts,
        'bow-chaser': { gunId: 'long-9', port: 1, starboard: 1 },
      },
    }
    const withChaser = buildCrewStations(buildShipModel(armed))
    expect(withChaser.filter((station) => station.type === 'bow-chaser')).toHaveLength(1)
  })

  it('places every station inside the ship and asks for a real crew', () => {
    const half = model.hull.length / 2
    const highest = Math.max(...model.sockets.masts.map((mast) => mast.truckY))
    for (const station of stations) {
      expect(Math.abs(station.position.x)).toBeLessThanOrEqual(half)
      expect(Math.abs(station.position.z)).toBeLessThanOrEqual(model.hull.params.beam / 2)
      expect(station.position.y).toBeGreaterThan(0)
      expect(station.position.y).toBeLessThanOrEqual(highest)
      expect(station.crewRequired).toBeGreaterThan(0)
    }
  })

  it('drops a battery station when its guns are landed', () => {
    const bare = {
      ...design,
      mounts: {
        ...design.mounts,
        quarterdeck: { gunId: 'carronade-24', port: 0, starboard: 0 },
      },
    }
    const stationsAfter = buildCrewStations(buildShipModel(bare))
    expect(stationsAfter.filter((station) => station.type === 'gun-battery')).toHaveLength(2)
  })
})
