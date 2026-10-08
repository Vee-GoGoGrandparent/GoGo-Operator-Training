// One-time, merge-only changes to live scenarios. Each runs once (recorded in the patches table) and only ADDS
// what is missing: anything an admin wrote or removed in the scenario builder stays exactly as they left it.
import fs from 'node:fs';
import { db, one, all, run, tx } from './db.js';
import { pinSkill } from './skills.js';
import { cleanScenario } from './grading.js';
import { CONFIRM_NAME_LINE, CONTACT_LINE, MENCHIES_MAP_OFTEN, MENCHIES_BUSINESS_SAVED, MENCHIES_STEPS, stepsFromNames, EXAMPLE_SCENARIOS, MENCHIES_NEW_LINES, MENCHIES_ANSWERS,
  MENCHIES_NOTE_OPTIONS, TORIKAYA_NOTE_OPTIONS } from './examples.js';

db.exec(`CREATE TABLE IF NOT EXISTS patches (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))`);
// A copy of a scenario taken before a patch REPLACES something an admin set up (only with Vee's OK), so it can be put back.
db.exec(`CREATE TABLE IF NOT EXISTS scenario_backups (id INTEGER PRIMARY KEY, scenario_id INTEGER NOT NULL, title TEXT, data TEXT NOT NULL,
  reason TEXT, saved_at TEXT NOT NULL DEFAULT (datetime('now')))`);
