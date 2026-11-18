// Kinds test: runs every traffic kind on every layout for a game day (3 strategies) and checks
// nothing gridlocks, no car ever drives on a closed lane, and the stadium crowd really shows up.
// Run with:  node kinds-test.js   (takes ~20 s)
var Sim = require('./sim.js');
var problems = 0;
Sim.KINDS.forEach(function (kind) {
  [1, 2, 4, 6].forEach(function (n) {
    var row = [];
    ['smart', 'timer', 'wave'].forEach(function (st) {
      var g = Sim.createChill(n, 0.29, { seed: 7, strategy: st, kind: kind });
      var last = 0, worst = 1e9, onClosed = 0, crowdBefore = 0, crowdDuring = 0;
      for (var i = 1; i <= 360 * 60; i++) {
        Sim.step(g, 1 / 60);
        if (g.construction) {
          var c = g.construction;
          c.lane.cars.forEach(function (car) { if (car.s - car.len > c.from + 1 && car.s < c.to && !car.shift) onClosed++; });
        }
        if (i % (30 * 60) === 0) {
          var hour = Sim.hourOfDay(g), quiet = hour < 6 || hour > 23.5;
          if (!quiet) worst = Math.min(worst, g.score - last);
          last = g.score;
        }
        if (kind === 'stadium' && i % 60 === 0) {
          var h = Sim.hourOfDay(g), crowd = g.lanes.filter(function (l) { return l.crowd; }).reduce(function (t, l) { return t + l.arrivals; }, 0);
          if (Math.abs(h - 21.0) < 0.07) crowdBefore = crowd;
          if (Math.abs(h - 23.0) < 0.07) crowdDuring = crowd - crowdBefore;
        }
      }
      var bad = worst === 0 || onClosed > 0 || (kind === 'stadium' && crowdDuring < 40);
      if (bad) problems++;
      row.push(st + ' ' + (g.tally.sum / g.tally.count).toFixed(1) + 's min/30s ' + worst +
        (g.construction ? ' closedLaneHits ' + onClosed : '') + (kind === 'stadium' ? ' crowd ' + crowdDuring : '') + (bad ? ' <-- PROBLEM' : ''));
    });
    console.log(kind + ', ' + n + ' lights: ' + row.join(' | '));
  });
});
console.log(problems ? problems + ' PROBLEMS' : 'all good');
