/*
 * Difficulty check: a simple bot plays many games and we look at how long it survives.
 * Run with:  node tune.js
 *
 * The bot flips at most one light per "reaction" (like a person clicking), choosing the
 * light where the red direction has the most cars waiting compared with the green one.
 */
'use strict';
var Sim = require('./sim.js');

function seeded(seed) {
  // Small deterministic random number generator (mulberry32) so runs are repeatable.
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function waitingAt(g, light, axis) {
  var n = 0;
  g.lanes.forEach(function (lane) {
    if (lane.axis !== axis) return;
    lane.stops.forEach(function (stop) {
      if (stop.light !== light) return;
      lane.cars.forEach(function (car) {
        if (car.v < 20 && car.s <= stop.line + 0.5 && car.s > stop.line - 160) n++;
      });
    });
  });
  return n;
}

function play(seed, reaction, maxTime, overrides) {
  var g = Sim.createGame(Object.assign({ rng: seeded(seed) }, overrides));
  var dt = 1 / 60, nextMove = reaction;
  while (!g.over && g.time < maxTime) {
    Sim.step(g, dt);
    if (g.time >= nextMove) {
      nextMove = g.time + reaction;
      var best = null, bestGain = 1;
      g.lights.forEach(function (l) {
        if (l.phase !== 'green' || l.greenFor < 2) return;
        var red = l.axis === 'ns' ? 'ew' : 'ns';
        var gain = waitingAt(g, l, red) - waitingAt(g, l, l.axis);
        if (gain > bestGain) { best = l; bestGain = gain; }
      });
      if (best) Sim.flip(g, best);
    }
  }
  return { time: g.time, score: g.score, reason: g.overReason || 'survived', lights: g.lights.length };
}

module.exports = { play: play };
if (require.main === module) [0.5, 1.0, 2.0].forEach(function (reaction) {
  var results = [];
  for (var seed = 1; seed <= 12; seed++) results.push(play(seed, reaction, 900));
  var times = results.map(function (r) { return r.time; }).sort(function (a, b) { return a - b; });
  var median = times[Math.floor(times.length / 2)];
  console.log('reaction ' + reaction + 's  median survival ' + (median / 60).toFixed(1) + ' min' +
    '  range ' + (times[0] / 60).toFixed(1) + '-' + (times[times.length - 1] / 60).toFixed(1) + ' min' +
    '  median cars ' + results.map(function (r) { return r.score; }).sort(function (a, b) { return a - b; })[6]);
});
