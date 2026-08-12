# Shipwright

Shipwright is a ship designer for the browser. The ships are from the Napoleonic
period. You select a hull. Then you add guns, rigging, and paint. Then you launch
the ship into an ocean that has wind. The sea trial shows you if your design
floats.

You can export the design as a JSON file that has a version number. You can also
export a glTF model that has a hierarchy of named nodes. A future age-of-sail
game can read these two files.

Shipwright has no server, no combat, and no save function. The build is static.
The export function makes a file download.

[SPEC.md](SPEC.md) gives the requirements. [ACCEPTANCE.md](ACCEPTANCE.md) gives
the definition of done. [DECISIONS.md](DECISIONS.md) gives a record of each
decision that SPEC.md does not specify.

## Quick start

Install the dependencies. Then start the development server.

```bash
npm install
npm run dev
```

You must have Node 20 or a later version. The development used Node 22. Before
the first Playwright run, do this command: `npx playwright install chromium`.

| Command | Function |
| --- | --- |
| `npm run dev` | Starts the development server with hot module replacement |
| `npm run build` | Does the type check (`tsc -b`) and makes the production build |
| `npm run preview` | Supplies the build on port 4173 |
| `npm run test` | Runs the Vitest unit tests |
| `npm run e2e` | Makes the build, then runs the Playwright tests against the preview server |
| `npm run e2e:shots` | Runs the demo scripts and writes retina screenshots to `shots/` |
| `npm run schema` | Makes `shipwright.schema.json` again from the zod schemas |

## The three screens

**Hull select.** There are five presets: Sloop, Brig, Frigate (28), Frigate (38),
and Third Rate (74). Each preset is a set of hull parameters. Each preset also
gives the permitted range for each slider. The screen shows a thumbnail image,
the length, the beam, and the nominal number of guns.

**Designer.** The camera is locked to a broadside view. This view is equivalent
to a profile drawing. Use the orbit control to unlock the camera. The left panel
has the hull sliders for the beam, the freeboard, and the sheer. The panel also
has the controls for the timber, the rig, the cosmetic parts, and the copper.

The mount markers are raycast targets on the applicable geometry. Click a
battery, a chaser, or a swivel rail to open the related dialog. In the dialog,
select the pattern. Then set the port count and the starboard count
independently.

All the controls write to one Zustand store. The statistics bar calculates these
values again immediately: the displacement, the draft, the GM, the static list,
the gun weight, the broadside weight for each side, the crew, and the cost in
pounds.

**Sea trial.** Push Launch to put the ship in the ocean. The screen has a wind
dial, a speed slider, sail controls for each group, and a tiller. You can also
use the `A` key and the `D` key for the tiller. The program calculates the
stability solution for each frame. Push Return to Dock to go back. The design
does not change.

## How the program operates

**The station curves are the only source of data.** The program makes the hull
from 21 transverse stations along the keel. It interpolates the stations from the
beam, the depth, the fullness, and the sheer. The same curves make the render
mesh (`src/hull/loft.ts`). The same curves also give the hydrostatics
(`src/physics/hydrostatics.ts`) and the position of each socket
(`src/hull/sockets.ts`). The program never measures the render mesh to calculate
the physics.

**The program integrates the hydrostatics directly.** It does not use a
small-angle approximation. For each candidate waterplane (the draft, the heel,
and the trim), the program clips each station polygon against the plane. Then it
integrates the submerged areas to get the volume and the centre of buoyancy. Then
it solves the draft until the displacement is equal to the mass.

The same clipping calculation gives the righting arm GZ at each heel angle. Thus
the point of vanishing stability is a result of the model. It is not a constant.

The program calculates the centre of gravity in three dimensions from all the
masses. The masses include the hull structure for each zone, the ballast, the
stores, the guns, and the rig. The calculation includes the lateral offset of
asymmetric batteries. Thus a battery on one side only makes the ship list at the
dock. The ship capsizes only when the heeling moment is more than the maximum
righting moment. No other condition causes a capsize.

