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
      run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
      return true;
    },
  },
  {
    // Vee, 2026-10-06 late: saved location #3 (14060 SE Petrovitsky Rd, saved by the system with the WRONG pin) was
    // missing on the live Menchie's, most likely saved over from an editor page opened before it existed.
    // Put it back, mark it as the one to fix, and make sure the "go there often" line is there. Add-only.
    name: 'menchies-saved-slot3-2026-10-06',
    run() {
      const row = one('SELECT * FROM scenarios WHERE title = ?', "Menchie's on Petrovitsky Road");
      if (!row) return false;
      const d = JSON.parse(row.data);
      d.account = d.account || { home: null, saved: [] };
      d.account.saved = Array.isArray(d.account.saved) ? d.account.saved : [];
      let idx = d.account.saved.findIndex((p) => p && /petrovitsky/i.test(`${p.label} ${p.address}`));
      if (idx < 0) {
        if (d.account.saved.length >= 3) return true; // all three slots used by an admin: leave them alone
        d.account.saved.unshift({ label: '14060 SE Petrovitsky Rd', address: '14060 Southeast Petrovitsky Road, Renton, WA 98058', lat: 47.44598587, lng: -122.15203913 });
        idx = 0;
      }
      if (!d.savedFix) d.savedFix = { slot: idx + 3, action: 'update', stop: 'pickup' };
      if (!d.questions.some((q) => /go(es)? (there|to) often/i.test(`${q.q} ${q.say}`))) {
        const at = d.questions.findIndex((q) => /notes for the driver/i.test(q.q));
        const line = { q: 'Ask if they go there often', say: "Is Menchie's a place you go to often?", a: 'Yes, I go every Sunday with my grandkids.', needed: true };
        if (at >= 0) d.questions.splice(at, 0, line); else d.questions.push(line);
      }
      run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
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
