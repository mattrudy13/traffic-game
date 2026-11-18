/*
 * Green Wave simulation: the rules of the game with no drawing in it.
 * game.js draws it in the browser; tune.js runs it in Node to check the difficulty.
 *
 * Coordinates: the map is CONFIG.width x CONFIG.height "world pixels".
 * A side street has one lane each way. In chill mode the east-west roads are avenues with two
 * lanes each way (an inner lane by the median and a curb lane), split by a median.
 * A car's position is `s`, the distance its FRONT has travelled along its lane
 * from the edge where it entered.
 */
(function (root) {
  'use strict';

  var CONFIG = {
    width: 1280,
    height: 680,
    roadWidth: 56,
    carLength: 24,
    carWidth: 12,
    minGap: 7,          // bumper-to-bumper space a stopped car leaves
    maxSpeed: 140,      // world px per second
    accel: 150,         // px/s² when speeding up
    brake: 450,         // px/s² braking used by the safe-speed rule
    stopGap: 4,         // space between the stop line and the intersection box
    amberTime: 1.5,
    allRedTime: 0.6,    // both ways red so cars already in the box can clear it
    maxOffMap: 3,       // cars stuck waiting off the map on one lane = game over
    // Cars per second arriving on each lane that enters the map. It ramps up over time.
    spawnBase: 0.12,
    spawnGrowth: 0.0012,   // tuned with tune.js: a quick bot lasts ~5.5 min, a slow one ~3.7
    spawnMax: 0.6,
    // Roads open over time. `pos` is a fraction of the map's width (v) or height (h).
    // The map is wide and short, so it gets 3 north-south roads but only 2 east-west ones:
    // a third east-west road left only ~3 car lengths at the edges and the game fell apart.
    roadSchedule: [
      { at: 0, axis: 'v', pos: 0.5 },
      { at: 0, axis: 'h', pos: 0.36 },
      { at: 35, axis: 'v', pos: 0.22 },
      { at: 80, axis: 'h', pos: 0.68 },
      { at: 140, axis: 'v', pos: 0.78 }
    ],
    // Chill mode: lights switch themselves. A green light is checked every `autoCheckEvery`
    // seconds once it has been green for `autoMinGreen`, and gives way to the red side when
    // more cars are waiting there (or after `autoMaxGreen` if anyone is waiting at all).
    autoCheckEvery: 0.5,
    autoMinGreen: 3,
    autoMaxGreen: 20,
    chillMaxOffMap: 4,   // in chill mode extra arrivals are just dropped, so a jam can't grow forever
    manualHold: 8,       // seconds a light you clicked is left alone before the strategy takes over again
    // Timer and green-wave lights run a fixed cycle: half of it green each way.
    cycleTime: 20,
    // Green wave: each light's east-west green starts later the further east it is, by the time a
    // car needs to drive there. A group of cars leaving on green then meets green all the way across.
    waveSpeedFactor: 0.85,
    // Chill mode's day: one game day lasts `dayLength` seconds and starts at `dayStartHour`.
    dayLength: 360,
    dayStartHour: 6.5,
    waitWindow: 60,      // average wait is over cars that left the map in the last N seconds
    // Turning (chill mode only). At each light where it may turn, a car turns 35% of the time,
    // split between left and right in these proportions.
    turnLeft: 0.15,
    turnRight: 0.2,
    leftTurnSpeed: 60,   // px/s through the corner; left turns are wider so a bit faster
    rightTurnSpeed: 45,
    gapTime: 2.5,        // a left-turner needs oncoming cars to be at least this many seconds away
    // Avenues (chill mode's east-west roads).
    avenueLaneWidth: 24,
    avenueMedian: 10,
    avenueSpeedFactor: 1.2,   // avenues are about 20% faster than side streets
    laneChangeTime: 0.7,      // seconds a lane change takes to draw
    laneChangeCooldown: 2.5,  // a car that just changed lanes waits this long before passing again
    laneChangeStopGap: 30,    // no lane changes this close to a stop line
    // Left-turn arrows (avenue lefts only). Before an avenue's green, if someone is waiting to
    // turn left there, the light shows a green arrow: only avenue left turns may go. Smart lights
    // keep it until the turners have gone (between arrowMin and arrowMax seconds); timer and
    // green-wave lights give it a fixed arrowTime. After it, lefts still go on gaps as usual.
    arrows: true,
    arrowMin: 2,
    arrowMax: 8,
    arrowTime: 4,
    arrowReach: 150,          // a left-turner this close to the line counts as waiting for an arrow
    arrowAfterWait: 6         // ...once it has been stopped this many seconds (tested: 0 s cost
                              // everyone a lot of waiting, 6 s keeps most of the benefit)
  };

  // How busy the city is at each hour, as a multiple of the traffic slider. Points are
  // [hour, multiplier] and the curve is straight lines between them: two rush hours, a quiet night.
  var DAY_TRAFFIC = [
    [0, 0.2], [5, 0.2], [6.5, 0.6], [8, 1.6], [9.5, 0.9], [12, 1.0], [15, 1.0],
    [17.5, 1.7], [19, 0.9], [21, 0.5], [23, 0.25], [24, 0.2]
  ];

  // Traffic kinds (chill and compare modes). Each changes the shape of the day.
  //  normal:       DAY_TRAFFIC, busier and quieter lanes picked at random.
  //  commute:      the same day, but mornings most avenue traffic heads east ("into town") and
  //                evenings it heads back west. COMMUTE_BIAS is +1 at the morning peak, -1 at the evening one.
  //  stadium:      a quieter day, then a night game lets out and a crowd floods in from the north-east
  //                corner: southbound on the east-most street and westbound on the top avenue.
  //  sunday:       no rush hours, light all day, and more people turning.
  //  construction: the lower avenue's eastbound curb lane is closed past its first light.
  var KINDS = ['normal', 'commute', 'stadium', 'sunday', 'construction'];
  var SUNDAY_TRAFFIC = [[0, 0.2], [6, 0.25], [10, 0.75], [17, 0.75], [21, 0.45], [24, 0.2]];
  var COMMUTE_BIAS = [[0, 0], [6, 0], [8, 1], [10, 0.6], [12, 0], [15, 0], [17.5, -1], [19.5, -0.4], [21, 0], [24, 0]];
  var COMMUTE_STRENGTH = 0.9;      // morning eastbound lanes get e^0.9 ≈ 2.5x, westbound e^-0.9 ≈ 0.4x
  var STADIUM_DAY = 0.85;          // the rest of a stadium day is a bit quieter than normal
  var STADIUM_BURST = [[0, 0], [21.25, 0], [21.5, 1], [22.5, 1], [23.25, 0], [24, 0]];
  var STADIUM_BOOST = 3;           // extra arrivals per crowd lane at the peak, as a multiple of the traffic slider
  var SUNDAY_TURNS = { turnLeft: 0.22, turnRight: 0.28 };

  // Road layouts for chill mode, keyed by the number of lights they make. The east-west roads
  // are avenues.
  var LAYOUTS = {
    1: [['v', 0.5], ['h', 0.5]],
    2: [['v', 0.3], ['v', 0.7], ['h', 0.5]],
    4: [['v', 0.3], ['v', 0.7], ['h', 0.34], ['h', 0.68]],
    6: [['v', 0.22], ['v', 0.5], ['v', 0.78], ['h', 0.34], ['h', 0.68]]
  };
  var HEADING = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

  // Which axis each travel direction uses, and which edge it enters from.
  var AXIS = { E: 'ew', W: 'ew', N: 'ns', S: 'ns' };
  var ENTRY_EDGE = { E: 'west', W: 'east', S: 'north', N: 'south' };
  var OPPOSITE = { E: 'W', W: 'E', N: 'S', S: 'N' };
  // Which way a car ends up heading after a left or right turn (y grows downward on screen).
  var LEFT_OF = { E: 'N', N: 'W', W: 'S', S: 'E' };
  var RIGHT_OF = { E: 'S', S: 'W', W: 'N', N: 'E' };

  // Seeded random numbers (mulberry32), so a city can be replayed exactly.
  function seeded(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Mixes a seed with some whole numbers into a new seed, for one lane's or one car's own stream.
  function mixSeed(seed) {
    var h = seed >>> 0;
    for (var i = 1; i < arguments.length; i++) {
      h = Math.imul(h ^ (arguments[i] >>> 0), 0x9E3779B1);
      h ^= h >>> 15;
    }
    return h >>> 0;
  }

  function createGame(options) {
    var cfg = Object.assign({}, CONFIG, options || {});
    var g = {
      cfg: cfg,
      // With a seed, setup (lane busyness, first light directions, Timer offsets) is seeded too.
      rng: cfg.rng || (cfg.seed !== undefined ? seeded(mixSeed(cfg.seed, 0x5e7)) : Math.random),
      time: 0,
      score: 0,
      over: false,
      overReason: '',
      roads: [],
      lights: [],
      lanes: [],
      nextRoad: 0,
      nextId: 1,
      events: [],
      chill: false,        // chill mode: no losing, lights run themselves
      traffic: null,       // chill mode: base arrival rate per lane (cars/s) instead of the ramp
      strategy: 'smart',   // chill mode: smart | timer | wave
      kind: 'normal',      // traffic kind (see KINDS)
      autoTimer: 0,
      exits: [],           // {t, wait} for cars that recently left the map
      tally: { count: 0, sum: 0, worst: 0 }   // every trip since resetTally (compare mode's "today")
    };
    // Arrivals and turn choices come from their own streams per lane and per car, not from g.rng.
    // Why: compare mode runs two cities with different lights side by side. If both drew from one
    // shared stream, a light strategy that used one extra number (Timer's random offsets) would
    // shift every car after it and the two cities would get different traffic. With a stream per
    // lane, arrivals depend only on the seed and the clock; with one per car, the 5th car on a
    // lane makes the same turns in both cities.
    g.seed = cfg.seed !== undefined ? cfg.seed >>> 0 : Math.floor(g.rng() * 4294967296);
    openDueRoads(g);
    return g;
  }

  // A relaxed game: all roads for the chosen layout are open from the start.
  function createChill(lights, traffic, options) {
    var layout = LAYOUTS[lights] || LAYOUTS[4];
    var kind = options && KINDS.indexOf(options.kind) >= 0 ? options.kind : 'normal';
    var g = createGame(Object.assign({}, kind === 'sunday' ? SUNDAY_TURNS : {}, options, {
      roadSchedule: layout.map(function (r) { return { at: 0, axis: r[0], pos: r[1], avenue: r[0] === 'h' }; })
    }));
    g.chill = true;
    g.traffic = traffic;
    g.kind = kind;
    if (kind === 'stadium') setUpStadium(g);
    if (kind === 'construction') setUpConstruction(g);
    setStrategy(g, (options && options.strategy) || 'smart');
    return g;
  }

  // The crowd comes out of the stadium in the north-east block, onto the two roads beside it.
  function setUpStadium(g) {
    var east = maxBy(g.roads.filter(function (r) { return r.axis === 'v'; }), function (r) { return r.c; });
    var top = maxBy(g.roads.filter(function (r) { return r.axis === 'h'; }), function (r) { return -r.c; });
    g.lanes.forEach(function (lane) {
      lane.crowd = (lane.road === east && lane.dir === 'S') || (lane.road === top && lane.dir === 'W');
    });
    // The block it stands in, for drawing.
    g.stadium = { x0: east.c + east.half, y1: top.c - top.half };
  }

  // Close the lower avenue's eastbound curb lane on the stretch past its first light.
  // That stretch gets no room at all (hasSpace says no), so straight cars in the curb lane merge
  // into the inner lane before the light; right turns from it still go. Turns only ever lead onto
  // streets out of the city, so nobody turns into the closed stretch, and the "don't block the
  // box" rule keeps working: a car never enters an intersection it can't leave.
  function setUpConstruction(g) {
    var low = maxBy(g.roads.filter(function (r) { return r.axis === 'h'; }), function (r) { return r.c; });
    var lane = g.lanes.filter(function (l) { return l.road === low && l.dir === 'E' && l.position === 'curb'; })[0];
    if (!lane || !lane.stops.length) return;
    var stop = lane.stops[0];
    stop.closed = true;
    g.construction = { lane: lane, stop: stop, from: stop.boxEnd, to: isFinite(stop.segmentEnd) ? stop.segmentEnd : lane.length };
  }

  function maxBy(list, f) {
    return list.reduce(function (best, x) { return best === null || f(x) > f(best) ? x : best; }, null);
  }

  function setTraffic(g, rate) {
    g.traffic = rate;
  }

  // Turn left-turn arrows on or off. A light showing an arrow right now moves on to its green.
  function setArrows(g, on) {
    g.cfg.arrows = on;
    if (on) return;
    g.lights.forEach(function (l) {
      if (l.phase === 'arrow') { l.phase = 'green'; l.greenFor = 0; }
    });
  }

  function setStrategy(g, strategy) {
    g.strategy = strategy;
    var cfg = g.cfg;
    // The wave runs east-west, so it is timed to the speed of the east-west roads.
    var ewSpeed = cfg.maxSpeed * (g.roads.some(function (r) { return r.avenue; }) ? cfg.avenueSpeedFactor : 1);
    var waveSpeed = ewSpeed * cfg.waveSpeedFactor;
    g.lights.forEach(function (l) {
      // Timer lights are not coordinated (random offsets); wave lights are offset by distance.
      l.offset = strategy === 'wave' ? l.x / waveSpeed : g.rng() * cfg.cycleTime;
      l.holdUntil = 0;
    });
  }

  // ---------------------------------------------------------------- time of day

  function hourOfDay(g) {
    return (g.cfg.dayStartHour + g.time / g.cfg.dayLength * 24) % 24;
  }

  // Straight lines between [hour, value] points.
  function curveAt(points, hour) {
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      if (hour <= b[0]) return a[1] + (b[1] - a[1]) * (hour - a[0]) / (b[0] - a[0]);
    }
    return points[0][1];
  }

  function dayTraffic(hour) {
    return curveAt(DAY_TRAFFIC, hour);
  }

  // Is the stadium crowd on its way out (0 = no, 1 = at its peak)?
  function stadiumCrowd(g) {
    return g.kind === 'stadium' ? curveAt(STADIUM_BURST, hourOfDay(g)) : 0;
  }

  // A short note on what the traffic kind is doing right now, for the strip (or null).
  function kindNote(g) {
    var hour = hourOfDay(g);
    if (g.kind === 'stadium') {
      if (stadiumCrowd(g) > 0) return 'game letting out';
      if (hour >= 19 && hour < 21.25) return 'game on';
    }
    if (g.kind === 'commute') {
      var b = curveAt(COMMUTE_BIAS, hour);
      if (b > 0.3) return 'commute into town';
      if (b < -0.3) return 'commute home';
    }
    if (g.kind === 'construction') return 'lane closed';
    return null;
  }

  // 0 = full daylight, 1 = full night, with an hour or two of dusk and dawn in between.
  function darkness(hour) {
    if (hour < 5 || hour >= 20.5) return 1;
    if (hour < 7) return 1 - (hour - 5) / 2;
    if (hour >= 18.5) return (hour - 18.5) / 2;
    return 0;
  }

  function dayPhase(hour) {
    if (hour < 5) return 'night';
    if (hour < 7) return 'early morning';
    if (hour < 9.5) return 'morning rush';
    if (hour < 15.5) return 'midday';
    if (hour < 19) return 'evening rush';
    if (hour < 21.5) return 'evening';
    return 'night';
  }

  // Start counting trips afresh (compare mode does this at midnight).
  function resetTally(g) {
    g.tally = { count: 0, sum: 0, worst: 0 };
  }

  // Average seconds stopped per trip, over cars that left in the last `waitWindow` seconds.
  function averageWait(g) {
    if (!g.exits.length) return null;
    var sum = 0;
    g.exits.forEach(function (e) { sum += e.wait; });
    return sum / g.exits.length;
  }

  // ---------------------------------------------------------------- roads and lanes

  function openDueRoads(g) {
    var schedule = g.cfg.roadSchedule;
    var opened = [];
    while (g.nextRoad < schedule.length && schedule[g.nextRoad].at <= g.time) {
      var r = schedule[g.nextRoad++];
      var size = r.axis === 'v' ? g.cfg.width : g.cfg.height;
      var avenue = !!r.avenue;
      var road = {
        axis: r.axis, c: Math.round(r.pos * size), avenue: avenue,
        // Half the road's width: two 28 px lanes for a street, four lanes plus a median for an avenue.
        half: avenue ? g.cfg.avenueMedian / 2 + 2 * g.cfg.avenueLaneWidth : g.cfg.roadWidth / 2
      };
      g.roads.push(road);
      opened.push(road);
    }
    if (!opened.length) return;

    opened.forEach(function (road) { addLanes(g, road); });
    rebuildIntersections(g, opened);
    // Busier and quieter lanes change whenever the map changes, so the player has to rebalance.
    g.lanes.forEach(function (lane) { lane.weight = 0.6 + g.rng() * 0.8; });
    if (g.time > 0) g.events.push({ type: 'road' });
  }

  // Lanes keep to the right: eastbound and northbound on the side of larger x / y respectively
  // (screen y grows downward, so eastbound is the south half of an east-west road).
  function addLanes(g, road) {
    var cfg = g.cfg, lo = cfg.roadWidth / 4;
    var specs;
    if (road.avenue) {
      var inner = cfg.avenueMedian / 2 + cfg.avenueLaneWidth / 2, curb = inner + cfg.avenueLaneWidth;
      specs = road.axis === 'v'
        ? [['S', -inner, 'inner'], ['S', -curb, 'curb'], ['N', inner, 'inner'], ['N', curb, 'curb']]
        : [['E', inner, 'inner'], ['E', curb, 'curb'], ['W', -inner, 'inner'], ['W', -curb, 'curb']];
    } else {
      specs = road.axis === 'v' ? [['S', -lo, 'single'], ['N', lo, 'single']] : [['E', lo, 'single'], ['W', -lo, 'single']];
    }
    var added = [];
    specs.forEach(function (d) {
      var lane = {
        id: g.lanes.length,
        dir: d[0],
        axis: AXIS[d[0]],
        road: road,
        coord: road.c + d[1],
        position: d[2],      // inner | curb on avenues, single on streets
        width: road.avenue ? cfg.avenueLaneWidth : cfg.roadWidth / 2,
        maxSpeed: cfg.maxSpeed * (road.avenue ? cfg.avenueSpeedFactor : 1),
        sibling: null,       // the other lane going the same way, on avenues
        length: road.axis === 'v' ? cfg.height : cfg.width,
        cars: [],            // front-most car first
        stops: [],
        offMap: 0,           // cars that arrived but have no room to enter yet
        pending: [],         // their arrival numbers, oldest first (offMap === pending.length)
        arrivals: 0,
        rng: seeded(mixSeed(g.seed, g.lanes.length)),
        weight: 1
      };
      // Expected arrivals still to come before the next car (see spawnCars).
      lane.spawnTimer = lane.rng();
      g.lanes.push(lane);
      added.push(lane);
    });
    added.forEach(function (a) {
      added.forEach(function (b) { if (a !== b && a.dir === b.dir) a.sibling = b; });
    });
  }

  function rebuildIntersections(g, opened) {
    var cfg = g.cfg;
    var byKey = {};
    g.lights.forEach(function (l) { byKey[l.key] = l; });

    var vRoads = g.roads.filter(function (r) { return r.axis === 'v'; });
    var hRoads = g.roads.filter(function (r) { return r.axis === 'h'; });
    var lights = [];
    vRoads.forEach(function (v) {
      hRoads.forEach(function (hr) {
        var key = v.c + ',' + hr.c;
        var light = byKey[key];
        if (!light) {
          // A new road starts on red so traffic already on the map keeps flowing.
          var newIsVertical = opened.indexOf(v) >= 0 && opened.indexOf(hr) < 0;
          var newIsHorizontal = opened.indexOf(hr) >= 0 && opened.indexOf(v) < 0;
          var axis = newIsVertical ? 'ew' : newIsHorizontal ? 'ns' : (g.rng() < 0.5 ? 'ns' : 'ew');
          light = {
            key: key, x: v.c, y: hr.c, hx: v.half, hy: hr.half, axis: axis, phase: 'green', timer: 0, greenFor: 0,
            busy: { ns: false, ew: false }, leftIn: {}, throughIn: {}, incoming: {},
            avenue: hr.avenue      // east-west avenue here, so this light can show a left-turn arrow
          };
        }
        lights.push(light);
      });
    });
    g.lights = lights;
    byKey = {};
    lights.forEach(function (l) { byKey[l.key] = l; });

    // Each lane gets one stop per road it crosses, in the order the car meets them.
    g.lanes.forEach(function (lane) {
      var crossing = lane.axis === 'ew' ? vRoads : hRoads;
      lane.stops = crossing.map(function (road) {
        var start, end, h = road.half;
        if (lane.dir === 'E' || lane.dir === 'S') {
          start = road.c - h; end = road.c + h;
        } else {
          start = lane.length - (road.c + h); end = lane.length - (road.c - h);
        }
        var key = lane.axis === 'ew' ? road.c + ',' + lane.road.c : lane.road.c + ',' + road.c;
        return { line: start - cfg.stopGap, boxStart: start, boxEnd: end, light: byKey[key] };
      }).sort(function (a, b) { return a.line - b.line; });
      // How many cars fit between this intersection and the next stop line (the map edge for the last one).
      lane.stops.forEach(function (stop, i) {
        var next = lane.stops[i + 1];
        stop.segmentEnd = next ? next.line : Infinity;
        stop.capacity = next ? Math.floor((next.line - stop.boxEnd + cfg.minGap) / (cfg.carLength + cfg.minGap)) : Infinity;
      });
    });

    // For every stop: the oncoming lanes at the same light, and the curve for each possible turn.
    // A turn onto an avenue ends in the lane on the same side: lefts in the inner lane, rights in
    // the curb lane (like real drivers are supposed to).
    function laneAt(road, dir, turn) {
      var found = g.lanes.filter(function (l) { return l.road === road && l.dir === dir; });
      if (found.length < 2) return found[0] || null;
      var want = turn === 'left' ? 'inner' : 'curb';
      return found.filter(function (l) { return l.position === want; })[0];
    }
    function stopFor(lane, light) {
      for (var i = 0; i < lane.stops.length; i++) if (lane.stops[i].light === light) return lane.stops[i];
      return null;
    }
    g.lanes.forEach(function (lane) {
      lane.stops.forEach(function (stop) {
        var light = stop.light;
        var crossRoad = null;
        g.roads.forEach(function (r) {
          if (r.axis !== lane.road.axis && (r.axis === 'v' ? r.c === light.x : r.c === light.y)) crossRoad = r;
        });
        stop.oncoming = g.lanes.filter(function (l) {
          return l.road === lane.road && l.dir === OPPOSITE[lane.dir];
        }).map(function (l) { return { lane: l, stop: stopFor(l, light) }; });
        stop.turns = {};
        [['left', LEFT_OF], ['right', RIGHT_OF]].forEach(function (t) {
          var to = laneAt(crossRoad, t[1][lane.dir], t[0]);
          var toStop = to && stopFor(to, light);
          if (to && toStop) stop.turns[t[0]] = { lane: to, stop: toStop, arc: makeArc(lane, stop, to, toStop, t[0]) };
        });
      });
    });

    // Plans point at stops, which were just rebuilt: give every car not mid-turn a fresh plan.
    g.lanes.forEach(function (lane) {
      lane.cars.forEach(function (car) {
        if (!isTurning(car)) car.plan = makePlan(g, lane, car.s, null, car.rng);
      });
    });
  }

  // ---------------------------------------------------------------- lights

  function flip(g, light) {
    if (g.over || !light || (light.phase !== 'green' && light.phase !== 'arrow')) return false;
    light.phase = 'amber';
    light.timer = g.cfg.amberTime;
    return true;
  }

  // Light phases, in order: green -> amber -> allred -> (arrow ->) green the other way.
  function updateLights(g, dt) {
    g.lights.forEach(function (l) {
      if (l.phase === 'green') {
        l.greenFor += dt;
        return;
      }
      if (l.phase === 'arrow') l.greenFor += dt;
      l.timer -= dt;
      if (l.timer > 0) return;
      if (l.phase === 'amber') {
        l.phase = 'allred';
        l.timer = g.cfg.allRedTime;
      } else if (l.phase === 'arrow') {
        l.phase = 'green';
        l.greenFor = 0;
      } else {
        l.axis = l.axis === 'ns' ? 'ew' : 'ns';
        l.greenFor = 0;
        if (g.cfg.arrows !== false && l.axis === 'ew' && l.avenue && leftTurnersWaiting(g, l)) {
          l.phase = 'arrow';
          l.timer = g.strategy === 'smart' ? g.cfg.arrowMax : g.cfg.arrowTime;
        } else {
          l.phase = 'green';
        }
      }
    });
  }

  // Is anyone queued to turn left off the avenue at this light?
  function leftTurnersWaiting(g, light) {
    return g.lanes.some(function (lane) {
      if (!lane.road.avenue || lane.axis !== 'ew') return false;
      return lane.cars.some(function (c) {
        var p = c.plan;
        return p && p.turn === 'left' && p.stop.light === light && c.s <= p.stop.line + 0.001 &&
          p.stop.line - c.s < g.cfg.arrowReach && c.v < 20 && c.wait >= g.cfg.arrowAfterWait;
      });
    });
  }

  function lightAt(g, x, y, radius) {
    var best = null, bestD = radius * radius;
    g.lights.forEach(function (l) {
      var d = (l.x - x) * (l.x - x) + (l.y - y) * (l.y - y);
      if (d <= bestD) { best = l; bestD = d; }
    });
    return best;
  }

  // Record what is inside each intersection box right now: which axes are busy, which
  // directions have a left-turner or another car in the box, and how many turning cars are
  // about to join each lane (they already hold a space there).
  function markBoxes(g) {
    g.lights.forEach(function (l) {
      l.busy.ns = false; l.busy.ew = false;
      l.leftIn = {}; l.throughIn = {}; l.incoming = {};
    });
    g.lanes.forEach(function (lane) {
      lane.cars.forEach(function (car) {
        var plan = car.plan, rear = car.s - car.len;
        var turning = isTurning(car);
        if (turning) {
          var L = plan.stop.light;
          L.busy[lane.axis] = true;
          if (plan.turn === 'left') L.leftIn[lane.dir] = true;
          else L.throughIn[lane.dir] = true;
          L.incoming[plan.target.id] = (L.incoming[plan.target.id] || 0) + 1;
        }
        lane.stops.forEach(function (stop) {
          if (turning && stop === plan.stop) return;
          if (car.s > stop.boxStart && rear < stop.boxEnd) {
            stop.light.busy[lane.axis] = true;
            stop.light.throughIn[lane.dir] = true;
          }
        });
      });
    });
  }

  // ---------------------------------------------------------------- cars

  function nextStop(lane, s) {
    for (var i = 0; i < lane.stops.length; i++) {
      if (lane.stops[i].line >= s - 0.001) return lane.stops[i];
    }
    return null;
  }

  // What a car will do at the next light on its lane: go straight, or turn onto a cross street.
  //
  // Cars only turn onto a street that leads straight out of the city (no more lights ahead on it).
  // Why: with turns allowed everywhere, the four streets around a block could all fill up while
  // each one's front car waited to turn into the next full one. That is a circular wait, and
  // nothing could ever move again. Going straight always heads toward an edge, so if turns also
  // only lead toward an edge, no street can end up waiting on itself and gridlock is impossible.
  function makePlan(g, lane, s, forced, rng) {
    var stop = nextStop(lane, s);
    if (!stop) return null;
    var turn = forced || 'straight';
    if (!forced && g.chill) {
      var cfg = g.cfg;
      var canLeft = stop.turns.left && stop.turns.left.stop.capacity === Infinity && !stop.turns.left.stop.closed;
      var canRight = stop.turns.right && stop.turns.right.stop.capacity === Infinity && !stop.turns.right.stop.closed;
      var leftWeight = canLeft ? cfg.turnLeft : 0, rightWeight = canRight ? cfg.turnRight : 0;
      // Keep the overall share of turning cars the same even when only one turn is allowed here.
      rng = rng || g.rng;
      var r = rng() * (leftWeight + rightWeight) / (cfg.turnLeft + cfg.turnRight);
      if (leftWeight + rightWeight > 0 && rng() < cfg.turnLeft + cfg.turnRight) {
        turn = r < leftWeight / (cfg.turnLeft + cfg.turnRight) ? 'left' : 'right';
      }
    }
    if (turn === 'straight') return { stop: stop, turn: 'straight' };
    // On an avenue, lefts go from the inner lane and rights from the curb lane. A car in the
    // other lane goes straight for now and tries to change lanes; `want` remembers the turn.
    var from = turnLane(lane, turn);
    if (from !== lane) return { stop: stop, turn: 'straight', want: turn };
    var t = stop.turns[turn];
    if (!t) return { stop: stop, turn: 'straight' };
    return { stop: stop, turn: turn, target: t.lane, targetStop: t.stop, arc: t.arc };
  }

  function turnLane(lane, turn) {
    if (!lane.sibling) return lane;
    var want = turn === 'left' ? 'inner' : 'curb';
    return lane.position === want ? lane : lane.sibling;
  }

  // A car that has crossed the stop line and is driving its curve (until it joins the new lane).
  function isTurning(car) {
    return !!car.plan && car.plan.turn !== 'straight' && car.s > car.plan.stop.line;
  }

  // The car this one must not hit. Straight cars follow whoever is ahead in the lane. A turning
  // car ignores cars that have gone all the way through the intersection, since they're no longer
  // on its path. It still follows a car that is in the box (a turn starts out going straight
  // ahead, so it could catch a slow car there) and any car ahead of it on the same curve.
  function findLeader(cars, i, car) {
    var plan = car.plan;
    if (!plan || plan.turn === 'straight') return i > 0 ? cars[i - 1] : null;
    for (var j = i - 1; j >= 0; j--) {
      var other = cars[j];
      var sameCurve = other.plan && other.plan.stop === plan.stop && other.plan.turn === plan.turn;
      if (sameCurve || other.s - other.len < plan.stop.boxEnd) return other;
    }
    return null;
  }

  // Is there a guaranteed space for one more car after this intersection on `lane`?
  // Cars already past the line on that stretch, and turning cars heading onto it, each hold a space.
  function hasSpace(lane, stop) {
    if (stop.closed) return false;
    if (stop.capacity === Infinity) return true;
    var taken = stop.light.incoming[lane.id] || 0;
    for (var i = 0; i < lane.cars.length; i++) {
      var c = lane.cars[i];
      if (c.s > stop.line + 0.001 && c.s <= stop.segmentEnd + 0.5) taken++;
    }
    return taken < stop.capacity;
  }

  // A left turn crosses the oncoming lane, so it needs a gap: nothing oncoming in the box, and
  // nothing arriving within `gapTime` seconds. Oncoming left-turners don't count (their paths
  // don't cross ours).
  function gapClear(g, stop) {
    for (var k = 0; k < stop.oncoming.length; k++) {
      var on = stop.oncoming[k];
      for (var i = 0; i < on.lane.cars.length; i++) {
        var c = on.lane.cars[i];
        if (c.plan && c.plan.stop === on.stop && c.plan.turn === 'left' && c.s <= on.stop.line) continue;
        if (c.s > on.stop.line) {
          if (c.s - c.len < on.stop.boxEnd + 2) return false;
        } else if (c.v > 5 && on.stop.line - c.s < c.v * g.cfg.gapTime) {
          return false;
        }
      }
    }
    return true;
  }

  // May this car drive past the stop line it is approaching?
  function mayEnter(g, lane, stop, car) {
    var cfg = g.cfg, light = stop.light, plan = car.plan;
    var opposite = OPPOSITE[lane.dir];
    if (light.axis !== lane.axis || light.phase === 'allred') return false;
    if (light.phase === 'arrow') {
      // Only avenue left turns go on the arrow. Oncoming traffic is held, so no gap is needed,
      // but opposite left turns still take turns and the new lane must have room.
      if (plan.turn !== 'left' || !lane.road.avenue) return false;
      if (light.busy[lane.axis === 'ns' ? 'ew' : 'ns']) return false;
      return hasSpace(plan.target, plan.targetStop);
    }
    if (light.phase === 'amber') {
      // A left-turner already waiting at the line may finish its turn on amber, like real drivers
      // do when oncoming traffic stops. Otherwise only keep going if too close to stop comfortably.
      var waitingLeft = plan.turn === 'left' && car.v < 5 && stop.line - car.s < 2;
      var dist = stop.line - car.s;
      var stoppingDistance = car.v * car.v / (2 * cfg.brake);
      if (!waitingLeft && (car.v < 20 || dist > stoppingDistance)) return false;
    }
    // Cross traffic that entered before the light changed still has to clear the box.
    if (light.busy[lane.axis === 'ns' ? 'ew' : 'ns']) return false;
    // A left-turner from the other side is crossing our path (or turning into our corner).
    if (light.leftIn[opposite]) return false;
    if (plan.turn === 'left') {
      if (light.throughIn[opposite] || !gapClear(g, stop)) return false;
    }
    // Don't block the box: only go if this car is guaranteed a space on the lane it ends up in.
    // (Checking only the car ahead wasn't enough: it could stop later and strand this car in the
    // box, and four stranded cars around a block froze the grid for good.)
    if (plan.turn === 'straight') return hasSpace(lane, stop);
    return hasSpace(plan.target, plan.targetStop);
  }

  // Can a car at the end of its curve slot into the new lane right now? It would sit just past
  // the box, so nothing on that lane may be within a car length (plus the usual gap) of there.
  function roomToJoin(g, car) {
    var lane = car.plan.target, at = car.plan.targetStop.boxEnd, gap = g.cfg.minGap;
    for (var i = 0; i < lane.cars.length; i++) {
      var c = lane.cars[i];
      if (c.s > at - car.len - gap && c.s - c.len < at + gap) return false;
    }
    return true;
  }

  function moveCars(g, lane, dt, joins) {
    var cfg = g.cfg, cars = lane.cars;
    for (var i = 0; i < cars.length; i++) {
      var car = cars[i], plan = car.plan;
      var leader = findLeader(cars, i, car);
      // `limit` is the furthest the car's front may go: the car ahead's rear, or a stop line.
      var limit = leader ? leader.s - leader.len - cfg.minGap : Infinity;
      // A car still sliding out of this lane is still partly in it, and a car sliding in is still
      // partly in its old lane, so it keeps clear of the car ahead there too.
      (lane.ghosts || []).forEach(function (gh) {
        if (gh.s > car.s) limit = Math.min(limit, gh.s - gh.len - cfg.minGap);
      });
      if (car.shift > 0.25 && car.oldLane) {
        car.oldLane.cars.forEach(function (o) {
          if (o.s > car.s) limit = Math.min(limit, o.s - o.len - cfg.minGap);
        });
      }
      var approaching = plan && car.s <= plan.stop.line + 0.001;
      if (approaching && !mayEnter(g, lane, plan.stop, car)) limit = Math.min(limit, plan.stop.line);

      var maxSpeed = lane.maxSpeed;
      if (plan && plan.turn !== 'straight') {
        var cornerSpeed = plan.turn === 'left' ? cfg.leftTurnSpeed : cfg.rightTurnSpeed;
        var curveEnd = plan.stop.boxStart + plan.arc.len;
        if (car.s > plan.stop.boxStart) {
          maxSpeed = cornerSpeed;
          if (!roomToJoin(g, car)) limit = Math.min(limit, curveEnd);
        } else {
          // Slow down for the corner: the same braking rule, aimed at corner speed at the box.
          var toBox = plan.stop.boxStart - car.s;
          maxSpeed = Math.min(maxSpeed, Math.sqrt(cornerSpeed * cornerSpeed + 2 * cfg.brake * toBox));
        }
      }

      // Safe-speed rule: from speed v a car needs v²/(2·brake) to stop, so the fastest
      // it can go and still stop within `room` is sqrt(2·brake·room).
      var room = Math.max(0, limit - car.s);
      var target = Math.min(maxSpeed, Math.sqrt(2 * cfg.brake * room));
      car.v = car.v < target ? Math.min(target, car.v + cfg.accel * dt) : target;

      var before = car.s;
      car.s = Math.min(car.s + car.v * dt, Math.max(car.s, limit));
      if (car.v < 10) {
        car.wait += dt;
        car.totalWait += dt;
      }
      if (plan && before <= plan.stop.line && car.s > plan.stop.line) {
        // Through the light: waiting time is per light, so it resets. Mark the box right away so
        // cars checking later in this same step see this car in it.
        car.wait = 0;
        var L = plan.stop.light;
        L.busy[lane.axis] = true;
        if (plan.turn === 'left') L.leftIn[lane.dir] = true;
        else L.throughIn[lane.dir] = true;
        // Plan for the next light. (Look from just past this stop line: a car that crossed by a
        // hair would otherwise pick this same light again and never check the next one.)
        if (plan.turn === 'straight') car.plan = makePlan(g, lane, Math.max(car.s, plan.stop.line + 0.01), null, car.rng);
        // A turning car holds its space on the new lane from the moment it commits.
        else plan.stop.light.incoming[plan.target.id] = (plan.stop.light.incoming[plan.target.id] || 0) + 1;
      }
      if (plan && plan.turn !== 'straight' && car.s >= plan.stop.boxStart + plan.arc.len && roomToJoin(g, car)) {
        joins.push({ car: car, from: lane });
      }
    }
    while (cars.length && cars[0].s - cars[0].len > lane.length) {
      var gone = cars.shift();
      g.exits.push({ t: g.time, wait: gone.totalWait, id: gone.id });
      g.tally.count++;
      g.tally.sum += gone.totalWait;
      g.tally.worst = Math.max(g.tally.worst, gone.totalWait);
      g.score++;
    }
  }

  // Cars that finished a curve move onto their new lane, just past the intersection.
  function applyJoins(g, joins) {
    joins.forEach(function (j) {
      var car = j.car, plan = car.plan, lane = plan.target;
      // The curve may end a little off the new lane's heading; ease that out instead of snapping.
      var end = curvePoint(plan.arc, 1), d = end.angle - lanePoint(lane, 0).angle;  // heading at the curve's end
      car.settle = Math.atan2(Math.sin(d), Math.cos(d));
      j.from.cars.splice(j.from.cars.indexOf(car), 1);
      car.s = plan.targetStop.boxEnd;
      var at = 0;
      while (at < lane.cars.length && lane.cars[at].s > car.s) at++;
      lane.cars.splice(at, 0, car);
      car.plan = makePlan(g, lane, car.s, null, car.rng);
    });
  }

  // ---------------------------------------------------------------- lane changes (avenues)

  // Space in front of a car in its own lane, and in the other lane from the same spot.
  function roomAhead(lane, i, car) {
    return i > 0 ? lane.cars[i - 1].s - lane.cars[i - 1].len - car.s : Infinity;
  }

  function roomAheadIn(lane, s) {
    var best = Infinity;
    for (var i = 0; i < lane.cars.length; i++) {
      var c = lane.cars[i];
      if (c.s > s && c.s - c.len - s < best) best = c.s - c.len - s;
    }
    return best;
  }

  // The stop a car has already passed on this lane (null on the stretch before the first light).
  function stopBehind(lane, s) {
    var last = null;
    for (var i = 0; i < lane.stops.length; i++) if (lane.stops[i].line < s) last = i;
    return last;
  }

  // May `car` slide sideways into `target` right now? It needs a real gap (the car behind in
  // the new lane must be able to brake) and, past a light, a free space in that lane's stretch:
  // the same "don't block the box" bookkeeping, so a lane change can never overfill a stretch.
  function canMoveInto(g, target, car, fromLane) {
    var cfg = g.cfg;
    for (var i = 0; i < target.cars.length; i++) {
      var c = target.cars[i];
      if (c.s >= car.s) {
        if (c.s - c.len - car.s < cfg.minGap + 4) return false;
      } else if (car.s - car.len - c.s < cfg.minGap + c.v * 0.6) {
        return false;
      }
    }
    var behind = stopBehind(fromLane, car.s);
    if (behind !== null) {
      var stop = target.stops[behind];
      if (car.s - car.len < stop.boxEnd + 2) return false;   // still in the intersection
      if (!hasSpace(target, stop)) return false;
    }
    return true;
  }

  function changeLanes(g, dt) {
    var cfg = g.cfg, moves = [];
    g.lanes.forEach(function (lane) {
      // Forget cars that have mostly finished sliding out of this lane.
      if (lane.ghosts) lane.ghosts = lane.ghosts.filter(function (gh) { return gh.shift > 0.25 && lane.sibling.cars.indexOf(gh) >= 0; });
      lane.cars.forEach(function (car, i) {
        if (car.settle) car.settle = Math.abs(car.settle) < 0.01 ? 0 : car.settle * Math.pow(0.0001, dt / 0.35);
        if (car.shift > 0) car.shift = Math.max(0, car.shift - dt / car.shiftTime);
        if (car.cooldown > 0) car.cooldown -= dt;
        if (!lane.sibling || car.shift > 0 || car.s < 2 * car.len) return;
        var plan = car.plan;
        if (!plan || isTurning(car)) return;
        // The stretch past the next light is closed: a car going straight there has to merge,
        // even right at the line (it waits there for a gap in the other lane).
        if (plan.turn === 'straight' && !plan.want && plan.stop.closed) {
          moves.push({ car: car, from: lane, reason: 'merge' });
          return;
        }
        if (car.s > plan.stop.line - cfg.laneChangeStopGap) {
          // Too close to the light to move over: give up the turn and go straight instead.
          if (plan.want) car.plan = { stop: plan.stop, turn: 'straight' };
          return;
        }
        var reason = null;
        if (plan.want) reason = 'turn';
        else if (plan.turn === 'straight' && car.cooldown <= 0 && car.v < 0.6 * lane.maxSpeed) {
          // Stuck behind a slow or stopped car (often a waiting left-turner), with clearly more
          // room in the other lane: pass.
          var here = roomAhead(lane, i, car), there = roomAheadIn(lane.sibling, car.s);
          var ahead = nextStop(lane.sibling, car.s);
          if (here < 50 && there > here + 60 && !(ahead && ahead.closed)) reason = 'pass';
        }
        if (reason) moves.push({ car: car, from: lane, reason: reason });
      });
    });
    moves.forEach(function (m) {
      var car = m.car, from = m.from, to = from.sibling;
      if (from.cars.indexOf(car) < 0 || !canMoveInto(g, to, car, from)) return;
      from.cars.splice(from.cars.indexOf(car), 1);
      var at = 0;
      while (at < to.cars.length && to.cars[at].s > car.s) at++;
      to.cars.splice(at, 0, car);
      car.shift = 1;
      car.oldLane = from;
      car.shiftFrom = from.coord - to.coord;
      car.shiftTime = cfg.laneChangeTime;
      car.cooldown = cfg.laneChangeCooldown;
      car.plan = makePlan(g, to, car.s, m.reason === 'turn' ? car.plan.want : 'straight');
      (from.ghosts = from.ghosts || []).push(car);
    });
  }

  function spawnRate(g) {
    var cfg = g.cfg;
    if (g.traffic !== null) {
      var hour = hourOfDay(g);
      if (g.kind === 'sunday') return g.traffic * curveAt(SUNDAY_TRAFFIC, hour);
      if (g.kind === 'stadium') return g.traffic * dayTraffic(hour) * STADIUM_DAY;
      return g.traffic * dayTraffic(hour);
    }
    return Math.min(cfg.spawnMax, cfg.spawnBase + cfg.spawnGrowth * g.time);
  }

  // This lane's arrivals per second: the city-wide rate shaped by the traffic kind.
  function laneRate(g, lane, rate) {
    var r = rate * lane.weight;
    if (g.kind === 'commute' && lane.axis === 'ew') {
      var bias = curveAt(COMMUTE_BIAS, hourOfDay(g)) * COMMUTE_STRENGTH;
      r *= Math.exp(lane.dir === 'E' ? bias : -bias);
    }
    if (lane.crowd) r += g.traffic * STADIUM_BOOST * stadiumCrowd(g);
    return r;
  }

  function spawnCars(g, dt) {
    var cfg = g.cfg, rate = spawnRate(g);
    g.lanes.forEach(function (lane) {
      // The timer counts down in "expected arrivals", not seconds: it drops by this lane's current
      // rate times dt. A gap measured in seconds would be fixed at whatever the rate was when it was
      // drawn, so a late-night gap of ~15 s would hold back the stadium crowd for half its burst.
      // Counting this way follows the rate as it changes (a varying-rate Poisson process).
      lane.spawnTimer -= laneRate(g, lane, rate) * dt;
      if (lane.spawnTimer <= 0) {
        lane.arrivals++;
        if (!g.chill || lane.offMap < cfg.chillMaxOffMap) {
          lane.offMap++;
          lane.pending.push(lane.arrivals);
        }
        // Random gaps between arrivals (exponential), so traffic comes in clumps like real traffic.
        lane.spawnTimer += -Math.log(1 - lane.rng());
      }
      var last = lane.cars[lane.cars.length - 1];
      var hasRoom = (!last || last.s - last.len >= cfg.minGap) && !(lane.ghosts || []).some(function (gh) {
        return gh.s - gh.len < cfg.minGap;
      });
      if (lane.offMap > 0 && hasRoom) {
        lane.offMap--;
        var arrival = lane.pending.shift();
        var car = {
          id: g.nextId++,
          s: 0,
          v: last ? Math.min(cfg.maxSpeed, last.v) : cfg.maxSpeed * 0.8,
          len: cfg.carLength,
          wait: 0,        // seconds stopped at the current light (drives the car's color)
          totalWait: 0,   // seconds stopped over the whole trip (drives the average wait)
          arrival: arrival,   // this car's number among the lane's arrivals (same car in both compare cities)
          rng: seeded(mixSeed(g.seed, lane.id, arrival))
        };
        car.plan = makePlan(g, lane, 0, null, car.rng);
        lane.cars.push(car);
      }
    });
  }

  // ---------------------------------------------------------------- where to draw a car

  // Point on a lane's centre line, `s` px from where the lane enters the map.
  function lanePoint(lane, s) {
    switch (lane.dir) {
      case 'E': return { x: s, y: lane.coord, angle: HEADING.E };
      case 'W': return { x: lane.length - s, y: lane.coord, angle: HEADING.W };
      case 'S': return { x: lane.coord, y: s, angle: HEADING.S };
      default: return { x: lane.coord, y: lane.length - s, angle: HEADING.N };
    }
  }

  // Point and heading `back` px behind a car's front, following its curve if it is turning.
  function carPoint(lane, car, back) {
    var s = car.s - back, plan = car.plan;
    if (plan && plan.turn !== 'straight' && s > plan.stop.boxStart) {
      return curvePoint(plan.arc, curveT(plan.arc, s - plan.stop.boxStart));
    }
    var p = lanePoint(lane, s);
    if (car.settle) p.angle += car.settle;
    if (car.shift > 0) {
      // Mid lane change: drawn part of the way back toward the old lane, angled toward the new one.
      var off = car.shift * car.shiftFrom, sideways = -car.shiftFrom / car.shiftTime;
      var fx = Math.cos(p.angle), fy = Math.sin(p.angle), v = Math.max(car.v, 30);
      if (lane.axis === 'ew') { p.y += off; p.angle = Math.atan2(fy * v + sideways, fx * v); }
      else { p.x += off; p.angle = Math.atan2(fy * v, fx * v + sideways); }
    }
    return p;
  }

  // Which turn signal a car shows: for a planned turn as it nears the light (or while turning),
  // for a lane change it wants to make, and while changing lanes.
  function signal(lane, car, within) {
    var plan = car.plan;
    if (plan && plan.turn !== 'straight' && car.s > plan.stop.line - within) return plan.turn;
    if (plan && plan.want) return plan.want === 'left' ? 'left' : 'right';
    if (car.shift > 0.15) {
      // Moving toward larger y (screen down) is a right-hand move when heading east, etc.
      var toward = -car.shiftFrom;   // new lane minus old lane, across the road
      var rightIsPlus = lane.dir === 'E' || lane.dir === 'N';
      if (lane.axis === 'ns') rightIsPlus = lane.dir === 'N';
      return (toward > 0) === rightIsPlus ? 'right' : 'left';
    }
    return null;
  }

  // Quadratic Bézier from where the car enters the box to where it leaves on the new lane,
  // bending through the spot where the two lanes cross.
  function curvePoint(arc, t) {
    var u = 1 - t;
    var x = u * u * arc.p0.x + 2 * u * t * arc.c.x + t * t * arc.p2.x;
    var y = u * u * arc.p0.y + 2 * u * t * arc.c.y + t * t * arc.p2.y;
    var dx = 2 * u * (arc.c.x - arc.p0.x) + 2 * t * (arc.p2.x - arc.c.x);
    var dy = 2 * u * (arc.c.y - arc.p0.y) + 2 * t * (arc.p2.y - arc.c.y);
    return { x: x, y: y, angle: Math.atan2(dy, dx) };
  }

  // A left turn off an avenue starts bending early (control point a few px into the box rather
  // than where the lanes cross), so the two opposite left-turners pass beside each other instead of
  // crossing paths, the way real drivers do. That lets both go at once on an arrow.
  function makeArc(fromLane, fromStop, toLane, toStop, turn) {
    var p0 = lanePoint(fromLane, fromStop.boxStart), p2 = lanePoint(toLane, toStop.boxEnd);
    var c = fromLane.axis === 'ew' ? { x: toLane.coord, y: fromLane.coord } : { x: fromLane.coord, y: toLane.coord };
    if (turn === 'left' && fromLane.road.avenue) {
      // 14 px into the box keeps opposite turners about 19 px apart (cars are 12 px wide).
      var early = lanePoint(fromLane, fromStop.boxStart + 14);
      c = { x: early.x, y: early.y };
    }
    // Measure the curve in small steps. A Bézier's `t` doesn't move at an even speed along it
    // (especially with the early bend), so `dist` lets carPoint turn "px along the curve" into t.
    var arc = { p0: p0, c: c, p2: p2, len: 0, dist: [0] };
    var prev = p0, STEPS = 48;
    for (var i = 1; i <= STEPS; i++) {
      var p = curvePoint(arc, i / STEPS);
      arc.len += Math.hypot(p.x - prev.x, p.y - prev.y);
      arc.dist.push(arc.len);
      prev = p;
    }
    return arc;
  }

  // The t on the curve that lies `d` px from its start.
  function curveT(arc, d) {
    if (d <= 0) return 0;
    if (d >= arc.len) return 1;
    var n = arc.dist.length - 1, i = 1;
    while (arc.dist[i] < d) i++;
    var a = arc.dist[i - 1], b = arc.dist[i];
    return (i - 1 + (d - a) / (b - a)) / n;
  }

  // ---------------------------------------------------------------- queues and losing

  // How full each entry lane's first stretch (map edge to the first light) is.
  function edgeQueues(g) {
    var cfg = g.cfg;
    return g.lanes.map(function (lane) {
      var first = lane.stops[0];
      var stretch = first ? first.line : lane.length;
      var capacity = Math.max(1, Math.floor((stretch + cfg.minGap) / (cfg.carLength + cfg.minGap)));
      var queued = 0;
      lane.cars.forEach(function (car) {
        if (car.s <= stretch + 0.5 && car.v < 10) queued++;
      });
      return {
        lane: lane,
        edge: ENTRY_EDGE[lane.dir],
        queued: Math.min(queued, capacity),
        capacity: capacity,
        offMap: lane.offMap,
        // 0 = empty, 1 = the stretch is full, above 1 = cars stuck off the map
        pressure: Math.min(queued, capacity) / capacity + lane.offMap / cfg.maxOffMap
      };
    });
  }

  function checkLose(g) {
    g.lanes.forEach(function (lane) {
      if (g.over) return;
      var last = lane.cars[lane.cars.length - 1];
      if (lane.offMap >= g.cfg.maxOffMap && last && last.v < 5) {
        g.over = true;
        g.overReason = 'Traffic backed up off the ' + ENTRY_EDGE[lane.dir] + ' edge.';
      }
    });
  }

  function step(g, dt) {
    if (g.over) return;
    g.time += dt;
    openDueRoads(g);
    if (g.chill) autoSwitch(g, dt);
    updateLights(g, dt);
    changeLanes(g, dt);
    markBoxes(g);
    var joins = [];
    g.lanes.forEach(function (lane) { moveCars(g, lane, dt, joins); });
    applyJoins(g, joins);
    spawnCars(g, dt);
    while (g.exits.length && g.exits[0].t < g.time - g.cfg.waitWindow) g.exits.shift();
    if (!g.chill) checkLose(g);
  }

  // A click from the player: switch now, and keep the strategy's hands off this light for a bit.
  function manualFlip(g, light) {
    if (!flip(g, light)) return false;
    light.holdUntil = g.time + g.cfg.manualHold;
    return true;
  }

  // ---------------------------------------------------------------- self-running lights

  // Cars stopped (or nearly) within 160 px before each light, counted per light and direction.
  function waitingCounts(g) {
    var counts = {};
    g.lights.forEach(function (l) { counts[l.key] = { ns: 0, ew: 0 }; });
    g.lanes.forEach(function (lane) {
      lane.stops.forEach(function (stop) {
        lane.cars.forEach(function (car) {
          if (car.v < 20 && car.s <= stop.line + 0.5 && car.s > stop.line - 160) {
            counts[stop.light.key][lane.axis]++;
          }
        });
      });
    });
    return counts;
  }

  function autoSwitch(g, dt) {
    var cfg = g.cfg;
    g.autoTimer -= dt;
    if (g.autoTimer > 0) return;
    g.autoTimer = cfg.autoCheckEvery;
    var counts = g.strategy === 'smart' ? waitingCounts(g) : null;
    // Timer lights start switching early so the new green begins on schedule after amber + all-red.
    var lead = cfg.amberTime + cfg.allRedTime;
    g.lights.forEach(function (l) {
      if (g.time < (l.holdUntil || 0)) return;
      // Smart lights end the arrow early once the left-turners have gone.
      if (l.phase === 'arrow' && g.strategy === 'smart' && l.greenFor >= cfg.arrowMin && !leftTurnersWaiting(g, l)) {
        l.phase = 'green';
        l.greenFor = 0;
        return;
      }
      if (l.phase === 'arrow' && g.strategy === 'smart') return;
      if (l.phase !== 'green' && l.phase !== 'arrow') return;
      if (g.strategy === 'smart') {
        if (l.greenFor < cfg.autoMinGreen) return;
        var c = counts[l.key];
        var redSide = l.axis === 'ns' ? c.ew : c.ns;
        var greenSide = c[l.axis];
        if (redSide > greenSide || (redSide > 0 && l.greenFor >= cfg.autoMaxGreen)) flip(g, l);
      } else {
        var t = (g.time + lead - l.offset) % cfg.cycleTime;
        if (t < 0) t += cfg.cycleTime;
        var wanted = t < cfg.cycleTime / 2 ? 'ew' : 'ns';
        if (l.axis !== wanted) flip(g, l);
      }
    });
  }

  function nextRoadIn(g) {
    var next = g.cfg.roadSchedule[g.nextRoad];
    return next ? Math.max(0, next.at - g.time) : null;
  }

  var api = {
    CONFIG: CONFIG,
    createGame: createGame,
    createChill: createChill,
    carPoint: carPoint,
    signal: signal,
    setTraffic: setTraffic,
    setStrategy: setStrategy,
    setArrows: setArrows,
    manualFlip: manualFlip,
    hourOfDay: hourOfDay,
    darkness: darkness,
    dayPhase: dayPhase,
    averageWait: averageWait,
    resetTally: resetTally,
    KINDS: KINDS,
    kindNote: kindNote,
    step: step,
    flip: flip,
    lightAt: lightAt,
    edgeQueues: edgeQueues,
    nextRoadIn: nextRoadIn
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficSim = api;
})(this);
