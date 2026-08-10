import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { schemaText } from './schema'

const target = fileURLToPath(new URL('../shipwright.schema.json', import.meta.url))
writeFileSync(target, schemaText())
console.log(`wrote ${target}`)
