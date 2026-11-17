# Green Wave

A little traffic simulation. Cars cross a city grid of side streets and four-lane avenues,
turning and changing lanes, and the lights switch themselves, giving way to whichever side has
more cars waiting.

- **Chill (default):** nothing to lose. A day passes every 6 minutes (at 1×), with a morning
  and evening rush hour and a quiet night when the map dims to lamplight and cars get headlights.
  Pick 1, 2, 4 or 6 lights, how the lights decide (Smart, Timer or Green wave), the speed
  (1×/2×/4×) and how busy the city is. Click any light to switch it yourself; the strategy leaves
  it alone for 8 seconds. The strip shows the average wait per trip and a chart of it. Settings
  are remembered.
- **Challenge:** the lights are all yours. If a queue backs up off the edge of the map, it's
  gridlock and the game ends. New roads open over time and traffic gets heavier.

## Play

Live at https://mattrudy13.github.io/traffic-game/ , or open `index.html` in a browser. There's no
build step and nothing to install.

On a phone held upright the whole city is drawn a quarter turn, so it fills the screen; a slim
bar shows the time, cars, average wait and pause, and **Controls** opens a pull-up sheet with the
rest. Turned sideways, the map stays the normal way round with the same slim bar.

## Files

- `sim.js`: the rules (roads, lights, car movement, spawning, losing). No drawing.
- `game.js`: draws the map on a canvas, handles clicks, the score strip and the start/pause/game-over card.
- `style.css`: the "transit map" look (paper, ink, Archivo + IBM Plex Sans).
- `tune.js`: a bot that plays many challenge games in Node so the difficulty can be checked: `node tune.js`.
- `freeze-test.js`: runs every chill setup for two game days to check nothing ever gridlocks: `node freeze-test.js`.
- `overlap-test.js`: checks no two cars are ever drawn on top of each other (turns, lane changes): `node overlap-test.js`.

## How the cars move

Each car looks at the closest thing it must not pass: the car ahead, or a stop line
whose light isn't green for it. A car going at speed `v` needs `v² / (2 · brake)` to
stop, so the fastest it can safely go with `room` px of space is `sqrt(2 · brake · room)`.
Every frame the car speeds up toward that (limited by `accel`) or drops to it at once.

Two traffic rules keep the grid from locking up:

- **All-red:** after amber, both directions get red for a moment so cars already in the box clear out.
- **Don't block the box:** a car only crosses the line if a space is free for it between this
  intersection and the next one. (An earlier version only looked at the car ahead; at heavy
  traffic four cars got stranded in boxes around a block, each waiting on the next, and the
  grid froze for good. That's real-world gridlock, and the stricter rule rules it out.)

## Turning

In chill mode about 35% of cars turn at each light where a turn is allowed (15 left : 20 right),
blinking their signal on the way in. They slow for the corner and follow a curve through the
box onto the cross street. Left turns wait at the line for a gap: nothing oncoming in the box and
nothing arriving within 2.5 s. A left-turner already waiting may finish on amber, like real drivers.
Opposing left turns go one at a time. The challenge mode stays straight-only.

Cars only turn onto a street that leads straight out of the city. With turns allowed everywhere,
the four streets around a block could all fill up while each front car waited to turn into the
next full one: a circular wait, and the grid froze for good. Straight driving always heads toward
an edge, so if turns do too, no street can end up waiting on itself.

## Avenues

In chill mode the east-west roads are avenues: two lanes each way split by a median, about 20%
faster than the side streets. Left turns go from the inner lane and right turns from the curb
lane, so a car that wants to turn signals and moves over first (if it can't before the light, it
goes straight). Cars also change lanes to pass, usually around a waiting left-turner or into a
shorter queue. A lane change needs a real gap (the car behind must be able to brake) and, past a
light, a free space in that lane's stretch, the same bookkeeping as "don't block the box", so it
can't cause gridlock. While a car slides over it still counts as being in both lanes.

## Left-turn arrows

Avenue left turns get a protected arrow. When the light is about to give the avenue green and
someone in a turn lane has been stopped for at least 6 seconds, it first shows a green arrow: the
light's ring goes green with a turn-arrow icon and only the inner (turn) lanes' stop lines go
green. Both directions turn at once; their curves bend early so they pass beside each other. Smart
lights end the arrow once the queue has cleared (2 to 8 s); Timer and Green wave give it 4 s.
After it, the normal green follows and lefts still go on gaps.

The trade-off, measured over a game day: arrows cut the worst left-turn waits a lot (6 lights,
rush hour: longest 224 s down to 75 s, 90th percentile 71 s down to 48 s) but everyone else waits
a few seconds longer on a typical trip. Triggering on any waiting left-turner instead of 6 s
cost everyone much more. The **Left arrows On/Off** switch in the controls flips them live, so
you can watch the average-wait chart move.

## Light strategies

- **Smart:** a light switches when more cars wait on the red side (green lasts 3–20 s).
- **Timer:** 10 s each way, every light on its own random offset.
- **Green wave:** same 10 s / 10 s cycle, but each light's east-west green starts later the further
  east it is, by the time a car needs to drive there. Eastbound groups hit green after green.
  At rush hour on 6 lights it beats Smart (about 5 s vs 6.5 s average wait).

## Testing

`index.html?hour=21` starts the day at 9 PM, handy for checking the night look.

## Tuning

Difficulty settings are in `CONFIG` at the top of `sim.js` (`spawnBase`, `spawnGrowth`,
`spawnMax`, `roadSchedule`). Chill mode's self-running lights use `autoMinGreen`,
`autoMaxGreen` and `autoCheckEvery`, and its road layouts are `LAYOUTS`. With the current values the bot lasts about 5.5 minutes
when it reacts every 0.5–1 s, and about 3.7 minutes when it reacts every 2 s.
