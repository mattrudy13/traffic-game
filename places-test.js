// Places test: runs a day on each place other than Downtown (3 seeds, two traffic levels) and fails
// if any car on the map stands still for 300 s (a real game hour's worth would be 15 s, so 300 s
// can only mean a jam that never clears). Run with:  node places-test.js   (takes ~15 s)
// Why it exists: building stop signs and roundabouts turned up three deadlocks that only showed
// after a few game hours (see README, Places), so they're checked for here.
var Sim = require('./sim.js');
var STUCK = 300, bad = 0;
Sim.PLACES.filter(function (p) { return p !== 'downtown'; }).forEach(function (place) {
  var line = [];
  [30, 50].forEach(function (slider) {
    for (var seed = 1; seed <= 3; seed++) {
      var g = Sim.createChill(4, 0.04 + 0.56 * slider / 100, { seed: seed, place: place, arrows: true, buses: true, ambulances: true });
      var longest = 0;
      for (var i = 0; i < 360 * 60; i++) {
        Sim.step(g, 1 / 60);
        if (i % 60 === 0) g.lanes.forEach(function (l) { l.cars.forEach(function (c) { if (c.wait > longest) longest = c.wait; }); });
      }
      if (longest > STUCK) bad++;
      line.push('s' + slider + '/' + seed + ' ' + Math.round(longest) + 's');
    }
  });
  console.log(place + ': longest standstill ' + line.join(', '));
});
console.log(bad ? bad + ' stuck' : 'all good');
if (bad) process.exitCode = 1;   // so test.js can tell it failed
