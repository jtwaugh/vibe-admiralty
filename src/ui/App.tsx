import { Designer } from './Designer'
import { HullSelect } from './HullSelect'
import { SeaTrial } from './SeaTrial'
import { useDesignerStore } from '../state/store'

/**
 * The three screens of SPEC §3: pick a hull, design her, then take her out and
 * see whether the design floats.
 */
export function App() {
  const screen = useDesignerStore((state) => state.screen)
  const design = useDesignerStore((state) => state.design)

  if (design) {
    if (screen === 'sea-trial') return <SeaTrial design={design} />
    if (screen === 'designer') return <Designer design={design} />
  }
  return <HullSelect />
}
