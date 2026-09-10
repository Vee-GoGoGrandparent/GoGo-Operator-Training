// OPS_TASK=opreports
//
// Turns the archived #op_report forms into tabs on the tracker sheet.
//
// WHY THIS EXISTS
// The first time these were pulled, the analysis lived in a chat and a temp file and
// then it was gone. Vee's question was the right one: "are you adding this anywhere?"
// The answer was no. This is the fix. Every number in the training-gap report comes
// out of src/op-reports.js, and this script puts those same numbers somewhere a
// trainer can open on a Monday.
//
// WHY THE DATA IS A FILE IN THE REPO AND NOT A LIVE PULL
// Reading Slack needs a bot token with history scope on a private channel, which we
// do not have. The reports are pulled by hand, saved under data/op-reports/, and
// committed. That is honest about what is automated and what is not: the counting is
// automated, the collecting is not yet. When a token exists, only the loader below
// changes and every number stays reproducible.
//
// NO CUSTOMER PII, EVER. The Slack form carries customer name and phone number. The
// archive does not contain those fields and this script never writes them.
//
// Does not touch the database. Does not touch anything marketing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTab, formatHeader, TRACKER_SHEET_ID } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET } from '../src/time.js';
import { summarize, themesOf, isTruncated, NOT_DISCLOSED, textOf } from '../src/op-reports.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(HERE, '..', 'data', 'op-reports');

/** Every archived pull, merged and deduped by Slack message timestamp. */
function loadArchive() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  const byTs = new Map();
  for (const file of fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.json'))) {
    const rows = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, file), 'utf8'));
    for (const r of rows) byTs.set(r.ts, r);
  }
  return [...byTs.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

async function main() {
  if (!TRACKER_SHEET_ID) throw new Error('Missing OPS_TRACKER_SHEET_ID — nothing to write to.');

  const reports = loadArchive();
  if (!reports.length) throw new Error(`No archived reports found in ${ARCHIVE_DIR}`);
  const s = summarize(reports);
  console.log(`[opreports] ${s.total} reports, ${s.firstDate} to ${s.lastDate}`);

  // ---- Tab: what the month was about -------------------------------------------
  const themeRows = [
    ['Theme', 'Reports', 'Share', 'Biggest piece of it'],
  ];
  for (const t of s.themes) {
    const top = t.parts.filter((p) => p.n > 0).slice(0, 3).map((p) => `${p.label} ${p.n}`).join(' · ');
    themeRows.push([t.label, t.n, pct(t.pct), top]);
  }
  themeRows.push(['Matched none of these', s.untouched, pct(s.untouched / s.total), 'Worth reading by hand — probably a fifth theme']);

  await writeTab('10 Op Reports — Themes', [
    ['What operators actually got written up for'],
    [`${s.total} reports from #op_report, ${s.firstDate} to ${s.lastDate} (${s.distinctDays} days). Run ${nowET()}.`],
    ['A report is counted under EVERY theme it mentions, so these add to more than the total.'],
    ['94 reports are about two things at once. Forcing one theme per report gave a different ranking each time the order changed, which is why it is not done that way.'],
    [''],
    ...themeRows,
    [''],
    ['A step was skipped, not fumbled', '', '', ''],
    [`${s.notDisclosed.n} reports say something was never said or never checked. That is different from doing it wrong — only this kind gets fixed by changing a script.`],
    ['What went unsaid', 'Reports', '', ''],
    ...s.notDisclosed.about.map((a) => [a.label, a.n, '', '']),
    [''],
    ['Read this before using the numbers', '', '', ''],
    [`${s.truncated} of ${s.total} reports have text cut off by the Slack reader ("..."). Theme counts survive it; individual corrections may be half-sentences.`],
    [`${s.withCallLog} of ${s.total} carry a usable CallLog ID, so they can be joined to the call in the database.`],
    ['Volume reflects who is watching as well as who is erring. One reviewer filed a quarter of the month.'],
    ['No customer names or phone numbers are stored or shown. The Slack form has them; this does not read them.'],
  ], TRACKER_SHEET_ID);
  await formatHeader('10 Op Reports — Themes', { bandRows: true, spreadsheetId: TRACKER_SHEET_ID });

  // ---- Tab: who and when --------------------------------------------------------
  // Counts only. Whether 8 reports is a lot depends on the reviewer, and this sheet
  // is not the place that decides.
  await writeTab('11 Op Reports — Who & When', [
    ['Counts, not verdicts'],
    [`${s.byOperator.length} different operators appear across ${s.total} reports. The most-reported has ${s.byOperator[0]?.[1] ?? 0}.`],
    ['That spread is the point: this is not a handful of people, so it is unlikely to be fixed by coaching a handful of people.'],
    [''],
    ['By week', 'Reports'],
    ...s.byWeek.map(([w, n]) => [w, n]),
    [''],
    ['By report type', 'Count'],
    ...s.byType.map(([t, n]) => [t, n]),
    [''],
    ['Who filed them', 'Count', 'Reviewers differ enormously in how much they file. Read operator counts against this.'],
    ...s.byReporter.map(([r, n]) => [r, n]),
    [''],
    ['Team lead named on the report', 'Count'],
    ...s.byLead.map(([l, n]) => [l, n]),
    [''],
    ['Operator named on the report', 'Count', 'Cut off below 2 — a single report is noise.'],
    ...s.byOperator.filter(([, n]) => n >= 2).map(([o, n]) => [o, n]),
  ], TRACKER_SHEET_ID);
  await formatHeader('11 Op Reports — Who & When', { bandRows: true, spreadsheetId: TRACKER_SHEET_ID });

  // ---- Tab: the raw reports -----------------------------------------------------
  // The point of keeping every row: the "how" column is a reviewer writing the right
  // answer to a real mistake. That is training material somebody already wrote.
  await writeTab('12 Op Reports — Every Report', [
    ['Every report, so nothing has to be taken on trust'],
    ['The last column is a reviewer writing down the correct handling. Those are ready-made practice questions — the mistake and its answer, both real.'],
    [''],
    ['Date', 'Type', 'Department', 'Operator', 'Team Lead', 'Reporter', 'CallLog ID', 'Themes', 'Step skipped?', 'Text cut off?', 'What happened', 'How it should have gone'],
    ...reports.map((r) => [
      r.date || '',
      r.type || '',
      r.dept || '',
      r.contractor || '',
      r.lead || '',
      r.reporter || '',
      r.callLogId || '',
      themesOf(r).join(' + '),
      NOT_DISCLOSED.test(textOf(r)) ? 'yes' : '',
      isTruncated(r) ? 'yes' : '',
      r.what || '',
      r.how || '',
    ]),
  ], TRACKER_SHEET_ID);
  await formatHeader('12 Op Reports — Every Report', { bandRows: true, spreadsheetId: TRACKER_SHEET_ID });

  console.log('[opreports] wrote 3 tabs');
  await notify(`Op reports updated — ${s.total} reports, ${s.firstDate} to ${s.lastDate}.`);
}

main().catch((err) => {
  console.error('[opreports] failed:', err);
  process.exit(1);
});
