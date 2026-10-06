// GoGo Pin Academy: pin practice and class pin tests built from short pretend calls (scenarios).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one, all, run, tx } from './src/db.js';
import { gradeScenario, publicScenario, cleanScenario } from './src/grading.js';
import { EXAMPLE_SCENARIOS } from './src/examples.js';
import * as auth from './src/auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
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
    note: str(b.note, 800),
    specific: (Array.isArray(b.specific) ? b.specific : []).slice(0, 2).map((s) => str(s, 120)),
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
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || '', mapId: process.env.GOOGLE_MAP_ID || 'DEMO_MAP_ID',
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

route('POST', '/api/practice/(\\d+)', async (req, res, { m }) => {
  const u = needUser(req);
  const row = one('SELECT * FROM scenarios WHERE id = ? AND practice = 1 AND archived = 0', num(m[1]));
  if (!row) fail(404, 'That scenario is not in practice.');
  const b = await readJson(req);
  const sub = cleanSubmission(b);
  const result = gradeScenario(scenarioData(row), sub, PRACTICE_METERS);
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
    return { id: t.id, name: t.name, status: t.status, questions: n, passMeters: t.pass_meters, passCount: t.pass_count,
      timeLimitMin: t.time_limit_min, state: !att ? 'not started' : att.submitted_at ? 'done' : 'in progress' };
  }));
});

function loadTestForTrainee(u, testId) {
  const t = one('SELECT * FROM tests WHERE id = ?', testId);
  if (!t || t.class_id !== u.class_id || t.status === 'draft') fail(404, 'Test not found.');
  return t;
}

route('POST', '/api/tests/(\\d+)/start', (req, res, { m }) => {
  const u = needUser(req);
  const t = loadTestForTrainee(u, num(m[1]));
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
  send(res, 200, all(`SELECT s.*, (SELECT COUNT(*) FROM scenario_answers sa WHERE sa.scenario_id = s.id) tries,
    (SELECT SUM(passed) FROM scenario_answers sa WHERE sa.scenario_id = s.id) passes FROM scenarios s WHERE archived = 0 ORDER BY id DESC`)
    .map((s) => ({ id: s.id, title: s.title, category: s.category, practice: !!s.practice, tries: s.tries, passes: s.passes || 0, data: scenarioData(s) })));
});

route('POST', '/api/admin/scenarios', async (req, res) => {
  const u = needAdmin(req);
  const b = await readJson(req);
  const title = str(b.title, 120);
  if (!title) fail(400, 'Give the scenario a name.');
  let data;
  try { data = cleanScenario(b.data || {}); } catch (e) { fail(400, e.message); }
  const vals = [title, str(b.category, 40) || 'Other', JSON.stringify(data), b.practice === false ? 0 : 1];
  if (b.id) {
    if (!one('SELECT id FROM scenarios WHERE id = ?', num(b.id))) fail(404, 'Scenario not found.');
    run('UPDATE scenarios SET title = ?, category = ?, data = ?, practice = ? WHERE id = ?', ...vals, num(b.id));
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

// Adds the worked examples (from real training cases, no customer details) if they are not there yet.
route('POST', '/api/admin/scenarios/examples', (req, res) => {
  const u = needAdmin(req);
  let added = 0;
  for (const ex of EXAMPLE_SCENARIOS) {
    if (one('SELECT id FROM scenarios WHERE title = ?', ex.title)) continue;
    run('INSERT INTO scenarios (title, category, data, practice, created_by) VALUES (?, ?, ?, 1, ?)', ex.title, ex.category, JSON.stringify(cleanScenario(ex.data)), u.slack_id);
    added++;
  }
  send(res, 200, { added });
});

// ── admins: classes and people ─────────────────────────────────────────
route('GET', '/api/admin/classes', (req, res) => {
  needAdmin(req);
  send(res, 200, all(`SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id) people FROM classes c ORDER BY id DESC`));
});
route('POST', '/api/admin/classes', async (req, res) => {
  needAdmin(req);
  const b = await readJson(req);
  if (b.id) { run('UPDATE classes SET active = ? WHERE id = ?', b.active ? 1 : 0, num(b.id)); return send(res, 200, { ok: true }); }
  const name = str(b.name, 80);
  if (!name) fail(400, 'Name the class, e.g. "October 2026".');
  if (one('SELECT id FROM classes WHERE name = ?', name)) fail(409, 'A class with that name already exists.');
  send(res, 200, { id: Number(run('INSERT INTO classes (name) VALUES (?)', name).lastInsertRowid) });
});

route('GET', '/api/admin/people', (req, res) => {
  needAdmin(req);
  send(res, 200, all(`SELECT u.slack_id, u.name, u.role, u.class_id, c.name class_name, u.last_login FROM users u
    LEFT JOIN classes c ON c.id = u.class_id ORDER BY u.last_login DESC`));
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
  send(res, 200, all(`SELECT t.*, c.name class_name,
    (SELECT COUNT(*) FROM test_scenarios ts WHERE ts.test_id = t.id) questions,
    (SELECT COUNT(*) FROM attempts a WHERE a.test_id = t.id AND a.submitted_at IS NOT NULL) handed_in
    FROM tests t LEFT JOIN classes c ON c.id = t.class_id ORDER BY t.id DESC`)
    .map((t) => ({ ...t, scenarioIds: all('SELECT scenario_id FROM test_scenarios WHERE test_id = ? ORDER BY position', t.id).map((r) => r.scenario_id) })));
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
  const id = tx(() => {
    let testId = num(b.id);
    if (testId) {
      const t = one('SELECT * FROM tests WHERE id = ?', testId);
      if (!t) fail(404, 'Test not found.');
      if (t.status !== 'draft') fail(409, 'A test can only be edited while it is a draft.');
      run('UPDATE tests SET name=?, class_id=?, pass_meters=?, pass_count=?, time_limit_min=? WHERE id = ?', name, num(b.classId), passMeters, passCount, minutes, testId);
      run('DELETE FROM test_scenarios WHERE test_id = ?', testId);
    } else {
      testId = Number(run('INSERT INTO tests (name, class_id, pass_meters, pass_count, time_limit_min, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        name, num(b.classId), passMeters, passCount, minutes, u.slack_id).lastInsertRowid);
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
  const t = one('SELECT * FROM tests WHERE id = ?', num(m[1]));
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Pin Academy on http://localhost:${PORT}`));
}
