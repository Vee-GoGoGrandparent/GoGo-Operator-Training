// GoGo Academy: pin practice and class pin tests built from short pretend calls (scenarios).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, one, all, run, tx } from './src/db.js';
import { gradeScenario, publicScenario, cleanScenario, isRightPick } from './src/grading.js';
import { PIN_SKILLS, pinSkill } from './src/skills.js';
import { EXAMPLE_SCENARIOS } from './src/examples.js';
import { runPatches } from './src/patches.js';
import * as auth from './src/auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Scenarios admins edit are NEVER overwritten by code. Changes that must reach a live scenario are one-time,
// merge-only patches (src/patches.js): they add what is missing and leave everything an admin wrote alone.
runPatches();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(HERE, 'public');
const GRACE_MS = 60 * 1000; // a late answer within a minute of the deadline still counts (slow networks)
const PRACTICE_METERS = 15;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

// ── helpers ────────────────────────────────────────────────────────────
function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}
const isHttps = (req) => baseUrl(req).startsWith('https://');

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 200_000) fail(413, 'Too much data.'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, 'Bad request.'); }
}

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' ? v : Number(v));
const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const toMs = (sqlTime) => Date.parse(sqlTime.replace(' ', 'T') + 'Z');
const seconds = (v) => Math.max(0, Math.min(36000, Math.round(num(v) || 0)));

function needUser(req) { const u = auth.currentUser(req); if (!u) fail(401, 'Please sign in.'); return u; }
function needAdmin(req) { const u = needUser(req); if (u.role !== 'admin') fail(403, 'Admins only.'); return u; }

const publicUser = (u) => u && ({
  slackId: u.slack_id, name: u.name, role: u.role, classId: u.class_id,
  className: u.class_id ? one('SELECT name FROM classes WHERE id = ?', u.class_id)?.name : null,
});

// What the trainee sends for one scenario: their pins, entrance picks, questions asked and note. Kept small.
function cleanSubmission(b) {
  return {
    pins: (Array.isArray(b.pins) ? b.pins : []).slice(0, 2).map((p) => (p ? { lat: num(p.lat), lng: num(p.lng) } : null)),
    entrances: (Array.isArray(b.entrances) ? b.entrances : []).slice(0, 2).map((e) => (Number.isInteger(e) ? e : null)),
    asked: (Array.isArray(b.asked) ? b.asked : []).slice(0, 10).map(Number).filter(Number.isInteger),
    steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 30)
      .map((p) => (Array.isArray(p) ? p : []).slice(0, 6).map(Number).filter(Number.isInteger)),
    note: str(b.note, 800),
    specific: (Array.isArray(b.specific) ? b.specific : []).slice(0, 2).map((s) => str(s, 120)),
    locationName: (Array.isArray(b.locationName) ? b.locationName : []).slice(0, 2).map((s) => str(s, 120)),
    wearing: str(b.wearing, 200),
    ordered: b.ordered === true,
    noteChoice: Number.isInteger(b.noteChoice) ? b.noteChoice : null,
    savedChanges: (Array.isArray(b.savedChanges) ? b.savedChanges : []).slice(0, 12).map((c) => ({
      slot: c && (c.slot === 'home' ? 'home' : Number(c.slot)), action: c?.action === 'delete' ? 'delete' : 'save',
      lat: num(c?.lat), lng: num(c?.lng), label: str(c?.label, 120) })),
    announce: str(b.announce, 40),
  };
}

const scenarioData = (row) => JSON.parse(row.data);

// ── tests: shared logic ────────────────────────────────────────────────
function testScenarios(testId) {
  return all(`SELECT s.* FROM test_scenarios ts JOIN scenarios s ON s.id = ts.scenario_id WHERE ts.test_id = ? ORDER BY ts.position`, testId);
}

function testResult(test, attempt) {
  const items = testScenarios(test.id);
  const answers = Object.fromEntries(all('SELECT * FROM scenario_answers WHERE attempt_id = ?', attempt.id).map((a) => [a.scenario_id, a]));
  const rows = items.map((s) => {
    const a = answers[s.id];
    return { scenarioId: s.id, title: s.title, answered: !!a, passed: !!a?.passed,
      result: a ? JSON.parse(a.result) : gradeScenario(scenarioData(s), {}, test.pass_meters), submitted: a ? JSON.parse(a.submitted) : null };
  });
  const correct = rows.filter((r) => r.passed).length;
  return { testName: test.name, passMeters: test.pass_meters, passCount: test.pass_count, total: items.length,
    correct, passed: correct >= test.pass_count, submittedAt: attempt.submitted_at, rows };
}

// A test past its deadline is handed in automatically the next time anyone looks at it.
function autoSubmitIfLate(attempt) {
  if (!attempt.submitted_at && attempt.deadline && Date.now() > toMs(attempt.deadline) + GRACE_MS) {
    run('UPDATE attempts SET submitted_at = ? WHERE id = ?', attempt.deadline, attempt.id);
    attempt.submitted_at = attempt.deadline;
  }
  return attempt;
}

