// OPS_TASK=starsources
//
// The star model weighting arrived from Ops on 2026-09-11 (Vee's screenshot). Weekly,
// 5 points, each part all or nothing that week; the 90-day figure is the average week,
// goal 3.70:
//
//   1 HR ratio ≥15% ............. 1.5    6 OTL ratio ≥75% ............ 0.5
//   2 Ride success ≥80% ......... 0.75   7 Scheduled ride success ≥80%  0.25
//   3 Tardies / early outs = 0 .. 0.5    8 Tech issues = 0 ............ 0.25
//   4 QA average ≥85% ........... 0.5    9 Op reports = 0 ............. 0.25
//   5 Activation (non-member signups) ≥40% 0.5
//
// We already have 1 (operatorPerformances) and 9 (the #op_report archive). This finds
// where the other seven live, and whether GoGo already computes a score itself.
//
// Leads from the 2026-09-10 schema search (Build Notes "09 Star Model"), NOT yet checked:
//   - operatorWeeklyScores: startDate, averageScore, totalScore,
//     callSummaryRatingsConfigKey. A weekly score table — it may be the star model, or
//     it may be the AI call score behind part 4. The data decides, not the name.
//   - ridePerformances: rides, ridesCompleted, scheduledRides, scheduledRidesCompleted
//     per operator per day — parts 2 and 7 look computable from it.
//
// Read-only, date-bounded, LIMITed. Writes BUILD NOTES only: this is gathering, not
// something a trainer acts on.

import { connect, tryQ } from '../src/db.js';
import { writeTab, formatHeader, BUILD_SHEET_ID } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate } from '../src/time.js';
import { TRAINED_SLACK_IDS, earliestGradDate } from '../data/trained-roster.js';

const TAB = '14 Star Model Sources';

