import { zodToJsonSchema } from 'zod-to-json-schema'
import { SCHEMA_VERSION, shipwrightDocumentSchema } from '../src/export/schema'

/**
 * shipwright.schema.json is generated from the zod schema, so the published
 * JSON Schema and the validation the app runs at export time can never
 * disagree. Run `npm run schema` after changing the export contract; a unit
 * test fails if the checked-in file is stale.
 */
export function shipwrightJsonSchema(): Record<string, unknown> {
  return {
    $id: `https://shipwright.local/shipwright.schema.v${SCHEMA_VERSION}.json`,
    title: 'Shipwright ship design',
    ...zodToJsonSchema(shipwrightDocumentSchema, { $refStrategy: 'none' }),
  }
}

export function schemaText(): string {
  return `${JSON.stringify(shipwrightJsonSchema(), null, 2)}\n`
}
