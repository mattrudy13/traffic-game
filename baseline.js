// Baseline: what each place does on a seeded day, so a rewrite of the engine can be checked against
// today's behavior. For every place and light strategy (and Downtown's 1/2/4/6 lights): trips, mean
// wait and drivers who gave up, over 3 seeded normal days at slider 45 with arrows on. Plus the
// challenge bot's median survival (tune.js) at three reaction times.
//   node baseline.js           print the numbers
//   node baseline.js --save    write them to baseline.json
//   node baseline.js --check   compare with baseline.json: waits and trips within 10%, give-ups within 10% or 5
// Takes ~1 min.
var fs = require('fs'), Sim = require('./sim.js'), tune = require('./tune.js');
var SEEDS = [11, 202, 3003], SLIDER = 45, TOLERANCE = 0.1;

function day(lights, strategy, place) {
  var trips = 0, sum = 0, gave = 0;
  SEEDS.forEach(function (seed) {
    var g = Sim.createChill(lights, 0.04 + 0.56 * SLIDER / 100, { seed: seed, strategy: strategy, arrows: true, place: place });
    for (var i = 0; i < 360 * 60; i++) {
      var c0 = g.tally.count, s0 = g.tally.sum, g0 = g.tally.gaveUp;
      Sim.step(g, 1 / 60);
      // The tally resets at midnight; count what was added either way.
      if (g.tally.count >= c0) { trips += g.tally.count - c0; sum += g.tally.sum - s0; gave += g.tally.gaveUp - g0; }
      else { trips += g.tally.count; sum += g.tally.sum; gave += g.tally.gaveUp; }
    }
  });
  return { trips: trips, wait: Math.round(sum / trips * 10) / 10, gaveUp: gave };
}

var results = {};
Sim.PLACES.forEach(function (place) {
  var layouts = place === 'downtown' ? [1, 2, 4, 6] : [4];
  var strategies = Sim.placeHasLights(place) ? ['smart', 'timer', 'wave'] : ['smart'];
  layouts.forEach(function (n) {
    strategies.forEach(function (st) {
      results[place + (place === 'downtown' ? ' ' + n : '') + ' ' + st] = day(n, st, place);
    });
  });
});
[0.5, 1, 2].forEach(function (reaction) {
  var times = [];
  for (var seed = 1; seed <= 12; seed++) times.push(tune.play(seed, reaction, 900).time);
  times.sort(function (a, b) { return a - b; });
  results['challenge bot ' + reaction + 's'] = { survival: Math.round(times[6]) };
});

var mode = process.argv[2];
if (mode === '--save') {
  fs.writeFileSync(__dirname + '/baseline.json', JSON.stringify(results, null, 2) + '\n');
  console.log('saved ' + Object.keys(results).length + ' setups to baseline.json');
}
var saved = mode === '--check' ? JSON.parse(fs.readFileSync(__dirname + '/baseline.json', 'utf8')) : null;
var off = 0;
Object.keys(results).forEach(function (key) {
  var r = results[key], b = saved && saved[key], flags = [];
  function near(a, base, slack) { return Math.abs(a - base) <= Math.max(base * TOLERANCE, slack || 0); }
  if (b) {
    if (r.survival !== undefined) { if (!near(r.survival, b.survival)) flags.push('survival was ' + b.survival); }
    else {
      if (!near(r.trips, b.trips)) flags.push('trips was ' + b.trips);
      if (!near(r.wait, b.wait, 1)) flags.push('wait was ' + b.wait);
      if (!near(r.gaveUp, b.gaveUp, 5)) flags.push('gave up was ' + b.gaveUp);
    }
  } else if (saved) flags.push('not in baseline');
  if (flags.length) off++;
  console.log(key.padEnd(24) + (r.survival !== undefined ? 'median survival ' + r.survival + ' s' : 'trips ' + r.trips + '  wait ' + r.wait + ' s  gave up ' + r.gaveUp) +
    (flags.length ? '   <-- ' + flags.join(', ') : ''));
});
if (saved) { console.log(off ? off + ' setups off baseline' : 'all within baseline'); if (off) process.exitCode = 1; }
