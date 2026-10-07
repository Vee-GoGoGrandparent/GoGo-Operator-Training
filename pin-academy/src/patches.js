// One-time, merge-only changes to live scenarios. Each runs once (recorded in the patches table) and only ADDS
// what is missing: anything an admin wrote or removed in the scenario builder stays exactly as they left it.
import { db, one, run, tx } from './db.js';
import { cleanScenario } from './grading.js';

db.exec(`CREATE TABLE IF NOT EXISTS patches (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))`);

const MENCHIES_HOME = { label: 'Home', address: '17130 127th Avenue Southeast, Renton, WA 98058', lat: 47.44892956, lng: -122.1726835 };

const PATCHES = [
  {
    // Vee, 2026-10-06: home address + drop-off (she goes home), ride estimate and driver details, her two call lines.
    name: 'menchies-home-dropoff-estimate-2026-10-06',
    run() {
      const row = one('SELECT * FROM scenarios WHERE title = ?', "Menchie's on Petrovitsky Road");
      if (!row) return false; // not added on this site yet: nothing to patch (the example file already has all of it)
      const d = JSON.parse(row.data);
      d.account = d.account || { home: null, saved: [] };
      if (!d.account.home) d.account.home = MENCHIES_HOME;
      if (!d.stops.some((x) => x.kind === 'dropoff')) {
        d.stops.push({ kind: 'dropoff', label: 'Home', addressGiven: MENCHIES_HOME.address,
          start: { lat: MENCHIES_HOME.lat, lng: MENCHIES_HOME.lng }, answer: { lat: MENCHIES_HOME.lat, lng: MENCHIES_HOME.lng }, entrances: [] });
      }
      d.ride = d.ride || {};
      const has = (label) => d.questions.some((q) => q.q.trim().toLowerCase() === label.toLowerCase());
      if (!has('Provide estimate')) d.questions.push({ q: 'Provide estimate',
        say: 'Okay, looks like this trip is going to cost you between $8-$10. Is it ok if I go ahead and order this ride for you now?', a: 'Yes, please.', needed: true });
      if (!has('Provide driver info')) d.questions.push({ q: 'Provide driver info',
        say: "We were able to find you a driver. Looks like Lidong, in a black Toyota Sienna, last 4 digits 0734 should be arriving in the next 2 minutes. If for any reason he doesn't show up within the estimated time, please give us a call back.",
        a: 'Okay, thank you.', needed: true });
      run('UPDATE scenarios SET data = ? WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
      return true;
    },
  },
];

export function runPatches() {
  for (const p of PATCHES) {
    if (one('SELECT name FROM patches WHERE name = ?', p.name)) continue;
    try {
      tx(() => { if (p.run()) run('INSERT INTO patches (name) VALUES (?)', p.name); });
    } catch (e) {
      console.error(`[pin-academy] patch ${p.name} failed (nothing changed):`, e.message);
    }
  }
}
