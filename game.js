/*
 * Green Wave: drawing, input and the bottom strip. The rules live in sim.js.
 */
(function () {
  'use strict';

  var Sim = window.TrafficSim;
  var cfg = Sim.CONFIG;
  var W = cfg.width, H = cfg.height;

  // Day is the paper map; night is the same map under warm streetlights. Every color in between
  // is a straight blend of the two, so dusk and dawn fade smoothly.
  var DAY = {
    map: '#f5f1e8', grid: '#e6dfd0', road: '#22252b', dash: '#5c6070', car: '#ffffff',
    green: '#2fbf6b', amber: '#f5a524', red: '#e5484d', chip: '#f5f1e8', arrow: '#22252b',
    paper: '#f5f1e8', ink: '#22252b', muted: '#4f525a', track: '#e2dccf', rush: '#e0b15a',
    spark: '#c47a12', danger: '#b3262b', median: '#d9d1c0',
    sideA: '#24539a', sideAInk: '#f5f1e8', sideB: '#c47a12', sideBInk: '#22252b',
    stadium: '#e9e1cf', field: '#d6e2c6', closed: '#f5a524', cone: '#ff6a00',
    rainInk: '#3460a0', snowEdge: '#ffffff', paint: '#f5f1e8', sign: '#c8323a', island: '#a9c48f'
  };
  var NIGHT = {
    map: '#3b362e', grid: '#453f36', road: '#1c1b19', dash: '#5a554c', car: '#f4ead6',
    green: '#5fd38d', amber: '#ffb547', red: '#ff6a5a', chip: '#3b362e', arrow: '#f1e9da',
    paper: '#2b2722', ink: '#f1e9da', muted: '#b5aa96', track: '#463f36', rush: '#c48a35',
    spark: '#ffd166', danger: '#ff8a80', median: '#4d473c',
    sideA: '#8fb3ea', sideAInk: '#2b2722', sideB: '#ffb547', sideBInk: '#2b2722',
    stadium: '#4a443a', field: '#3f4a38', closed: '#c48a35', cone: '#ff8a3d',
    rainInk: '#aac8f0', snowEdge: '#e8e4dc', paint: '#d8d0c0', sign: '#e5484d', island: '#4f6143'
  };
  // Everything outside the map, plus the bits drawn on it that use the strip's ink and paper.
  var FLIP = { paper: 1, ink: 1, muted: 1, track: 1, rush: 1, spark: 1, danger: 1, sideA: 1, sideAInk: 1,
    sideB: 1, sideBInk: 1, chip: 1, arrow: 1 };
  var CSS_VARS = ['map', 'paper', 'ink', 'muted', 'track', 'rush', 'spark', 'danger', 'sideA', 'sideAInk', 'sideB', 'sideBInk'];
  // CSS custom property names for the palette keys (sideA -> --side-a).
  function cssVarName(k) { return '--' + k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }
  var WAIT_COLOR = '#ffd166', FED_UP_COLOR = '#ff8a3d';
  var SIGNAL_COLOR = '#ff6a00';
  // Same shape as the picked mockup (24 x 24 box).
  var TURN_ICON = new Path2D('M4 20 V12 Q4 7 9 7 H18 M14 3 L19 7 L14 11 M20 4 V12 Q20 17 15 17 H6 M10 13 L5 17 L10 21');
  var SIGNAL_BLINK_MS = 350;   // turn signal on/off time (real time, so 4x speed doesn't strobe)
  var SIGNAL_FROM = 160;       // start signalling this many world px before the stop line

  var WAIT_YELLOW = 2.5;   // seconds stopped at one light before a car turns yellow
  var WAIT_ORANGE = 7;     // ...and orange
  var CLICK_RADIUS = 50;   // world px around an intersection that counts as clicking it
  var BEAM = 30;           // headlight length in world px
  var POOL = 140;          // streetlight glow radius
  var CHART_EVERY = 3;     // sim seconds between wait-chart samples
  var CHART_POINTS = 60;   // samples kept (3 minutes at 1x)
  var BEST_KEY = 'greenWave.best';
  var PREFS_KEY = 'greenWave.chill';
  // Testing aid: index.html?hour=21 starts the day at 9 PM instead of 6:30 AM.
  var START_HOUR = Number(new URLSearchParams(location.search).get('hour'));

  var STRATEGY_NAMES = { smart: 'Smart', timer: 'Timer', wave: 'Green wave' };
  var BUS_WINDOWS = 5;
  var AMBULANCE_RED = '#e5484d', AMBULANCE_BLUE = '#2f6fe0';
  var WEATHER_FADE = 0.5;     // weather fades in or out at this much per real second
  // Fixed scatter of rain streaks and snowflakes (positions as fractions of the view, plus a
  // per-drop speed), so the weather looks random but costs nothing to work out each frame.
  var DROPS = (function () {
    var seed = 12345, out = [];
    function r() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < 220; i++) out.push({ x: r(), y: r(), k: 0.7 + r() * 0.6, size: r() });
    return out;
  })();
  var PLACE_NAMES = { downtown: 'Downtown', main: 'Main Street', suburb: 'Suburb', crosstown: 'Crosstown' };
  var PLACE_NOTES = {
    downtown: '',
    main: 'Main Street: side streets stop and wait for a gap in the avenue; one light at the busiest crossing. The back street has all-way stops.',
    suburb: 'Suburb: no lights. All-way stops, a roundabout where the two through streets meet, and a school run.',
    crosstown: 'Crosstown: two avenues meet at a roundabout, each narrowing to one lane on the way in. Lights on the side streets.'
  };
  // Stadium and Construction are built around Downtown's grid.
  var DOWNTOWN_KINDS = ['stadium', 'construction'];
  var KIND_NAMES = { normal: 'Normal', commute: 'Commute', stadium: 'Stadium', sunday: 'Sunday', construction: 'Construction' };
  var KIND_NOTES = {
    normal: 'Normal: two rush hours; some streets are busier than others.',
    commute: 'Commute: mornings most avenue traffic heads east into town; evenings it heads back west.',
    stadium: 'Stadium: a quieter day, then the game lets out at 9:30 PM and the crowd pours out of the north-east corner. (About 4 minutes in at 1×.)',
    sunday: 'Sunday: no rush hours, light traffic all day, and more people turning.',
    construction: 'Construction: one lane of the lower avenue is closed past its first light, so drivers merge early.'
  };
  var LEAD_MIN_TRIPS = 20;   // trips each map needs today before one is called ahead

  var STRATEGY_NOTES = {
    smart: 'Smart: each light lets the cars on green finish, then switches once clearly more are waiting on red.',
    timer: 'Timer: every light switches every 10 seconds, no matter who is waiting. Lights aren\'t coordinated.',
    wave: 'Green wave: lights turn green one after another from west to east, timed so cars heading east can cruise through.'
  };

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('board'), ctx = canvas.getContext('2d'), mapEl = $('map');
  var ui = {
    overlay: $('overlay'), cardTitle: $('cardTitle'), cardText: $('cardText'), cardStats: $('cardStats'),
    cardButton: $('cardButton'), cardKeys: $('cardKeys'), finalScore: $('finalScore'), finalTime: $('finalTime'),
    bestScore: $('bestScore'), score: $('score'), clock: $('clock'), lights: $('lights'), nextRoad: $('nextRoad'),
    queue: $('queue'), queueEdge: $('queueEdge'), queueStat: $('queueStat'),
    pause: $('pauseButton'), toast: $('toast'), hint: $('hint'), modeButton: $('modeButton'),
    dayClock: $('dayClock'), dayPhase: $('dayPhase'), dayMarker: $('dayMarker'),
    avgWait: $('avgWait'), enter: $('enter'), gaveUp: $('gaveUp'), waitLine: $('waitLine'), strategyNote: $('strategyNote'),
    layoutButtons: $('layoutButtons'), strategyButtons: $('strategyButtons'), speedButtons: $('speedButtons'),
    arrowButtons: $('arrowButtons'),
    controlsOpen: $('controlsOpen'), controlsClose: $('controlsClose'), backdrop: $('sheetBackdrop'),
    sheetChallenge: $('sheetChallenge'),
    traffic: $('traffic'), trafficName: $('trafficName'),
    sheetSpeedButtons: $('sheetSpeedButtons'), kindButtons: $('kindButtons'), kindNote: $('kindNote'),
    controlTabs: $('controlTabs'), cmpKindButtons: $('cmpKindButtons'),
    placeButtons: $('placeButtons'), cmpPlaceButtons: $('cmpPlaceButtons'),
    weatherButtons: $('weatherButtons'), busButtons: $('busButtons'), ambulanceButton: $('ambulanceButton'),
    cmpWeatherButtons: $('cmpWeatherButtons'), cmpBusButtons: $('cmpBusButtons'), cmpAmbulance: $('cmpAmbulance'),
    compareButton: $('compareButton'), sheetCompare: $('sheetCompare'),
    compare: $('compare'), compareExit: $('compareExit'), cmpExitPhone: $('cmpExitPhone'), cmpPause: $('cmpPause'),
    cmpClock: $('cmpClock'), cmpPhase: $('cmpPhase'), cmpMarker: $('cmpMarker'),
    cmpLineA: $('cmpLineA'), cmpLineB: $('cmpLineB'), cmpLegendA: $('cmpLegendA'), cmpLegendB: $('cmpLegendB'),
    cmpLayoutButtons: $('cmpLayoutButtons'), cmpSpeedButtons: $('cmpSpeedButtons'),
    cmpTraffic: $('cmpTraffic'), cmpTrafficName: $('cmpTrafficName'), cmpToast: $('cmpToast'),
    cmpControlsOpen: $('cmpControlsOpen'), cmpControlsClose: $('cmpControlsClose')
  };

  var prefs = loadPrefs();
  var kind = 'chill';          // chill (relaxed, default) | challenge (the game with losing) | compare
  var status = 'running';      // running | paused | ready (challenge start card) | over
  var game = newChillGame();
  var scale = 1;
  var hoverLight = null;
  var toastTimer = 0;
  var lastFrame = 0;
  var palette = DAY, paletteDarkness = -1;
  var chart = [], nextSample = 0;
  var drawn = game;            // the city the drawing functions are drawing right now
  var drawRotated = false;     // ...and whether that view is turned (labels are turned back upright)
  var drawView = mainView;     // ...and the view itself (weather is drawn in screen space)

  // The main map, and the two compare maps. Each has its own canvas, scale and turn.
  var mainView = { canvas: canvas, ctx: ctx, box: mapEl, border: 0, scale: 1, rotated: false };
  var cmpViews = Array.prototype.map.call(document.querySelectorAll('.cmp-side'), function (el) {
    var c = el.querySelector('canvas');
    return {
      el: el, side: el.dataset.side, canvas: c, ctx: c.getContext('2d'), box: el.querySelector('.cmp-map'),
      border: 3, scale: 1, rotated: false,
      stats: {
        avg: el.querySelector('[data-stat="avg"]'), worst: el.querySelector('[data-stat="worst"]'),
        today: el.querySelector('[data-stat="today"]'), lead: el.querySelector('[data-stat="lead"]'),
        enter: el.querySelector('[data-stat="enter"]'), gaveUp: el.querySelector('[data-stat="gaveup"]')
      }
    };
  });
  // Compare mode's two cities (a and b) and their wait charts.
  var cmp = { a: null, b: null, chartA: [], chartB: [], nextSample: 0 };

  // ------------------------------------------------------------------ sizing

  // Small screens (phones either way up) get the slim bar and the pull-up controls sheet.
  // Held upright, the city is also turned a quarter turn so its long side runs down the screen.
  var phoneQuery = window.matchMedia('(max-width: 600px), (max-height: 500px)');
  var uprightQuery = window.matchMedia('(orientation: portrait)');
  var rotated = false;

  function applyPhone() {
    document.body.classList.toggle('phone', phoneQuery.matches);
    if (!phoneQuery.matches) closeSheet();
    resize();
  }

  function resize() {
    if (kind === 'compare') cmpViews.forEach(fitView);
    else fitView(mainView);
    scale = mainView.scale;
    rotated = mainView.rotated;
  }

  // A compare map gets whatever its column has left after the picker and the numbers, so the three
  // stay together instead of the map's box stretching and leaving gaps around the drawing.
  function spaceForMap(view) {
    var side = view.el.getBoundingClientRect();
    var gap = parseFloat(getComputedStyle(view.el).rowGap) || 0;
    var used = 0, shown = 0;
    Array.prototype.forEach.call(view.el.children, function (child) {
      if (child === view.box || !child.offsetHeight) return;
      used += child.offsetHeight;
      shown++;
    });
    return { width: side.width, height: side.height - used - gap * shown };
  }

  // The world is a fixed 1280 x 680; scale it to fit the view's box and keep it sharp on retina screens.
  function fitView(view) {
    var box = view.el ? spaceForMap(view) : view.box.getBoundingClientRect();
    if (!box.width || !box.height) return;   // hidden right now
    var dpr = window.devicePixelRatio || 1;
    view.rotated = phoneQuery.matches && uprightQuery.matches;
    // On screen the world is W x H, or H x W when turned.
    var sw = view.rotated ? H : W, sh = view.rotated ? W : H;
    var b = view.border * 2;
    view.scale = Math.max(0.05, Math.min((box.width - b) / sw, (box.height - b) / sh));
    view.canvas.style.width = Math.floor(sw * view.scale) + 'px';
    view.canvas.style.height = Math.floor(sh * view.scale) + 'px';
    view.canvas.width = Math.floor(sw * view.scale * dpr);
    view.canvas.height = Math.floor(sh * view.scale * dpr);
    var k = view.scale * dpr;
    // Turned: world x runs down the screen and world y runs right-to-left
    // (screenX = H·k − y·k, screenY = x·k).
    if (view.rotated) view.ctx.setTransform(0, k, -k, 0, H * k, 0);
    else view.ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  // ------------------------------------------------------------------ colors

  function mixHex(a, b, t) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * t));
    var g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t));
    var bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }

  function currentDarkness() {
    if (kind === 'compare') return Sim.darkness(Sim.hourOfDay(cmp.a));
    return kind === 'chill' ? Sim.darkness(Sim.hourOfDay(game)) : 0;
  }

  // Rebuild the palette only when the light level has visibly changed, and push it to the CSS too.
  function updatePalette(darkness) {
    var d = Math.round(darkness * 100) / 100;
    if (d === paletteDarkness) return;
    paletteDarkness = d;
    // Text and what it sits on run opposite ways (dark on cream by day, cream on dark by night), so
    // a gradual fade takes them through the same gray mid-dusk and the strip vanishes for a while.
    // Those colors switch all at once at the halfway point instead (style.css eases the switch);
    // the map itself keeps the slow fade.
    var flipped = d < 0.5 ? 0 : 1;
    palette = {};
    Object.keys(DAY).forEach(function (k) { palette[k] = mixHex(DAY[k], NIGHT[k], FLIP[k] ? flipped : d); });
    var root = document.documentElement.style;
    CSS_VARS.forEach(function (k) { root.setProperty(cssVarName(k), palette[k]); });
  }

  // ------------------------------------------------------------------ lane geometry

  // Point on a lane's centre line, `s` px from where the lane enters the map.
  function lanePoint(lane, s) {
    switch (lane.dir) {
      case 'E': return { x: s, y: lane.coord };
      case 'W': return { x: lane.length - s, y: lane.coord };
      case 'S': return { x: lane.coord, y: s };
      default: return { x: lane.coord, y: lane.length - s };
    }
  }

  // Rectangle covering a lane from s0 to s1, `width` px across.
  function laneRect(lane, s0, s1, width) {
    var len = s1 - s0, half = width / 2;
    switch (lane.dir) {
      case 'E': return { x: s0, y: lane.coord - half, w: len, h: width };
      case 'W': return { x: lane.length - s1, y: lane.coord - half, w: len, h: width };
      case 'S': return { x: lane.coord - half, y: s0, w: width, h: len };
      default: return { x: lane.coord - half, y: lane.length - s1, w: width, h: len };
    }
  }


  // ------------------------------------------------------------------ drawing

  // Draw one city into one view. The drawing helpers below use `ctx` and `drawn`.
  function drawInto(view, city, darkness, nowMs) {
    ctx = view.ctx;
    drawn = city;
    drawRotated = view.rotated;
    drawView = view;
    draw(darkness, nowMs);
  }

  function draw(darkness, nowMs) {
    ctx.fillStyle = palette.map;
    ctx.fillRect(0, 0, W, H);
    drawGrid();
    var wx = weatherMix(nowMs);
    if (wx.rain + wx.snow > 0) drawWeatherTint(wx, darkness);
    if (drawn.stadium) drawStadium();
    drawRoads();
    if (wx.rain > 0) drawWetRoads(wx.rain);
    if (wx.snow > 0) drawSnowyEdges(wx.snow);
    if (drawn.construction) drawConstruction();
    drawEndedLanes();
    if (drawn.buses) drawBusStops();
    if (darkness > 0) drawStreetlights(darkness);
    // Every mode shows where cars are queued off the map; only the challenge adds the red glow.
    var queues = Sim.edgeQueues(drawn);
    if (kind === 'challenge') drawDanger(queues);
    drawStopBars();
    if (darkness > 0) drawHeadlights(darkness);
    drawCars(nowMs);
    drawLights(darkness);
    drawOffMapBadges(queues);
    if (wx.rain > 0) drawRain(wx.rain, nowMs);
    if (wx.snow > 0) drawSnow(wx.snow, nowMs);
  }

  // ---- weather

  // How much rain and snow to draw (0..1 each), fading toward the city's current weather so
  // "changing" weather drifts in rather than snapping. Kept on the city, since each compare map draws its own.
  function weatherMix(nowMs) {
    if (kind === 'challenge') return { rain: 0, snow: 0 };
    var now = Sim.currentWeather(drawn), m = drawn.drawWeather;
    if (!m) m = drawn.drawWeather = { rain: now === 'rain' ? 1 : 0, snow: now === 'snow' ? 1 : 0, at: nowMs };
    var step = Math.min(1, (nowMs - m.at) / 1000 * WEATHER_FADE);
    m.at = nowMs;
    m.rain += Math.max(-step, Math.min(step, (now === 'rain' ? 1 : 0) - m.rain));
    m.snow += Math.max(-step, Math.min(step, (now === 'snow' ? 1 : 0) - m.snow));
    return m;
  }

  // A cool grey wash for rain, a whiter map for snow.
  function drawWeatherTint(wx, darkness) {
    if (wx.rain > 0) {
      ctx.fillStyle = 'rgba(56, 84, 124, ' + (0.07 * wx.rain) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (wx.snow > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.35 * wx.snow * (1 - 0.6 * darkness)) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Wet roads: faint light stripes along each road, like a sheen.
  function drawWetRoads(amount) {
    ctx.fillStyle = 'rgba(160, 190, 230, ' + (0.16 * amount) + ')';
    drawn.roads.forEach(function (r) {
      [-0.45, 0.45].forEach(function (f) {
        var c = r.c + f * r.half;
        if (r.axis === 'v') ctx.fillRect(c - 1.5, 0, 3, H);
        else ctx.fillRect(0, c - 1.5, W, 3);
      });
    });
  }

  // Snow piled along the road edges.
  function drawSnowyEdges(amount) {
    ctx.globalAlpha = amount;
    ctx.fillStyle = palette.snowEdge;
    drawn.roads.forEach(function (r) {
      if (r.axis === 'v') { ctx.fillRect(r.c - r.half, 0, 4, H); ctx.fillRect(r.c + r.half - 4, 0, 4, H); }
      else { ctx.fillRect(0, r.c - r.half, W, 4); ctx.fillRect(0, r.c + r.half - 4, W, 4); }
    });
    ctx.globalAlpha = 1;
  }

  // Rain and snow fall down the screen, so they're drawn in screen space (a turned phone map
  // would otherwise have rain falling sideways). They move with real time, not game speed.
  function inScreenSpace(fn) {
    var dpr = window.devicePixelRatio || 1;
    var sw = drawView.canvas.width / dpr, sh = drawView.canvas.height / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fn(sw, sh, Math.min(1, sw * sh / (W * H * 0.5)));
    ctx.restore();
  }

  function drawRain(amount, nowMs) {
    inScreenSpace(function (sw, sh, density) {
      var t = nowMs / 1000, n = Math.round(DROPS.length * Math.max(0.3, density) * 0.75);
      ctx.strokeStyle = palette.rainInk;
      ctx.globalAlpha = 0.5 * amount;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var d = DROPS[i], len = 10 + d.size * 8;
        var y = ((d.y * (sh + 40) + t * 520 * d.k) % (sh + 40)) - 20;
        var x = ((d.x * (sw + 40) + y * 0.32) % (sw + 40)) - 20;
        ctx.moveTo(x, y);
        ctx.lineTo(x + len * 0.32, y + len);
      }
      ctx.stroke();
    });
  }

  function drawSnow(amount, nowMs) {
    inScreenSpace(function (sw, sh, density) {
      var t = nowMs / 1000, n = Math.round(DROPS.length * Math.max(0.3, density) * 0.6);
      ctx.globalAlpha = amount;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(80, 96, 120, 0.35)';
      ctx.lineWidth = 1;
      for (var i = 0; i < n; i++) {
        var d = DROPS[i];
        var y = ((d.y * (sh + 20) + t * 34 * d.k) % (sh + 20)) - 10;
        var x = d.x * sw + Math.sin(t * 0.9 + i) * 6;
        ctx.beginPath();
        ctx.arc(x, y, 1.6 + d.size * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });
  }

  // ---- buses

  // A small ink square on the pavement beside each bus stop.
  function drawBusStops() {
    ctx.fillStyle = palette.ink;
    drawn.lanes.forEach(function (lane) {
      (lane.busStops || []).forEach(function (at) {
        var p = lanePoint(lane, at - 26);
        var out = lane.width / 2 + 11;
        var x = p.x, y = p.y;
        if (lane.dir === 'E') y += out; else if (lane.dir === 'W') y -= out;
        else if (lane.dir === 'S') x -= out; else x += out;
        roundRect(x - 6, y - 6, 12, 12, 2);
      });
    });
  }

  function drawGrid() {
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 40; x < W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (var y = 40; y < H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  // Side streets get a dashed centre line. Avenues get a median down the middle and dashed
  // lines between their two lanes each way.
  function drawRoads() {
    ctx.fillStyle = palette.road;
    drawn.roads.forEach(function (r) {
      if (r.axis === 'v') ctx.fillRect(r.c - r.half, 0, r.half * 2, H);
      else ctx.fillRect(0, r.c - r.half, W, r.half * 2);
    });
    ctx.strokeStyle = palette.dash;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    drawn.roads.forEach(function (r) {
      var offsets = r.avenue ? [-(cfg.avenueMedian / 2 + cfg.avenueLaneWidth), cfg.avenueMedian / 2 + cfg.avenueLaneWidth] : [0];
      offsets.forEach(function (o) {
        if (r.axis === 'v') { ctx.moveTo(r.c + o, 0); ctx.lineTo(r.c + o, H); }
        else { ctx.moveTo(0, r.c + o); ctx.lineTo(W, r.c + o); }
      });
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = palette.median;
    drawn.roads.forEach(function (r) {
      if (!r.avenue) return;
      var m = cfg.avenueMedian;
      if (r.axis === 'v') ctx.fillRect(r.c - m / 2, 0, m, H);
      else ctx.fillRect(0, r.c - m / 2, W, m);
    });
    // Plain boxes over the crossings so lines and medians don't run through them.
    ctx.fillStyle = palette.road;
    drawn.lights.forEach(function (l) {
      if (l.control !== 'round') ctx.fillRect(l.x - l.hx, l.y - l.hy, l.hx * 2, l.hy * 2);
    });
    drawn.lights.forEach(function (l) { if (l.control === 'round') drawRoundabout(l); });
  }

  // A roundabout: a disc of road with a planted island in the middle, edged in white paint.
  function drawRoundabout(l) {
    var outer = l.hx, island = l.ring - cfg.roundLane / 2;
    ctx.fillStyle = palette.road;
    ctx.beginPath();
    ctx.arc(l.x, l.y, outer, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(l.x, l.y, island, 0, Math.PI * 2);
    ctx.fillStyle = palette.island;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.paint;
    ctx.stroke();
  }

  // Yield "shark teeth": a row of small white triangles across the lane, pointing at the driver.
  function drawYieldTeeth(lane, stop) {
    var p = Sim.lanePoint(lane, stop.line - 3), a = p.angle, across = a + Math.PI / 2;
    var n = 4, w = lane.width - 6, size = w / n;
    ctx.fillStyle = palette.paint;
    for (var k = 0; k < n; k++) {
      var o = -w / 2 + size * (k + 0.5);
      var cx = p.x + Math.cos(across) * o, cy = p.y + Math.sin(across) * o;
      ctx.beginPath();
      // Base on the line, tip pointing back toward the approaching car.
      ctx.moveTo(cx + Math.cos(across) * size * 0.42, cy + Math.sin(across) * size * 0.42);
      ctx.lineTo(cx - Math.cos(across) * size * 0.42, cy - Math.sin(across) * size * 0.42);
      ctx.lineTo(cx - Math.cos(a) * size * 0.9, cy - Math.sin(a) * size * 0.9);
      ctx.closePath();
      ctx.fill();
    }
  }

  // The stadium fills (up to a size) the block north-east of the last crossing: an outlined bowl
  // with a pale field, like a building on a paper street map.
  function drawStadium() {
    var st = drawn.stadium, pad = 16;
    var bx0 = st.x0 + pad, bx1 = W - pad, by0 = pad, by1 = st.y1 - pad;
    var w = Math.min(280, bx1 - bx0), h = Math.min(136, by1 - by0);
    if (w < 60 || h < 40) return;
    var cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = palette.stadium;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2 - 44, h / 2 - 28, 0, 0, Math.PI * 2);
    ctx.fillStyle = palette.field;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    drawLabel('STADIUM', cx, cy, null, palette.ink, 15);
  }

  // The closed lane: amber and ink stripes, a few cones where it starts, and a tag beside the road.
  function drawConstruction() {
    var c = drawn.construction, lane = c.lane;
    var r = laneRect(lane, c.from, c.to, lane.width - 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = palette.road;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = palette.closed;
    ctx.lineWidth = 8;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (var x = r.x - r.h - 20; x < r.x + r.w + r.h + 20; x += 18) {
      ctx.moveTo(x, r.y + r.h);
      ctx.lineTo(x + r.h, r.y);
    }
    ctx.stroke();
    ctx.restore();
    // Cones in a short diagonal where the lane closes, pushing traffic over.
    ctx.fillStyle = palette.cone;
    ctx.strokeStyle = palette.paper;
    ctx.lineWidth = 1.5;
    for (var k = 0; k < 4; k++) {
      var p = lanePoint(lane, c.from + 6 + k * 9);
      var side = (k / 3 - 0.5) * (lane.width - 8);   // across the lane, curb side to median side
      var px = p.x, py = p.y;
      if (lane.axis === 'ew') py += (lane.dir === 'E' ? 1 : -1) * side; else px += (lane.dir === 'S' ? -1 : 1) * side;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    var mid = lanePoint(lane, (c.from + Math.min(c.to, c.from + 500)) / 2);
    var road = lane.road;
    if (lane.axis === 'ew') drawLabel('LANE CLOSED', mid.x, road.c + road.half + 16, palette.closed, '#22252b', 12);
    else drawLabel('LANE CLOSED', road.c + road.half + 60, mid.y, palette.closed, '#22252b', 12);
  }

  // Where an avenue's outer lane ends before a roundabout, the closed stretch is painted over as
  // a hatched gore (like the striped area where real lanes end). Construction draws its own.
  function drawEndedLanes() {
    drawn.lanes.forEach(function (lane) {
      lane.stops.forEach(function (stop) {
        if (!stop.closed || (drawn.construction && drawn.construction.stop === stop)) return;
        var r = laneRect(lane, stop.boxEnd, isFinite(stop.segmentEnd) ? stop.segmentEnd : lane.length, lane.width - 2);
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.fillStyle = palette.road;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = palette.paint;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var x = r.x - r.h - r.w; x < r.x + r.w + r.h; x += 12) {
          ctx.moveTo(x, r.y + r.h);
          ctx.lineTo(x + Math.max(r.h, r.w), r.y + r.h - Math.max(r.h, r.w));
        }
        ctx.stroke();
        ctx.restore();
      });
    });
  }

  // Text at a world point, kept upright when the map is drawn turned (phones held upright).
  function drawLabel(text, x, y, bg, fg, size) {
    ctx.save();
    ctx.translate(x, y);
    if (drawRotated) ctx.rotate(-Math.PI / 2);
    ctx.font = '800 ' + size + 'px Archivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    if (bg) {
      var w = ctx.measureText(text).width + 14, h = size + 10;
      ctx.fillStyle = bg;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.fillStyle = fg;
    ctx.fillText(text, 0, 1);
    ctx.restore();
  }

  // A warm pool of light around each intersection after dark.
  function drawStreetlights(darkness) {
    drawn.lights.forEach(function (l) {
      var g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, POOL);
      g.addColorStop(0, 'rgba(255, 206, 130, ' + (0.3 * darkness) + ')');
      g.addColorStop(0.45, 'rgba(255, 206, 130, ' + (0.1 * darkness) + ')');
      g.addColorStop(1, 'rgba(255, 206, 130, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(l.x - POOL, l.y - POOL, POOL * 2, POOL * 2);
    });
  }

  // Headlight beams: one gradient pointing "forward", rotated to each car's heading (curves too).
  function drawHeadlights(darkness) {
    var beam = ctx.createLinearGradient(0, 0, BEAM, 0);
    beam.addColorStop(0, 'rgba(255, 214, 150, ' + (0.42 * darkness) + ')');
    beam.addColorStop(1, 'rgba(255, 214, 150, 0)');
    ctx.fillStyle = beam;
    var width = cfg.carWidth + 4;
    drawn.lanes.forEach(function (lane) {
      lane.cars.forEach(function (car) {
        var p = Sim.carPoint(lane, car, 0);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillRect(0, -width / 2, BEAM, width);
        ctx.restore();
      });
    });
  }

  // A red glow on entry stretches that are filling up, so trouble is visible before it's too late.
  function drawDanger(queues) {
    queues.forEach(function (q) {
      if (q.pressure < 0.6 || !q.lane.stops.length) return;
      var lane = q.lane, stretch = lane.stops[0].line;
      var a = lanePoint(lane, 0), b = lanePoint(lane, stretch);
      var strength = Math.min(1, (q.pressure - 0.6) / 0.8);
      var grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, 'rgba(229, 72, 77, ' + (0.35 + 0.5 * strength) + ')');
      grad.addColorStop(1, 'rgba(229, 72, 77, 0)');
      var r = laneRect(lane, 0, stretch, lane.width);
      ctx.fillStyle = grad;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    });
  }

  function barColor(light, lane) {
    if (light.axis !== lane.axis || light.phase === 'allred') return palette.red;
    // On a left-turn arrow only the avenue's inner (turn) lanes have green.
    if (light.phase === 'arrow') return lane.road.avenue && lane.position === 'inner' ? palette.green : palette.red;
    return light.phase === 'amber' ? palette.amber : palette.green;
  }

  function drawStopBars() {
    drawn.lanes.forEach(function (lane) {
      lane.stops.forEach(function (stop) {
        var L = stop.light;
        if (L.control === 'stop2' || L.control === 'stop4') { drawStopSign(lane, stop); return; }
        if (L.control === 'round') { if (!stop.laneEnds) drawYieldTeeth(lane, stop); return; }
        if (L.control !== 'light') return;
        var r = laneRect(lane, stop.line - 5, stop.line, lane.width - 4);
        ctx.fillStyle = barColor(stop.light, lane);
        roundRect(r.x, r.y, r.w, r.h, 2);
      });
    });
  }

  // A stop sign: a painted white line across each lane that has to stop, and a small red
  // octagon at the curb. Signs get no round chip, since chips are the lights you can click.
  function drawStopSign(lane, stop) {
    var L = stop.light;
    if (L.control === 'stop2' && lane.axis === L.major) return;
    var r = laneRect(lane, stop.line - 4, stop.line, lane.width - 4);
    ctx.fillStyle = palette.paint;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (lane.position === 'inner') return;
    var p = Sim.lanePoint(lane, stop.line - 9), right = p.angle + Math.PI / 2, off = lane.width / 2 + 9;
    drawOctagon(p.x + Math.cos(right) * off, p.y + Math.sin(right) * off, 6.5);
  }

  function drawOctagon(x, y, radius) {
    ctx.beginPath();
    for (var k = 0; k < 8; k++) {
      var a = Math.PI / 8 + k * Math.PI / 4;
      ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    }
    ctx.closePath();
    ctx.fillStyle = palette.sign;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = palette.paint;
    ctx.stroke();
  }

  // Each car is drawn at the middle of its body, turned to its heading, so turning and
  // lane-changing cars follow their path. Cars blink their signal before a turn or lane change.
  function drawCars(nowMs) {
    var len = cfg.carLength, w = cfg.carWidth;
    var blinkOn = Math.floor(nowMs / SIGNAL_BLINK_MS) % 2 === 0;
    drawn.lanes.forEach(function (lane) {
      lane.cars.forEach(function (car) {
        if (car.bus || car.ambulance) { drawSpecial(lane, car, nowMs); return; }
        var c = Sim.carPoint(lane, car, len / 2);
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle);
        // On a one-lane street, cars ahead of an ambulance ease toward the curb (driver's right).
        if (car.aside && !lane.sibling) ctx.translate(0, 5);
        ctx.fillStyle = car.wait >= WAIT_ORANGE ? FED_UP_COLOR : car.wait >= WAIT_YELLOW ? WAIT_COLOR : palette.car;
        roundRect(-len / 2, -w / 2, len, w, w / 2);
        var signal = blinkOn && Sim.signal(lane, car, SIGNAL_FROM);
        if (signal) {
          // In the car's own frame +y is the driver's right (the screen's y axis points down).
          var side = signal === 'left' ? -1 : 1;
          ctx.fillStyle = SIGNAL_COLOR;
          [len / 2 - 4, -len / 2 + 4].forEach(function (x) {
            ctx.beginPath();
            ctx.arc(x, side * (w / 2 - 1), 2.6, 0, Math.PI * 2);
            ctx.fill();
          });
        }
        ctx.restore();
      });
    });
  }

  // Buses: a long white capsule with an ink outline and windows. Ambulances: white with a red
  // cross, red and blue lights flashing at the front, and a soft red glow.
  function drawSpecial(lane, car, nowMs) {
    var len = car.len, w = car.bus ? 14 : 13;
    var c = Sim.carPoint(lane, car, len / 2);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    if (car.ambulance) {
      var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 36);
      glow.addColorStop(0, 'rgba(229, 72, 77, 0.35)');
      glow.addColorStop(1, 'rgba(229, 72, 77, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-36, -36, 72, 72);
    }
    ctx.fillStyle = palette.car;
    roundRect(-len / 2, -w / 2, len, w, w / 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#22252b';
    ctx.stroke();
    if (car.bus) {
      ctx.fillStyle = '#22252b';
      for (var k = 0; k < BUS_WINDOWS; k++) ctx.fillRect(-len / 2 + 7 + k * 8, -3, 5, 6);
    } else {
      ctx.fillStyle = AMBULANCE_RED;
      ctx.fillRect(-5, -1.5, 8, 3);
      ctx.fillRect(-2.5, -4, 3, 8);
      var on = Math.floor(nowMs / 250) % 2 === 0;
      ctx.fillStyle = on ? AMBULANCE_RED : AMBULANCE_BLUE;
      ctx.beginPath(); ctx.arc(len / 2 - 5, -4, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = on ? AMBULANCE_BLUE : AMBULANCE_RED;
      ctx.beginPath(); ctx.arc(len / 2 - 5, 4, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawLights(darkness) {
    drawn.lights.forEach(function (l) {
      if (!Sim.isLight(l)) return;
      var radius = l === hoverLight && status === 'running' ? 18 : 15;
      var ring = l.phase === 'green' || l.phase === 'arrow' ? palette.green : l.phase === 'amber' ? palette.amber : palette.red;
      ctx.beginPath();
      ctx.arc(l.x, l.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = palette.chip;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = ring;
      // Lights glow at night.
      ctx.shadowColor = ring;
      ctx.shadowBlur = 14 * darkness;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (l.phase === 'arrow') drawTurnArrows(l.x, l.y);
      else drawArrow(l.x, l.y, l.axis === 'ns');
    });
  }

  // The left-turn arrow icon: two hooked arrows, one for each direction's left turn.
  function drawTurnArrows(x, y) {
    ctx.save();
    ctx.translate(x - 8, y - 8);
    ctx.scale(16 / 24, 16 / 24);
    ctx.strokeStyle = palette.arrow;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(TURN_ICON);
    ctx.restore();
  }

  // Double-headed arrow showing which way traffic is (or was just) allowed to go.
  function drawArrow(x, y, vertical) {
    var len = 7, head = 4;
    ctx.save();
    ctx.translate(x, y);
    if (!vertical) ctx.rotate(Math.PI / 2);
    ctx.strokeStyle = palette.arrow;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -len); ctx.lineTo(0, len);
    ctx.moveTo(-head, -len + head); ctx.lineTo(0, -len); ctx.lineTo(head, -len + head);
    ctx.moveTo(-head, len - head); ctx.lineTo(0, len); ctx.lineTo(head, len - head);
    ctx.stroke();
    ctx.restore();
  }

  // "+12 WAITING" beside the road at the edge where cars are queued off the map. Shown once the
  // entry stretch is full too, so a car that waits a moment for the one ahead to move doesn't flash one.
  function drawOffMapBadges(queues) {
    ctx.font = '800 13px Archivo, sans-serif';
    queues.forEach(function (q) {
      if (q.offMap < 1 || q.pressure < 1) return;
      var text = kind === 'challenge' ? '+' + q.offMap + ' OF ' + cfg.maxOffMap + ' WAITING' : '+' + q.offMap + ' WAITING';
      var bw = ctx.measureText(text).width + 16, bh = 24, pad = 6;
      // The badge is drawn upright on screen, so on a turned map it takes up bh x bw of the world.
      var ew = drawRotated ? bh : bw, eh = drawRotated ? bw : bh;
      var road = q.lane.road.c, half = q.lane.road.half, x, y;
      switch (q.lane.dir) {
        case 'S': x = road - half - pad - ew; y = pad; break;
        case 'N': x = road + half + pad; y = H - pad - eh; break;
        case 'E': x = pad; y = road + half + pad; break;
        default: x = W - pad - ew; y = road - half - pad - eh;
      }
      ctx.save();
      ctx.translate(x + ew / 2, y + eh / 2);
      if (drawRotated) ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = palette.red;
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 1);
      ctx.restore();
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  // ------------------------------------------------------------------ bottom strip

  function formatTime(seconds) {
    var s = Math.floor(seconds);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function formatHour(hour) {
    var h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function updateStrip() {
    setText(ui.score, game.score.toLocaleString());
    if (kind === 'chill') updateChillStrip();
    else updateChallengeStrip();
  }

  // "morning rush", or the traffic kind's note ("game letting out"), plus the weather if any.
  function phaseText(city, hour) {
    var text = Sim.kindNote(city) || Sim.dayPhase(hour), weather = Sim.currentWeather(city);
    return weather === 'clear' ? text : text + ' · ' + weather;
  }

  function updateChillStrip() {
    var hour = Sim.hourOfDay(game);
    setText(ui.dayClock, formatHour(hour));
    setText(ui.dayPhase, phaseText(game, hour));
    ui.dayMarker.style.left = (hour / 24 * 100).toFixed(2) + '%';
    var wait = Sim.averageWait(game);
    setText(ui.avgWait, wait === null ? '–' : wait.toFixed(1) + 's');
    setText(ui.enter, String(Sim.waitingToEnter(game)));
    setText(ui.gaveUp, gaveUpText(game));
  }

  // Phones drop "today" to keep the slim bar on one row.
  function gaveUpText(city) {
    if (!city.tally.gaveUp) return '';
    return city.tally.gaveUp.toLocaleString() + (phoneQuery.matches ? ' gave up' : ' gave up today');
  }

  function updateChallengeStrip() {
    setText(ui.clock, formatTime(game.time));
    setText(ui.lights, String(game.lights.length));
    var next = Sim.nextRoadIn(game);
    setText(ui.nextRoad, next === null ? 'all roads open' : 'new road in ' + formatTime(Math.ceil(next)));

    var worst = null;
    Sim.edgeQueues(game).forEach(function (q) {
      if (!worst || q.pressure > worst.pressure) worst = q;
    });
    if (!worst) return;
    if (worst.offMap > 0 && worst.pressure >= 1) {
      setText(ui.queue, 'FULL');
      setText(ui.queueEdge, worst.edge + ' edge · ' + worst.offMap + ' of ' + cfg.maxOffMap + ' waiting');
    } else {
      setText(ui.queue, worst.queued + '/' + worst.capacity);
      setText(ui.queueEdge, worst.queued ? worst.edge + ' edge' : '');
    }
    ui.queueStat.classList.toggle('danger', worst.pressure >= 0.75);
  }

  // The wait chart: one point every few sim-seconds, scaled so the tallest point nearly fills it.
  function sampleChart() {
    if (game.time < nextSample) return;
    nextSample = game.time + CHART_EVERY;
    var wait = Sim.averageWait(game);
    chart.push(wait === null ? 0 : wait);
    if (chart.length > CHART_POINTS) chart.shift();
    var top = Math.max(5, Math.max.apply(null, chart)) * 1.1;
    var stepX = 140 / (CHART_POINTS - 1);
    var offset = CHART_POINTS - chart.length;
    ui.waitLine.setAttribute('points', chart.map(function (v, i) {
      return ((i + offset) * stepX).toFixed(1) + ',' + (34 - (v / top) * 32).toFixed(1);
    }).join(' '));
  }

  function resetChart() {
    chart = [];
    nextSample = 0;
    ui.waitLine.setAttribute('points', '');
  }

  function showToast(text) {
    var el = kind === 'compare' ? ui.cmpToast : ui.toast;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2500);
  }

  // ------------------------------------------------------------------ compare strip

  function formatWait(seconds) {
    return seconds === null ? '–' : seconds.toFixed(1) + 's';
  }

  function todayAverage(city) {
    return city.tally.count ? city.tally.sum / city.tally.count : null;
  }

  function updateCompareStrip() {
    var hour = Sim.hourOfDay(cmp.a);
    setText(ui.cmpClock, formatHour(hour));
    setText(ui.cmpPhase, phaseText(cmp.a, hour));
    ui.cmpMarker.style.left = (hour / 24 * 100).toFixed(2) + '%';

    // Who is ahead goes by today's average, which settles down; the last minute jumps around.
    var avgA = todayAverage(cmp.a), avgB = todayAverage(cmp.b);
    var enough = cmp.a.tally.count >= LEAD_MIN_TRIPS && cmp.b.tally.count >= LEAD_MIN_TRIPS;
    var gap = enough ? Math.round(Math.abs(avgA - avgB) * 10) / 10 : 0;
    var leader = !enough || gap === 0 ? null : avgA < avgB ? 'a' : 'b';
    cmpViews.forEach(function (v) {
      var city = cmp[v.side], st = v.stats;
      setText(st.avg, formatWait(Sim.averageWait(city)));
      setText(st.worst, city.tally.count ? Math.round(city.tally.worst) + 's' : '–');
      setText(st.today, formatWait(todayAverage(city)));
      setText(st.enter, String(Sim.waitingToEnter(city)));
      setText(st.gaveUp, gaveUpText(city));
      var lead = !enough ? 'Too early to call' : !leader ? 'Even so far today'
        : leader === v.side ? 'Ahead by ' + gap.toFixed(1) + 's today' : gap.toFixed(1) + 's behind today';
      setText(st.lead, lead);
      st.lead.classList.toggle('ahead', leader === v.side);
    });
  }

  // Both lines share one scale so their heights can be compared directly.
  function sampleCompareChart() {
    if (cmp.a.time < cmp.nextSample) return;
    cmp.nextSample = cmp.a.time + CHART_EVERY;
    [['chartA', cmp.a], ['chartB', cmp.b]].forEach(function (p) {
      var wait = Sim.averageWait(p[1]);
      cmp[p[0]].push(wait === null ? 0 : wait);
      if (cmp[p[0]].length > CHART_POINTS) cmp[p[0]].shift();
    });
    var top = Math.max(5, Math.max.apply(null, cmp.chartA.concat(cmp.chartB))) * 1.1;
    var stepX = 260 / (CHART_POINTS - 1);
    function points(values) {
      var offset = CHART_POINTS - values.length;
      return values.map(function (v, i) {
        return ((i + offset) * stepX).toFixed(1) + ',' + (42 - (v / top) * 40).toFixed(1);
      }).join(' ');
    }
    ui.cmpLineA.setAttribute('points', points(cmp.chartA));
    ui.cmpLineB.setAttribute('points', points(cmp.chartB));
  }

  // ------------------------------------------------------------------ settings

  function loadBest() {
    try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
  }

  function saveBest(score) {
    try { localStorage.setItem(BEST_KEY, String(score)); } catch (e) { /* private window: skip */ }
  }

  // Chill settings are remembered per browser so the city comes back the way you left it.
  function loadPrefs() {
    var p = { lights: 4, traffic: 45, strategy: 'smart', speed: 1, arrows: true, compare: null, kind: 'normal', tab: 'lights',
      weather: 'clear', buses: true, place: 'downtown' };
    try {
      var saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if ([1, 2, 4, 6].indexOf(saved.lights) >= 0) p.lights = saved.lights;
      if (saved.traffic >= 0 && saved.traffic <= 100) p.traffic = saved.traffic;
      if (STRATEGY_NOTES[saved.strategy]) p.strategy = saved.strategy;
      if ([1, 2, 4].indexOf(saved.speed) >= 0) p.speed = saved.speed;
      if (typeof saved.arrows === 'boolean') p.arrows = saved.arrows;
      if (KIND_NAMES[saved.kind]) p.kind = saved.kind;
      if (['lights', 'traffic', 'extras'].indexOf(saved.tab) >= 0) p.tab = saved.tab;
      if (['clear', 'rain', 'snow', 'changing'].indexOf(saved.weather) >= 0) p.weather = saved.weather;
      if (typeof saved.buses === 'boolean') p.buses = saved.buses;
      if (Sim.PLACES.indexOf(saved.place) >= 0) p.place = saved.place;
      if (p.place !== 'downtown' && DOWNTOWN_KINDS.indexOf(p.kind) >= 0) p.kind = 'normal';
      var c = saved.compare;
      if (c && c.a && c.b && STRATEGY_NOTES[c.a.strategy] && STRATEGY_NOTES[c.b.strategy]) {
        p.compare = {
          a: { strategy: c.a.strategy, arrows: c.a.arrows !== false },
          b: { strategy: c.b.strategy, arrows: c.b.arrows !== false }
        };
      }
    } catch (e) { /* use defaults */ }
    return p;
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* skip */ }
  }

  // Slider 0-100 -> cars per second arriving on each lane, before the time-of-day multiplier.
  function trafficRate(value) {
    return 0.04 + 0.56 * (value / 100);
  }

  function trafficName(value) {
    return value < 25 ? 'light' : value < 60 ? 'normal' : value < 85 ? 'busy' : 'very busy';
  }

  // Slider value where, on a normal day with arrows on, drivers start giving up at rush hour
  // (the first value from which at least 2 of 3 seeded days had give-ups). Measured in steps
  // of 5, so treat it as +-5. Smart overloads first: it compares raw car counts, and the
  // avenue's 4 lanes outnumber the street's 2, so the street gets little green at rush hour.
  var CAPACITY = {
    1: { smart: 55, timer: 65, wave: 65 },
    2: { smart: 55, timer: 60, wave: 60 },
    4: { smart: 55, timer: 60, wave: 60 },
    6: { smart: 55, timer: 55, wave: 55 }
  };
  // The same measure for the other places (lights count doesn't apply there). Suburb has no lights,
  // so its strategy doesn't matter; its quieter school-run day carries more before it overloads.
  var PLACE_CAPACITY = {
    main: { smart: 45, timer: 60, wave: 55 },
    suburb: { smart: 70, timer: 70, wave: 70 },
    crosstown: { smart: 55, timer: 55, wave: 55 }
  };

  // Name the slider value and shade the track past capacity. Above it the filled part turns
  // red too, so it reads as "too much" before the badges pile up.
  function showTraffic(input, nameEl, cap) {
    var v = prefs.traffic, over = v >= cap;
    nameEl.textContent = over ? 'overloaded' : trafficName(v);
    nameEl.classList.toggle('over', over);
    var soft = 'color-mix(in srgb, var(--danger) 30%, var(--track))';
    input.style.setProperty('--range', over
      ? 'linear-gradient(to right, var(--ink) 0 ' + cap + '%, var(--danger) ' + cap + '% ' + v + '%, ' + soft + ' ' + v + '%)'
      : 'linear-gradient(to right, var(--ink) 0 ' + v + '%, var(--track) ' + v + '% ' + cap + '%, ' + soft + ' ' + cap + '%)');
  }
  function capacity(strategy) {
    var row = prefs.place === 'downtown' ? CAPACITY[prefs.lights] : PLACE_CAPACITY[prefs.place];
    return row ? row[strategy] : 101;
  }
  function chillCapacity() { return capacity(prefs.strategy); }
  // The first of the two maps to overload sets the mark.
  function compareCapacity() {
    return Math.min(capacity(prefs.compare.a.strategy), capacity(prefs.compare.b.strategy));
  }

  // `hour` (optional) starts the day at that time, so leaving compare mode carries on the same day.
  function newChillGame(hour) {
    var options = { strategy: prefs.strategy, arrows: prefs.arrows, kind: prefs.kind, weather: prefs.weather, buses: prefs.buses, ambulances: true,
      place: prefs.place };
    if (START_HOUR >= 0 && START_HOUR < 24 && location.search.indexOf('hour=') >= 0) options.dayStartHour = START_HOUR;
    if (hour !== undefined) options.dayStartHour = hour;
    return Sim.createChill(prefs.lights, trafficRate(prefs.traffic), options);
  }

  // Two cities with the same seed get exactly the same cars (see sim.js), so only the lights differ.
  function startCompare(hour) {
    var seed = Math.floor(Math.random() * 4294967296);
    ['a', 'b'].forEach(function (side) {
      var setup = prefs.compare[side];
      cmp[side] = Sim.createChill(prefs.lights, trafficRate(prefs.traffic),
        { seed: seed, strategy: setup.strategy, arrows: setup.arrows, kind: prefs.kind, weather: prefs.weather,
          buses: prefs.buses, ambulances: true, dayStartHour: hour, place: prefs.place });
    });
    cmp.chartA = [];
    cmp.chartB = [];
    cmp.nextSample = 0;
    ui.cmpLineA.setAttribute('points', '');
    ui.cmpLineB.setAttribute('points', '');
  }

  function syncCompareControls() {
    Array.prototype.forEach.call(document.querySelectorAll('.side-seg'), function (group) {
      var setup = prefs.compare[group.dataset.side];
      var value = group.dataset.setting === 'arrows' ? (setup.arrows ? 'on' : 'off') : setup.strategy;
      markPressed(group, value);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.cmp-pick'), function (b) {
      var setup = prefs.compare[b.dataset.side];
      b.querySelector('[data-name]').textContent = STRATEGY_NAMES[setup.strategy];
      b.querySelector('[data-arrows]').textContent = setup.arrows ? 'arrows on' : 'arrows off';
      b.setAttribute('aria-label', 'Map ' + b.dataset.side.toUpperCase() + ': ' + STRATEGY_NAMES[setup.strategy] +
        ', arrows ' + (setup.arrows ? 'on' : 'off') + '. Change');
    });
    setText(ui.cmpLegendA, 'A · ' + STRATEGY_NAMES[prefs.compare.a.strategy]);
    setText(ui.cmpLegendB, 'B · ' + STRATEGY_NAMES[prefs.compare.b.strategy]);
    markPressed(ui.cmpLayoutButtons, prefs.lights);
    markPressed(ui.cmpPlaceButtons, prefs.place);
    showPlace();
    markPressed(ui.cmpSpeedButtons, prefs.speed);
    markPressed(ui.cmpKindButtons, prefs.kind);
    markPressed(ui.cmpWeatherButtons, prefs.weather);
    markPressed(ui.cmpBusButtons, prefs.buses ? 'on' : 'off');
    ui.cmpTraffic.value = String(prefs.traffic);
    showTraffic(ui.cmpTraffic, ui.cmpTrafficName, compareCapacity());
  }

  // Body class for the place, so Downtown-only controls (lights count, Stadium, Construction) hide elsewhere.
  function showPlace() {
    Sim.PLACES.forEach(function (p) { document.body.classList.toggle('place-' + p, p === prefs.place); });
    if (kind === 'chill') ui.hint.textContent = chillHint();
  }

  function chillHint() {
    return Sim.placeHasLights(prefs.place) ? 'Lights run themselves. Click one to take over.' : 'Stop signs and a roundabout; they run themselves.';
  }

  // Place buttons come from the sim's list, so a place shows up once it exists there.
  // Compare races two light strategies, so it leaves out places without lights.
  [ui.placeButtons, ui.cmpPlaceButtons].forEach(function (group) {
    Sim.PLACES.forEach(function (p) {
      if (group === ui.cmpPlaceButtons && !Sim.placeHasLights(p)) return;
      var b = document.createElement('button');
      b.dataset.value = p;
      b.textContent = PLACE_NAMES[p];
      group.appendChild(b);
    });
  });

  // A new place is a new map, so the day starts again there.
  function setPlace(value) {
    prefs.place = value;
    if (value !== 'downtown' && DOWNTOWN_KINDS.indexOf(prefs.kind) >= 0) prefs.kind = 'normal';
  }

  function markPressed(group, value) {
    Array.prototype.forEach.call(group.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.value === String(value)));
    });
  }

  function syncChillControls() {
    ui.traffic.value = String(prefs.traffic);
    showTraffic(ui.traffic, ui.trafficName, chillCapacity());
    markPressed(ui.layoutButtons, prefs.lights);
    markPressed(ui.placeButtons, prefs.place);
    showPlace();
    markPressed(ui.strategyButtons, prefs.strategy);
    markPressed(ui.speedButtons, prefs.speed);
    markPressed(ui.sheetSpeedButtons, prefs.speed);
    markPressed(ui.arrowButtons, prefs.arrows ? 'on' : 'off');
    markPressed(ui.kindButtons, prefs.kind);
    markPressed(ui.weatherButtons, prefs.weather);
    markPressed(ui.busButtons, prefs.buses ? 'on' : 'off');
    var strategyNote = Sim.placeHasLights(prefs.place) ? STRATEGY_NOTES[prefs.strategy] : '';
    ui.strategyNote.textContent = PLACE_NOTES[prefs.place] ? PLACE_NOTES[prefs.place] + ' ' + strategyNote : strategyNote;
    ui.kindNote.textContent = KIND_NOTES[prefs.kind];
    showTab(prefs.tab);
  }

  // Lights / Traffic tabs over the chill controls.
  function showTab(name) {
    Array.prototype.forEach.call(ui.controlTabs.querySelectorAll('[role="tab"]'), function (t) {
      var on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#controlsSheet .tab-panel'), function (p) {
      p.hidden = p.dataset.tab !== name;
    });
  }

  // ------------------------------------------------------------------ game flow

  function showCard(which) {
    ui.overlay.hidden = false;
    ui.cardStats.hidden = which !== 'over';
    ui.cardKeys.hidden = which === 'over';
    if (which === 'ready') {
      ui.cardTitle.textContent = 'Challenge';
      ui.cardText.textContent = 'Now the lights are all yours. Click an intersection to switch which way is green. ' +
        'Don\'t let a queue back up off the edge of the map. New roads open as you go.';
      ui.cardButton.textContent = 'Start';
    } else if (which === 'paused') {
      ui.cardTitle.textContent = 'Paused';
      ui.cardText.textContent = 'The cars will wait. Mostly.';
      ui.cardButton.textContent = 'Resume';
    } else if (which === 'over') {
      var best = loadBest(), isBest = game.score > best;
      if (isBest) saveBest(game.score);
      ui.cardTitle.textContent = 'Gridlock';
      ui.cardText.textContent = game.overReason + (isBest && game.score > 0 ? ' New best!' : '');
      ui.finalScore.textContent = String(game.score);
      ui.finalTime.textContent = formatTime(game.time);
      ui.bestScore.textContent = String(Math.max(best, game.score));
      ui.cardButton.textContent = 'Play again';
    }
    ui.cardButton.focus();
  }

  function hideCard() {
    ui.overlay.hidden = true;
    ui.cardButton.blur();
  }

  function setPauseButton(paused) {
    [ui.pause, ui.cmpPause].forEach(function (b) {
      b.classList.toggle('paused', paused);
      b.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    });
  }

  function setModeClass(name) {
    document.body.classList.remove('mode-chill', 'mode-challenge', 'mode-compare');
    document.body.classList.add(name);
  }

  // Phones: the chill controls slide up as a sheet over the map. The city keeps running.
  function openSheet() {
    document.body.classList.add('sheet-open');
    ui.backdrop.hidden = false;
    ui.controlsOpen.setAttribute('aria-expanded', 'true');
    ui.cmpControlsOpen.setAttribute('aria-expanded', 'true');
  }

  function closeSheet() {
    document.body.classList.remove('sheet-open');
    ui.backdrop.hidden = true;
    ui.controlsOpen.setAttribute('aria-expanded', 'false');
    ui.cmpControlsOpen.setAttribute('aria-expanded', 'false');
  }

  // Compare mode replaces the map and strip with two maps side by side. The pause card moves along.
  function enterCompare() {
    var hour = Sim.hourOfDay(game);
    if (!Sim.placeHasLights(prefs.place)) setPlace('downtown');
    if (!prefs.compare) {
      // First time: map A is the city as you had it, map B the strategy most worth comparing it with.
      prefs.compare = {
        a: { strategy: prefs.strategy, arrows: prefs.arrows },
        b: { strategy: prefs.strategy === 'wave' ? 'smart' : 'wave', arrows: prefs.arrows }
      };
      savePrefs();
    }
    kind = 'compare';
    setModeClass('mode-compare');
    closeSheet();
    mapEl.hidden = true;
    document.querySelector('.game > .strip').hidden = true;
    ui.compare.hidden = false;
    ui.compare.appendChild(ui.overlay);
    hoverLight = null;
    startCompare(hour);
    syncCompareControls();
    status = 'running';
    setPauseButton(false);
    hideCard();
    resize();
  }

  function exitCompare() {
    var hour = Sim.hourOfDay(cmp.a);
    closeSheet();
    ui.compare.hidden = true;
    mapEl.hidden = false;
    document.querySelector('.game > .strip').hidden = false;
    mapEl.appendChild(ui.overlay);
    cmp.a = cmp.b = null;
    enterChill(hour);
    syncChillControls();
    resize();
  }

  function enterChill(hour) {
    kind = 'chill';
    setModeClass('mode-chill');
    ui.hint.textContent = chillHint();
    ui.modeButton.textContent = 'Try challenge';
    game = newChillGame(hour);
    resetChart();
    status = 'running';
    setPauseButton(false);
    hideCard();
  }

  function enterChallenge() {
    kind = 'challenge';
    setModeClass('mode-challenge');
    closeSheet();
    ui.hint.textContent = 'Click a light to flip it';
    ui.modeButton.textContent = 'Back to chill';
    game = Sim.createGame();
    status = 'ready';
    setPauseButton(false);
    showCard('ready');
  }

  function startChallenge() {
    game = Sim.createGame();
    status = 'running';
    setPauseButton(false);
    hideCard();
  }

  function pause() {
    if (status !== 'running') return;
    status = 'paused';
    setPauseButton(true);
    showCard('paused');
  }

  function resume() {
    if (status !== 'paused') return;
    status = 'running';
    setPauseButton(false);
    hideCard();
  }

  function togglePause() {
    if (status === 'running') pause();
    else if (status === 'paused') resume();
  }

  function frame(now) {
    // Cap the step so a background tab or a slow frame can't teleport cars through each other.
    var dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (kind === 'compare') {
      compareFrame(dt, now);
      requestAnimationFrame(frame);
      return;
    }
    if (status === 'running') {
      // Fast-forward runs more small steps per frame rather than bigger ones, so cars stay accurate.
      var steps = 2 * (kind === 'chill' ? prefs.speed : 1);
      for (var i = 0; i < steps; i++) Sim.step(game, dt / 2);
      while (game.events.length) {
        if (game.events.shift().type === 'road') showToast('New road open');
      }
      if (kind === 'chill') sampleChart();
      if (game.over) {
        status = 'over';
        showCard('over');
      }
    }
    var darkness = currentDarkness();
    updatePalette(darkness);
    drawInto(mainView, game, darkness, now);
    updateStrip();
    requestAnimationFrame(frame);
  }

  // Both cities take exactly the same steps, so the same car arrives at the same moment in each.
  function compareFrame(dt, now) {
    if (status === 'running') {
      var steps = 2 * prefs.speed;
      for (var i = 0; i < steps; i++) {
        Sim.step(cmp.a, dt / 2);
        Sim.step(cmp.b, dt / 2);
      }
      sampleCompareChart();
      cmp.a.events.length = 0;    // nothing to announce in compare mode (ambulances toast on the button)
      cmp.b.events.length = 0;
    }
    var darkness = currentDarkness();
    updatePalette(darkness);
    drawInto(cmpViews[0], cmp.a, darkness, now);
    drawInto(cmpViews[1], cmp.b, darkness, now);
    updateCompareStrip();
  }

  // ------------------------------------------------------------------ input

  function worldPoint(e) {
    var box = canvas.getBoundingClientRect();
    var sx = (e.clientX - box.left) / scale, sy = (e.clientY - box.top) / scale;
    // Undo the quarter turn used on phones.
    return rotated ? { x: sy, y: H - sx } : { x: sx, y: sy };
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (status !== 'running') return;
    var p = worldPoint(e);
    Sim.manualFlip(game, Sim.lightAt(game, p.x, p.y, CLICK_RADIUS));
  });

  canvas.addEventListener('pointermove', function (e) {
    var p = worldPoint(e);
    hoverLight = Sim.lightAt(game, p.x, p.y, CLICK_RADIUS);
    canvas.classList.toggle('over-light', !!hoverLight && status === 'running');
  });

  canvas.addEventListener('pointerleave', function () {
    hoverLight = null;
    canvas.classList.remove('over-light');
  });

  ui.cardButton.addEventListener('click', function () {
    if (status === 'paused') resume();
    else startChallenge();
  });

  ui.pause.addEventListener('click', togglePause);

  ui.modeButton.addEventListener('click', function () {
    if (kind === 'chill') enterChallenge();
    else enterChill();
  });

  function onSegment(group, handler) {
    group.addEventListener('click', function (e) {
      var button = e.target.closest('button');
      if (!button) return;
      handler(button.dataset.value);
      savePrefs();
      syncChillControls();
    });
  }

  onSegment(ui.placeButtons, function (value) {
    if (prefs.place === value) return;
    setPlace(value);
    game = newChillGame(Sim.hourOfDay(game));
    resetChart();
  });

  // A different number of lights redraws the city from scratch (and restarts the day).
  onSegment(ui.layoutButtons, function (value) {
    prefs.lights = Number(value);
    game = newChillGame();
    resetChart();
  });

  // Strategy and speed change the running city without restarting it.
  onSegment(ui.strategyButtons, function (value) {
    prefs.strategy = value;
    Sim.setStrategy(game, value);
  });

  // Arrows can be switched while the city runs, to compare waits with and without them.
  onSegment(ui.arrowButtons, function (value) {
    prefs.arrows = value === 'on';
    Sim.setArrows(game, prefs.arrows);
  });

  onSegment(ui.speedButtons, function (value) {
    prefs.speed = Number(value);
  });
  onSegment(ui.sheetSpeedButtons, function (value) {
    prefs.speed = Number(value);
  });

  // A different traffic kind is a different day, so the day starts again.
  onSegment(ui.kindButtons, function (value) {
    if (prefs.kind === value) return;
    prefs.kind = value;
    game = newChillGame();
    resetChart();
  });

  // Weather and buses change the running city (both maps in compare mode); no restart.
  onSegment(ui.weatherButtons, function (value) {
    prefs.weather = value;
    Sim.setWeather(game, value);
  });
  onSegment(ui.busButtons, function (value) {
    prefs.buses = value === 'on';
    Sim.setBuses(game, prefs.buses);
  });
  ui.ambulanceButton.addEventListener('click', function () {
    Sim.sendAmbulance(game, Math.random());
    showToast('Ambulance on its way');
  });

  ui.controlTabs.addEventListener('click', function (e) {
    var tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    prefs.tab = tab.dataset.tab;
    savePrefs();
    showTab(prefs.tab);
  });
  // Arrow keys move between tabs, as screen-reader users expect from a tab list.
  ui.controlTabs.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var tabs = Array.prototype.slice.call(ui.controlTabs.querySelectorAll('[role="tab"]'));
    var at = tabs.indexOf(document.activeElement);
    if (at < 0) return;
    var next = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    prefs.tab = next.dataset.tab;
    savePrefs();
    showTab(prefs.tab);
    next.focus();
  });

  ui.traffic.addEventListener('input', function () {
    prefs.traffic = Number(ui.traffic.value);
    showTraffic(ui.traffic, ui.trafficName, chillCapacity());
    Sim.setTraffic(game, trafficRate(prefs.traffic));
  });
  ui.traffic.addEventListener('change', savePrefs);

  window.addEventListener('keydown', function (e) {
    // A focused button handles Space itself; doing it here too would toggle twice.
    if (e.target.tagName === 'BUTTON') return;
    if (e.code === 'Space' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      togglePause();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pause();
  });

  // ---- compare mode

  ui.compareButton.addEventListener('click', enterCompare);
  ui.sheetCompare.addEventListener('click', enterCompare);
  ui.compareExit.addEventListener('click', exitCompare);
  ui.cmpExitPhone.addEventListener('click', exitCompare);
  ui.cmpPause.addEventListener('click', togglePause);
  ui.cmpControlsOpen.addEventListener('click', openSheet);
  ui.cmpControlsClose.addEventListener('click', closeSheet);
  Array.prototype.forEach.call(document.querySelectorAll('.cmp-pick'), function (b) {
    b.addEventListener('click', openSheet);
  });

  // Restart both maps from empty roads at the same time of day, so neither carries a head start.
  function restartCompare(message) {
    startCompare(Sim.hourOfDay(cmp.a));
    showToast(message);
  }

  // Each map's lights. Changing one restarts both: switching a city that already has its own
  // queues wouldn't be a fair race.
  Array.prototype.forEach.call(document.querySelectorAll('.side-seg'), function (group) {
    group.addEventListener('click', function (e) {
      var button = e.target.closest('button');
      if (!button) return;
      var setup = prefs.compare[group.dataset.side];
      var value = group.dataset.setting === 'arrows' ? button.dataset.value === 'on' : button.dataset.value;
      if (setup[group.dataset.setting] === value) return;
      setup[group.dataset.setting] = value;
      savePrefs();
      syncCompareControls();
      restartCompare('Both maps restarted with the same cars');
    });
  });

  function onCompareSegment(group, handler) {
    group.addEventListener('click', function (e) {
      var button = e.target.closest('button');
      if (!button) return;
      handler(button.dataset.value);
      savePrefs();
      syncCompareControls();
      syncChillControls();
    });
  }

  onCompareSegment(ui.cmpLayoutButtons, function (value) {
    if (prefs.lights === Number(value)) return;
    prefs.lights = Number(value);
    restartCompare('Both maps restarted with ' + value + (value === '1' ? ' light' : ' lights'));
    resize();
  });

  onCompareSegment(ui.cmpPlaceButtons, function (value) {
    if (prefs.place === value) return;
    setPlace(value);
    restartCompare('Both maps moved to ' + PLACE_NAMES[value]);
    resize();
  });

  // A new traffic kind is a new day for both maps.
  onCompareSegment(ui.cmpKindButtons, function (value) {
    if (prefs.kind === value) return;
    prefs.kind = value;
    startCompare(cfg.dayStartHour);
    showToast('New day on both maps: ' + KIND_NAMES[value]);
  });

  onCompareSegment(ui.cmpWeatherButtons, function (value) {
    prefs.weather = value;
    Sim.setWeather(cmp.a, value);
    Sim.setWeather(cmp.b, value);
  });
  onCompareSegment(ui.cmpBusButtons, function (value) {
    prefs.buses = value === 'on';
    Sim.setBuses(cmp.a, prefs.buses);
    Sim.setBuses(cmp.b, prefs.buses);
  });
  // The same pick on both maps, so the same road gets the ambulance on each.
  ui.cmpAmbulance.addEventListener('click', function () {
    var pick = Math.random();
    Sim.sendAmbulance(cmp.a, pick);
    Sim.sendAmbulance(cmp.b, pick);
    showToast('Ambulance on its way on both maps');
  });

  onCompareSegment(ui.cmpSpeedButtons, function (value) {
    prefs.speed = Number(value);
  });

  // Traffic changes both cities at once, so they stay matched without a restart.
  ui.cmpTraffic.addEventListener('input', function () {
    prefs.traffic = Number(ui.cmpTraffic.value);
    showTraffic(ui.cmpTraffic, ui.cmpTrafficName, compareCapacity());
    Sim.setTraffic(cmp.a, trafficRate(prefs.traffic));
    Sim.setTraffic(cmp.b, trafficRate(prefs.traffic));
  });
  ui.cmpTraffic.addEventListener('change', function () { savePrefs(); syncChillControls(); });

  ui.controlsOpen.addEventListener('click', openSheet);
  ui.controlsClose.addEventListener('click', closeSheet);
  ui.backdrop.addEventListener('click', closeSheet);
  ui.sheetChallenge.addEventListener('click', enterChallenge);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheet();
  });

  window.addEventListener('resize', resize);
  phoneQuery.addEventListener('change', applyPhone);
  uprightQuery.addEventListener('change', applyPhone);
  syncChillControls();
  applyPhone();
  // Testing aid: index.html?compare opens compare mode straight away.
  if (new URLSearchParams(location.search).has('compare')) enterCompare();
  requestAnimationFrame(frame);
})();
