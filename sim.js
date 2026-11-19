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
    smartRatio: 2,       // Smart: switch once the red side has this many times the green side's cars
    // Chill mode: a car queued off the map this many seconds gives up and drives off. Without it,
    // traffic above what the city can carry (about slider 60 on 6 lights) would build a queue that
    // grows every day forever, since the night is too short to clear it.
    giveUpAfter: 120,
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
    arrowAfterWait: 6,        // ...once it has been stopped this many seconds (tested: 0 s cost
                              // everyone a lot of waiting, 6 s keeps most of the benefit)
    // Stop signs (places other than Downtown).
    signStop: 0.8,            // seconds a car stands at a stop line before it may go
    crossGap: 3,              // a car leaving a side-street stop sign needs the main road clear this many seconds
    // Roundabouts: one lane, driven counterclockwise (traffic keeps right).
    roundSpeed: 55,           // px/s on the circle
    roundYield: 45,           // an entering car needs the circle clear this many px upstream of its entry
    roundLane: 24             // width of the circle's lane
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

  // Weather (chill and compare modes). Wet and snowy roads mean lower top speeds, gentler
  // acceleration and weaker brakes. Weaker brakes alone make moving cars keep bigger gaps (the
  // safe-speed rule leaves more room). The gap between stopped cars stays the same: the "don't
  // block the box" spaces are counted from it, so changing it could strand a car in a box.
  var WEATHER = {
    clear: { speed: 1, accel: 1, brake: 1 },
    rain: { speed: 0.85, accel: 0.85, brake: 0.75 },
    snow: { speed: 0.7, accel: 0.65, brake: 0.55 }
  };
  var WEATHER_BLOCK = 4;           // "changing" weather picks anew every 4 game hours

  // Buses run in the avenues' curb lanes, one every BUS_EVERY seconds each way, and stop for
  // BUS_DWELL seconds at a stop in the middle of each block. A bus is about two cars long, so it
  // takes two spaces in the "don't block the box" count (it would otherwise fit where it can't).
  var BUS_EVERY = 40, BUS_DWELL = 4, BUS_LENGTH = 52, BUS_SPEED = 0.85;
  // Ambulances: one every AMBULANCE_EVERY seconds or so, straight across the city. Lights ahead
  // turn green for it, and cars ahead move over (or ease to the side on one-lane streets).
  var AMBULANCE_EVERY = 45, AMBULANCE_LENGTH = 30, AMBULANCE_SPEED = 1.25;
  var AMBULANCE_REACH = 260;       // a light this far ahead of an ambulance turns green for it
  var YIELD_REACH = 140;           // cars this close ahead of an ambulance get out of its way
  // Buses and ambulances never turn: their stream always says "no".
  function neverTurn() { return 0.999; }

  // Road layouts for chill mode, keyed by the number of lights they make. The east-west roads
  // are avenues.
  var LAYOUTS = {
    1: [['v', 0.5], ['h', 0.5]],
    2: [['v', 0.3], ['v', 0.7], ['h', 0.5]],
    4: [['v', 0.3], ['v', 0.7], ['h', 0.34], ['h', 0.68]],
    6: [['v', 0.22], ['v', 0.5], ['v', 0.78], ['h', 0.34], ['h', 0.68]]
  };
  // Suburb's day: a sharp school run in the morning, a smaller one mid-afternoon, a modest evening.
  var SCHOOL_TRAFFIC = [
    [0, 0.15], [5, 0.15], [6.5, 0.5], [7.5, 1.6], [8.5, 1.4], [9.25, 0.6], [12, 0.6], [14.75, 0.7],
    [15.25, 1.3], [16, 0.8], [17.5, 1.1], [19, 0.7], [21, 0.4], [23, 0.2], [24, 0.15]
  ];

  // Places (chill and compare). Downtown is the 1/2/4/6-light grid above, all lights. The others
  // have a fixed layout, and each crossing has its own control:
  //   light   a traffic light, run by the strategy
  //   stop2   two-way stop: the `major` axis never stops; the other stops, then waits for a gap
  //   stop4   all-way stop: everyone stops; first to stop goes first (and those on the same road with it)
  //   round   roundabout: entering cars yield to cars already on the circle
  // Roads are [axis, pos, avenue, weight]; weight (default 1) scales that road's traffic.
  // `streetWeight` scales traffic on every non-avenue lane. `control(vi, hi)` gets the crossing's index among the
  // north-south roads (west to east) and east-west roads (north to south).
  var PLACES = {
    main: {
      roads: [['v', 0.14], ['v', 0.38], ['v', 0.62], ['v', 0.86], ['h', 0.24], ['h', 0.62, true]],
      streetWeight: 0.5,   // side streets carry half the avenue's traffic per lane
      control: function (vi, hi) {
        if (hi === 0) return { type: 'stop4' };
        return vi === 2 ? { type: 'light' } : { type: 'stop2', major: 'ew' };
      }
    },
    // Two through streets (the middle north-south one and the lower east-west one) meet at a
    // roundabout; where a through street crosses a quiet one, the quiet one stops; quiet
    // crossings are all-way stops. No lights at all.
    suburb: {
      day: SCHOOL_TRAFFIC,
      roads: [['v', 0.22, false, 0.5], ['v', 0.52], ['v', 0.8, false, 0.5], ['h', 0.3, false, 0.5], ['h', 0.66]],
      control: function (vi, hi) {
        if (vi === 1 && hi === 1) return { type: 'round' };
        if (vi === 1) return { type: 'stop2', major: 'ns' };
        if (hi === 1) return { type: 'stop2', major: 'ew' };
        return { type: 'stop4' };
      }
    },
    // Two avenues cross at a roundabout. Its circle has one lane, so each avenue's outer lane ends
    // just before it and traffic merges. Lights where a side street meets an avenue, all-way stops
    // where two side streets meet.
    crosstown: {
      // Avenues at 0.6: two lanes each way squeeze into one at the circle, so full avenue traffic
      // overloaded it at light traffic.
      roads: [['v', 0.17], ['v', 0.5, true, 0.6], ['v', 0.83], ['h', 0.24], ['h', 0.64, true, 0.6]],
      control: function (vi, hi) {
        if (vi === 1 && hi === 1) return { type: 'round' };
        if (vi === 1 || hi === 1) return { type: 'light' };
        return { type: 'stop4' };
      }
    }
  };
  var PLACE_NAMES = ['downtown', 'main', 'suburb', 'crosstown'];

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
      weather: 'clear',    // clear | rain | snow | changing
      wx: WEATHER.clear,   // this step's weather effect
      buses: false,
      ambulances: false,   // send one now and then by itself
      autoTimer: 0,
      lastHour: 0,         // chill mode: the hour last step, to spot midnight
      exits: [],           // {t, wait} for cars that recently left the map
      tally: { count: 0, sum: 0, worst: 0, gaveUp: 0 }   // every trip since resetTally ("today": it resets at midnight)
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
    var place = options && PLACES[options.place] ? options.place : 'downtown';
    var schedule = place === 'downtown'
      ? (LAYOUTS[lights] || LAYOUTS[4]).map(function (r) { return { at: 0, axis: r[0], pos: r[1], avenue: r[0] === 'h' }; })
      : PLACES[place].roads.map(function (r) { return { at: 0, axis: r[0], pos: r[1], avenue: !!r[2], weight: r[3] || 1 }; });
    var kind = options && KINDS.indexOf(options.kind) >= 0 ? options.kind : 'normal';
    var g = createGame(Object.assign({}, kind === 'sunday' ? SUNDAY_TURNS : {}, options, {
      roadSchedule: schedule, place: place
    }));
    g.chill = true;
    g.traffic = traffic;
    g.kind = kind;
    g.weather = options && options.weather && (WEATHER[options.weather] || options.weather === 'changing') ? options.weather : 'clear';
    g.buses = !!(options && options.buses);
    g.ambulances = !!(options && options.ambulances);
    if (kind === 'stadium') setUpStadium(g);
    if (kind === 'construction') setUpConstruction(g);
    setUpBuses(g);          // after construction: no buses in a closed lane
    setUpAmbulances(g);
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

  // Bus lanes and their stops: one stop in the middle of each block that's long enough.
  function setUpBuses(g) {
    g.lanes.forEach(function (lane) {
      if (!lane.road.avenue || lane.position !== 'curb' || lane.stops.some(function (st) { return st.closed || st.laneEnds; })) return;
      var edges = [0];
      lane.stops.forEach(function (st) { edges.push(st.line, st.boxEnd); });
      edges.push(lane.length);
      lane.busStops = [];
      for (var i = 0; i + 1 < edges.length; i += 2) {
        if (edges[i + 1] - edges[i] > 4 * BUS_LENGTH) lane.busStops.push((edges[i] + edges[i + 1]) / 2 + BUS_LENGTH / 2);
      }
      var rng = seeded(mixSeed(g.seed, 0xb05, lane.id));
      lane.nextBus = rng() * BUS_EVERY;
      lane.buses = 0;
    });
  }

  function setUpAmbulances(g) {
    g.ambulanceRng = seeded(mixSeed(g.seed, 0xa3b));
    g.nextAmbulance = AMBULANCE_EVERY * (0.5 + g.ambulanceRng());
  }

  // Send an ambulance across the city. `pick` (0..1) chooses its road, so compare mode can send
  // the same one on both maps. It goes in an avenue's inner lane or a side street, never a closed lane.
  function sendAmbulance(g, pick) {
    var lanes = g.lanes.filter(function (l) {
      return l.position !== 'curb' && !l.stops.some(function (st) { return st.closed; });
    });
    if (!lanes.length) return null;
    var lane = lanes[Math.min(lanes.length - 1, Math.floor(pick * lanes.length))];
    lane.ambulancesWaiting = (lane.ambulancesWaiting || 0) + 1;
    lane.ambulances = (lane.ambulances || 0) + 1;
    g.events.push({ type: 'ambulance' });
    return lane;
  }

  // The weather right now: the setting, or for "changing", a pick for this 4-hour block of this day.
  function currentWeather(g) {
    if (g.weather !== 'changing') return g.weather;
    var hours = g.cfg.dayStartHour + g.time / g.cfg.dayLength * 24;
    var block = Math.floor(hours / WEATHER_BLOCK);
    var r = seeded(mixSeed(g.seed, 0xea7, block))();
    return r < 0.5 ? 'clear' : r < 0.82 ? 'rain' : 'snow';
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

  // A finished trip (or one given up at the edge) goes into the last-minute window and today's tally.
  function recordTrip(g, wait, id) {
    g.exits.push({ t: g.time, wait: wait, id: id });
    g.tally.count++;
    g.tally.sum += wait;
    g.tally.worst = Math.max(g.tally.worst, wait);
  }

  // Cars that have arrived but are still queued off the map, waiting for room to enter.
  function waitingToEnter(g) {
    var n = 0;
    g.lanes.forEach(function (lane) { n += lane.offMap; });
    return n;
  }

  // Start counting trips afresh (compare mode does this at midnight).
  function resetTally(g) {
    g.tally = { count: 0, sum: 0, worst: 0, gaveUp: 0 };
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
        axis: r.axis, c: Math.round(r.pos * size), avenue: avenue, weight: r.weight || 1,
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
    var place = PLACES[g.cfg.place];
    g.lanes.forEach(function (lane) {
      lane.weight = (0.6 + g.rng() * 0.8) * lane.road.weight * (place && place.streetWeight && !lane.road.avenue ? place.streetWeight : 1);
    });
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
        pending: [],         // their arrival number and time, oldest first (offMap === pending.length)
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

  function placeHasLights(name) {
    var place = PLACES[name];
    if (!place) return true;
    var nv = place.roads.filter(function (r) { return r[0] === 'v'; }).length, nh = place.roads.length - nv;
    for (var vi = 0; vi < nv; vi++) for (var hi = 0; hi < nh; hi++) if (place.control(vi, hi).type === 'light') return true;
    return false;
  }

  // What controls the crossing of roads `v` and `h`: a light unless the place says otherwise.
  function controlAt(g, v, h) {
    var place = PLACES[g.cfg.place];
    if (!place) return { type: 'light' };
    var vs = g.roads.filter(function (r) { return r.axis === 'v'; }).sort(function (a, b) { return a.c - b.c; });
    var hs = g.roads.filter(function (r) { return r.axis === 'h'; }).sort(function (a, b) { return a.c - b.c; });
    return place.control(vs.indexOf(v), hs.indexOf(h));
  }

  function isLight(l) { return l.control === 'light'; }

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
          var spec = controlAt(g, v, hr);
          // A roundabout's circle: its lane's centre line runs `ring` px out, clear of both roads,
          // and the whole thing (to the outer kerb) fills a box `rb` px each way from the centre.
          var ring = Math.max(v.half, hr.half) + 12, rb = ring + cfg.roundLane / 2;
          var round = spec.type === 'round';
          light = {
            key: key, x: v.c, y: hr.c, hx: round ? rb : v.half, hy: round ? rb : hr.half, axis: axis, phase: 'green', timer: 0, greenFor: 0,
            ring: round ? ring : 0,
            control: spec.type, major: spec.major || null, queue: [],
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
        var start, end;
        var key0 = lane.axis === 'ew' ? road.c + ',' + lane.road.c : lane.road.c + ',' + road.c;
        var h = byKey[key0] && byKey[key0].control === 'round' ? byKey[key0].hx : road.half;
        if (lane.dir === 'E' || lane.dir === 'S') {
          start = road.c - h; end = road.c + h;
        } else {
          start = lane.length - (road.c + h); end = lane.length - (road.c - h);
        }
        var key = lane.axis === 'ew' ? road.c + ',' + lane.road.c : lane.road.c + ',' + road.c;
        return { line: start - cfg.stopGap, boxStart: start, boxEnd: end, light: byKey[key] };
      }).sort(function (a, b) { return a.line - b.line; });
      // An avenue's curb lane ends just before a roundabout (its circle has one lane): cars merge.
      // Where a light comes first, the lane closes from that light on (like Construction), so cars
      // merge before the light. Merging between the light and the roundabout didn't work: the
      // stretch's space count is per lane, and the inner lane's stretch stayed full of cars on
      // their way round, so a merging car was never given a space and sat there all day.
      lane.stops.forEach(function (stop, i) {
        stop.laneEnds = stop.light.control === 'round' && lane.position === 'curb';
        if (stop.laneEnds && i > 0) lane.stops[i - 1].closed = true;
      });
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
        if (light.control === 'round') {
          // Every way through a roundabout is a drive around part of the circle. Leave into the
          // curb lane of an avenue (the outer lane, nearest the circle).
          [['left', LEFT_OF[lane.dir], crossRoad], ['right', RIGHT_OF[lane.dir], crossRoad], ['straight', lane.dir, lane.road]].forEach(function (t) {
            var to = laneAt(t[2], t[1], 'right');
            var toStop = to && stopFor(to, light);
            if (to && toStop) stop.turns[t[0]] = { lane: to, stop: toStop, arc: makeRoundPath(light, lane, stop, to, toStop) };
          });
          return;
        }
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
    if (g.over || !light || !isLight(light) || (light.phase !== 'green' && light.phase !== 'arrow')) return false;
    light.phase = 'amber';
    light.timer = g.cfg.amberTime;
    return true;
  }

  // Light phases, in order: green -> amber -> allred -> (arrow ->) green the other way.
  function updateLights(g, dt) {
    g.lights.forEach(function (l) {
      if (!isLight(l)) return;
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
      if (!isLight(l)) return;
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
    if (stop.light.control === 'round') return roundPlan(g, stop, forced, rng);
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

  // At a roundabout every car drives the circle (turn 'round'); `exit` says where it leaves.
  // Turning onto a road that meets more crossings is allowed here, unlike at other crossings: the
  // gridlock argument above needs every turn to lead away from where it came from, and every road
  // out of a roundabout does (no other crossing turns a car onto a road back toward it).
  function roundPlan(g, stop, forced, rng) {
    var exit = forced && forced !== 'straight' ? forced : 'straight';
    if (!forced && g.chill) {
      var cfg = g.cfg, r = (rng || g.rng)();
      if (r < cfg.turnLeft && stop.turns.left) exit = 'left';
      else if (r < cfg.turnLeft + cfg.turnRight && stop.turns.right) exit = 'right';
    }
    var t = stop.turns[exit] || stop.turns.straight;
    if (!t) return { stop: stop, turn: 'straight' };
    return { stop: stop, turn: 'round', exit: exit, target: t.lane, targetStop: t.stop, arc: t.arc };
  }

  function turnLane(lane, turn) {
    if (!lane.sibling) return lane;
    var want = turn === 'left' ? 'inner' : 'curb';
    return lane.position === want ? lane : lane.sibling;
  }

  function onCircle(car) {
    return !!car.plan && car.plan.turn === 'round' && car.s > car.plan.stop.line;
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
    if (!plan || plan.turn === 'straight') {
      // A car going round a roundabout is measured along its path, not this lane: skip it.
      for (var k = i - 1; k >= 0; k--) if (!onCircle(cars[k])) return cars[k];
      return null;
    }
    for (var j = i - 1; j >= 0; j--) {
      var other = cars[j];
      var sameCurve = other.plan && other.plan.stop === plan.stop && other.plan.turn === plan.turn;
      if (sameCurve) return other;
      if (onCircle(other)) continue;   // measured along its own path, not this lane
      if (other.s - other.len < plan.stop.boxEnd) return other;
    }
    return null;
  }

  // Is there a guaranteed space for one more car after this intersection on `lane`?
  // Cars already past the line on that stretch, and turning cars heading onto it, each hold a space.
  function hasSpace(lane, stop, need) {
    if (stop.closed) return false;
    if (stop.capacity === Infinity) return true;
    var taken = stop.light.incoming[lane.id] || 0;
    for (var i = 0; i < lane.cars.length; i++) {
      var c = lane.cars[i];
      if (c.s > stop.line + 0.001 && c.s <= stop.segmentEnd + 0.5) taken += c.slots || 1;
    }
    return taken + (need || 1) <= stop.capacity;
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
    if (light.control === 'stop2' || light.control === 'stop4') return mayEnterSign(g, lane, stop, car);
    if (light.control === 'round') return !stop.laneEnds && plan.turn === 'round' && hasSpace(plan.target, plan.targetStop) && roundClear(g, light, plan.arc, car);
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
      var stoppingDistance = car.v * car.v / (2 * cfg.brake * g.wx.brake);
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
    if (plan.turn === 'straight') return hasSpace(lane, stop, car.slots);
    return hasSpace(plan.target, plan.targetStop);
  }

  // Stop signs. A car that has to stop must stand at the line for `signStop` seconds first. Then:
  //  two-way stop: the main road must be clear for `crossGap` seconds both ways (main-road cars
  //    never stop, so the side street waits for a real gap, like real drivers do);
  //  all-way stop: cars go in the order they stopped. The car that stopped first picks the road
  //    that goes next, and anyone stopped on that road may go with it (opposite cars pass each
  //    other, as at a real four-way stop). A car whose way out is full is skipped, so one blocked
  //    car can't hold up the whole crossing (that could chain around a block into gridlock).
  // After that, the same rules as a green light: the box must be clear of cross traffic, left
  // turns need a gap, and nobody enters without a guaranteed space on the far side.
  function mayEnterSign(g, lane, stop, car) {
    var cfg = g.cfg, light = stop.light, plan = car.plan, opposite = OPPOSITE[lane.dir];
    var cross = lane.axis === 'ns' ? 'ew' : 'ns';
    var mustStop = light.control === 'stop4' || lane.axis !== light.major;
    if (mustStop && (car.lineWait || 0) < cfg.signStop) return false;
    if (light.control === 'stop4' && stop4Axis(light) !== lane.axis) return false;
    // A right turn only merges into the near side, so only traffic coming from the left matters.
    if (light.control === 'stop2' && mustStop && !crossClear(g, light, cross, plan.turn === 'right' ? RIGHT_OF[lane.dir] : null)) return false;
    if (light.busy[cross] || light.leftIn[opposite]) return false;
    if (plan.turn === 'left' && (light.throughIn[opposite] || !gapClear(g, stop))) return false;
    if (plan.turn === 'straight') return hasSpace(lane, stop, car.slots);
    return hasSpace(plan.target, plan.targetStop);
  }

  // ---- roundabouts
  //
  // Each car on a roundabout is placed on the circle by an angle-like "progress" u (radians,
  // growing the way cars drive). Cars on their way in or out count too, a bit before or after
  // their own entry and exit points, so a car always sees what is about to share its piece of road.
  function ringU(arc, d) {
    var R = arc.R;
    if (d < arc.ringStart) return arc.uIn - (arc.ringStart - d) / R;
    if (d <= arc.ringEnd) return arc.uIn + (d - arc.ringStart) / R;
    return arc.uIn + arc.sweep + (d - arc.ringEnd) / R;
  }

  function mod2pi(a) { a %= 2 * Math.PI; return a < 0 ? a + 2 * Math.PI : a; }

  // Everyone on (or just entering or leaving) this roundabout: front and rear progress.
  function ringCars(g, light) {
    if (light.ringStamp === g.time) return light.ringList;
    var list = [];
    g.lanes.forEach(function (lane) {
      lane.cars.forEach(function (c) {
        var p = c.plan;
        if (!p || p.turn !== 'round' || p.stop.light !== light) return;
        // Only cars past their yield line: one waiting there isn't on the circle yet, and counting
        // it made the cars going round wait for it while it waited for them.
        var d = c.s - p.stop.boxStart;
        if (c.s <= p.stop.line || d - c.len > p.arc.ringEnd + 10) return;
        var u = ringU(p.arc, d);
        list.push({ car: c, front: u, rear: u - c.len / p.arc.R });
      });
    });
    light.ringStamp = g.time;
    light.ringList = list;
    return list;
  }

  // May a car enter here? Nobody on the circle within `roundYield` px upstream of the entry, and
  // nobody's rear just past it (room to slot in).
  function roundClear(g, light, arc, car) {
    var list = ringCars(g, light), R = arc.R, cfg = g.cfg;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.car === car) continue;
      var upstream = mod2pi(arc.uIn - o.rear) * R;          // entry point ahead of the other car's rear
      if (upstream < o.car.len + cfg.roundYield) return false;
      var ahead = mod2pi(o.rear - arc.uIn) * R;             // the other car's rear past the entry
      if (ahead < car.len + cfg.minGap) return false;
    }
    return true;
  }

  // The furthest a car on the circle may go (in its own s): up to the nearest rear ahead of it.
  function ringLimit(g, car) {
    var p = car.plan, arc = p.arc, list = ringCars(g, p.stop.light);
    var d = car.s - p.stop.boxStart, front = ringU(arc, d), best = Infinity;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.car === car) continue;
      var gap = mod2pi(o.rear - front) * arc.R;
      // Only cars ahead on the circle, not ones just behind (whose rear wraps round to look far ahead).
      if (gap < 2 * Math.PI * arc.R - car.len - 4 && gap < best) best = gap;
    }
    return best === Infinity ? Infinity : car.s + best - g.cfg.minGap;
  }

  // Which road goes next at an all-way stop: the road of the first car in line that has room to go.
  function stop4Axis(light) {
    for (var i = 0; i < light.queue.length; i++) {
      var q = light.queue[i], p = q.car.plan;
      var ok = p.turn === 'straight' ? hasSpace(q.lane, q.stop, q.car.slots) : hasSpace(p.target, p.targetStop);
      if (ok) return q.lane.axis;
    }
    return null;
  }

  // Nothing on the main road in the box or due at it within `crossGap` seconds (only lanes heading
  // `onlyDir`, if given).
  function crossClear(g, light, axis, onlyDir) {
    if (light.busy[axis]) return false;
    for (var k = 0; k < g.lanes.length; k++) {
      var lane = g.lanes[k];
      if (lane.axis !== axis || (onlyDir && lane.dir !== onlyDir)) continue;
      var stop = null;
      for (var j = 0; j < lane.stops.length; j++) if (lane.stops[j].light === light) stop = lane.stops[j];
      if (!stop) continue;
      for (var i = 0; i < lane.cars.length; i++) {
        var c = lane.cars[i], d = stop.line - c.s;
        if (d < -0.001) continue;
        if (d < c.len + 10 || (c.v > 5 && d < c.v * g.cfg.crossGap)) return false;
      }
    }
    return true;
  }

  // Can a car at the end of its curve slot into the new lane right now? It would sit just past
  // the box, so nothing on that lane may be within a car length (plus the usual gap) of there.
  function roomToJoin(g, car) {
    var lane = car.plan.target, at = car.plan.targetStop.boxEnd, gap = g.cfg.minGap;
    for (var i = 0; i < lane.cars.length; i++) {
      var c = lane.cars[i];
      // Going straight through a roundabout on a one-lane street ends on the lane it started on.
      // Cars still going round are measured along their path, not this lane, so they don't count.
      if (c === car || onCircle(c)) continue;
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
      // Zipper merge: where the other lane ends (or is closed past the next light), let in the merging car
      // just ahead. Without this the two queues sat side by side and the ending lane never got a gap.
      // Only when this lane's stretch has a space for it: the merging car can't move over without
      // one, and holding back then would only stop the car whose going frees one.
      if (approaching && lane.sibling && !plan.stop.laneEnds && roomToMerge(lane, car.s)) {
        var merger = null;
        lane.sibling.cars.forEach(function (c) {
          var ends = c.plan && (c.plan.stop.laneEnds || (c.plan.stop.closed && c.plan.turn === 'straight' && !c.plan.want));
          // Only a car it can still stop fully behind: one already alongside goes first instead.
          if (c.s - c.len - cfg.minGap >= car.s && c.s <= plan.stop.line + 0.5 && ends && (!merger || c.s < merger.s)) merger = c;
        });
        if (merger) limit = Math.min(limit, merger.s - merger.len - cfg.minGap);
      }
      if (approaching && !mayEnter(g, lane, plan.stop, car)) limit = Math.min(limit, plan.stop.line);
      if (car.bus) limit = Math.min(limit, busStopLimit(lane, car, dt));

      var wx = g.wx, brake = cfg.brake * wx.brake;
      var maxSpeed = lane.maxSpeed * wx.speed * (car.bus ? BUS_SPEED : car.ambulance ? AMBULANCE_SPEED : 1);
      if (plan && plan.turn === 'round' && car.s > plan.stop.line) limit = Math.min(limit, ringLimit(g, car));
      if (plan && plan.turn !== 'straight') {
        var cornerSpeed = (plan.turn === 'round' ? cfg.roundSpeed : plan.turn === 'left' ? cfg.leftTurnSpeed : cfg.rightTurnSpeed) * wx.speed;
        var curveEnd = plan.stop.boxStart + plan.arc.len;
        if (car.s > plan.stop.boxStart) {
          maxSpeed = cornerSpeed;
          if (!roomToJoin(g, car)) limit = Math.min(limit, curveEnd);
        } else {
          // Slow down for the corner: the same braking rule, aimed at corner speed at the box.
          var toBox = plan.stop.boxStart - car.s;
          maxSpeed = Math.min(maxSpeed, Math.sqrt(cornerSpeed * cornerSpeed + 2 * brake * toBox));
        }
      }

      // Safe-speed rule: from speed v a car needs v²/(2·brake) to stop, so the fastest
      // it can go and still stop within `room` is sqrt(2·brake·room).
      var room = Math.max(0, limit - car.s);
      var target = Math.min(maxSpeed, Math.sqrt(2 * brake * room));
      car.v = car.v < target ? Math.min(target, car.v + cfg.accel * wx.accel * dt) : target;

      var before = car.s;
      car.s = Math.min(car.s + car.v * dt, Math.max(car.s, limit));
      // Time standing at a stop sign's line; at an all-way stop, that's what joins the line to go.
      if (approaching && plan.stop.light.control !== 'light' && plan.stop.line - car.s < 3 && car.v < 5) {
        var was = car.lineWait || 0;
        car.lineWait = was + dt;
        var sl = plan.stop.light;
        if (sl.control === 'stop4' && was < cfg.signStop && car.lineWait >= cfg.signStop) sl.queue.push({ car: car, lane: lane, stop: plan.stop });
      }
      if (car.v < 10 && !car.dwell) {
        car.wait += dt;
        car.totalWait += dt;
      }
      if (plan && before <= plan.stop.line && car.s > plan.stop.line) {
        // Through the light: waiting time is per light, so it resets. Mark the box right away so
        // cars checking later in this same step see this car in it.
        car.wait = 0;
        car.lineWait = 0;
        var L = plan.stop.light;
        if (L.queue.length) L.queue = L.queue.filter(function (q) { return q.car !== car; });
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
      // Buses and ambulances aren't trips people are timing, so they stay out of the numbers.
      if (gone.bus || gone.ambulance) continue;
      recordTrip(g, gone.totalWait, gone.id);
      g.score++;
    }
  }

  // A bus heads for its next stop, waits there BUS_DWELL seconds, then carries on.
  function busStopLimit(lane, bus, dt) {
    var stops = lane.busStops || [];
    if (bus.busStop >= stops.length) return Infinity;
    var at = stops[bus.busStop];
    if (bus.dwell > 0) {
      bus.dwell -= dt;
      if (bus.dwell <= 0) { bus.dwell = 0; bus.busStop++; }
      return bus.s;
    }
    if (bus.s >= at - 0.5) {
      bus.dwell = BUS_DWELL;
      return bus.s;
    }
    return at;
  }

  // Lights ahead of an ambulance turn green for it and stay that way until it has gone through.
  // The usual rules still apply to everyone (amber, all-red, don't block the box), so this can't
  // cause gridlock; it only decides who gets the green.
  function clearWayForAmbulances(g) {
    g.lanes.forEach(function (lane) {
      lane.cars.forEach(function (car) {
        if (!car.ambulance || !car.plan || car.s > car.plan.stop.line) return;
        if (car.plan.stop.line - car.s > AMBULANCE_REACH) return;
        var light = car.plan.stop.light;
        if (light.axis !== lane.axis) flip(g, light);
        else if (light.phase === 'arrow') { light.phase = 'green'; light.greenFor = 0; }
        light.holdUntil = Math.max(light.holdUntil || 0, g.time + 1);
        light.forAmbulance = g.time + 1;
      });
    });
  }

  // Cars just ahead of an ambulance get out of its way: on an avenue they move over when there's
  // room; on a one-lane street they ease toward the curb (only drawn, there's nowhere to go).
  function markYielding(g) {
    g.lanes.forEach(function (lane) {
      var siren = null;
      for (var i = lane.cars.length - 1; i >= 0; i--) {
        var c = lane.cars[i];
        if (c.ambulance) { siren = c; c.aside = false; continue; }
        c.aside = !!siren && c.s - c.len - siren.s < YIELD_REACH && c.s > siren.s;
      }
    });
  }

  // Cars that finished a curve move onto their new lane, just past the intersection.
  function applyJoins(g, joins) {
    joins.forEach(function (j) {
      var car = j.car, plan = car.plan, lane = plan.target;
      // The curve may end a little off the new lane's heading; ease that out instead of snapping.
      var end = pathPoint(plan.arc, plan.arc.len), d = end.angle - lanePoint(lane, 0).angle;  // heading at the curve's end
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

  // Could a car move into `lane` at `s` as far as the stretch's space count goes?
  function roomToMerge(lane, s) {
    var behind = stopBehind(lane, s);
    return behind === null || hasSpace(lane, lane.stops[behind]);
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
      } else if (car.s - car.len - c.s < cfg.minGap - 0.5 + c.v * 0.6) {
        return false;
      }
    }
    var behind = stopBehind(fromLane, car.s);
    if (behind !== null) {
      var stop = target.stops[behind];
      if (car.s - car.len < stop.boxEnd + 2) return false;   // still in the intersection
      if (!hasSpace(target, stop, car.slots)) return false;
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
        if (!lane.sibling || car.shift > 0 || car.s < 2 * car.len || car.bus || car.ambulance) return;
        var plan = car.plan;
        if (!plan || isTurning(car)) return;
        // The stretch past the next light is closed: a car going straight there has to merge,
        // even right at the line (it waits there for a gap in the other lane).
        if ((plan.turn === 'straight' && !plan.want && plan.stop.closed) || plan.stop.laneEnds) {
          moves.push({ car: car, from: lane, reason: 'merge' });
          return;
        }
        if (car.s > plan.stop.line - cfg.laneChangeStopGap) {
          // Too close to the light to move over: give up the turn and go straight instead.
          if (plan.want) car.plan = { stop: plan.stop, turn: 'straight' };
          return;
        }
        var reason = null;
        var over = nextStop(lane.sibling, car.s);
        if (car.aside && plan.turn === 'straight' && !plan.want && !(over && (over.closed || over.laneEnds))) reason = 'pass';
        else if (plan.want) reason = 'turn';
        else if (plan.turn === 'straight' && car.cooldown <= 0 && car.v < 0.6 * lane.maxSpeed) {
          // Stuck behind a slow or stopped car (often a waiting left-turner), with clearly more
          // room in the other lane: pass.
          var here = roomAhead(lane, i, car), there = roomAheadIn(lane.sibling, car.s);
          var ahead = nextStop(lane.sibling, car.s);
          if (here < 50 && there > here + 60 && !(ahead && (ahead.closed || ahead.laneEnds))) reason = 'pass';
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
      // Merging toward a roundabout, the car picks its exit there from its own random stream.
      var next = nextStop(to, car.s);
      car.plan = makePlan(g, to, car.s, m.reason === 'turn' ? car.plan.want : next && next.light.control === 'round' ? null : 'straight', car.rng);
      (from.ghosts = from.ghosts || []).push(car);
    });
  }

  function spawnRate(g) {
    var cfg = g.cfg;
    if (g.traffic !== null) {
      var hour = hourOfDay(g);
      if (g.kind === 'sunday') return g.traffic * curveAt(SUNDAY_TRAFFIC, hour);
      if (g.kind === 'stadium') return g.traffic * dayTraffic(hour) * STADIUM_DAY;
      var place = PLACES[g.cfg.place];
      return g.traffic * (place && place.day ? curveAt(place.day, hour) : dayTraffic(hour));
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
    if (g.ambulances && g.time >= g.nextAmbulance) {
      sendAmbulance(g, g.ambulanceRng());
      g.nextAmbulance += AMBULANCE_EVERY * (0.6 + 0.8 * g.ambulanceRng());
    }
    g.lanes.forEach(function (lane) {
      // Buses keep their timetable whether or not they're switched on, so turning them on later
      // (or comparing two maps) doesn't shift anything else.
      if (lane.busStops && g.time >= lane.nextBus) {
        lane.nextBus += BUS_EVERY;
        if (g.buses) { lane.busesWaiting = (lane.busesWaiting || 0) + 1; lane.buses++; }
      }
      // The timer counts down in "expected arrivals", not seconds: it drops by this lane's current
      // rate times dt. A gap measured in seconds would be fixed at whatever the rate was when it was
      // drawn, so a late-night gap of ~15 s would hold back the stadium crowd for half its burst.
      // Counting this way follows the rate as it changes (a varying-rate Poisson process).
      lane.spawnTimer -= laneRate(g, lane, rate) * dt;
      if (lane.spawnTimer <= 0) {
        // Every arrival waits at the edge until it fits, however long the queue gets. Dropping
        // arrivals past a cap (as chill mode once did) hid the worst waits, flattered the more
        // jammed compare map, and broke "same cars on both maps" once the two dropped different cars.
        lane.arrivals++;
        lane.offMap++;
        lane.pending.push({ n: lane.arrivals, at: g.time });
        // Random gaps between arrivals (exponential), so traffic comes in clumps like real traffic.
        lane.spawnTimer += -Math.log(1 - lane.rng());
      }
      // Drivers queued too long at the edge give up. Their wait still counts as a trip: leaving it
      // out would make the most jammed city look best, the same flaw as dropping arrivals.
      while (g.chill && lane.pending.length && g.time - lane.pending[0].at >= cfg.giveUpAfter) {
        var quit = lane.pending.shift();
        lane.offMap--;
        recordTrip(g, g.time - quit.at, null);
        g.tally.gaveUp++;
      }
      var last = lane.cars[lane.cars.length - 1];
      var hasRoom = (!last || last.s - last.len >= cfg.minGap) && !(lane.ghosts || []).some(function (gh) {
        return gh.s - gh.len < cfg.minGap;
      });
      // An ambulance goes ahead of everyone queued at the edge, then any bus.
      if (hasRoom && (lane.ambulancesWaiting || lane.busesWaiting)) {
        var amb = lane.ambulancesWaiting > 0;
        if (amb) lane.ambulancesWaiting--; else lane.busesWaiting--;
        var special = {
          id: g.nextId++, s: 0,
          v: last ? Math.min(cfg.maxSpeed, last.v) : cfg.maxSpeed * 0.8,
          len: amb ? AMBULANCE_LENGTH : BUS_LENGTH,
          slots: 2, wait: 0, totalWait: 0, rng: neverTurn,
          bus: !amb, ambulance: amb, busStop: 0, dwell: 0
        };
        special.plan = makePlan(g, lane, 0, 'straight');
        lane.cars.push(special);
        return;
      }
      if (lane.offMap > 0 && hasRoom) {
        lane.offMap--;
        var arrival = lane.pending.shift();
        // Time queued off the map counts as waiting: the driver has been stopped since arriving.
        var edgeWait = g.time - arrival.at;
        var car = {
          id: g.nextId++,
          s: 0,
          v: last ? Math.min(cfg.maxSpeed, last.v) : cfg.maxSpeed * 0.8,
          len: cfg.carLength,
          wait: 0,        // seconds stopped at the current light (drives the car's color)
          totalWait: edgeWait,   // seconds stopped over the whole trip, from arrival (drives the average wait)
          arrival: arrival.n,    // this car's number among the lane's arrivals (same car in both compare cities)
          rng: seeded(mixSeed(g.seed, lane.id, arrival.n))
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
      return pathPoint(plan.arc, s - plan.stop.boxStart);
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
    if (plan && plan.turn === 'round') return car.s < plan.stop.line && car.s > plan.stop.line - within && plan.exit !== 'straight' ? plan.exit : null;
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

  // Point and heading `d` px along a turn's path: a Bézier curve, or a roundabout's sampled path.
  function pathPoint(arc, d) {
    if (!arc.pts) return curvePoint(arc, curveT(arc, d));
    var pts = arc.pts, dist = arc.dist;
    if (d <= 0) return pts[0];
    if (d >= arc.len) return pts[pts.length - 1];
    var lo = 0, hi = dist.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (dist[mid] < d) lo = mid; else hi = mid; }
    var a = pts[lo], b = pts[hi], f = (d - dist[lo]) / (dist[hi] - dist[lo]);
    var da = b.angle - a.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: a.angle + da * f };
  }

  // The path through a roundabout: a smooth bend from the lane onto the circle, counterclockwise
  // round it, and a bend off onto the new lane. Entry and exit points sit a little round the
  // circle from the road's centre line toward the lane's own side (`delta`), so the bends are gentle.
  // Screen y points down, so counterclockwise on screen means the angle shrinks.
  function makeRoundPath(light, fromLane, fromStop, toLane, toStop) {
    var R = light.ring, cx = light.x, cy = light.y;
    var p0 = lanePoint(fromLane, fromStop.boxStart), p2 = lanePoint(toLane, toStop.boxEnd);
    var inSide = HEADING[fromLane.dir] + Math.PI, outSide = HEADING[toLane.dir];
    var offIn = Math.abs(fromLane.axis === 'ew' ? fromLane.coord - cy : fromLane.coord - cx);
    var offOut = Math.abs(toLane.axis === 'ew' ? toLane.coord - cy : toLane.coord - cx);
    var thIn = inSide - (Math.asin(Math.min(0.9, offIn / R)) + 0.15);
    var thOut = outSide + Math.asin(Math.min(0.9, offOut / R));
    var sweep = mod2pi(thIn - thOut);
    if (sweep < 0.3) sweep += 2 * Math.PI;
    var ring = function (th) { return { x: cx + R * Math.cos(th), y: cy + R * Math.sin(th) }; };
    var tangent = function (th) { return { x: Math.sin(th), y: -Math.cos(th) }; };
    var pts = [];
    // Cubic Hermite bends: start and end points with their headings.
    function bend(a, ta, b, tb) {
      var k = Math.hypot(b.x - a.x, b.y - a.y) * 1.1;
      for (var i = 0; i <= 12; i++) {
        var t = i / 12, t2 = t * t, t3 = t2 * t;
        var h1 = 2 * t3 - 3 * t2 + 1, h2 = t3 - 2 * t2 + t, h3 = -2 * t3 + 3 * t2, h4 = t3 - t2;
        pts.push({ x: h1 * a.x + h2 * k * ta.x + h3 * b.x + h4 * k * tb.x, y: h1 * a.y + h2 * k * ta.y + h3 * b.y + h4 * k * tb.y });
      }
    }
    var head = function (dir) { return { x: Math.cos(HEADING[dir]), y: Math.sin(HEADING[dir]) }; };
    bend(p0, head(fromLane.dir), ring(thIn), tangent(thIn));
    var startIdx = pts.length - 1, steps = Math.max(6, Math.ceil(sweep * R / 4));
    for (var i = 1; i <= steps; i++) pts.push(ring(thIn - sweep * i / steps));
    var endIdx = pts.length - 1;
    pts.pop();
    bend(ring(thOut), tangent(thOut), p2, head(toLane.dir));
    // Headings from neighbouring points, and distance along the path.
    var dist = [0], len = 0;
    for (var j = 0; j < pts.length; j++) {
      var a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
      pts[j].angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (j > 0) { len += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y); dist.push(len); }
    }
    return { pts: pts, dist: dist, len: len, R: R, uIn: -thIn, sweep: sweep,
      ringStart: dist[startIdx], ringEnd: dist[endIdx] };
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
    g.wx = WEATHER[currentWeather(g)];
    openDueRoads(g);
    if (g.chill) autoSwitch(g, dt);
    clearWayForAmbulances(g);
    markYielding(g);
    updateLights(g, dt);
    changeLanes(g, dt);
    markBoxes(g);
    var joins = [];
    g.lanes.forEach(function (lane) { moveCars(g, lane, dt, joins); });
    applyJoins(g, joins);
    spawnCars(g, dt);
    while (g.exits.length && g.exits[0].t < g.time - g.cfg.waitWindow) g.exits.shift();
    if (g.chill) {
      // "Today" starts again at midnight.
      var hour = hourOfDay(g);
      if (hour < g.lastHour) resetTally(g);
      g.lastHour = hour;
    }
    if (!g.chill) checkLose(g);
  }

  // A click from the player: switch now, and keep the strategy's hands off this light for a bit.
  function manualFlip(g, light) {
    if (!flip(g, light)) return false;
    light.holdUntil = g.time + g.cfg.manualHold;
    return true;
  }

  // ---------------------------------------------------------------- self-running lights

  // Cars within 160 px before each light, per light and direction: `ns`/`ew` count the ones stopped
  // (or nearly), `nsAll`/`ewAll` every car there, moving or not.
  function waitingCounts(g) {
    var counts = {};
    g.lights.forEach(function (l) { counts[l.key] = { ns: 0, ew: 0, nsAll: 0, ewAll: 0 }; });
    g.lanes.forEach(function (lane) {
      lane.stops.forEach(function (stop) {
        lane.cars.forEach(function (car) {
          if (car.s <= stop.line + 0.5 && car.s > stop.line - 160) {
            if (car.v < 20) counts[stop.light.key][lane.axis]++;
            counts[stop.light.key][lane.axis + 'All']++;
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
      if (!isLight(l) || g.time < (l.holdUntil || 0)) return;
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
        // The green side counts every car still coming through, not just stopped ones: a flowing
        // green has few stopped cars, so counting only those flipped it back after 3 s, and every
        // switch costs 2.1 s of amber and all-red. Waiting for the red side to be well ahead (more
        // than `smartRatio` times as many) lets a green finish its platoon.
        var greenSide = c[l.axis + 'All'];
        if (redSide > cfg.smartRatio * greenSide || (redSide > 0 && l.greenFor >= cfg.autoMaxGreen)) flip(g, l);
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
    lanePoint: lanePoint,
    signal: signal,
    setTraffic: setTraffic,
    setStrategy: setStrategy,
    setArrows: setArrows,
    manualFlip: manualFlip,
    hourOfDay: hourOfDay,
    darkness: darkness,
    dayPhase: dayPhase,
    averageWait: averageWait,
    waitingToEnter: waitingToEnter,
    resetTally: resetTally,
    KINDS: KINDS,
    PLACES: PLACE_NAMES,
    // Does this place have any lights (so the light strategy matters)?
    placeHasLights: placeHasLights,
    isLight: isLight,
    kindNote: kindNote,
    currentWeather: currentWeather,
    sendAmbulance: sendAmbulance,
    setBuses: function (g, on) { g.buses = on; },
    setWeather: function (g, w) { g.weather = w; },
    step: step,
    flip: flip,
    lightAt: lightAt,
    edgeQueues: edgeQueues,
    nextRoadIn: nextRoadIn
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficSim = api;
})(this);