**Wind supplies force. It is not an animation.** Each sail in the set condition
supplies a force of ½ρv²·A·C at its centre of effort. The program divides this
force into a drive component and a heel component by the wind angle. Furled sails
supply no force. The program integrates the heel, the speed, and the yaw with
strong damping. The waves move the image only. The hull moves with the swell, but
the swell does not push the hull.

**The parts are data.** The guns, the timber, the sails, the cosmetic parts, and
the presets are typed JSON files in `src/data/`. Zod validates the files at load
time. To add a gun rating, edit `guns.json`. Do not change the component code.
Each part has a mass, a mounting height, and a cost in period pounds. All three
values go into the totals.

## Export contract

Push Export JSON to write a document. The document agrees with
`shipwright.schema.json`. The document contains the applicable hull parameters,
the timber, the rig, the mounts, the cosmetic parts, a `derived` block, and a
`stations` array. Each battery in the mounts has a `port` count and a `starboard`
count.

The program makes the `stations` array automatically. The array contains the crew
stations: the helm, one gun battery for each armed deck, sail handling and
lookout for each mast, and the chasers if they have guns. Each station has a
position in ship coordinates and a crew requirement. The round trip is exact: the
import button in the development build makes the same design state.

Push Export glTF to write a hierarchy of named nodes: `Hull`, `Mast_1` to
`Mast_n` with their yards, `Sail_<mast>_<tier>`, `Rudder`, and
`Gunport_<deck>_<index>`. The gun meshes are below their mounts. The names are
part of the contract, because a future engine uses the node names to make the
animation.

## Tests

The Vitest suite has 86 assertions. The assertions test the parts that are
mathematics:

- a box barge of 40 x 10 x 6 against its calculated draft, displacement, and
  small-angle GM
- the shape of the GZ curve
- the increase of the draft with the mass
- the carronade test: if you replace the 32 lb carronades on the quarterdeck with
  long 24 lb guns, the GM must decrease
- the mass and cost sequence in the data files
- the export round trip and the glTF node names

Playwright tests the user interface from end to end. The command `npm run
e2e:shots` runs the two demo scripts from ACCEPTANCE.md:

1. The Frigate, with all plain sail set.
2. The Abomination, a sloop that has the minimum beam, too much sail, and long
   32 lb guns. This ship capsizes without help.

Look at the screenshots. Do not only make them.

## Layout

```
src/
  data/          guns, timber, sails, cosmetics, presets (JSON + zod schemas)
  hull/          stations.ts, loft.ts, sockets.ts, areas.ts
  physics/       hydrostatics.ts, wind.ts, integrate.ts, masses.ts, derived.ts, cost.ts
  scene/         viewer.ts, ocean.ts, ship-mesh.ts, sails.ts, wake.ts, materials.ts
  ui/            React panels, modals, hull select, HUD
  export/        json-export.ts, gltf-export.ts, stations.ts, schema.ts
  state/         store.ts (zustand)
tests/           Vitest
e2e/             Playwright specs + demo scripts
```

## Differences from ACCEPTANCE.md

Two items in the second demo specify behaviour that the hydrostatics do not
produce. The model was not changed to make these two items true.

1. A hull that has an extreme beam behaves as the spec specifies in most
   conditions. The roll stops almost immediately. The ship holds a steady heel
   angle under sail. The ship turns in 5.2 lengths and not in 3.7 lengths. But
   the roll period is shorter, not longer, because the beam supplies the GM of a
   hull.
2. A wind of 20 knots does not capsize the frigate that has all the guns to port.
   The ship lists 3.4° at rest and 10° in that wind. The list does not increase.
   The ship capsizes at approximately 50 knots, when the lee sills go below the
   water.

The last part of [DECISIONS.md](DECISIONS.md) gives the full reasons.
