// OPS_TASK=opreports
//
// Op reports, split across the two sheets the way Vee wants them:
//
//   TEAM SHEET  ->  one tab, "Op Reports". What operators are actually getting
//                   written up for, laid out for a trainer. Nothing else.
//
//   BUILD SHEET ->  the working detail. Who filed what, when, and every single
//                   report. Useful for digging; not something a trainer needs.
//
// Vee: "any time we're gathering information, that's the sheet that needs to be
// updated... we need to provide information that's useful for the training team."
//
// So the split is by AUDIENCE, not by size. A trainer opening the team sheet should
// see what to teach differently. Anyone asking "says who?" goes to the build sheet.
//
// WHY THESE REPORTS MATTER MORE THAN THE QA TABLE
// `qualityAssurances` flags 93.4% of calls positive — a detector that says yes to
// nearly everything cannot tell you where the gaps are. These are a human writing
// down a specific mistake AND the correction.
//
// NO CUSTOMER PII. The Slack form carries customer name and phone number. The
// archive does not contain those fields and nothing here writes them.
// NOTHING ABOUT PAYMENT AUDIO — the system mutes it; silence there is never a finding.
//
// Needs no database, so it runs even while the replica is unreachable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeTab, formatHeader, formatScorecard, deleteTabs,
  TRACKER_SHEET_ID, BUILD_SHEET_ID,
} from '../src/sheets.js';
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

/**
 * Is this theme covered by the training material?
 *
 * CORRECTED 2026-09-10 after reading the full Canva library. An earlier version of
 * this said Need Love had no module, and that surge and cancellation fees were not
 * taught. All three were wrong — they were based on four decks when there are around
 * twenty. Every single theme below turns out to be covered, most of them thoroughly.
 *
 * That flips the conclusion. These are not content gaps. They are execution gaps —
 * which is exactly what GoGo's own Registration Call Coaching Breakdown already said:
 * "bottom performers are not struggling from a lack of product knowledge... the gap
 * is in execution."
 *
 * A content gap is fixed by writing a slide. An execution gap is fixed by practice,
 * and the two need completely different responses. Getting this backwards would have
 * sent Oscar off to write material that already exists.
 */
const COVERAGE = {
  address: 'Taught twice over. "Registration Structure" says confirm addresses back; "Mistakes We See Most Often" makes failing to confirm ride details its own lesson. Pin adjustment has a deck of its own and "adjust the pin properly" is in Targets and Metrics.',
  fees: 'Taught. The Need Love deck covers cancellation fees, the 2-minute vendor window, fare reviews, surge, and the $20 lost item fee. It states outright that informing customers of surge before ordering is a requirement.',
  membership: 'Taught heavily. Plan pricing with the dollar savings, plus a low-performer versus top-performer comparison built from real call transcripts.',
  nl: 'Taught in a 54-page deck: every ticket type, how to file two ways, the 30-day dispute window, duplicate prevention, scenarios and a knowledge check.',
  accessibility: 'Taught — mobility and accessibility questions are covered in the registration material.',
};

