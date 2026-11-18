// Extras test: weather, buses and ambulances on every layout and strategy for a game day.
// Checks nothing gridlocks, buses really stop and get through, every ambulance crosses the city,
// and two compare cities with the same seed still get the same buses and ambulances.
// Run with:  node extras-test.js   (takes ~30 s)
var Sim = require('./sim.js');
var problems = 0;
function run(n, st, weather, kind) {
  var g = Sim.createChill(n, 0.35, { seed: 11, strategy: st, weather: weather, buses: true, ambulances: true, kind: kind });
  var last = 0, worst = 1e9, busesSeen = {}, busesDone = 0, ambSeen = {}, ambDone = 0, dwelled = 0, snow = 0, rain = 0;
  for (var i = 1; i <= 360 * 60; i++) {
    if (i % (20 * 60) === 0) Sim.sendAmbulance(g, (i / 1200 * 0.37) % 1);   // the button, now and then
    Sim.step(g, 1 / 60);
    var w = Sim.currentWeather(g); if (w === 'rain') rain++; if (w === 'snow') snow++;
    var present = {};
    g.lanes.forEach(function (l) { l.cars.forEach(function (c) {
      if (c.bus) { busesSeen[c.id] = 1; present[c.id] = 1; if (c.dwell > 0) dwelled++; }
      if (c.ambulance) { ambSeen[c.id] = 1; present[c.id] = 1; }
    }); });
    Object.keys(busesSeen).forEach(function (id) { if (!present[id] && busesSeen[id] === 1) { busesSeen[id] = 2; busesDone++; } });
    Object.keys(ambSeen).forEach(function (id) { if (!present[id] && ambSeen[id] === 1) { ambSeen[id] = 2; ambDone++; } });
    if (i % (30 * 60) === 0) {
      var hour = Sim.hourOfDay(g), quiet = hour < 6 || hour > 23;
      if (!quiet) worst = Math.min(worst, g.score - last);
      last = g.score;
    }
  }
  var buses = Object.keys(busesSeen).length, ambs = Object.keys(ambSeen).length;
  var bad = worst === 0 || buses < 5 || busesDone < buses - 6 || dwelled === 0 || ambs < 8 || ambDone < ambs - 3;
  if (bad) problems++;
  return st + ' ' + (g.tally.sum / g.tally.count).toFixed(1) + 's min/30s ' + worst + ' buses ' + busesDone + '/' + buses +
    ' amb ' + ambDone + '/' + ambs + (weather === 'changing' ? ' rain/snow ' + Math.round(rain / 3600) + '/' + Math.round(snow / 3600) + 's' : '') + (bad ? ' <-- PROBLEM' : '');
}
['clear', 'rain', 'snow', 'changing'].forEach(function (weather) {
  [1, 2, 4, 6].forEach(function (n) {
    console.log(weather + ', ' + n + ' lights: ' + ['smart', 'timer', 'wave'].map(function (st) { return run(n, st, weather, 'normal'); }).join(' | '));
  });
});
console.log('construction + snow, 4 lights: ' + run(4, 'smart', 'snow', 'construction'));
console.log('stadium + rain, 6 lights: ' + run(6, 'wave', 'rain', 'stadium'));

// Same seed, different lights: buses and ambulances must enter at the same moments on both maps.
var A = Sim.createChill(4, 0.3, { seed: 5, strategy: 'smart', buses: true, ambulances: true, weather: 'changing' });
var B = Sim.createChill(4, 0.3, { seed: 5, strategy: 'timer', buses: true, ambulances: true, weather: 'changing' });
var diff = 0;
for (var i = 0; i < 360 * 60; i++) {
  if (i === 5000) { Sim.sendAmbulance(A, 0.42); Sim.sendAmbulance(B, 0.42); }
  Sim.step(A, 1 / 60); Sim.step(B, 1 / 60);
  A.lanes.forEach(function (l, j) {
    var m = B.lanes[j];
    // Buses and ambulances sent, and cars arrived, must match (when each gets onto the map can differ).
    if (l.nextBus !== m.nextBus || l.buses !== m.buses || (l.ambulances || 0) !== (m.ambulances || 0) || l.arrivals !== m.arrivals) diff++;
  });
  if (Sim.currentWeather(A) !== Sim.currentWeather(B)) diff++;
}
console.log('compare: steps where arrivals, timetables or weather differ: ' + diff + (diff ? '   <-- PROBLEM' : ''));
if (diff) problems++;
console.log(problems ? problems + ' PROBLEMS' : 'all good');