const fmt = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fmtDbDate(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

async function main() {
  const { conn } = await connect();
  const out = [['Question', 'Answer']];

  const ask = async (label, sql, params = [], timeout = 45_000) => {
    const r = await tryQ(conn, sql, params, timeout);
    if (r.error) {
      out.push([label, `ERROR: ${r.error.slice(0, 400)}`]);
      console.log(`${label}\n  ERROR: ${r.error.slice(0, 200)}`);
      return null;
    }
    const text = r.rows.map((row) => Object.entries(row).map(([k, v]) => `${k}=${fmt(v)}`).join('  ')).join('\n');
    out.push([label, text || '(no rows)']);
    console.log(`${label}\n  ${(text || '(no rows)').slice(0, 400)}`);
    return r.rows;
  };
  const section = (t) => out.push([`— ${t} —`, '']);
  const columnsOf = (table) => ask(
    `${table} — every column`,
    `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION LIMIT 120`,
    [table],
  );

  const idRes = await tryQ(conn, 'SELECT id FROM operators WHERE slackId IN (?)', [TRAINED_SLACK_IDS]);
  const ids = (idRes.rows ?? []).map((r) => r.id);
  const since = earliestGradDate();
  out.push(['Scope', `${ids.length} operators from the class rosters, data since ${since}. Schema searches cover the whole database; every number is limited to these operators.`]);

  // ------------------------------------------------------------------ 0
  section('0. Does GoGo already compute a weekly score? (operatorWeeklyScores)');
  const wsCols = await columnsOf('operatorWeeklyScores');
  await ask('operatorWeeklyScores — size, date range, score range',
    `SELECT COUNT(*) AS rows_total, MIN(startDate) AS first, MAX(startDate) AS last,
            MIN(averageScore) AS min_avg, MAX(averageScore) AS max_avg, ROUND(AVG(averageScore), 3) AS mean_avg,
            MIN(totalScore) AS min_total, MAX(totalScore) AS max_total
       FROM operatorWeeklyScores`);
  await ask('operatorWeeklyScores — which ratings config each row uses',
    `SELECT callSummaryRatingsConfigKey, COUNT(*) AS n FROM operatorWeeklyScores
      GROUP BY callSummaryRatingsConfigKey ORDER BY n DESC LIMIT 20`);
  await ask('operatorWeeklyScores — the 3 most recent rows, every column',
    'SELECT * FROM operatorWeeklyScores ORDER BY startDate DESC LIMIT 3');
  const wsKey = (wsCols ?? []).map((c) => c.COLUMN_NAME).find((n) => /^(operatorId|agentId)$/i.test(n));
  if (wsKey && ids.length) {
    await ask(`operatorWeeklyScores — our operators since ${since} (joined on ${wsKey} = operators.id; no rows may just mean the key is not operators.id)`,
      `SELECT o.firstName, o.lastName, w.startDate, w.averageScore, w.totalScore
         FROM operatorWeeklyScores w JOIN operators o ON o.id = w.\`${wsKey}\`
        WHERE w.\`${wsKey}\` IN (?) AND w.startDate >= ?
        ORDER BY w.startDate DESC LIMIT 80`, [ids, since]);
  } else {
    out.push(['operatorWeeklyScores — our operators', 'Not queried: no operatorId/agentId column. The column list above shows what it is keyed on.']);
  }

  // ------------------------------------------------------------------ 2 + 7
  section('2 + 7. Ride success and scheduled ride success (ridePerformances)');
  if (ids.length) {
    await ask(`ridePerformances — our operators since ${since}`,
      `SELECT o.firstName, o.lastName,
              SUM(r.rides) AS rides, SUM(r.ridesCompleted) AS completed,
              ROUND(100 * SUM(r.ridesCompleted) / NULLIF(SUM(r.rides), 0), 1) AS pct_completed,
              SUM(r.ridesCanceled) AS canceled,
              SUM(r.scheduledRides) AS scheduled, SUM(r.scheduledRidesCompleted) AS scheduled_completed,
              ROUND(100 * SUM(r.scheduledRidesCompleted) / NULLIF(SUM(r.scheduledRides), 0), 1) AS pct_scheduled
         FROM ridePerformances r JOIN operators o ON o.id = r.operatorId
        WHERE r.operatorId IN (?) AND r.aggregationDate >= ?
        GROUP BY o.id, o.firstName, o.lastName ORDER BY rides DESC LIMIT 100`, [ids, since], 60_000);
  }

  // ------------------------------------------------------------------ 3 + 6
  section('3 + 6. Tardies, early outs, OTL (operatorActivities)');
  await columnsOf('operatorActivities');
  await ask('operatorActivities — status codes in the last 14 days (all operators)',
    `SELECT startCode, endCode, COUNT(*) AS n FROM operatorActivities
      WHERE startTime >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      GROUP BY startCode, endCode ORDER BY n DESC LIMIT 40`, [], 60_000);
  await ask('operatorActivities — descriptions in the last 14 days (all operators)',
    `SELECT LEFT(description, 120) AS description_, COUNT(*) AS n FROM operatorActivities
      WHERE startTime >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      GROUP BY description_ ORDER BY n DESC LIMIT 30`, [], 60_000);
  if (ids.length) {
    await ask('operatorActivities — one of our operators, last 2 days, in order (what a working day looks like)',
      `SELECT startTime, startCode, endTime, endCode, LEFT(description, 80) AS description_
         FROM operatorActivities
        WHERE operatorId = ? AND startTime >= DATE_SUB(NOW(), INTERVAL 2 DAY)
        ORDER BY startTime LIMIT 60`, [ids[0]], 30_000);
  }

  // ------------------------------------------------------------------ 5
  section('5. Activation — non-member calls that became signups');
  await columnsOf('operatorPerformances');
  if (ids.length) {
    await ask(`operatorPerformanceCalls — our operators since ${since}: non-member calls and outcomes`,
      `SELECT o.firstName, o.lastName,
              SUM(c.noMembershipCalls) AS nonmember_calls,
              SUM(c.noMembershipHardRegs) AS nonmember_hard, SUM(c.noMembershipTrialRegs) AS nonmember_trial,
              ROUND(100 * (SUM(c.noMembershipHardRegs) + SUM(c.noMembershipTrialRegs)) / NULLIF(SUM(c.noMembershipCalls), 0), 1) AS pct_signed_up
         FROM operatorPerformanceCalls c JOIN operators o ON o.id = c.operatorId
        WHERE c.operatorId IN (?) AND c.callTimeStart >= ?
        GROUP BY o.id, o.firstName, o.lastName ORDER BY nonmember_calls DESC LIMIT 100`, [ids, since], 60_000);
  }

  // ------------------------------------------------------------------ 4
  section('4. QA average — which table holds a percentage?');
  await columnsOf('qualityAssurances');
  await columnsOf('callSummary');

  // ------------------------------------------------------------------ 8 + anything else
  section('8 and the rest — schema search across the whole database');
  await ask('Tables named like schedules, shifts, attendance, tardies, tech issues, outages, activation, scores, points or weekly',
    `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND LOWER(TABLE_NAME) REGEXP 'schedul|shift|attendance|adherence|tard|techissue|tech_issue|outage|incident|activation|score|point|weekly|otl|punch|clock'
        AND LOWER(TABLE_NAME) NOT LIKE '%backup%'
      ORDER BY TABLE_NAME LIMIT 150`);
  await ask('Columns named like tardy, early out, clock in, OTL, adherence, activation, tech issue, outage, success rate, QA score, points',
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND LOWER(COLUMN_NAME) REGEXP 'tard|earlyout|early_out|clockin|clock_in|clockout|clock_out|otl|adherence|activation|techissue|tech_issue|outage|successrat|success_rat|completionrat|qascore|qa_score|starmodel|star_model|points'
        AND LOWER(TABLE_NAME) NOT LIKE '%backup%'
      ORDER BY TABLE_NAME, COLUMN_NAME LIMIT 200`);

  // ------------------------------------------------------------------ 3, 6, 8 — wider
  // Vee, 2026-09-11: Time Scheduled, tardies and tech issues ARE in the database. The name
  // searches above found nothing, so this looks the other way round: every table keyed to
  // an operator, whatever it is called, in every schema this login can see.
  section('3, 6 and 8 — wider search: every table keyed to an operator');
  await tryQ(conn, 'SET SESSION group_concat_max_len = 16384');
  await ask('Schemas this login can see',
    `SELECT TABLE_SCHEMA, COUNT(*) AS tables_, SUM(TABLE_ROWS) AS approx_rows
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA NOT IN ('mysql','sys','information_schema','performance_schema')
      GROUP BY TABLE_SCHEMA ORDER BY TABLE_SCHEMA`);
  await ask('Every table with an operator / agent / team lead / employee key, and all its columns',
    `SELECT k.TABLE_SCHEMA, k.TABLE_NAME, t.TABLE_ROWS,
            GROUP_CONCAT(c.COLUMN_NAME ORDER BY c.ORDINAL_POSITION SEPARATOR ', ') AS columns_
       FROM (SELECT DISTINCT TABLE_SCHEMA, TABLE_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA NOT IN ('mysql','sys','information_schema','performance_schema')
                AND LOWER(COLUMN_NAME) IN ('operatorid','operator_id','agentid','agent_id','teamleadid','team_lead_id',
                                           'employeeid','employee_id','staffid','staff_id','workerid','supervisorid')) k
       JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = k.TABLE_SCHEMA AND t.TABLE_NAME = k.TABLE_NAME
       JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME
      WHERE LOWER(k.TABLE_NAME) NOT LIKE '%backup%'
      GROUP BY k.TABLE_SCHEMA, k.TABLE_NAME, t.TABLE_ROWS
      ORDER BY k.TABLE_SCHEMA, k.TABLE_NAME LIMIT 200`, [], 90_000);
  await ask('Tables in any schema named like a schedule, shift, roster, time off, attendance, hours or login',
    `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
      WHERE TABLE_SCHEMA NOT IN ('mysql','sys','information_schema','performance_schema')
        AND LOWER(TABLE_NAME) REGEXP 'schedul|shift|roster|slot|availab|calendar|timeoff|time_off|pto|leave|absen|attend|tard|early|clock|punch|timesheet|timecard|hour|adherence|wfm|staffing|coverage|login|session|technical|outage|workday|work_day'
        AND LOWER(TABLE_NAME) NOT REGEXP '^scheduled(rides|ridehistories|deliver|grocer)|backup'
      ORDER BY TABLE_SCHEMA, TABLE_NAME LIMIT 200`);
  const opCols = await columnsOf('operators');
  for (const { COLUMN_NAME: col } of (opCols ?? []).filter((c) => c.DATA_TYPE === 'json')) {
    await ask(`operators.${col} — the keys it holds, for our operators`,
      `SELECT JSON_KEYS(\`${col}\`) AS keys_, COUNT(*) AS operators_
         FROM operators WHERE id IN (?) AND \`${col}\` IS NOT NULL
        GROUP BY keys_ ORDER BY operators_ DESC LIMIT 10`, [ids]);
  }
  // Tech issues: operators set a "technical" status (1,592 times in 14 days, everyone).
  // Counted per class operator for the two weeks management's document covers, to hold
  // against their "Tech issues" column. Times as stored, not converted.
  await ask('operatorActivities — "technical" status per class operator, the two star-model weeks',
    `SELECT o.firstName, o.lastName,
            SUM(a.startTime >= '2026-08-23' AND a.startTime < '2026-08-30') AS technical_8_23,
            SUM(a.startTime >= '2026-08-30' AND a.startTime < '2026-09-06') AS technical_8_30,
            ROUND(SUM(CASE WHEN a.startTime >= '2026-08-30' AND a.startTime < '2026-09-06'
                           THEN TIMESTAMPDIFF(SECOND, a.startTime, a.endTime) END) / 60, 1) AS technical_minutes_8_30
       FROM operatorActivities a JOIN operators o ON o.id = a.operatorId
      WHERE a.operatorId IN (?) AND a.startCode = 'technical'
        AND a.startTime >= '2026-08-23' AND a.startTime < '2026-09-06'
      GROUP BY a.operatorId, o.firstName, o.lastName ORDER BY o.lastName LIMIT 120`, [ids], 90_000);
  // Tardies / early outs need a schedule to be late against. Words typed into activity
  // descriptions may name it. Keyword and count only: descriptions are free text and are
  // not copied here.
  await ask('operatorActivities — schedule words in descriptions, last 60 days (keyword + count only)',
    `SELECT REGEXP_SUBSTR(LOWER(description), 'tard[a-z]*|early out|early|late|shift|schedul[a-z]*|absent|excused|undertime|overtime|power|internet|outage|tech[a-z]*') AS keyword,
            COUNT(*) AS n
       FROM operatorActivities
      WHERE startTime >= DATE_SUB(NOW(), INTERVAL 60 DAY)
        AND LOWER(description) REGEXP 'tard|early|late|shift|schedul|absent|excused|undertime|overtime|power|internet|outage|tech'
      GROUP BY keyword ORDER BY n DESC LIMIT 30`, [], 90_000);

  // ------------------------------------------------------------------ the dashboard
  section("The operator dashboard's own SQL (customReports)");
  const crCols = await columnsOf('customReports');
  const names = (crCols ?? []).map((c) => c.COLUMN_NAME);
  const nameCol = ['name', 'title', 'label', 'reportName'].find((n) => names.includes(n));
  const queryCol = ['query', 'sql', 'sqlQuery'].find((n) => names.includes(n));
  if (nameCol) {
    await ask('customReports — every report name', `SELECT id, \`${nameCol}\` AS name_ FROM customReports ORDER BY id LIMIT 80`);
  }
  if (queryCol) {
    // BY NAME first. The 2026-09-11 run searched the SQL for words instead, and "star"
    // matched "periodStartAt" in every Google conversion report — the 20-row limit filled
    // with ads reports and the operator dashboard's own SQL never came back.
    if (nameCol) {
      await ask('customReports — the operator dashboard reports (full SQL, first 8000 characters)',
        `SELECT id, \`${nameCol}\` AS name_, LEFT(\`${queryCol}\`, 8000) AS sql_
           FROM customReports
          WHERE \`${nameCol}\` LIKE 'operator%'
          ORDER BY id LIMIT 10`);
    }
    await ask('customReports — other reports whose SQL names a star model table (first 3000 characters)',
      `SELECT id, ${nameCol ? `\`${nameCol}\` AS name_,` : ''} LEFT(\`${queryCol}\`, 3000) AS sql_
         FROM customReports
        WHERE LOWER(\`${queryCol}\`) REGEXP 'rideperformances|operatoractivities|operatorweeklyscores|qualityassurances|callsummary|scheduledrides'
          ${nameCol ? `AND \`${nameCol}\` NOT LIKE 'operator%'` : ''}
        ORDER BY id LIMIT 10`);
  } else {
    out.push(['customReports — SQL', 'Not queried: no column named query/sql. See the column list above.']);
  }

  await conn.end();

  const info = await writeTab(TAB, [
    ['Where do the 9 star model parts live?'],
    [`Run ${nowET()}. Read-only. Weighting from Ops 2026-09-11: HR ratio 1.5 · ride success 0.75 · tardies 0.5 · QA 0.5 · activation 0.5 · OTL 0.5 · scheduled rides 0.25 · tech issues 0.25 · op reports 0.25.`],
    [''],
    ...out,
  ], BUILD_SHEET_ID);
  if (info.created) await formatHeader(TAB, { bandRows: true }).catch(() => {});
  console.log(`[starsources] wrote "${TAB}" to Build Notes`);
  await notify(`Star model sources probe finished — see "${TAB}" on Build Notes.`);
}

// A probe that writes nothing when it fails looks the same as one that never ran.
main().catch(async (err) => {
  console.error('[starsources] failed:', err);
  try {
    await writeTab(TAB, [
      ['Where do the 9 star model parts live?'],
      ['Status', '❌ FAILED — the probe started but could not finish'],
      ['Error', err.message],
      ['Run at', nowET()],
    ], BUILD_SHEET_ID);
  } catch (e) {
    console.error('[starsources] could not write the failure either:', e.message);
  }
  await notify(`❌ Star model sources probe failed: ${err.message}`);
  process.exit(1);
});
