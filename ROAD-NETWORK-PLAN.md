# Road network plan

Status: Stage 0 done (2026-11-19). Stage 1a started on branch `stage-1-network` (2026-11-19):
`maps.js` and `network.js` build the network for every place and `network-test.js` checks it against
today's engine; sim.js doesn't use it yet. Next: switch sim.js onto the network. Replaces "every road is a straight line from one edge of
the map to the other" with a real network of nodes and roads, so maps can have T-junctions, dead
ends, one-way streets, curves, diagonals and a highway with ramps.

## Decisions so far

| Question | Decision |
|---|---|
| Road features in v1 | T-junctions and dead ends, one-way streets, curves and diagonals, a highway with ramps |
| Existing places | Port all four (Downtown, Main Street, Suburb, Crosstown) to the new model; small changes to their numbers are fine, then capacity marks and README tables get re-measured |
| Gridlock | Generalize today's rule: each road segment gets a "distance to exit", and a car may only move onto one with a smaller value |
| Map format | Hand-written data, in the format an editor would save later |
| Dead ends | Cars start there (homes, lots) and drive out; nobody drives in |
| New maps | Interchange, Riverside, Old town, and an upgraded Suburb |
| Delivery | Staged; each stage ships on its own and leaves everything playable |
| Challenge mode | Ported with behavior unchanged; no new features for it |

Assumed (say if wrong): the world stays 1280 × 680 and scales to the screen as now (no pan or zoom);
traffic keeps right; Stadium and Construction stay Downtown-only; buses run only on avenues.

## What changes, and why it's big

Today (sim.js):
- A road is `{axis, c, half, avenue}`: a horizontal or vertical line across the whole map.
- A lane is one direction of one road, `s` px from the edge it enters at; `lanePoint` turns `s` into x/y.
- Stops are worked out by crossing every road with every other; a crossing's key is `"x,y"`.
- Who may enter a crossing is hand-written per case: `light.axis`, `busy.ns/ew`, `leftIn[dir]`,
  `throughIn[dir]`, `OPPOSITE`, `LEFT_OF`/`RIGHT_OF`. All of it assumes four arms at right angles.
- Gridlock is impossible because turns only lead onto lanes that run straight out of the city.

Nearly every function in sim.js leans on one of these, so stage 1 is a rewrite of the sim's core,
not an addition. The drawing in game.js changes as much (roads are drawn as full-width lines today).

## The new model

### Map data (hand-written, editor-ready)

```js
{
  nodes: {
    w1: { x: 0, y: 420, type: 'edge' },               // cars enter and leave here
    a:  { x: 380, y: 420, control: 'light' },          // light | stop2 | stop4 | round | none
    cul: { x: 520, y: 120, type: 'source', weight: 0.4 }   // dead end: cars start here
  },
  roads: [
    { from: 'w1', to: 'a', kind: 'avenue', lanes: [2, 2] },         // [forward, back]
    { from: 'a', to: 'b', kind: 'street', lanes: [1, 0] },          // one-way
    { from: 'b', to: 'c', kind: 'street', lanes: [1, 1], curve: [[620, 300]] },  // bends through a point
    { from: 'h1', to: 'h2', kind: 'highway', lanes: [2, 2], level: 1 }           // a bridge: no crossing
  ]
}
```

Places become data like this. Downtown's 1/2/4/6 grids become a small function that writes it.
Challenge mode's road schedule becomes roads with an `opensAt` time.

### At run time

- **Link:** one lane of one road between two nodes, with a sampled path (points, headings, distance
  along it). The roundabout code already does this (`makeRoundPath`, `pathPoint`), so it becomes the
  general case. A car keeps `s` = distance along its link, as now.
- **Node:** its arms (incoming and outgoing links, sorted by angle), a stop line per incoming link, and
  its **movements** (incoming link → outgoing link), each with a path through the box.
- **Conflicts from geometry:** two movements conflict if their paths pass within a car width (plus a
  margin) of each other, unless they share their start lane (follow) or end lane (merge, handled by
  join spacing). This is worked out once per node and replaces the hand-written `busy`/`leftIn`/
  `throughIn` rules. A car may enter when no conflicting movement has a car in the box, and, for a
  movement that must yield, none is arriving within the gap time. Today's left-turn gap rule becomes
  one case of "this movement yields to those".
- **Lights:** a light runs **phases**: groups of movements that may go together, generated from the
  arms (4-way: two phases plus left arrows; T-junction: two or three). Smart, Timer and Green wave
  work on phases instead of axes. Smart counts cars waiting per phase.
- **Signs and roundabouts** carry over: two-way stops name their major arms; all-way stops keep their
  queue; roundabouts take arms at any angle (their path code already works from headings).
- **Bridges:** roads at different `level`s don't make a node where they cross; drawn in level order.
- **Ramps:** a merge node (two incoming, one outgoing): the ramp yields to the main road, and zippers
  when both are slow. A diverge node (one incoming, two outgoing) has no conflicts.
