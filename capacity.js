// Capacity marks and the strategy table in the README.
//   capacity: for each place (and Downtown's 1/2/4/6 lights) and strategy, the first traffic-slider
//     value, in steps of 5, where at least 2 of 3 seeded normal days (arrows on) had drivers give up.
//     game.js shades the slider past it.
//   table: average wait over a game day (give-ups included), averaged over 3 seeded days, for the
//     setups in the README's "Light strategies" table.
// Run with:  node capacity.js [--engine other-sim.js] [--place suburb]   (takes a few minutes; setups
// run side by side).
// --engine measures another copy of the engine, e.g. main's sim.js, to compare before and after.
// --place measures one place's capacity marks only (no strategy table).
var path = require('path'), spawn = require('child_process').spawn, os = require('os');
var SEEDS = [11, 202, 3003];
var argEngine = process.argv.indexOf('--engine');
var ENGINE = argEngine >= 0 ? process.argv[argEngine + 1] : 'sim.js';
var argPlace = process.argv.indexOf('--place');
var ONLY_PLACE = argPlace >= 0 ? process.argv[argPlace + 1] : null;

// One worker job: run the 3 seeded days for one setup and print a JSON line.
if (process.argv[2] === '--job') {
  var job = JSON.parse(process.argv[3]), Sim = require(path.join(__dirname, job.engine));
  var gaveUpDays = 0, trips = 0, sum = 0;
  SEEDS.forEach(function (seed) {
    var g = Sim.createChill(job.lights, 0.04 + 0.56 * job.slider / 100, { seed: seed, strategy: job.strategy, arrows: true, place: job.place });
    var gave = 0;
    for (var i = 0; i < 360 * 60; i++) {
      var c0 = g.tally.count, s0 = g.tally.sum, g0 = g.tally.gaveUp;
      Sim.step(g, 1 / 60);
      // The tally resets at midnight; count what was added either way.
      if (g.tally.count >= c0) { trips += g.tally.count - c0; sum += g.tally.sum - s0; gave += g.tally.gaveUp - g0; }
      else { trips += g.tally.count; sum += g.tally.sum; gave += g.tally.gaveUp; }
    }
    if (gave > 0) gaveUpDays++;
  });
  console.log(JSON.stringify({ overloaded: gaveUpDays >= 2, wait: sum / trips }));
  return;
}

function run(job) {
  return new Promise(function (resolve) {
    var out = '';
    var child = spawn(process.execPath, [__filename, '--job', JSON.stringify(Object.assign({ engine: ENGINE }, job))]);
    child.stdout.on('data', function (d) { out += d; });
    child.on('close', function () { resolve(JSON.parse(out.trim())); });
  });
}

// Runs tasks (functions returning promises) a few at a time.
function pool(tasks, size) {
  var results = new Array(tasks.length), next = 0;
  function worker() {
    if (next >= tasks.length) return Promise.resolve();
    var i = next++;
    return tasks[i]().then(function (r) { results[i] = r; return worker(); });
  }
  var workers = [];
  for (var k = 0; k < size; k++) workers.push(worker());
  return Promise.all(workers).then(function () { return results; });
}

var STRATEGIES = ['smart', 'timer', 'wave'];
var PLACES = [['downtown', 1], ['downtown', 2], ['downtown', 4], ['downtown', 6], ['main', 4], ['suburb', 4], ['crosstown', 4]];
var TABLE = ONLY_PLACE ? [] : [[4, 30], [4, 45], [4, 60], [6, 45], [6, 75], [6, 90], [1, 45], [2, 60]];
if (ONLY_PLACE) PLACES = PLACES.filter(function (p) { return p[0] === ONLY_PLACE; });

// Each capacity search walks up the slider from 30 until a value overloads.
function capacityTask(place, lights, strategy) {
  return function () {
    function at(slider) {
      if (slider > 100) return Promise.resolve('100+');
      return run({ place: place, lights: lights, strategy: strategy, slider: slider }).then(function (r) { return r.overloaded ? slider : at(slider + 5); });
    }
    return at(30);
  };
}

var size = Math.max(2, Math.min(6, os.cpus().length - 1));
var capTasks = [], capKeys = [];
PLACES.forEach(function (p) {
  // Suburb has no lights, so the strategy can't matter there.
  (p[0] === 'suburb' ? ['smart'] : STRATEGIES).forEach(function (st) { capTasks.push(capacityTask(p[0], p[1], st)); capKeys.push([p, st]); });
});
var tableTasks = [], tableKeys = [];
TABLE.forEach(function (t) {
  STRATEGIES.forEach(function (st) {
    tableTasks.push(function () { return run({ place: 'downtown', lights: t[0], strategy: st, slider: t[1] }); });
    tableKeys.push([t, st]);
  });
});

pool(capTasks.concat(tableTasks), size).then(function (all) {
  console.log('engine: ' + ENGINE + '\n\ncapacity (slider where give-ups start)');
  var rows = {};
  capKeys.forEach(function (k, i) {
    var name = k[0][0] === 'downtown' ? k[0][1] + (k[0][1] === 1 ? ' light' : ' lights') : k[0][0];
    (rows[name] = rows[name] || {})[k[1]] = all[i];
  });
  Object.keys(rows).forEach(function (name) {
    var r = rows[name];
    console.log('  ' + name.padEnd(10) + STRATEGIES.map(function (st) { return st + ' ' + (r[st] !== undefined ? r[st] : r.smart); }).join('  '));
  });
  console.log('\naverage wait over a day (3 seeds)');
  var table = {};
  tableKeys.forEach(function (k, i) {
    var name = k[0][0] + (k[0][0] === 1 ? ' light' : ' lights') + ', slider ' + k[0][1];
    (table[name] = table[name] || {})[k[1]] = all[capTasks.length + i].wait.toFixed(1) + ' s';
  });
  Object.keys(table).forEach(function (name) {
    console.log('  ' + name.padEnd(22) + STRATEGIES.map(function (st) { return st + ' ' + table[name][st]; }).join('  '));
  });
});
