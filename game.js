/*
 * Green Wave: drawing, input and the bottom strip. The rules live in sim.js.
 */
(function () {
  'use strict';

  var Sim = window.TrafficSim;
  var cfg = Sim.CONFIG;
  var W = cfg.width, H = cfg.height;
  var HALF = cfg.roadWidth / 2;   // half a side street (challenge mode badges use it)

  // Day is the paper map; night is the same map under warm streetlights. Every color in between
  // is a straight blend of the two, so dusk and dawn fade smoothly.
  var DAY = {
    map: '#f5f1e8', grid: '#e6dfd0', road: '#22252b', dash: '#5c6070', car: '#ffffff',
    green: '#2fbf6b', amber: '#f5a524', red: '#e5484d', chip: '#f5f1e8', arrow: '#22252b',
    paper: '#f5f1e8', ink: '#22252b', muted: '#4f525a', track: '#e2dccf', rush: '#e0b15a',
    spark: '#c47a12', danger: '#b3262b', median: '#d9d1c0'
  };
  var NIGHT = {
    map: '#3b362e', grid: '#453f36', road: '#1c1b19', dash: '#5a554c', car: '#f4ead6',
    green: '#5fd38d', amber: '#ffb547', red: '#ff6a5a', chip: '#3b362e', arrow: '#f1e9da',
    paper: '#2b2722', ink: '#f1e9da', muted: '#b5aa96', track: '#463f36', rush: '#c48a35',
    spark: '#ffd166', danger: '#ff8a80', median: '#4d473c'
  };
  var CSS_VARS = ['map', 'paper', 'ink', 'muted', 'track', 'rush', 'spark', 'danger'];
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

  var STRATEGY_NOTES = {
    smart: 'Smart: each light gives green to whichever side has more cars waiting.',
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
    avgWait: $('avgWait'), waitLine: $('waitLine'), strategyNote: $('strategyNote'),
    layoutButtons: $('layoutButtons'), strategyButtons: $('strategyButtons'), speedButtons: $('speedButtons'),
    arrowButtons: $('arrowButtons'),
    traffic: $('traffic'), trafficName: $('trafficName')
  };

  var prefs = loadPrefs();
  var kind = 'chill';          // chill (relaxed, default) | challenge (the game with losing)
  var status = 'running';      // running | paused | ready (challenge start card) | over
  var game = newChillGame();
  var scale = 1;
  var hoverLight = null;
  var toastTimer = 0;
  var lastFrame = 0;
  var palette = DAY, paletteDarkness = -1;
  var chart = [], nextSample = 0;

  // ------------------------------------------------------------------ sizing

  // The world is a fixed 1280 x 680; scale it to fit the map area and keep it sharp on retina screens.
  function resize() {
    var box = mapEl.getBoundingClientRect();
    scale = Math.min(box.width / W, box.height / H);
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
    canvas.width = Math.floor(W * scale * dpr);
    canvas.height = Math.floor(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
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
    return kind === 'chill' ? Sim.darkness(Sim.hourOfDay(game)) : 0;
  }

  // Rebuild the palette only when the light level has visibly changed, and push it to the CSS too.
  function updatePalette(darkness) {
    var d = Math.round(darkness * 100) / 100;
    if (d === paletteDarkness) return;
    paletteDarkness = d;
    palette = {};
    Object.keys(DAY).forEach(function (k) { palette[k] = mixHex(DAY[k], NIGHT[k], d); });
    var root = document.documentElement.style;
    CSS_VARS.forEach(function (k) { root.setProperty('--' + k, palette[k]); });
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

  function draw(darkness, nowMs) {
    ctx.fillStyle = palette.map;
    ctx.fillRect(0, 0, W, H);
    drawGrid();
    drawRoads();
    if (darkness > 0) drawStreetlights(darkness);
    var queues = kind === 'challenge' ? Sim.edgeQueues(game) : null;
    if (queues) drawDanger(queues);
    drawStopBars();
    if (darkness > 0) drawHeadlights(darkness);
    drawCars(nowMs);
    drawLights(darkness);
    if (queues) drawOffMapBadges(queues);
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
    game.roads.forEach(function (r) {
      if (r.axis === 'v') ctx.fillRect(r.c - r.half, 0, r.half * 2, H);
      else ctx.fillRect(0, r.c - r.half, W, r.half * 2);
    });
    ctx.strokeStyle = palette.dash;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    game.roads.forEach(function (r) {
      var offsets = r.avenue ? [-(cfg.avenueMedian / 2 + cfg.avenueLaneWidth), cfg.avenueMedian / 2 + cfg.avenueLaneWidth] : [0];
      offsets.forEach(function (o) {
        if (r.axis === 'v') { ctx.moveTo(r.c + o, 0); ctx.lineTo(r.c + o, H); }
        else { ctx.moveTo(0, r.c + o); ctx.lineTo(W, r.c + o); }
      });
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = palette.median;
    game.roads.forEach(function (r) {
      if (!r.avenue) return;
      var m = cfg.avenueMedian;
      if (r.axis === 'v') ctx.fillRect(r.c - m / 2, 0, m, H);
      else ctx.fillRect(0, r.c - m / 2, W, m);
    });
    // Plain boxes over the crossings so lines and medians don't run through them.
    ctx.fillStyle = palette.road;
    game.lights.forEach(function (l) { ctx.fillRect(l.x - l.hx, l.y - l.hy, l.hx * 2, l.hy * 2); });
  }

  // A warm pool of light around each intersection after dark.
  function drawStreetlights(darkness) {
    game.lights.forEach(function (l) {
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
    game.lanes.forEach(function (lane) {
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
    game.lanes.forEach(function (lane) {
      lane.stops.forEach(function (stop) {
        var r = laneRect(lane, stop.line - 5, stop.line, lane.width - 4);
        ctx.fillStyle = barColor(stop.light, lane);
        roundRect(r.x, r.y, r.w, r.h, 2);
      });
    });
  }

  // Each car is drawn at the middle of its body, turned to its heading, so turning and
  // lane-changing cars follow their path. Cars blink their signal before a turn or lane change.
  function drawCars(nowMs) {
    var len = cfg.carLength, w = cfg.carWidth;
    var blinkOn = Math.floor(nowMs / SIGNAL_BLINK_MS) % 2 === 0;
    game.lanes.forEach(function (lane) {
      lane.cars.forEach(function (car) {
        var c = Sim.carPoint(lane, car, len / 2);
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle);
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

  function drawLights(darkness) {
    game.lights.forEach(function (l) {
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

  function drawOffMapBadges(queues) {
    ctx.font = '800 13px Archivo, sans-serif';
    ctx.textBaseline = 'middle';
    queues.forEach(function (q) {
      if (q.offMap < 1 || q.pressure < 1) return;
      var text = '+' + q.offMap + ' OF ' + cfg.maxOffMap + ' WAITING';
      var bw = ctx.measureText(text).width + 16, bh = 24, pad = 6;
      var road = q.lane.road.c, x, y;
      // Put the badge beside the road at the edge the cars are stuck behind.
      switch (q.lane.dir) {
        case 'S': x = road - HALF - pad - bw; y = pad; break;
        case 'N': x = road + HALF + pad; y = H - pad - bh; break;
        case 'E': x = pad; y = road + HALF + pad; break;
        default: x = W - pad - bw; y = road - HALF - pad - bh;
      }
      ctx.fillStyle = palette.red;
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x + 8, y + bh / 2 + 1);
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

  function updateChillStrip() {
    var hour = Sim.hourOfDay(game);
    setText(ui.dayClock, formatHour(hour));
    setText(ui.dayPhase, Sim.dayPhase(hour));
    ui.dayMarker.style.left = (hour / 24 * 100).toFixed(2) + '%';
    var wait = Sim.averageWait(game);
    setText(ui.avgWait, wait === null ? '–' : wait.toFixed(1) + 's');
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
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.hidden = true; }, 2500);
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
    var p = { lights: 4, traffic: 45, strategy: 'smart', speed: 1, arrows: true };
    try {
      var saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if ([1, 2, 4, 6].indexOf(saved.lights) >= 0) p.lights = saved.lights;
      if (saved.traffic >= 0 && saved.traffic <= 100) p.traffic = saved.traffic;
      if (STRATEGY_NOTES[saved.strategy]) p.strategy = saved.strategy;
      if ([1, 2, 4].indexOf(saved.speed) >= 0) p.speed = saved.speed;
      if (typeof saved.arrows === 'boolean') p.arrows = saved.arrows;
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

  function newChillGame() {
    var options = { strategy: prefs.strategy, arrows: prefs.arrows };
    if (START_HOUR >= 0 && START_HOUR < 24 && location.search.indexOf('hour=') >= 0) options.dayStartHour = START_HOUR;
    return Sim.createChill(prefs.lights, trafficRate(prefs.traffic), options);
  }

  function markPressed(group, value) {
    Array.prototype.forEach.call(group.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.value === String(value)));
    });
  }

  function syncChillControls() {
    ui.traffic.value = String(prefs.traffic);
    ui.trafficName.textContent = trafficName(prefs.traffic);
    markPressed(ui.layoutButtons, prefs.lights);
    markPressed(ui.strategyButtons, prefs.strategy);
    markPressed(ui.speedButtons, prefs.speed);
    markPressed(ui.arrowButtons, prefs.arrows ? 'on' : 'off');
    ui.strategyNote.textContent = STRATEGY_NOTES[prefs.strategy];
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
    ui.pause.classList.toggle('paused', paused);
    ui.pause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  }

  function enterChill() {
    kind = 'chill';
    document.body.className = 'mode-chill';
    ui.hint.textContent = 'Lights run themselves. Click one to take over.';
    ui.modeButton.textContent = 'Try challenge';
    game = newChillGame();
    resetChart();
    status = 'running';
    setPauseButton(false);
    hideCard();
  }

  function enterChallenge() {
    kind = 'challenge';
    document.body.className = 'mode-challenge';
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
    draw(darkness, now);
    updateStrip();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ input

  function worldPoint(e) {
    var box = canvas.getBoundingClientRect();
    return { x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
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

  ui.traffic.addEventListener('input', function () {
    prefs.traffic = Number(ui.traffic.value);
    ui.trafficName.textContent = trafficName(prefs.traffic);
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

  window.addEventListener('resize', resize);
  syncChillControls();
  resize();
  requestAnimationFrame(frame);
})();
