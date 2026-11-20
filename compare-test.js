// Compare test: two cities with the same seed but different lights must get the same traffic.
// Checks that every lane's arrivals happen at the same moments in both, and that the same car
// (lane + arrival number) picks the same first turn in both. Also checks that two cities with the
// same seed AND the same lights end the day exactly alike.
// Run with:  node compare-test.js   (takes a few seconds)
var Sim = require('./sim.js');
var problems = 0;

function check(lights, rate, a, b) {
  var A = Sim.createChill(lights, rate, { seed: 12345, strategy: a.strategy, arrows: a.arrows });
  var B = Sim.createChill(lights, rate, { seed: 12345, strategy: b.strategy, arrows: b.arrows });
  var firstTurn = [{}, {}], arrivalsDiffer = 0, turnsDiffer = 0, shared = 0;
  for (var i = 0; i < 360 * 60; i++) {
    [A, B].forEach(function (g, k) {
      Sim.step(g, 1 / 60);
      g.lanes.forEach(function (lane) {
        lane.cars.forEach(function (car) {
          var key = lane.id + ':' + car.arrival;
          if (car.arrival && !(key in firstTurn[k]) && car.s < 40) firstTurn[k][key] = car.plan ? (car.plan.want || car.plan.turn) : 'none';
        });
      });
    });
    A.lanes.forEach(function (lane, j) { if (lane.arrivals !== B.lanes[j].arrivals) arrivalsDiffer++; });
  }
  Object.keys(firstTurn[0]).forEach(function (key) {
    if (!(key in firstTurn[1])) return;
    shared++;
    if (firstTurn[0][key] !== firstTurn[1][key]) turnsDiffer++;
  });
  var ok = arrivalsDiffer === 0 && turnsDiffer === 0 && shared > 100;
  if (!ok) problems++;
  console.log(lights + ' lights, ' + a.strategy + (a.arrows ? '+arrows' : '') + ' vs ' + b.strategy + (b.arrows ? '+arrows' : '') +
    ': arrivals ' + A.lanes.reduce(function (n, l) { return n + l.arrivals; }, 0) +
    ', steps with different arrivals ' + arrivalsDiffer + ', cars compared ' + shared + ', different first turns ' + turnsDiffer +
    ', avg wait today ' + (A.tally.sum / A.tally.count).toFixed(1) + 's vs ' + (B.tally.sum / B.tally.count).toFixed(1) + 's' +
    (ok ? '' : '   <-- PROBLEM'));
  return [A, B];
}

check(6, 0.29, { strategy: 'smart', arrows: true }, { strategy: 'wave', arrows: true });
check(4, 0.29, { strategy: 'timer', arrows: false }, { strategy: 'smart', arrows: true });
check(1, 0.6, { strategy: 'wave', arrows: true }, { strategy: 'timer', arrows: true });
var same = check(4, 0.29, { strategy: 'smart', arrows: true }, { strategy: 'smart', arrows: true });
if (same[0].score !== same[1].score || same[0].tally.sum !== same[1].tally.sum) {
  problems++;
  console.log('Same seed and same lights did not end the day alike: ' + same[0].score + ' vs ' + same[1].score + '   <-- PROBLEM');
} else console.log('Same seed and same lights: identical day (' + same[0].score + ' cars)');
console.log(problems ? problems + ' PROBLEMS' : 'all good');
if (problems) process.exitCode = 1;   // so test.js can tell it failed