- **Lane changes** stay between sibling links on the same road. On a curve, siblings have different
  lengths, so a car's position moves over in proportion (s × other length / this length).

### Gridlock rule, generalized

A car may take a movement only if it leads to a link with a smaller `d` (distance to exit) than the
one it's on.

Why that can't jam: a jam is a loop of cars, each waiting for space the next one holds. Every move
makes `d` smaller, so following "who waits on whom" around a loop, `d` would have to keep getting
smaller and still come back to where it started, which is impossible. That holds for any `d`, so the
work is choosing `d` so the moves people expect are allowed.

Changed while building (2026-11-19): the first plan was `d` = shortest driving distance to an exit.
That forbade going straight on past an avenue's first light, since turning off there is a shorter
way out. So the allowed moves are picked first and `d` is measured over them (`buildDistances` in
network.js):
1. going straight on;
2. turns onto a road that runs straight out of the map, and every way off a roundabout (today's
   rules, so Stage 1 matches today's traffic);
3. only for a road side with no way out at all (a T-junction's stem, Stage 2), its other turns,
   shortest way out first.

Each is added only if it doesn't let a car come back to where it was. `d` is then the longest allowed
drive to the edge, so every allowed move lowers it. `network-test.js` checks the allowed turns match
today's exactly. The cost is still that cars can't drive around a block or into a dead end. That
suits "cars start at dead ends and drive out". Trips with destinations would need reservations
instead, so the rule lives in one function that can be swapped later.

"Don't block the box" stays as it is: every link has a capacity (cars that fit), and nobody enters a
node without a guaranteed space on the link they're heading for.

### Sources

Edge nodes and dead-end sources both spawn cars. Each source keeps its own random stream, and each
car its own, as now, so compare mode still gets the same cars on both maps. Dead-end sources follow
their own day curve (mostly morning departures).

### Drawing

Roads are drawn as stroked paths at their width (lane dashes along each path), junction boxes as
polygons from the arms' edges, stop lines and teeth along each incoming link's stop line, and bridges
over everything at a lower level. Lights stay round chips at the node. Phones held upright still
rotate the whole canvas, so nothing special is needed there.

## Stages

Each stage ends with the tests passing, a playable game, a commit, and README updates. Each stage
that adds a map starts with mockups (desktop and phone, 2 to 4 options) before any drawing code.

**Stage 0: safety net (small). Done 2026-11-19.** Running the overlap check on every place found
cars colliding at stop signs and roundabouts in all three new places; fixed before saving the
baseline (see README, Places).
- `node test.js` runs every test script.
- Record a baseline: for each place and strategy, trips, average wait and give-ups per seeded day,
  saved as JSON.
- Add an overlap and stuck check that runs on every map, not just Downtown.

**Stage 1: new engine, same maps (large; likely several sessions).**
- 1a: the map format, links, nodes, movements, geometric conflicts, phases, distance-to-exit rule, and
  sources. Port Downtown (1/2/4/6), Main Street, Suburb, Crosstown, and challenge mode's schedule.
- 1b: drawing from the network (roads as paths, junction polygons).
- Done when: all tests pass; nothing freezes; compare still matches cars exactly; each place's
  baseline numbers land within about 10%; the challenge bot (`tune.js`) survives about as long as
  before; capacity marks re-measured.

**Stage 2: T-junctions, dead ends, one-way streets (medium).**
- Still straight roads.
- T-junction phases and stops, dead-end sources with their own day curve, and one-way links.
- Map: Suburb, first pass, with cul-de-sacs and T-junctions in place of some crossings.

**Stage 3: curves and diagonals (medium to large).**
- Curved and angled road paths, lane changes on curves, and junction boxes at odd angles.
- Maps: Riverside, Old town, and Suburb's curved streets.

**Stage 4: highway, bridges and ramps (large).**
- Bridge levels, merge and diverge nodes, highway speeds, and ramp meters left out unless needed.
- Map: Interchange.

## Risks

- **Geometric conflicts get it wrong:** cars would drive through each other, or wait for no reason.
  The overlap test, run on every map, catches the first; baseline waits catch the second.
- **New deadlocks.** Building signs and roundabouts turned up three that only showed after hours of
  game time. The stuck check runs on every map and every stage.
- **Smart on unusual nodes.** Comparing waiting cars per phase on a T-junction or a five-arm node
  hasn't been tuned. Expect a tuning pass.
- **Performance.** Conflict checks per car per step. Precomputed tables per node should keep it cheap.
  Watch frame time on a phone at 4×.
- **Space on a 1280 × 680 map.** Interchange may be cramped. If so, pan and zoom becomes a follow-up
  rather than squeezing the map.
- **Scope.** Stage 1 touches most of sim.js (about 1,800 lines) and the drawing half of game.js. It's
  the stage most likely to take longer than planned. Stopping after it still leaves a sounder engine.
