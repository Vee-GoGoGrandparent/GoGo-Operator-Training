// OPS_TASK=discover
//
// Read-only reconnaissance. Writes nothing to the database and nothing outside
// OPS_SHEET_ID. Its whole job is to answer the questions we must not guess at
// before designing the tracker:
//
//   1. Can this Railway service even reach the replica? (Did the static IP carry
//      over from the marketing service, or does the DBA need to add this one?)
//   2. Which operator tables can the `marketing` user actually SELECT?
//   3. Does `operators.slackId` really match the Slack IDs in the class workbooks?
//      Everything depends on this. If it fails, the design changes completely.
//   4. Is `callSummary.score` real data or mostly null?
//   5. What is `operatorActivities` actually recording? (6.2M rows of something.)
//   6. How do we tell THIS department's operators from everyone else's?
//
// Read the sheet, not the logs. Every finding lands in a tab.

import { connect, q, tryQ } from '../src/db.js';
import { writeTab, formatHeader, OPS_SHEET_ID } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { CLASS_SLACK_IDS, CONFLICTING_IDS } from '../data/class-slack-ids.js';

// Everything that looked operator-shaped in the table inventory, plus the two
// giants we only want to confirm access to, not scan.
const TABLES = [
  'operators',
  'operatorPerformances',
  'operatorPerformanceCalls',
  'operatorConnectionHistories',
  'operatorActivities',
  'operatorActions',
  'operatorFaq',
  'callSummary',
  'qualityAssurances',
  'coachingAssignments',
  'coachingSummaries',
  'teamLeads',
  'ridePerformances',
  'callerPerformances',
  'customReports',
  'reservedCalls',
  'twilioTasks',
  'callLogs',
];

const fmt = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 500);
  return String(v);
};

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

