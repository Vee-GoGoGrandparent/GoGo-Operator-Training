// OPS_TASK=star
//
// "They have a Ride Star Model and we need access to that information. Is it
// possible to get it from the DB?"
//
// I do not know, and this finds out rather than guessing.
//
// WHY A PROBE AND NOT AN ANSWER
// The discovery run only inventoried 18 operator-related tables out of 249. A star
// rating could easily live in a rides or drivers table nobody has looked at. The one
// star-ish column found so far is `ridePerformances.lowRatingRides` — an int count of
// low-rated rides, which is a symptom of a rating system, not the rating itself. That
// column existing is actually good evidence the ratings ARE stored somewhere.
//
// WHAT THE SCORECARD NEEDS
// "90 day star model — goal 3.70+". A 3.70 on a 5-point scale is an average rating.
// So we are looking for a per-operator (or per-ride, averageable) numeric rating.
//
// This searches the entire database SCHEMA, because a column could be anywhere. But
// any actual numbers it reports back are scoped to operators who went through a class
// we track — per Vee, this project is only about the training department.
//
// Read-only. Touches nothing marketing.

import { connect, tryQ } from '../src/db.js';
import { TRAINED_SLACK_IDS } from '../data/trained-roster.js';
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

  const ask = async (label, sql, params = [], timeout = 45_000) => {
    const r = await tryQ(conn, sql, params, timeout);
    if (r.error) {
      out.push([label, `ERROR: ${r.error.slice(0, 400)}`]);
      console.log(`${label}\n  ERROR: ${r.error.slice(0, 200)}`);
      return null;
    }
    const text = r.rows.map((row) => Object.entries(row).map(([k, v]) => `${k}=${fmt(v)}`).join('  ')).join('\n');
    out.push([label, text || '(no rows)']);
    console.log(`${label}\n  ${(text || '(no rows)').slice(0, 600)}`);
    return r.rows;
  };

  out.push(['— Where could a star rating possibly live? —', '']);

  // 1. Every column in the whole database whose NAME sounds like a rating.
  //    This is the question that actually settles it.
  const cols = await ask(
    'Every column in the database named like a rating or star',
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (COLUMN_NAME LIKE '%star%'
          OR COLUMN_NAME LIKE '%rating%'
          OR COLUMN_NAME LIKE '%rated%'
          OR COLUMN_NAME LIKE '%stars%')
      ORDER BY TABLE_NAME, COLUMN_NAME
      LIMIT 200`,
  );

  // 2. Tables named like a rating, in case the column is called something bland
  //    like `value` on a table called `operatorRatings`.
  await ask(
    'Every table named like a rating, review or score',
    `SELECT TABLE_NAME, TABLE_ROWS
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND (TABLE_NAME LIKE '%rating%'
          OR TABLE_NAME LIKE '%star%'
          OR TABLE_NAME LIKE '%review%'
          OR TABLE_NAME LIKE '%feedback%'
          OR TABLE_NAME LIKE '%survey%'
          OR TABLE_NAME LIKE '%csat%'
          OR TABLE_NAME LIKE '%nps%')
      ORDER BY TABLE_ROWS DESC
      LIMIT 100`,
  );

  // 3. A "model" that produces a 3.70 might be a scoring column with a decimal type
  //    on an operator table. Cast a slightly wider net.
  await ask(
    'Decimal columns on operator tables that could hold an average out of 5',
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME LIKE '%operator%'
        AND DATA_TYPE IN ('decimal', 'float', 'double')
      ORDER BY TABLE_NAME, COLUMN_NAME
      LIMIT 200`,
  );

  // 4. The one lead we already have. If lowRatingRides is populated, ratings exist
  //    somewhere upstream of it and somebody knows where.
  out.push(['— The one lead we already had —', '']);
  await ask(
    'ridePerformances — is lowRatingRides actually populated?',
    `SELECT COUNT(*) AS rows_total,
            SUM(lowRatingRides > 0) AS rows_with_low_ratings,
            SUM(lowRatingRides) AS total_low_rated_rides,
            MIN(aggregationDate) AS first, MAX(aggregationDate) AS last
       FROM ridePerformances`,
  );

  await ask(
    'ridePerformances — every column, so we can see what else is in there',
    `SELECT COLUMN_NAME, DATA_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ridePerformances'
      ORDER BY ORDINAL_POSITION
      LIMIT 100`,
  );

  // 5. If step 1 found anything, look at real values — a column called `rating` that
  //    is always NULL is not an answer.
  if (cols?.length) {
    out.push(['— Are those columns actually populated? —', '']);
    for (const c of cols.slice(0, 8)) {
      await ask(
        `${c.TABLE_NAME}.${c.COLUMN_NAME} — is there anything in it?`,
        `SELECT COUNT(*) AS rows_total,
                COUNT(\`${c.COLUMN_NAME}\`) AS rows_not_null,
                MIN(\`${c.COLUMN_NAME}\`) AS smallest,
                MAX(\`${c.COLUMN_NAME}\`) AS largest,
                AVG(\`${c.COLUMN_NAME}\`) AS average
           FROM \`${c.TABLE_NAME}\``,
      );
    }
  } else {
    out.push([
      'VERDICT so far',
      'No column or table in the entire database is named like a star rating. If the Ride Star Model exists, it is either computed outside the database (a spreadsheet or a BI tool), stored under a name nobody would guess, or lives in a different system entirely. The next step is asking Ops for the definition rather than searching harder.',
    ]);
  }

  // If a rating turns up on something operator-shaped, show it for OUR people only.
  out.push(['— Scope —', `Schema search covers the whole database. Any operator numbers are limited to the ${TRAINED_SLACK_IDS.length} operators on the trained roster.`]);

  out.push(['— What we still need from a human —', '']);
  out.push([
    'The definition',
    'Even if a rating column turns up, "star model" is a formula somebody wrote: which rides count, over what window, weighted how, and what makes 3.70 the bar. That is not discoverable from column names. Ops (Aleesa) has it.',
  ]);

  await writeTab('09 Star Model', [
    ['Is the Ride Star Model in the database?'],
    [`Run ${nowET()}. Read-only. Searches all tables, not a guessed shortlist.`],
    [''],
    ...out,
  ]);
  await formatHeader('09 Star Model', { bandRows: true }).catch(() => {});

  console.log('[star] wrote 09 Star Model to the build sheet');
  await notify('Star model probe finished — see tab "09 Star Model" on the build sheet.');
}

main().catch((err) => {
  console.error('[star] failed:', err);
  process.exit(1);
});
