// OPS_TASK=reports
//
// "Does the system know whether an operator has an op report / op observation?"
//
// No table is named that. Searching all 249 tables for report / observation /
// writeup / incident / warning / infraction / disciplinary turned up only three
// candidates, and their contents are unknown:
//
//   operatorActions      37,225 rows — has `action`, `description`, a JSON blob
//                        and a url. Big enough to be a real log of something.
//   coachingSummaries        21 rows — operatorId, agentId, a summary JSON,
//                        a date, and sentToSlackAt.
//   coachingAssignments      10 rows — agent assigned to operator, start/end date.
//
// 21 and 10 rows is almost nothing across 1,920 operators, which suggests either a
// brand-new feature or one nobody uses. This probe finds out what is actually in
// them before anybody builds on top of them.
//
// The competing explanation, which this cannot rule out: op reports live in Google
// Docs and Sheets (the way "Op's Refresher" does) and were never in the database at
// all. If these tables come back thin or stale, that is the answer.
//
// Read-only.

import { connect, tryQ } from '../src/db.js';
import { writeTab, formatHeader } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate } from '../src/time.js';

const fmt = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fmtDbDate(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

async function main() {
  const { conn } = await connect();
  const out = [['Question', 'Answer']];

  const ask = async (label, sql, params = [], timeout = 30_000) => {
    const r = await tryQ(conn, sql, params, timeout);
    if (r.error) {
      out.push([label, `ERROR: ${r.error.slice(0, 400)}`]);
      console.log(`${label}\n  ERROR: ${r.error.slice(0, 200)}`);
      return null;
    }
    const text = r.rows.map((row) => Object.entries(row).map(([k, v]) => `${k}=${fmt(v)}`).join('  ')).join('\n');
    out.push([label, text || '(no rows)']);
    console.log(`${label}\n  ${text.slice(0, 400)}`);
    return r.rows;
  };

  out.push(['— operatorActions: 37k rows of WHAT? —', '']);

  // The whole question in one query: what kinds of action get logged here?
  await ask('operatorActions — every distinct action type',
    `SELECT action, COUNT(*) AS n, MIN(createdAt) AS first, MAX(createdAt) AS last
       FROM operatorActions GROUP BY action ORDER BY n DESC LIMIT 60`);

  await ask('operatorActions — what do the descriptions look like?',
    `SELECT action, description, COUNT(*) AS n
       FROM operatorActions
      WHERE description IS NOT NULL AND description <> ''
      GROUP BY action, description ORDER BY n DESC LIMIT 40`);

  await ask('operatorActions — what does it attach to?',
    `SELECT associatedObjectType, COUNT(*) AS n
       FROM operatorActions GROUP BY associatedObjectType ORDER BY n DESC LIMIT 25`);

  await ask('operatorActions — three recent rows in full',
    `SELECT * FROM operatorActions ORDER BY createdAt DESC LIMIT 3`);

  await ask('operatorActions — is it still being written to?',
    `SELECT DATE_FORMAT(createdAt,'%Y-%m') AS month, COUNT(*) AS n
       FROM operatorActions
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY month ORDER BY month`);

  out.push(['— coachingSummaries / coachingAssignments: real, or abandoned? —', '']);

  // No summary or coaching text: it can quote callers (Vee's no-customer-details rule,
  // 2026-09-11). Lengths answer "real, or abandoned?" just as well.
  await ask('coachingSummaries — everything in it (only ~21 rows; summary length only)',
    `SELECT cs.id, cs.date, cs.sentToSlackAt, cs.createdAt,
            o.slackId, o.firstName, o.lastName,
            CHAR_LENGTH(cs.summary) AS summary_chars
       FROM coachingSummaries cs
       LEFT JOIN operators o ON o.id = cs.operatorId
      ORDER BY cs.date DESC LIMIT 25`);

  await ask('coachingAssignments — everything in it (only ~10 rows)',
    `SELECT ca.id, ca.startDate, ca.endDate, ca.createdAt,
            o.slackId, o.firstName AS opFirst, o.lastName AS opLast,
            ag.firstName AS agentFirst, ag.lastName AS agentLast,
            CHAR_LENGTH(ca.data) AS data_chars
       FROM coachingAssignments ca
       LEFT JOIN operators o  ON o.id = ca.operatorId
       LEFT JOIN operators ag ON ag.id = ca.agentId
      ORDER BY ca.startDate DESC LIMIT 15`);

  out.push(['— anywhere else a note about an operator could hide —', '']);

  await ask('temporaryNotes — what is this, and is it operator-facing?',
    `SELECT COUNT(*) AS rows_, MIN(createdAt) AS first, MAX(createdAt) AS last FROM temporaryNotes`);

  await ask('temporaryNotes — three recent rows',
    `SELECT * FROM temporaryNotes ORDER BY createdAt DESC LIMIT 3`);

  // The trainer said operators get coached and then fired. If a report exists
  // anywhere, the people who were fired for performance are the likeliest to have
  // one — so look at them specifically.
  await ask('do recently-fired operators have ANY coaching record at all?',
    `SELECT o.slackId, o.firstName, o.lastName, o.closedAt, o.deactivationReason,
            (SELECT COUNT(*) FROM coachingSummaries cs WHERE cs.operatorId = o.id)   AS coaching_summaries,
            (SELECT COUNT(*) FROM coachingAssignments ca WHERE ca.operatorId = o.id) AS coaching_assignments,
            (SELECT COUNT(*) FROM operatorActions oa WHERE oa.userId = o.id)         AS operator_actions
       FROM operators o
      WHERE o.closedAt >= DATE_SUB(CURDATE(), INTERVAL 4 MONTH)
        AND o.deactivationReason IS NOT NULL
      ORDER BY o.closedAt DESC LIMIT 25`, [], 45_000);

  await conn.end();

  out.push([]);
  out.push(['Verdict', 'Read the rows above. If operatorActions turns out to be system/audit logging and the coaching tables are near-empty, then op reports are NOT in this database — they live in Docs and Sheets, and the tracker has to read them from there instead.']);
  out.push(['Run at', nowET()]);

  await writeTab('07 Op Reports', out);
  await formatHeader('07 Op Reports').catch(() => {});
  await notify('📝 Op report probe finished — see tab "07 Op Reports".');
}

main().catch(async (err) => {
  console.error('OP REPORT PROBE FAILED:', err.message);
  try {
    await writeTab('07 Op Reports', [['Status', '❌ FAILED'], ['Error', err.message], ['Run at', nowET()]]);
  } catch (e) {
    console.error('could not write the failure:', e.message);
  }
  await notify(`❌ Op report probe failed: ${err.message}`);
  process.exit(1);
});