async function main() {
  const started = Date.now();
  const summary = [];
  const note = (k, v) => {
    summary.push([k, fmt(v)]);
    console.log(`${k}: ${fmt(v)}`);
  };

  if (!OPS_SHEET_ID) throw new Error('OPS_SHEET_ID is not set. Nothing would have anywhere to go.');

  // ---------------------------------------------------------------- 1. connect
  const { conn, tls } = await connect();
  note('Connected', 'yes — the static IP carried over, no DBA request needed');
  note('TLS', tls);
  note('Database', process.env.DB_NAME);
  note('Run at', new Date().toISOString());

  // ------------------------------------------------- 2. access + size per table
  const access = [['Table', 'Can SELECT?', '~Rows', 'Size (MB)', '# Cols', 'Note']];
  const readable = [];

  const sizes = await q(
    conn,
    `SELECT TABLE_NAME, TABLE_ROWS, ROUND((DATA_LENGTH + INDEX_LENGTH)/1048576) AS mb
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?`,
    [process.env.DB_NAME],
  );
  const sizeOf = Object.fromEntries(sizes.map((r) => [r.TABLE_NAME, r]));

  for (const t of TABLES) {
    // One row is enough to prove SELECT works, and costs nothing on a 51M table.
    const probe = await tryQ(conn, `SELECT 1 FROM \`${t}\` LIMIT 1`, [], 10_000);
    const meta = sizeOf[t];
    if (probe.error) {
      access.push([t, '❌ DENIED', fmt(meta?.TABLE_ROWS), fmt(meta?.mb), '', probe.error.slice(0, 200)]);
      continue;
    }
    const cols = await tryQ(
      conn,
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
      [process.env.DB_NAME, t],
    );
    readable.push(t);
    access.push([
      t,
      '✅ yes',
      fmt(meta?.TABLE_ROWS),
      fmt(meta?.mb),
      fmt(cols.rows?.[0]?.n),
      meta ? '' : 'table not found in information_schema',
    ]);
  }
  note('Tables readable', `${readable.length} of ${TABLES.length}`);
  const denied = TABLES.filter((t) => !readable.includes(t));
  if (denied.length) note('DENIED', denied.join(', '));

  // ------------------------------------------------------- 3. column inventory
  const columns = [['Table', 'Column', 'Type', 'Nullable', 'Default', 'Comment']];
  if (readable.length) {
    const rows = await q(
      conn,
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${readable.map(() => '?').join(',')})
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [process.env.DB_NAME, ...readable],
    );
    for (const r of rows) {
      columns.push([
        r.TABLE_NAME,
        r.COLUMN_NAME,
        r.COLUMN_TYPE,
        r.IS_NULLABLE,
        fmt(r.COLUMN_DEFAULT),
        r.COLUMN_COMMENT || '',
      ]);
    }
  }

  // ------------------------------------------------------------ 4. THE JOIN TEST
  // The single most important question in this whole run.
  const join = [['Slack ID', 'Name (from workbook)', 'Cohort', 'Workbook status', 'Matched?', 'DB name', 'Hired', 'Closed', 'Deactivation reason', 'Rehire OK?', 'Suspended', 'Team lead', 'Departments', 'Perf rows', 'First perf day', 'Last perf day']];
  let matched = 0;
  let withPerf = 0;

  if (readable.includes('operators')) {
    const ids = CLASS_SLACK_IDS.map((c) => c.slackId);
    const found = await q(
      conn,
      `SELECT id, slackId, slackName, firstName, lastName, createdAt, closedAt,
              deactivationReason, isRehireEligible, suspendedAt, teamLeadId,
              departments, defaultType
         FROM operators
        WHERE slackId IN (${ids.map(() => '?').join(',')})`,
      ids,
      30_000,
    );
    const byId = Object.fromEntries(found.map((r) => [r.slackId, r]));

    // Second half of the join: do matched operators actually have performance rows?
    let perfBy = {};
    if (readable.includes('operatorPerformances') && found.length) {
      const opIds = found.map((r) => r.id);
      const perf = await tryQ(
        conn,
        `SELECT operatorId, COUNT(*) AS n, MIN(aggregationDate) AS first, MAX(aggregationDate) AS last
           FROM operatorPerformances
          WHERE operatorId IN (${opIds.map(() => '?').join(',')})
          GROUP BY operatorId`,
        opIds,
        30_000,
      );
      if (perf.rows) perfBy = Object.fromEntries(perf.rows.map((r) => [r.operatorId, r]));
    }

    for (const c of CLASS_SLACK_IDS) {
      const o = byId[c.slackId];
      if (o) matched += 1;
      const p = o ? perfBy[o.id] : null;
      if (p) withPerf += 1;
      join.push([
        c.slackId,
        c.name,
        c.cohort,
        c.status,
        o ? '✅' : '❌ no row',
        o ? `${fmt(o.firstName)} ${fmt(o.lastName)}`.trim() : '',
        fmt(o?.createdAt),
        fmt(o?.closedAt),
        fmt(o?.deactivationReason),
        o ? (o.isRehireEligible ? 'yes' : 'no') : '',
        fmt(o?.suspendedAt),
        fmt(o?.teamLeadId),
        fmt(o?.departments),
        fmt(p?.n),
        fmt(p?.first),
        fmt(p?.last),
      ]);
    }
    note('Slack ID join', `${matched}/${CLASS_SLACK_IDS.length} matched (${pct(matched, CLASS_SLACK_IDS.length)})`);
    note('With performance rows', `${withPerf}/${matched}`);

    // The three people whose workbooks disagree about their own Slack ID.
    join.push([]);
    join.push(['— CONFLICTING IDS IN THE WORKBOOKS (the DB settles which is right) —']);
    for (const c of CONFLICTING_IDS) {
      const hits = await tryQ(
        conn,
        `SELECT slackId, firstName, lastName, createdAt, closedAt FROM operators WHERE slackId IN (?, ?)`,
        c.ids,
      );
      for (const id of c.ids) {
        const hit = hits.rows?.find((r) => r.slackId === id);
        join.push([id, c.name, 'conflict', '', hit ? '✅ this is the real one' : '❌ not in DB', hit ? `${fmt(hit.firstName)} ${fmt(hit.lastName)}` : '', fmt(hit?.createdAt), fmt(hit?.closedAt)]);
      }
    }
  }

  // --------------------------------------- 5. is the data actually populated?
  const samples = [['Question', 'Answer']];
  const ask = async (label, sql, params = [], timeout = 25_000) => {
    const r = await tryQ(conn, sql, params, timeout);
    if (r.error) {
      samples.push([label, `ERROR: ${r.error.slice(0, 300)}`]);
      return null;
    }
    samples.push([label, r.rows.map((row) => Object.entries(row).map(([k, v]) => `${k}=${fmt(v)}`).join('  ')).join('\n') || '(no rows)']);
    return r.rows;
  };

  if (readable.includes('operators')) {
    await ask('operators — how many, and how many are closed?',
      `SELECT COUNT(*) AS total, SUM(closedAt IS NOT NULL) AS closed, SUM(suspendedAt IS NOT NULL) AS suspended FROM operators`);
    await ask('operators — hires per month, last 12 months (cohort sizes)',
      `SELECT DATE_FORMAT(createdAt,'%Y-%m') AS month, COUNT(*) AS hires
         FROM operators WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY month ORDER BY month`);
    await ask('operators — deactivation reasons (the churn vocabulary)',
      `SELECT deactivationReason, COUNT(*) AS n FROM operators
        WHERE deactivationReason IS NOT NULL AND deactivationReason <> ''
        GROUP BY deactivationReason ORDER BY n DESC LIMIT 40`);
    await ask('operators — defaultType values (is this how we find the department?)',
      `SELECT defaultType, COUNT(*) AS n FROM operators GROUP BY defaultType ORDER BY n DESC LIMIT 30`);
    await ask('operators — sample of the departments JSON',
      `SELECT departments, COUNT(*) AS n FROM operators WHERE departments IS NOT NULL GROUP BY departments ORDER BY n DESC LIMIT 25`);
    await ask('operators — how many have a slackId at all?',
      `SELECT COUNT(*) AS total, SUM(slackId IS NOT NULL AND slackId <> '') AS with_slack FROM operators`);
  }

  if (readable.includes('operatorPerformances')) {
    await ask('operatorPerformances — date range and volume',
      `SELECT MIN(aggregationDate) AS first, MAX(aggregationDate) AS last, COUNT(*) AS rows_, COUNT(DISTINCT operatorId) AS operators FROM operatorPerformances`);
    await ask('operatorPerformances — plan mix last 30d (the plan-sequencing signal)',
      `SELECT SUM(hardRegs) AS hardRegs, SUM(annualHardRegs) AS annual, SUM(valueMonthlyHardRegs) AS value_,
              SUM(basicMonthlyHardRegs) AS basic, SUM(fixedIncomeMonthlyHardRegs) AS fixedIncome,
              SUM(trialRegs) AS trials, SUM(softRegs) AS softRegs, SUM(upsellDuringRideCallsCount) AS upsells
         FROM operatorPerformances WHERE aggregationDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`);
    await ask('operatorPerformances — reg calls by service last 30d',
      `SELECT SUM(rideRegCalls) AS ride, SUM(groceryRegCalls) AS grocery, SUM(gourmetRegCalls) AS gourmet,
              SUM(noMembershipCalls) AS noMembership, SUM(testCalls) AS testCalls
         FROM operatorPerformances WHERE aggregationDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`);
  }

  if (readable.includes('callSummary')) {
    await ask('callSummary — is `score` real, or mostly null? (the AI quality signal)',
      `SELECT COUNT(*) AS rows_, SUM(score IS NOT NULL) AS scored, MIN(score) AS min_, MAX(score) AS max_,
              ROUND(AVG(score),2) AS avg_, MIN(createdAt) AS first, MAX(createdAt) AS last
         FROM callSummary`);
    await ask('callSummary — scored volume in the last 30 days',
      `SELECT COUNT(*) AS rows_, SUM(score IS NOT NULL) AS scored, COUNT(DISTINCT agentId) AS agents
         FROM callSummary WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)`);
    await ask('callSummary — one real summary, truncated (what does it actually say?)',
      `SELECT LEFT(summary, 900) AS sample, score FROM callSummary WHERE summary IS NOT NULL AND score IS NOT NULL ORDER BY createdAt DESC LIMIT 2`);
  }

  if (readable.includes('operatorActivities')) {
    await ask('operatorActivities — columns are a mystery; here are 3 real rows',
      `SELECT * FROM operatorActivities ORDER BY id DESC LIMIT 3`);
    await ask('operatorActivities — date range',
      `SELECT COUNT(*) AS rows_, COUNT(DISTINCT operatorId) AS operators FROM operatorActivities`);
  }

  if (readable.includes('operatorConnectionHistories')) {
    await ask('operatorConnectionHistories — is this handle time?',
      `SELECT COUNT(*) AS rows_, MIN(firstTime) AS first, MAX(lastTime) AS last,
              ROUND(AVG(TIMESTAMPDIFF(SECOND, firstTime, lastTime))) AS avg_seconds
         FROM operatorConnectionHistories WHERE firstTime IS NOT NULL AND lastTime IS NOT NULL`);
  }

  if (readable.includes('qualityAssurances')) {
    await ask('qualityAssurances — what is in the response JSON?',
      `SELECT LEFT(response, 900) AS sample, createdAt FROM qualityAssurances ORDER BY createdAt DESC LIMIT 2`);
  }

  if (readable.includes('customReports')) {
    // The SQL behind "Operator Registration Performances" lives here. If we can
    // read it, our numbers can match the dashboard the trainer already trusts.
    await ask('customReports — names (is Operator Registration Performances here?)',
      `SELECT id, name, schedule FROM customReports ORDER BY name LIMIT 50`);
  }

  if (readable.includes('teamLeads')) {
    await ask('teamLeads — the inventory said 0 rows; confirm',
      `SELECT COUNT(*) AS n FROM teamLeads`);
  }

  await conn.end();

  // --------------------------------------------------------------- 6. write out
  summary.unshift(['Finding', 'Value']);
  summary.push([]);
  summary.push(['Elapsed', `${Math.round((Date.now() - started) / 1000)}s`]);
  summary.push(['Next', 'Read tabs 01–04, then design the scorecard against what is actually there.']);

  await writeTab('00 Discovery Summary', summary);
  await writeTab('01 Table Access', access);
  await writeTab('02 Columns', columns);
  await writeTab('03 Join Test', join);
  await writeTab('04 Value Samples', samples);

  for (const t of ['00 Discovery Summary', '01 Table Access', '02 Columns', '03 Join Test', '04 Value Samples']) {
    await formatHeader(t, { bandRows: t === '01 Table Access' || t === '03 Join Test' }).catch(() => {});
  }

  const headline =
    `🔎 *Operator discovery finished* — ${readable.length}/${TABLES.length} tables readable, ` +
    `Slack-ID join matched ${matched}/${CLASS_SLACK_IDS.length}. Results in the tracker sheet.`;
  await notify(headline);
  console.log(headline);
}

main().catch(async (err) => {
  console.error('DISCOVERY FAILED:', err.message);
  // A failure is still a finding — write it where it can be read.
  try {
    await writeTab('00 Discovery Summary', [
      ['Finding', 'Value'],
      ['Status', '❌ FAILED'],
      ['Error', err.message],
      ['Run at', new Date().toISOString()],
      [],
      ['If this says the IP is not on the allowlist', 'then the static IP did NOT carry over to this new Railway service, and the DBA has to add it. That is the one thing we could not know in advance.'],
    ]);
    await formatHeader('00 Discovery Summary').catch(() => {});
  } catch (e) {
    console.error('could not even write the failure to the sheet:', e.message);
  }
  await notify(`❌ Operator discovery failed: ${err.message}`);
  process.exit(1);
});
