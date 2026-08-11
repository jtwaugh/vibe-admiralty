import { create } from 'zustand'
import type { SailPlanId, ThicknessStep, TimberZoneId } from '../data/schemas'
import type {
  CosmeticsDesign,
  Design,
  MountConfig,
  SailState,
} from '../export/schema'
import { computeDerived } from '../physics/derived'
import type { DerivedStats } from '../physics/derived'
import { buildShipModel } from '../physics/masses'
import type { ShipModel } from '../physics/masses'
import type { CameraMode } from '../scene/viewer'
import type { WindConditions } from '../physics/wind'
import { defaultDesign } from './defaults'

export type Screen = 'hull-select' | 'designer' | 'sea-trial'

/** Which hull parameters the left panel is allowed to deform (SPEC §4). */
export type SliderKey = 'beam' | 'freeboard' | 'sheer'

type DesignerStore = {
  screen: Screen
  /** Null only before a hull has ever been chosen. */
  design: Design | null
  cameraMode: CameraMode
  /** Socket id whose mount modal is open, if any. */
  activeMountId: string | null
  /**
   * The weather for the sea trial. It is not part of the design and does not
   * export: two ships tried in different winds are still the same two ships.
   */
  wind: WindConditions

  selectPreset(presetId: string): void
  backToHulls(): void
  launch(): void
  returnToDock(): void

  setName(name: string): void
  setHullParam(key: SliderKey, value: number): void
  setTimberSpecies(speciesId: string): void
  setTimberZone(zone: TimberZoneId, step: ThicknessStep): void
  setNettings(on: boolean): void
  setSailPlan(planId: SailPlanId): void
  setSailState(sailId: string, state: SailState): void
  setAllSails(state: SailState): void
  setCosmetic<K extends keyof CosmeticsDesign>(key: K, value: CosmeticsDesign[K]): void
  setMount(socketId: string, patch: Partial<MountConfig>): void

  setWind(patch: Partial<WindConditions>): void
  openMount(socketId: string): void
  closeMount(): void
  setCameraMode(mode: CameraMode): void
  loadDesign(design: Design): void
}

export const useDesignerStore = create<DesignerStore>((set) => {
  /** Every mutation replaces the design object, which drives the memo below. */
  const edit = (mutate: (design: Design) => Design) =>
    set((state) => (state.design ? { design: mutate(state.design) } : {}))

  return {
    screen: 'hull-select',
    design: null,
    cameraMode: 'broadside',
    activeMountId: null,
    // A working breeze on the starboard beam, which is where a sea trial starts.
    wind: { directionRad: Math.PI / 2, speedKn: 15 },

    selectPreset: (presetId) =>
      set({ screen: 'designer', design: defaultDesign(presetId), activeMountId: null }),
    backToHulls: () => set({ screen: 'hull-select', activeMountId: null }),
    launch: () => set({ screen: 'sea-trial', activeMountId: null }),
    returnToDock: () => set({ screen: 'designer' }),

    setName: (name) => edit((design) => ({ ...design, name })),
    setHullParam: (key, value) =>
      edit((design) => ({ ...design, hull: { ...design.hull, [key]: value } })),
    setTimberSpecies: (speciesId) =>
      edit((design) => ({ ...design, timber: { ...design.timber, speciesId } })),
    setTimberZone: (zone, step) =>
      edit((design) => ({
        ...design,
        timber: { ...design.timber, zones: { ...design.timber.zones, [zone]: step } },
      })),
    setNettings: (on) =>
      edit((design) => ({ ...design, timber: { ...design.timber, nettings: on } })),
    setSailPlan: (sailPlanId) =>
      edit((design) => ({ ...design, rig: { ...design.rig, sailPlanId } })),
    setSailState: (sailId, state) =>
      edit((design) => ({
        ...design,
        rig: { ...design.rig, sails: { ...design.rig.sails, [sailId]: state } },
      })),
    setAllSails: (state) =>
      edit((design) => {
        const sails: Record<string, SailState> = {}
        for (const id of Object.keys(design.rig.sails)) sails[id] = state
        return { ...design, rig: { ...design.rig, sails } }
      }),
    setCosmetic: (key, value) =>
      edit((design) => ({ ...design, cosmetics: { ...design.cosmetics, [key]: value } })),
    setMount: (socketId, patch) =>
      edit((design) => {
        const current = design.mounts[socketId] ?? { gunId: null, port: 0, starboard: 0 }
        return {
          ...design,
          mounts: { ...design.mounts, [socketId]: { ...current, ...patch } },
        }
      }),

    setWind: (patch) => set((state) => ({ wind: { ...state.wind, ...patch } })),
    openMount: (socketId) => set({ activeMountId: socketId }),
    closeMount: () => set({ activeMountId: null }),
    setCameraMode: (cameraMode) => set({ cameraMode }),
    loadDesign: (design) => set({ design, screen: 'designer', activeMountId: null }),
  }
})

/**
 * Building the ship model and solving her hydrostatics costs a few milliseconds,
 * and several components want the same answer for the same design. One entry of
 * cache is enough: the design object is replaced on every edit.
 */
let cached: { design: Design; model: ShipModel; derived: DerivedStats } | null = null

export function analyse(design: Design): { model: ShipModel; derived: DerivedStats } {
  if (cached && cached.design === design) return cached
  const model = buildShipModel(design)
  const derived = computeDerived(model)
  cached = { design, model, derived }
  return cached
}