// ── routes ─────────────────────────────────────────────────────────────
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });

// Sign in
route('GET', '/auth/slack', (req, res) => {
  if (!auth.slackConfigured()) return send(res, 503, 'Slack sign-in is not set up yet.', 'text/plain');
  redirect(res, auth.slackLoginUrl(res, baseUrl(req), isHttps(req)));
});
route('GET', '/auth/slack/callback', async (req, res, { url }) => {
  try {
    const who = await auth.slackCallback(req, url, baseUrl(req));
    auth.upsertUser(who);
    auth.startSession(res, who.slackId, isHttps(req));
    redirect(res, '/');
  } catch (e) {
    redirect(res, `/?error=${encodeURIComponent(e.message)}`);
  }
});
route('GET', '/auth/dev', (req, res, { url }) => {
  if (!auth.devLoginAllowed()) fail(404, 'Not found.');
  const slackId = str(url.searchParams.get('as'), 40) || 'UDEVTRAINEE';
  const u = auth.upsertUser({ slackId, name: str(url.searchParams.get('name'), 80) || slackId });
  if (url.searchParams.get('role') === 'admin') run(`UPDATE users SET role = 'admin' WHERE slack_id = ?`, u.slack_id);
  auth.startSession(res, slackId, false);
  redirect(res, '/' + (/^#[a-z0-9-]+$/.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : ''));
});
route('POST', '/auth/logout', (req, res) => { auth.endSession(res, isHttps(req)); send(res, 200, { ok: true }); });

route('GET', '/api/me', (req, res) => {
  send(res, 200, {
    user: publicUser(auth.currentUser(req)),
    slackReady: auth.slackConfigured(), devLogin: auth.devLoginAllowed(),
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || '', mapId: process.env.GOOGLE_MAP_ID || 'DEMO_MAP_ID', pinSkills: PIN_SKILLS,
  });
});

route('GET', '/api/classes', (req, res) => {
  needUser(req);
  send(res, 200, all('SELECT id, name FROM classes WHERE active = 1 ORDER BY id DESC'));
});

// A trainee picks their class once; after that only an admin can change it.
route('POST', '/api/me/class', async (req, res) => {
  const u = needUser(req);
  const { classId } = await readJson(req);
  if (u.class_id) fail(409, 'Your class is already set. Ask your trainer to change it.');
  if (!one('SELECT id FROM classes WHERE id = ? AND active = 1', num(classId))) fail(400, 'Pick a class from the list.');
  run('UPDATE users SET class_id = ? WHERE slack_id = ?', num(classId), u.slack_id);
  send(res, 200, { user: publicUser(one('SELECT * FROM users WHERE slack_id = ?', u.slack_id)) });
});

// ── practice ───────────────────────────────────────────────────────────
route('GET', '/api/practice', (req, res) => {
  needUser(req);
  send(res, 200, all('SELECT * FROM scenarios WHERE practice = 1 AND archived = 0 ORDER BY category, title').map(publicScenario));
});

// A scenario this person may practise: general practice, an open practice set for their class, or any if admin.
function practiceRow(u, id) {
  const row = one(`SELECT s.* FROM scenarios s WHERE s.id = ? AND s.archived = 0 AND (s.practice = 1 OR ? = 'admin' OR EXISTS (
      SELECT 1 FROM test_scenarios ts JOIN tests t ON t.id = ts.test_id
      WHERE ts.scenario_id = s.id AND t.mode = 'practice' AND t.status = 'open' AND t.class_id = ?))`, id, u.role, u.class_id);
  if (!row) fail(404, 'That scenario is not in practice.');
  return row;
}

// Practice only: is this line right for this step? Tests have no such check: the call goes on and is graded at the end.
route('POST', '/api/practice/(\\d+)/step', async (req, res, { m }) => {
  const row = practiceRow(needUser(req), num(m[1]));
  const b = await readJson(req);
  send(res, 200, { right: isRightPick(scenarioData(row), num(b.step), num(b.pick)) });
});

route('POST', '/api/practice/(\\d+)', async (req, res, { m }) => {
  const u = needUser(req);
  const row = practiceRow(u, num(m[1]));
  const b = await readJson(req);
  const sub = cleanSubmission(b);
  const result = gradeScenario(scenarioData(row), sub, PRACTICE_METERS, { practice: true });
  tx(() => {
    const att = run(`INSERT INTO attempts (slack_id, submitted_at) VALUES (?, datetime('now'))`, u.slack_id);
    run('INSERT INTO scenario_answers (attempt_id, scenario_id, submitted, result, passed, seconds) VALUES (?, ?, ?, ?, ?, ?)',
      att.lastInsertRowid, row.id, JSON.stringify(sub), JSON.stringify(result), result.passed ? 1 : 0, seconds(b.seconds));
  });
  send(res, 200, result);
});

// ── tests (trainee) ────────────────────────────────────────────────────
route('GET', '/api/tests', (req, res) => {
  const u = needUser(req);
  if (!u.class_id) return send(res, 200, []);
  const tests = all(`SELECT * FROM tests WHERE class_id = ? AND status IN ('open','closed') ORDER BY id DESC`, u.class_id);
  send(res, 200, tests.map((t) => {
    let att = one('SELECT * FROM attempts WHERE slack_id = ? AND test_id = ?', u.slack_id, t.id);
    if (att) att = autoSubmitIfLate(att);
    const n = one('SELECT COUNT(*) n FROM test_scenarios WHERE test_id = ?', t.id).n;
    return { id: t.id, name: t.name, mode: t.mode, status: t.status, questions: n, passMeters: t.pass_meters, passCount: t.pass_count,
      timeLimitMin: t.time_limit_min, state: !att ? 'not started' : att.submitted_at ? 'done' : 'in progress' };
  }));
});

function loadTestForTrainee(u, testId) {
  const t = one('SELECT * FROM tests WHERE id = ?', testId);
  if (!t || t.status === 'draft' || t.status === 'deleted' || (u.role !== 'admin' && t.class_id !== u.class_id)) fail(404, 'Test not found.');
  return t;
}

route('POST', '/api/tests/(\\d+)/start', (req, res, { m }) => {
  const u = needUser(req);
  const t = loadTestForTrainee(u, num(m[1]));
  if (t.mode === 'practice') fail(409, 'This is a practice set, not a test.');
  let att = one('SELECT * FROM attempts WHERE slack_id = ? AND test_id = ?', u.slack_id, t.id);
  if (!att) {
    if (t.status !== 'open') fail(409, 'This test is closed.');
    const deadline = new Date(Date.now() + t.time_limit_min * 60000).toISOString().replace('T', ' ').slice(0, 19);
    run('INSERT INTO attempts (slack_id, test_id, deadline) VALUES (?, ?, ?)', u.slack_id, t.id, deadline);
    att = one('SELECT * FROM attempts WHERE slack_id = ? AND test_id = ?', u.slack_id, t.id);
  }
  att = autoSubmitIfLate(att);
  if (att.submitted_at) return send(res, 200, { done: true, result: testResult(t, att) });
  const answered = all('SELECT scenario_id FROM scenario_answers WHERE attempt_id = ?', att.id).map((r) => r.scenario_id);
  send(res, 200, { done: false, name: t.name, deadline: toMs(att.deadline), serverNow: Date.now(),
    passMeters: t.pass_meters, passCount: t.pass_count, scenarios: testScenarios(t.id).map(publicScenario), answered });
});

route('POST', '/api/tests/(\\d+)/answer', async (req, res, { m }) => {
  const u = needUser(req);
  const t = loadTestForTrainee(u, num(m[1]));
  const b = await readJson(req);
  let att = one('SELECT * FROM attempts WHERE slack_id = ? AND test_id = ?', u.slack_id, t.id);
  if (!att) fail(409, 'Start the test first.');
  att = autoSubmitIfLate(att);
  if (att.submitted_at) fail(409, 'Time is up. Your test has been handed in.');
  const row = one('SELECT s.* FROM test_scenarios ts JOIN scenarios s ON s.id = ts.scenario_id WHERE ts.test_id = ? AND s.id = ?', t.id, num(b.scenarioId));
  if (!row) fail(400, 'That scenario is not on this test.');
  const sub = cleanSubmission(b);
  const result = gradeScenario(scenarioData(row), sub, t.pass_meters);
  // Saving again replaces the earlier answer, until the test is handed in.
  run(`INSERT INTO scenario_answers (attempt_id, scenario_id, submitted, result, passed, seconds) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (attempt_id, scenario_id) DO UPDATE SET submitted = excluded.submitted, result = excluded.result,
       passed = excluded.passed, seconds = excluded.seconds, created_at = datetime('now')`,
    att.id, row.id, JSON.stringify(sub), JSON.stringify(result), result.passed ? 1 : 0, seconds(b.seconds));
  send(res, 200, { saved: true }); // no result during a test: that would give the answer away
});

route('POST', '/api/tests/(\\d+)/submit', (req, res, { m }) => {
  const u = needUser(req);
  const t = loadTestForTrainee(u, num(m[1]));
  let att = one('SELECT * FROM attempts WHERE slack_id = ? AND test_id = ?', u.slack_id, t.id);
  if (!att) fail(409, 'Start the test first.');
  att = autoSubmitIfLate(att);
  if (!att.submitted_at) { att.submitted_at = sqlNow(); run('UPDATE attempts SET submitted_at = ? WHERE id = ?', att.submitted_at, att.id); }
  send(res, 200, { done: true, result: testResult(t, att) });
});

// Opening a class link: someone with no class joins the link's class. Someone already in another class is told to ask.
route('POST', '/api/tests/(\\d+)/join', (req, res, { m }) => {
  const u = needUser(req);
  const t = one('SELECT t.*, c.name class_name FROM tests t LEFT JOIN classes c ON c.id = t.class_id WHERE t.id = ?', num(m[1]));
  if (!t || t.status === 'draft' || t.status === 'deleted') fail(404, 'This link is not open yet. Ask your trainer.');
  if (u.role !== 'admin') {
    if (!u.class_id) run('UPDATE users SET class_id = ? WHERE slack_id = ?', t.class_id, u.slack_id);
    else if (u.class_id !== t.class_id) fail(409, `This link is for the ${t.class_name} class, and you are in another class. Ask your trainer.`);
  }
  send(res, 200, { id: t.id, mode: t.mode, name: t.name, user: publicUser(one('SELECT * FROM users WHERE slack_id = ?', u.slack_id)) });
});

// ── class links ────────────────────────────────────────────────────────
// Each class has ONE link that ends with its name: /class/october-2026. Opening it joins the class (if you have none)
// and shows that class's open practice and tests. The link follows the class name, so renaming a class changes it.
export const slugify = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'class';
const classBySlug = (slug) => all('SELECT * FROM classes').find((c) => slugify(c.name) === slug);

route('GET', '/class/([a-z0-9-]+)', (req, res, { m }) => {
  res.writeHead(302, { Location: `/#class-${m[1]}` });
  res.end();
});

route('POST', '/api/class/([a-z0-9-]+)/join', (req, res, { m }) => {
  const u = needUser(req);
  const c = classBySlug(m[1]);
  if (!c) fail(404, 'This class link does not work any more. Ask your trainer for the new one.');
  if (u.role !== 'admin') {
    if (u.class_id && u.class_id !== c.id) fail(409, `This link is for the ${c.name} class, and you are in another class. Ask your trainer.`);
    if (!u.class_id) {
      if (!c.active) fail(409, `The ${c.name} class is closed. Ask your trainer.`);
      run('UPDATE users SET class_id = ? WHERE slack_id = ?', c.id, u.slack_id);
    }
  }
  const done = Object.fromEntries(all(`SELECT sa.scenario_id, MAX(sa.passed) ok, COUNT(*) n FROM scenario_answers sa JOIN attempts at ON at.id = sa.attempt_id
    WHERE at.slack_id = ? AND at.test_id IS NULL GROUP BY sa.scenario_id`, u.slack_id).map((r) => [r.scenario_id, r]));
  const sets = all(`SELECT * FROM tests WHERE class_id = ? AND mode = 'practice' AND status = 'open' ORDER BY id`, c.id);
  const seen = new Set();
  const practice = sets.flatMap((t) => testScenarios(t.id)).filter((s) => !seen.has(s.id) && seen.add(s.id))
    .map((s) => ({ ...publicScenario(s), tries: done[s.id]?.n || 0, gotRight: !!done[s.id]?.ok }));
  const tests = all(`SELECT * FROM tests WHERE class_id = ? AND mode = 'test' AND status IN ('open','closed') ORDER BY id DESC`, c.id).map((t) => {
    let att = one('SELECT * FROM attempts WHERE slack_id = ? AND test_id = ?', u.slack_id, t.id);
    if (att) att = autoSubmitIfLate(att);
    const n = one('SELECT COUNT(*) n FROM test_scenarios WHERE test_id = ?', t.id).n;
    return { id: t.id, name: t.name, status: t.status, questions: n, passMeters: t.pass_meters, passCount: t.pass_count,
      timeLimitMin: t.time_limit_min, state: !att ? 'not started' : att.submitted_at ? 'done' : 'in progress' };
  });
  send(res, 200, { class: { id: c.id, name: c.name, slug: slugify(c.name) }, practice, tests,
    user: publicUser(one('SELECT * FROM users WHERE slack_id = ?', u.slack_id)) });
});

route('GET', '/api/tests/(\\d+)/set', (req, res, { m }) => {
  const u = needUser(req);
  const t = loadTestForTrainee(u, num(m[1]));
  if (t.mode !== 'practice') fail(409, 'This is a test, not a practice set.');
  const done = Object.fromEntries(all(`SELECT sa.scenario_id, MAX(sa.passed) ok, COUNT(*) n FROM scenario_answers sa JOIN attempts at ON at.id = sa.attempt_id
    WHERE at.slack_id = ? AND at.test_id IS NULL GROUP BY sa.scenario_id`, u.slack_id).map((r) => [r.scenario_id, r]));
  send(res, 200, { id: t.id, name: t.name, scenarios: testScenarios(t.id).map((s) => ({ ...publicScenario(s), tries: done[s.id]?.n || 0, gotRight: !!done[s.id]?.ok })) });
});

route('GET', '/api/my/history', (req, res) => {
  const u = needUser(req);
  const rows = all(`SELECT s.title, sa.passed, sa.result, sa.created_at FROM scenario_answers sa JOIN attempts at ON at.id = sa.attempt_id
    JOIN scenarios s ON s.id = sa.scenario_id WHERE at.slack_id = ? AND at.test_id IS NULL ORDER BY sa.id DESC LIMIT 30`, u.slack_id);
  send(res, 200, {
    tries: rows.length, passed: rows.filter((r) => r.passed).length,
    recent: rows.map((r) => { const g = JSON.parse(r.result); return { title: r.title, passed: !!r.passed, distance: g.stops[0]?.distance, at: r.created_at,
      misses: [...g.stops.filter((x) => !x.passed).map((x) => `${x.kind} pin`), ...(g.missingQuestions.length ? ['questions'] : []), ...(g.note.ok ? [] : ['driver note'])] }; }),
  });
});

// ── admins: scenarios ──────────────────────────────────────────────────
route('GET', '/api/admin/scenarios', (req, res) => {
  needAdmin(req);
  // Trainees only: admins and trainers trying their own scenarios never count toward these numbers.
  const trainee = `JOIN attempts a ON a.id = sa.attempt_id JOIN users u ON u.slack_id = a.slack_id AND u.role = 'trainee'`;
  send(res, 200, all(`SELECT s.*, (SELECT COUNT(*) FROM scenario_answers sa ${trainee} WHERE sa.scenario_id = s.id) tries,
    (SELECT SUM(sa.passed) FROM scenario_answers sa ${trainee} WHERE sa.scenario_id = s.id) passes FROM scenarios s WHERE archived = 0 ORDER BY id DESC`)
    .map((s) => ({ id: s.id, version: s.version, title: s.title, category: s.category, practice: !!s.practice, tries: s.tries, passes: s.passes || 0, data: scenarioData(s) })));
});

route('POST', '/api/admin/scenarios', async (req, res) => {
  const u = needAdmin(req);
  const b = await readJson(req);
  const title = str(b.title, 120);
  if (!title) fail(400, 'Give the scenario a name.');
  let data;
  try { data = cleanScenario(b.data || {}); } catch (e) { fail(400, e.message); }
  const vals = [title, pinSkill(str(b.category, 40)), JSON.stringify(data), b.practice === false ? 0 : 1];
  if (b.id) {
    const cur = one('SELECT id, version FROM scenarios WHERE id = ?', num(b.id));
    if (!cur) fail(404, 'Scenario not found.');
    if (num(b.version) !== cur.version) fail(409, 'This scenario changed since you opened it (someone saved it, or an update reached it). Reload the page so nothing newer gets written over, then make your change again.');
    run('UPDATE scenarios SET title = ?, category = ?, data = ?, practice = ?, version = version + 1 WHERE id = ?', ...vals, num(b.id));
    return send(res, 200, { id: num(b.id) });
  }
  send(res, 200, { id: Number(run('INSERT INTO scenarios (title, category, data, practice, created_by) VALUES (?, ?, ?, ?, ?)', ...vals, u.slack_id).lastInsertRowid) });
});

// Archive, never delete: old test results keep pointing at the scenario.
route('POST', '/api/admin/scenarios/(\\d+)/archive', (req, res, { m }) => {
  needAdmin(req);
  run('UPDATE scenarios SET archived = 1 WHERE id = ?', num(m[1]));
  send(res, 200, { ok: true });
});

// Adds the worked examples that are not here yet. Never changes one that is already here.
route('POST', '/api/admin/scenarios/examples', (req, res) => {
  const u = needAdmin(req);
  let added = 0;
  for (const ex of EXAMPLE_SCENARIOS) {
    // Add-only: an example that is already here may have been edited by an admin, so it is left exactly as it is.
    if (one('SELECT id FROM scenarios WHERE title = ?', ex.title)) continue;
    run('INSERT INTO scenarios (title, category, data, practice, created_by) VALUES (?, ?, ?, 1, ?)', ex.title, pinSkill(ex.category), JSON.stringify(cleanScenario(ex.data)), u.slack_id);
    added++;
  }
  send(res, 200, { added });
});

// ── admins: classes and people ─────────────────────────────────────────
route('GET', '/api/admin/classes', (req, res) => {
  needAdmin(req);
  send(res, 200, all(`SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id) people FROM classes c ORDER BY id DESC`)
    .map((c) => ({ ...c, slug: slugify(c.name) })));
});
// Two classes can't share a link: "October 2026" and "october-2026" would both be /class/october-2026.
function linkTaken(name, exceptId = 0) {
  const other = all('SELECT id, name FROM classes WHERE id != ?', exceptId).find((c) => slugify(c.name) === slugify(name));
  if (other) fail(409, `A class with that name already exists ("${other.name}").`);
}
route('POST', '/api/admin/classes', async (req, res) => {
  needAdmin(req);
  const b = await readJson(req);
  if (b.id) {
    if (!one('SELECT id FROM classes WHERE id = ?', num(b.id))) fail(404, 'Class not found.');
    if ('active' in b) run('UPDATE classes SET active = ? WHERE id = ?', b.active ? 1 : 0, num(b.id));
    if ('name' in b) {
      const nm = str(b.name, 80);
      if (!nm) fail(400, 'The class needs a name.');
      linkTaken(nm, num(b.id));
      run('UPDATE classes SET name = ? WHERE id = ?', nm, num(b.id));
    }
    return send(res, 200, { ok: true });
  }
  const name = str(b.name, 80);
  if (!name) fail(400, 'Name the class, e.g. "October 2026".');
  linkTaken(name);
  send(res, 200, { id: Number(run('INSERT INTO classes (name) VALUES (?)', name).lastInsertRowid) });
});

// A class with people in it can't be deleted (move them first). Deleting an empty class also deletes its practice
// sets and tests (status 'deleted': hidden everywhere, any results stay in the database).
route('POST', '/api/admin/classes/(\\d+)/delete', (req, res, { m }) => {
  needAdmin(req);
  const id = num(m[1]);
  const c = one('SELECT * FROM classes WHERE id = ?', id);
  if (!c) fail(404, 'Class not found.');
  if (one(`SELECT 1 FROM users WHERE class_id = ? AND role = 'trainee'`, id)) fail(409, 'Trainees are in this class. Move them to another class first, or close the class instead.');
  tx(() => {
    run(`UPDATE tests SET status = 'deleted', deleted_class_name = ?, class_id = NULL WHERE class_id = ?`, c.name, id);
    run('UPDATE users SET class_id = NULL WHERE class_id = ?', id); // admins only, by the check above
    run('DELETE FROM classes WHERE id = ?', id);
  });
  send(res, 200, { ok: true });
});

route('GET', '/api/admin/people', (req, res) => {
  needAdmin(req);
  send(res, 200, all(`SELECT u.slack_id, u.name, u.role, u.class_id, c.name class_name, u.last_login,
    (SELECT COUNT(*) FROM scenario_answers sa JOIN attempts a ON a.id = sa.attempt_id WHERE a.slack_id = u.slack_id AND a.test_id IS NULL) practice_tries,
    (SELECT COUNT(DISTINCT sa.scenario_id) FROM scenario_answers sa JOIN attempts a ON a.id = sa.attempt_id WHERE a.slack_id = u.slack_id AND a.test_id IS NULL AND sa.passed = 1) practice_right,
    (SELECT COUNT(*) FROM attempts a WHERE a.slack_id = u.slack_id AND a.test_id IS NOT NULL AND a.submitted_at IS NOT NULL) tests_done
    FROM users u LEFT JOIN classes c ON c.id = u.class_id ORDER BY c.id DESC, u.name`));
});
route('POST', '/api/admin/people', async (req, res) => {
  const me = needAdmin(req);
  const b = await readJson(req);
  const target = one('SELECT * FROM users WHERE slack_id = ?', str(b.slackId, 40));
  if (!target) fail(404, 'Person not found.');
  if ('classId' in b) run('UPDATE users SET class_id = ? WHERE slack_id = ?', b.classId ? num(b.classId) : null, target.slack_id);
  if (b.role === 'admin' || b.role === 'trainee') {
    if (target.slack_id === me.slack_id && b.role === 'trainee') fail(400, 'You cannot remove your own admin access.');
    run('UPDATE users SET role = ? WHERE slack_id = ?', b.role, target.slack_id);
  }
  send(res, 200, { ok: true });
});

// ── admins: tests ──────────────────────────────────────────────────────
route('GET', '/api/admin/tests', (req, res) => {
  needAdmin(req);
  send(res, 200, all(`SELECT t.*, c.name class_name, COALESCE(t.group_id, t.id) grp,
    (SELECT COUNT(*) FROM test_scenarios ts WHERE ts.test_id = t.id) questions,
    (SELECT COUNT(*) FROM attempts a WHERE a.test_id = t.id) started,
    (SELECT COUNT(*) FROM attempts a WHERE a.test_id = t.id AND a.submitted_at IS NOT NULL) handed_in,
    (SELECT COUNT(DISTINCT a.slack_id) FROM scenario_answers sa JOIN attempts a ON a.id = sa.attempt_id JOIN test_scenarios ts ON ts.scenario_id = sa.scenario_id
      JOIN users u ON u.slack_id = a.slack_id WHERE ts.test_id = t.id AND a.test_id IS NULL AND u.class_id = t.class_id) practised
    FROM tests t LEFT JOIN classes c ON c.id = t.class_id WHERE t.status != 'deleted' ORDER BY grp DESC, t.mode, t.id`)
    .map((t) => ({ ...t, classSlug: t.class_name ? slugify(t.class_name) : null,
      scenarioIds: all('SELECT scenario_id FROM test_scenarios WHERE test_id = ? ORDER BY position', t.id).map((r) => r.scenario_id) })));
});

// One form makes a class's practice set AND its test: each scenario is marked Practice, Test, or not used.
// Practice can be changed any time. A test's calls can't change once someone has started it (name, time and
// pass mark still can). New ones start as drafts, so nothing shows on the class link until it is opened.
route('POST', '/api/admin/tests/group', async (req, res) => {
  const u = needAdmin(req);
  const b = await readJson(req);
  const name = str(b.name, 120);
  const ids = (x) => (Array.isArray(x) ? [...new Set(x.map(num))] : []);
  const practiceIds = ids(b.practiceIds);
  const testIds = ids(b.testIds).filter((id) => !practiceIds.includes(id));
  const classId = num(b.classId);
  if (!name) fail(400, 'Give it a name, e.g. "October 2026 pins".');
  if (!one('SELECT id FROM classes WHERE id = ?', classId)) fail(400, 'Pick the class this is for.');
  if (!practiceIds.length && !testIds.length) fail(400, 'Mark at least one scenario as Practice or Test.');
  for (const id of [...practiceIds, ...testIds]) if (!one('SELECT id FROM scenarios WHERE id = ? AND archived = 0', id)) fail(400, 'One of the scenarios no longer exists.');
  const passMeters = Math.min(200, Math.max(1, num(b.passMeters) || 15));
  const passCount = Math.min(Math.max(testIds.length, 1), Math.max(1, Math.round(num(b.passCount) || testIds.length)));
  const minutes = Math.min(240, Math.max(1, Math.round(num(b.timeLimitMin) || 20)));
  const groupId = num(b.groupId) || 0;
  const rows = groupId ? all(`SELECT * FROM tests WHERE COALESCE(group_id, id) = ? AND status != 'deleted'`, groupId) : [];
  if (groupId && !rows.length) fail(404, 'Not found. Reload the page.');
  const sorted = (a) => JSON.stringify([...a].sort((x, y) => x - y));
  const sameList = (t, list) => sorted(all('SELECT scenario_id FROM test_scenarios WHERE test_id = ?', t.id).map((r) => r.scenario_id)) === sorted(list);
  const out = tx(() => {
    let grp = groupId;
    const save = (mode, list) => {
      const cur = rows.find((t) => t.mode === mode);
      const started = cur && one('SELECT 1 FROM attempts WHERE test_id = ?', cur.id);
      if (!list.length) {
        if (!cur) return;
        if (started) fail(409, 'People have already taken this test, so it can\'t be emptied. Delete it from the list instead.');
        run(`UPDATE tests SET status = 'deleted' WHERE id = ?`, cur.id);
        return;
      }
      if (cur) {
        if (started && !sameList(cur, list)) fail(409, 'People have already started this test, so its calls can\'t change. Make a new test instead.');
        run('UPDATE tests SET name=?, class_id=?, pass_meters=?, pass_count=?, time_limit_min=? WHERE id = ?', name, classId, passMeters, passCount, minutes, cur.id);
        if (started) return;
        run('DELETE FROM test_scenarios WHERE test_id = ?', cur.id);
        list.forEach((sid, i) => run('INSERT INTO test_scenarios (test_id, scenario_id, position) VALUES (?, ?, ?)', cur.id, sid, i));
        return;
      }
      const id = Number(run('INSERT INTO tests (name, class_id, pass_meters, pass_count, time_limit_min, mode, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        name, classId, passMeters, passCount, minutes, mode, u.slack_id).lastInsertRowid);
      if (!grp) grp = id;
      run('UPDATE tests SET group_id = ? WHERE id = ?', grp, id);
      list.forEach((sid, i) => run('INSERT INTO test_scenarios (test_id, scenario_id, position) VALUES (?, ?, ?)', id, sid, i));
    };
    save('practice', practiceIds);
    save('test', testIds);
    return grp;
  });
  send(res, 200, { groupId: out });
});

// Delete = hidden everywhere (list, class link, results). Answers already given stay in the database.
route('POST', '/api/admin/tests/(\\d+)/delete', (req, res, { m }) => {
  needAdmin(req);
  if (!one(`SELECT id FROM tests WHERE id = ? AND status != 'deleted'`, num(m[1]))) fail(404, 'Not found. Reload the page.');
  run(`UPDATE tests SET status = 'deleted' WHERE id = ?`, num(m[1]));
  send(res, 200, { ok: true });
});

route('POST', '/api/admin/tests', async (req, res) => {
  const u = needAdmin(req);
  const b = await readJson(req);
  const name = str(b.name, 120);
  const ids = Array.isArray(b.scenarioIds) ? [...new Set(b.scenarioIds.map(num))] : [];
  if (!name) fail(400, 'Name the test.');
  if (!one('SELECT id FROM classes WHERE id = ?', num(b.classId))) fail(400, 'Pick the class this test is for.');
  if (!ids.length) fail(400, 'Add at least one scenario.');
  for (const id of ids) if (!one('SELECT id FROM scenarios WHERE id = ? AND archived = 0', id)) fail(400, 'One of the scenarios no longer exists.');
  const passMeters = Math.min(200, Math.max(1, num(b.passMeters) || 15));
  const passCount = Math.min(ids.length, Math.max(1, Math.round(num(b.passCount) || ids.length)));
  const minutes = Math.min(240, Math.max(1, Math.round(num(b.timeLimitMin) || 20)));
  const mode = b.mode === 'practice' ? 'practice' : 'test';
  const id = tx(() => {
    let testId = num(b.id);
    if (testId) {
      const t = one('SELECT * FROM tests WHERE id = ?', testId);
      if (!t) fail(404, 'Test not found.');
      if (t.status !== 'draft') fail(409, 'A test can only be edited while it is a draft.');
      run('UPDATE tests SET name=?, class_id=?, pass_meters=?, pass_count=?, time_limit_min=?, mode=? WHERE id = ?', name, num(b.classId), passMeters, passCount, minutes, mode, testId);
      run('DELETE FROM test_scenarios WHERE test_id = ?', testId);
    } else {
      testId = Number(run('INSERT INTO tests (name, class_id, pass_meters, pass_count, time_limit_min, mode, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        name, num(b.classId), passMeters, passCount, minutes, mode, u.slack_id).lastInsertRowid);
    }
    ids.forEach((sid, i) => run('INSERT INTO test_scenarios (test_id, scenario_id, position) VALUES (?, ?, ?)', testId, sid, i));
    return testId;
  });
  send(res, 200, { id });
});

route('POST', '/api/admin/tests/(\\d+)/status', async (req, res, { m }) => {
  needAdmin(req);
  const { status } = await readJson(req);
  if (!['draft', 'open', 'closed'].includes(status)) fail(400, 'Unknown status.');
  const t = one(`SELECT * FROM tests WHERE id = ? AND status != 'deleted'`, num(m[1]));
  if (!t) fail(404, 'Test not found.');
  if (status === 'draft' && one('SELECT id FROM attempts WHERE test_id = ?', t.id)) fail(409, 'People have already started this test, so it cannot go back to draft.');
  run('UPDATE tests SET status = ? WHERE id = ?', status, t.id);
  send(res, 200, { ok: true });
});

function resultsFor(testId) {
  const t = one('SELECT * FROM tests WHERE id = ?', testId);
  if (!t) fail(404, 'Test not found.');
  const people = all(`SELECT slack_id, name FROM users WHERE class_id = ? AND role = 'trainee' ORDER BY name`, t.class_id);
  const items = testScenarios(t.id);
  const rows = people.map((p) => {
    let att = one('SELECT * FROM attempts WHERE slack_id = ? AND test_id = ?', p.slack_id, t.id);
    if (att) att = autoSubmitIfLate(att);
    if (!att) return { slackId: p.slack_id, name: p.name, state: 'not started' };
    const r = testResult(t, att);
    return { slackId: p.slack_id, name: p.name, state: att.submitted_at ? 'done' : 'in progress', correct: r.correct, total: r.total,
      passed: att.submitted_at ? r.passed : null, submittedAt: att.submitted_at,
      scenarios: r.rows.map((x) => ({ title: x.title, answered: x.answered, passed: x.passed, stops: x.result.stops.map((s) => ({ kind: s.kind, distance: s.distance, passed: s.passed })),
        missingQuestions: x.result.missingQuestions, noteProblems: x.result.note.problems, note: x.submitted?.note || '' })) };
  });
  const perScenario = items.map((s) => {
    const done = all(`SELECT sa.result, sa.passed FROM scenario_answers sa JOIN attempts at ON at.id = sa.attempt_id
      WHERE at.test_id = ? AND sa.scenario_id = ? AND at.submitted_at IS NOT NULL`, t.id, s.id).map((r) => ({ ...JSON.parse(r.result), ok: !!r.passed }));
    const count = (f) => done.filter(f).length;
    return { title: s.title, answered: done.length, passed: count((d) => d.ok),
      pinWrong: count((d) => d.stops.some((x) => !x.passed)), questionsMissed: count((d) => d.missingQuestions.length > 0), noteWrong: count((d) => !d.note.ok) };
  });
  return { test: { id: t.id, name: t.name, status: t.status, passMeters: t.pass_meters, passCount: t.pass_count, total: items.length }, rows, perScenario };
}

route('GET', '/api/admin/results/(\\d+)', (req, res, { m }) => { needAdmin(req); send(res, 200, resultsFor(num(m[1]))); });

route('GET', '/api/admin/results/(\\d+)\\.csv', (req, res, { m }) => {
  needAdmin(req);
  const r = resultsFor(num(m[1]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Name', 'Slack ID', 'State', 'Passed scenarios', 'Out of', 'Passed test', ...r.perScenario.map((s) => s.title)];
  const lines = r.rows.map((p) => [p.name, p.slackId, p.state, p.correct ?? '', p.total ?? '', p.passed == null ? '' : p.passed ? 'Yes' : 'No',
    ...(p.scenarios || []).map((s) => (!s.answered ? 'No answer' : s.passed ? 'Pass' : 'Fail'))]);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pin-test-${r.test.id}.csv"` });
  res.end([head, ...lines].map((l) => l.map(q).join(',')).join('\r\n'));
});

// ── static files ───────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), TYPES['.html']); // one-page app
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// The Operator Training service (scripts/server.js) mounts this handler on its web port.
export async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    for (const r of routes) {
      const m = url.pathname.match(r.pattern);
      if (m && r.method === req.method) return await r.handler(req, res, { url, m });
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) fail(404, 'Not found.');
    if (req.method !== 'GET') fail(405, 'Not allowed.');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong. Please try again.' });
  }
}
export const server = http.createServer(handle);
// Called when the service is told to stop: closes the database so nothing is left half-written.
export function close() { db.close(); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`GoGo Academy on http://localhost:${PORT}`));
}