async function main() {
  if (!TRACKER_SHEET_ID) throw new Error('Missing OPS_TRACKER_SHEET_ID — nothing to write to.');
  if (!BUILD_SHEET_ID) throw new Error('Missing OPS_BUILD_SHEET_ID — the working detail has nowhere to go.');

  const reports = loadArchive();
  if (!reports.length) throw new Error(`No archived reports found in ${ARCHIVE_DIR}`);
  const s = summarize(reports);
  const asOf = nowET();
  console.log(`[opreports] ${s.total} reports, ${s.firstDate} to ${s.lastDate}`);

  // ======================================================= TEAM SHEET: "Op Reports"
  //
  // Row kinds are collected as the tab is built so the colours can go on afterwards —
  // the same indigo / cornflower / lavender Vee chose for the Scorecard, so the two
  // tabs read as part of one sheet rather than two different documents.
  const W = 4;
  const out = [];
  const bannerRows = [];
  const headerRows = [];
  const push = (cells) => out.push([...cells, ...Array(Math.max(0, W - cells.length)).fill('')]);
  const banner = (t) => { bannerRows.push(out.length); push([t]); };
  const header = (...cells) => { headerRows.push(out.length); push(cells); };

  push(['What operators are getting written up for']);
  push([`${s.total} reports from #op_report, ${s.firstDate} to ${s.lastDate}. Last updated ${asOf}.`]);
  push(['']);

  banner('WHAT THE REPORTS ARE ABOUT');
  header('Theme', 'Reports', 'Share', 'Where the training already covers it');
  for (const t of s.themes) push([t.label, t.n, pct(t.pct), COVERAGE[t.key] || '']);
  push(['Matched none of these', s.untouched, pct(s.untouched / s.total),
        'Worth reading by hand — probably a fifth theme']);
  push(['']);
  push(['A report is counted under EVERY theme it mentions, so these add to more than the total. 94 reports are about two things at once.']);
  push(['']);

  banner('WHAT EXACTLY WENT WRONG INSIDE EACH ONE');
  header('Theme', 'The specific mistake', 'Reports', '');
  for (const t of s.themes) {
    const parts = t.parts.filter((p) => p.n > 0);
    parts.forEach((p, i) => push([i === 0 ? t.label : '', p.label, p.n, '']));
  }
  push(['']);

  banner('A STEP WAS SKIPPED, NOT FUMBLED');
  push([`${s.notDisclosed.n} reports say something was never said or never checked. That is different from doing it wrong — only this kind gets fixed by changing a script.`]);
  header('What went unsaid', 'Reports', '', '');
  for (const a of s.notDisclosed.about) push([a.label, a.n, '', '']);
  push(['']);

  banner('BEFORE YOU USE THESE NUMBERS');
  push(['Volume reflects who is watching as well as who is erring. One reviewer filed a quarter of this month on their own.']);
  push([`${s.truncated} of ${s.total} reports have their text cut off by Slack, so some corrections read as half sentences.`]);
  push(['Every theme here IS covered by the training material — checked against the full Canva library, about twenty decks, on 2026-09-10. So these are execution gaps, not content gaps. They are fixed by practice, not by writing new slides.']);
  push(['No customer names or phone numbers are stored or shown anywhere.']);
  push(['The working detail — who filed what, and every individual report — is on the Build Notes sheet, not here.']);

  await writeTab('Op Reports', out, TRACKER_SHEET_ID);
  await formatScorecard('Op Reports', {
    classRows: bannerRows, headerRows, spreadsheetId: TRACKER_SHEET_ID,
  }).catch((e) => console.error('[opreports] colours:', e.message));

  // The three numbered tabs this replaces. Vee: the team sheet carries the themes
  // only, and it should not be called "10 Op Reports — Themes".
  const removed = await deleteTabs(
    ['10 Op Reports — Themes', '11 Op Reports — Who & When', '12 Op Reports — Every Report'],
    { spreadsheetId: TRACKER_SHEET_ID },
  ).catch((e) => { console.error('[opreports] could not remove old tabs:', e.message); return []; });
  if (removed.length) console.log(`[opreports] removed from the team sheet: ${removed.join(', ')}`);

  // ========================================================= BUILD SHEET: the detail
  // Header row FIRST, notes underneath — the shape Vee rearranged these into by hand.
  // It is the better shape: row 1 headers means the freeze and the column matching
  // both land where they should.
  //
  // Section headers get indigo, white, bold and CENTRED, which is exactly what she
  // applied to rows 1, 8, 15 and 19 by hand. Read back off the sheet, not guessed.
  const who = [];
  const whoIndigo = [];
  const wPush = (cells) => who.push(cells);
  const wSection = (...cells) => { whoIndigo.push(who.length); who.push(cells); };

  wSection('What', 'Count', 'Note');
  wPush([`${s.total} reports, ${s.firstDate} to ${s.lastDate}. Last updated ${asOf}.`]);
  wPush(['Working detail. The team-facing summary is the "Op Reports" tab on the tracker sheet.']);
  wPush(['']);
  wPush([`${s.byOperator.length} different operators appear across ${s.total} reports. The most-reported has ${s.byOperator[0]?.[1] ?? 0}.`]);
  wPush(['That spread matters: this is not a handful of people, so it is unlikely to be fixed by coaching a handful of people.']);
  wPush(['']);

  wSection('By week', 'Reports');
  for (const [w, n] of s.byWeek) wPush([w, n]);
  wPush(['']);

  wSection('By report type', 'Count');
  for (const [t, n] of s.byType) wPush([t, n]);
  wPush(['']);

  wSection('Who filed them', 'Count', 'Reviewers differ enormously in how much they file. Read operator counts against this.');
  for (const [r, n] of s.byReporter) wPush([r, n]);
  wPush(['']);

  wSection('Team lead named on the report', 'Count');
  for (const [l, n] of s.byLead) wPush([l, n]);
  wPush(['']);

  // EVERY operator, no cut-off.
  //
  // This list used to stop at two or more, with a note calling a single report
  // "noise". Both were wrong. Vee asked whether the hidden ones were still being
  // counted — they were, in every total — but the cut-off was hiding 123 of 189
  // operators, roughly two thirds of the list, on the sheet whose entire purpose is
  // completeness. And a single op report is not noise to the person who got it.
  //
  // The totals were never affected: 123 one-report operators plus 158 reports across
  // the other 66 is 281, which matches the headline, the report types, the weekly
  // counts and the row count on the Every Report tab. Checked, not assumed.
  const onceOnly = s.byOperator.filter(([, n]) => n === 1).length;
  wSection('Operator named on the report', 'Count', 'Everyone, including the one-report operators. Nothing here is filtered out of any total.');
  for (const [o, n] of s.byOperator) wPush([o, n]);
  wPush(['']);
  wPush([`${s.byOperator.length} operators in total. ${onceOnly} of them appear exactly once; those ${onceOnly} reports are still counted everywhere else on this tab and on the tracker.`]);

  await writeTab('10 Op Reports — Who & When', who, BUILD_SHEET_ID, { keepColumnOrderFromRow: 0 });
  await formatHeader('10 Op Reports — Who & When', { bandRows: true, spreadsheetId: BUILD_SHEET_ID }).catch(() => {});
  await formatScorecard('10 Op Reports — Who & When', {
    indigoRows: whoIndigo, spreadsheetId: BUILD_SHEET_ID,
  }).catch((e) => console.error('[opreports] section headers:', e.message));

  await writeTab('11 Op Reports — Every Report', [
    ['Date', 'Type', 'Department', 'Operator', 'Team Lead', 'Reporter', 'CallLog ID', 'Themes', 'Step skipped?', 'Text cut off?', 'What happened', 'How it should have gone'],
    ['The last column is a reviewer writing down the correct handling. Those are ready-made practice questions — the mistake and its answer, both real.'],
    [`Last updated ${asOf}.`],
    [''],
    ...reports.map((r) => [
      r.date || '', r.type || '', r.dept || '', r.contractor || '', r.lead || '', r.reporter || '',
      r.callLogId || '',
      themesOf(r).join(' + '),
      NOT_DISCLOSED.test(textOf(r)) ? 'yes' : '',
      isTruncated(r) ? 'yes' : '',
      r.what || '', r.how || '',
    ]),
  ], BUILD_SHEET_ID, { keepColumnOrderFromRow: 0 });
  await formatHeader('11 Op Reports — Every Report', { bandRows: true, spreadsheetId: BUILD_SHEET_ID }).catch(() => {});

  console.log('[opreports] team sheet: 1 tab. build sheet: 2 tabs.');
  await notify(`Op reports updated — ${s.total} reports, ${s.firstDate} to ${s.lastDate}.`);
}

main().catch((err) => {
  console.error('[opreports] failed:', err);
  process.exit(1);
});
