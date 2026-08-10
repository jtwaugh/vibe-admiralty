import { Designer } from './Designer'
import { HullSelect } from './HullSelect'
import { useDesignerStore } from '../state/store'

/**
 * Two screens in phase 2: pick a hull, then design her. The sea trial (SPEC §3)
 * is phase 3 and its Launch button is disabled until then.
 */
export function App() {
  const screen = useDesignerStore((state) => state.screen)
  const design = useDesignerStore((state) => state.design)

  if (screen === 'designer' && design) return <Designer design={design} />
  return <HullSelect />
}