const backup = (row, reason) => run('INSERT INTO scenario_backups (scenario_id, title, data, reason) VALUES (?, ?, ?, ?)', row.id, row.title, row.data, reason);

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
  {
    // Vee, 2026-10-06 night: the caller gives the address right away; "we have this location saved" after the
    // read-back; every call closes with "anything else?" and the closing line (both must-ask). Add-only: the opening
    // line changes only if it is still the original default.
    name: 'menchies-callflow-close-2026-10-06',
    run() {
      const row = one('SELECT * FROM scenarios WHERE title = ?', "Menchie's on Petrovitsky Road");
      if (!row) return false;
      const d = JSON.parse(row.data);
      if (d.caller === 'Hi, I need a ride.') d.caller = "Hi, I'd like to be picked up at 14060 Southeast Petrovitsky Road.";
      const has = (re) => d.questions.some((q) => re.test(`${q.q} ${q.say}`));
      if (!has(/location saved/i)) {
        const at = d.questions.findIndex((q) => /read the address back/i.test(q.q));
        d.questions.splice(at >= 0 ? at + 1 : d.questions.length, 0, {"q":"Mention the saved location","say":"Okay, looks like we have this location saved on your account.","a":"Oh yes, I've been there before.","needed":false});
      }
      if (!has(/anything else/i)) d.questions.push({"q":"Ask if there is anything else","say":"Is there anything else I can help you with today?","a":"No, that's all. Thank you!","needed":true});
      if (!has(/thank you so much for calling/i)) d.questions.push({"q":"Close the call","say":"Perfect! Thank you so much for calling GoGo, and we hope you have a beautiful and wonderful day.","a":"You too, bye!","needed":true});
      run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
      return true;
    },
  },
  {
    // Vee, 2026-10-07: the call in steps, three lines at a time. Adds "Confirm the customer's name" first and the
    // draft steps. Leaves a call that already has steps alone. The repeat-address line is reworded only if it is
    // still the original wording (the name is now confirmed before it).
    name: 'menchies-call-steps-2026-10-07',
    run() {
      const row = one('SELECT * FROM scenarios WHERE title = ?', "Menchie's on Petrovitsky Road");
      if (!row) return false;
      const d = JSON.parse(row.data);
      if (d.steps?.length) return true;
      if (!d.questions.some((q) => /confirm the customer|speaking with/i.test(`${q.q} ${q.say}`))) d.questions.unshift({ ...CONFIRM_NAME_LINE });
      const rep = d.questions.find((q) => q.say === 'Perfect, I was able to pull up your account. Can you repeat the address for me?');
      if (rep) rep.say = 'Thank you, Marge. Can you repeat the address for me?';
      d.steps = stepsFromNames(d.questions, MENCHIES_STEPS);
      run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
      return true;
    },
  },
  {
    // Vee, 2026-10-07: the standard driver line ends with "...within that time, please give us a call back immediately
    // so we can look into the status of your ride." Reworded only while it is still the original wording.
    name: 'menchies-driver-line-2026-10-07',
    run() {
      const row = one('SELECT * FROM scenarios WHERE title = ?', "Menchie's on Petrovitsky Road");
      if (!row) return false;
      const d = JSON.parse(row.data);
      const old = "We were able to find you a driver. Looks like Lidong, in a black Toyota Sienna, last 4 digits 0734 should be arriving in the next 2 minutes. If for any reason he doesn't show up within the estimated time, please give us a call back.";
      const line = d.questions.find((q) => q.say === old);
      if (!line) return true; // reworded by an admin, or removed: leave it
      line.say = EXAMPLE_SCENARIOS[0].data.questions.find((q) => q.q === 'Provide driver info').say;
      run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
      return true;
    },
  },
  {
    // Vee, 2026-10-07: the Torikaya anniversary call. Added once on a site that already has the examples, so nobody
    // has to press "Add the examples" again. Add-only: if a scenario with this title exists, it is left alone.
    name: 'add-torikaya-2026-10-07',
    run() {
      if (!one('SELECT id FROM scenarios WHERE title = ?', "Menchie's on Petrovitsky Road")) return false; // examples not added here yet
      const ex = EXAMPLE_SCENARIOS.find((x) => x.title === 'Anniversary dinner on Houston Street');
      if (!one('SELECT id FROM scenarios WHERE title = ?', ex.title)) {
        run('INSERT INTO scenarios (title, category, data, practice) VALUES (?, ?, ?, 1)', ex.title, ex.category, JSON.stringify(cleanScenario(ex.data)));
      }
      return true;
    },
  },
  {
    // Vee, 2026-10-07 afternoon: Torikaya's new flow (full home address, ask the name of the place again, celebrate the
    // 40 years while checking the map, driver notes: his wife uses a walker). Replaced ONLY if the live call is still
    // exactly the version that went live (snapshots/torikaya-v1.json); if anyone edited it, it is left alone.
    name: 'torikaya-flow-v2-2026-10-07',
    run() {
      const ex = EXAMPLE_SCENARIOS.find((x) => x.title === 'Anniversary dinner on Houston Street');
      const row = one('SELECT * FROM scenarios WHERE title = ?', ex.title);
      if (!row) return true; // not on this site: "Add the examples" brings the new version
      const v2 = JSON.stringify(cleanScenario(ex.data));
      if (row.data === v2) return true; // added after this change: already the new flow
      if (row.data !== fs.readFileSync(new URL('./snapshots/torikaya-v1.json', import.meta.url), 'utf8')) {
        console.log('[pin-academy] Torikaya was edited after it went live; the new flow was NOT applied.');
        return true;
      }
      run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', v2, row.id);
      return true;
    },
  },
  {
    // Vee, 2026-10-07 afternoon: Menchie's new call order. She chose "replace, keep a backup": her version is copied to
    // scenario_backups first, then the steps are REPLACED. Lines she wrote stay in the list (only answers she asked
    // for change), the two new lines are added if missing, and practice gets the note choices if it has none.
    name: 'menchies-flow-v2-2026-10-07',
    run() {
      const row = one('SELECT * FROM scenarios WHERE title = ?', "Menchie's on Petrovitsky Road");
      if (!row) return false;
      backup(row, "Before Menchie's new call order (Vee, 2026-10-07)");
      const d = JSON.parse(row.data);
      const find = (label) => d.questions.find((q) => q.q.trim().toLowerCase() === label.toLowerCase());
      for (const [label, answer] of Object.entries(MENCHIES_ANSWERS)) { const q = find(label); if (q) { q.a = answer; q.needed = true; } }
      for (const line of MENCHIES_NEW_LINES) if (!find(line.q)) d.questions.push({ ...line });
      if (!find('Ask for notes for the driver')) d.questions.push({ q: 'Ask for notes for the driver', say: 'Do you have any notes for the driver?', a: "Just tell them I'm at Menchie's.", needed: true });
      d.note = d.note || { mustMention: [], model: '' };
      if (!d.note.options?.length) d.note.options = MENCHIES_NOTE_OPTIONS.map((o) => ({ ...o }));
      d.steps = stepsFromNames(d.questions, MENCHIES_STEPS);
      run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
      return true;
    },
  },
  {
    // Vee, 2026-10-07: practice note choices for Torikaya. Add-only: a call that already has choices keeps them.
    name: 'torikaya-note-options-2026-10-07',
    run() {
      const row = one('SELECT * FROM scenarios WHERE title = ?', 'Anniversary dinner on Houston Street');
      if (!row) return true;
      const d = JSON.parse(row.data);
      if (d.note?.options?.length) return true;
      d.note = { ...(d.note || { mustMention: [], model: '' }), options: TORIKAYA_NOTE_OPTIONS.map((o) => ({ ...o })) };
      run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
      return true;
    },
  },
  {
    // Vee, 2026-10-07 evening: every call confirms the best contact number right after the name.
    name: 'contact-number-step-2026-10-07',
    run() {
      const wrongs = {
        "Menchie's on Petrovitsky Road": ['Ask them to repeat the address', 'Mention the saved location'],
        'Anniversary dinner on Houston Street': ['Ask for the pickup address', 'Confirm the pickup is home'],
      };
      for (const [title, wrongNames] of Object.entries(wrongs)) {
        const row = one('SELECT * FROM scenarios WHERE title = ?', title);
        if (!row) continue;
        const d = JSON.parse(row.data);
        const at = (label) => d.questions.findIndex((q) => q.q.trim().toLowerCase() === label.toLowerCase());
        if (d.questions.some((q) => /best contact number/i.test(`${q.q} ${q.say}`))) continue; // already there
        d.questions.push({ ...CONTACT_LINE });
        const line = d.questions.length - 1;
        if (d.steps?.length) {
          const nameStep = d.steps.findIndex((st) => st.right.includes(at("Confirm the customer's name")));
          const earlier = new Set(d.steps.slice(0, nameStep + 1).flatMap((st) => st.right));
          const wrong = wrongNames.map(at).filter((i) => i >= 0 && !earlier.has(i));
          d.steps.splice(nameStep >= 0 ? nameStep + 1 : 0, 0, { choices: [line, ...wrong], right: [line] });
        }
        run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
      }
      return true;
    },
  },
  {
    // Vee, 2026-10-08: branches + one wording at the join. Backup first (her version is in scenario_backups).
    name: 'menchies-branches-2026-10-08',
    run() {
      const row = one('SELECT * FROM scenarios WHERE title = ?', "Menchie's on Petrovitsky Road");
      if (!row) return false;
      const d = JSON.parse(row.data);
      const at = (label) => d.questions.findIndex((q) => q.q.trim().toLowerCase() === label.toLowerCase());
      const [repeat, mention, readBack, business, map, often] = ['Ask them to repeat the address', 'Mention the saved location', 'Read the address back',
        'Ask for the name of the business', 'Tell them you are checking the map', 'Ask if they go there often'].map(at);
      const s3 = d.steps.findIndex((st) => st.right.includes(repeat) && st.right.includes(mention));
      const s4 = d.steps.findIndex((st, n) => n > s3 && st.right.includes(readBack));
      if ([repeat, mention, readBack, business, map, often].some((i) => i < 0) || s3 < 0 || s4 < 0 || d.steps.some((st) => st.when)) {
        console.log("[pin-academy] Menchie's does not have the expected steps (or already has branches): branches NOT added.");
        return true;
      }
      backup(row, "Before Menchie's branches (Vee, 2026-10-08)");
      let saved = at(MENCHIES_BUSINESS_SAVED.q);
      if (saved < 0) { d.questions.push({ ...MENCHIES_BUSINESS_SAVED }); saved = d.questions.length - 1; }
      const fill = (keep, want) => [...want, ...[at('Ask them to spell the street'), at('Send the driver to the address'), at('Ask for notes for the driver'), at('Ask what they are wearing')]]
        .filter((i, k, a) => i >= 0 && !keep.includes(i) && a.indexOf(i) === k).slice(0, 2);
      const steps = d.steps.filter((st) => !st.right.some((i) => [business, map, often].includes(i)) && !(st.right.length === 1 && st.right[0] === mention));
      const s4new = steps.findIndex((st) => st.right.includes(readBack) && st.right.length >= 1);
      steps.splice(s4new + 1, 0,
        { choices: [mention, ...fill([mention], [])], right: [mention], when: { notSaid: mention } },
        { choices: [business, ...fill([business], [])], right: [business], when: { said: repeat } },
        { choices: [saved, ...fill([saved], [])], right: [saved], when: { notSaid: repeat } },
        { choices: [map, often, ...fill([map, often], [at('Ask for notes for the driver')]).slice(0, 1)], right: [map, often], ...MENCHIES_MAP_OFTEN });
      d.steps = steps;
      run('UPDATE scenarios SET data = ?, version = version + 1 WHERE id = ?', JSON.stringify(cleanScenario(d)), row.id);
      return true;
    },
  },
  {
    // Vee, 2026-10-07: "Type of place" is replaced by the Pin skill. Each old type moves to the skill it teaches
    // (Restaurant or shop -> Place or business name, Shopping center -> Multiple entrances, ...). Only the label changes.
    name: 'type-of-place-to-pin-skill-2026-10-07',
    run() {
      for (const r of all('SELECT id, category FROM scenarios')) {
        const to = pinSkill(r.category);
        if (to !== r.category) run('UPDATE scenarios SET category = ?, version = version + 1 WHERE id = ?', to, r.id);
      }
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
