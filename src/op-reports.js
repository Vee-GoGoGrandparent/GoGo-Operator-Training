// Op reports — reading them, sorting them, and counting them.
//
// WHAT THESE ARE
// Every time a reviewer catches something on a call, they file a form that lands in
// Slack #op_report (G8HDD60Q6). Two flavours: "Op Report" (something went wrong) and
// "Op Observation" (a note, often neutral or positive). The form is always the same
// shape, which is the whole reason this file can exist:
//
//   What type of report is this?        Op Report | Op Observation
//   Service Department                  Transportation - On Demand, etc.
//   Reporter                            who caught it
//   Contractor Name                     the operator
//   Team Leader's Name                  who owns them
//   CallLog ID                          <- the join key back into the database
//   Please describe in detail...        what happened
//   How could the contractor...         what they should have done
//
// WHY THIS MATTERS MORE THAN THE QA TABLE
// `qualityAssurances` in the database flags 93.4% of calls positive (13,028 of
// 13,955). A detector that says yes to nearly everything cannot tell you where the
// gaps are. These reports are a human writing down a specific mistake AND the
// correction. That second half is the valuable part: it is a ready-made answer key.
//
// TWO RULES THIS FILE KEEPS
//
//   1. NO CUSTOMER PII. The Slack form carries customer name, phone number, and the
//      number they called from. None of those are read, stored, or written to a
//      sheet. Only: who filed it, who it was about, their lead, the CallLog ID, and
//      the two free-text fields.
//
//   2. NOTHING ABOUT PAYMENT AUDIO. The system mutes the segment where a card is
//      entered, so nobody hears payment details. This file never asserts anything
//      about what was said during payment, and no pattern here is built to.
//
// KNOWN LIMIT — the text is cut off
// The Slack reader truncates long attachment fields with "...". 124 of 281 reports
// arrive with one or both free-text fields incomplete. That is upstream of us, not a
// parsing bug — the "..." appears in the raw tool output. Theme counts survive it
// (the giveaway words come early) but the corrections do not read as full sentences.
// Fixing it properly needs a Slack bot token calling conversations.history directly.
// `isTruncated` marks each one so nobody quotes half a sentence as if it were whole.
//
// NOT YET USED, BUT THERE
// These messages also carry thread replies and emoji reactions (`one-and-done`,
// `jasper`, `positive-sun`). Those look like a tagging convention somebody already
// uses by hand. Nothing here reads them yet.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARCHIVE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'op-reports');

/** Every archived pull, merged and deduped by Slack message timestamp. */
export function loadArchive(dir = ARCHIVE_DIR) {
  if (!fs.existsSync(dir)) return [];
  const byTs = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const r of rows) byTs.set(r.ts, r);
  }
  return [...byTs.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Accents off, lower case, letters only — "Canaña" on a form and "Canana" are one person. */
const nameTokens = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z ]/g, ' ')
  .split(/\s+/).filter((t) => t.length > 1 && t !== 'jr' && t !== 'sr');

/**
 * Is this op report about this trainee?
 *
 * The form's "Contractor Name" is typed by a reviewer, so it is never exactly the
 * class workbook's spelling: "Rizza Abubacar" for "Rizza E. Abubacar", "Karl Ullmer
 * Polinar" for "Karl Polinar". First AND last name must both appear.
 *
 * Checked against the archive 2026-09-11: 47 trainees, 70 reports, and no report
 * matched two trainees. Last-name-only matches were all different people (Mark Jason
 * Villegas is not Faye Marie Villegas), which is why a surname alone is not enough.
 */
export function isReportAbout(traineeName, contractor) {
  const want = nameTokens(traineeName);
  if (!want.length) return false;
  const got = nameTokens(contractor);
  return got.includes(want[0]) && got.includes(want[want.length - 1]);
}

/**
 * THEMES — and why a report can sit in more than one.
 *
 * The first version of this forced every report into exactly one bucket, tested in
 * priority order. That was wrong, and provably so: 94 of 281 reports mention two or
 * more themes ("operator set the wrong drop-off AND the customer was charged a
 * cancellation fee"). Whichever keyword list ran first won the report, so reordering
 * the buckets changed the answer. Two runs produced two different rankings, which is
 * how the mistake was caught.
 *
 * So these are tallies, not an assignment. A report is counted under every theme it
 * touches. The totals add to more than the number of reports, and that is correct —
 * the question being answered is "how many reports involve X", not "what is this
 * report really about", which is a question the text often does not settle.
 *
 * Every pattern here was checked against the actual text before being trusted. Two
 * were rewritten for matching things they should not have; see the notes inline.
 */
export const THEMES = [
  {
    key: 'address',
    label: 'Address, drop-off or pin',
    match: /\bpin\b|\baddress|drop.?off|\bterminal\b|airport|wrong location|destination/i,
    parts: [
      ['The PIN', /\bpin\b/i],
      ['Drop-off', /drop.?off/i],
      ['Wrong or incorrect address', /(wrong|incorrect)\s+\w{0,15}\s*address|address\s+\w{0,10}\s*(wrong|incorrect)/i],
      ['Airport or terminal', /airport|\bterminal\b|\blax\b/i],
    ],
  },
  {
    key: 'fees',
    label: 'Fees, fares and refunds',
    match: /\bfee\b|\bfees\b|\bfare\b|surge|refund|overcharg|\bcharged\b/i,
    parts: [
      ['Cancellation fee', /cancell?ation fee/i],
      ['Refund', /refund/i],
      ['Fare', /\bfare\b/i],
      ['Surge pricing', /surge/i],
      ['Multi-stop wait fee', /wait(ing)? (time )?fee/i],
    ],
  },
  {
    key: 'membership',
    label: 'Membership or plan wording',
    // `\bplan\b` was checked by hand against every report that matched it without the
    // word "membership". All 8 are genuinely about plan pricing disclosure — none are
    // "the operator should plan to". Kept.
    match: /membership|subscription|\bplan\b|\btier\b|upsell/i,
    parts: [
      ['The 7-day trial', /7.?day (free )?trial|seven.?day/i],
      ['$29.99 or $35 named', /29\.99|\$\s?35\b/i],
      ['$245 annual named', /\b245/i],
    ],
  },
  {
    key: 'nl',
    label: 'Need Love tickets',
    match: /\bnl\b|need love|false trip|fare review|\bticket/i,
    parts: [
      ['Duplicate ticket', /duplicate/i],
      // "instead of" on its own matched every NL report and several address ones, so
      // it is anchored to a filing verb, and the address case is excluded by the
      // caller. Went from a meaningless 47 to a real 13.
      ['Wrong category chosen', /(tagged|categoriz|selected|filed|chose|submitted).{0,60}instead of|wrong (nl )?categor|incorrect (nl )?categor/i],
      ['False Trip named', /false trip/i],
    ],
  },
  {
    key: 'accessibility',
    label: 'Accessibility or mobility',
    match: /wheelchair|\bwav\b|walker|\bcane\b|oxygen|mobility|assistive/i,
    parts: [],
  },
];

/**
 * Cross-cutting: the reviewer says something was not said, or not checked.
 *
 * This cuts across every theme above and is arguably the most useful pattern in the
 * file, because it separates "the operator did the wrong thing" from "the operator
 * skipped a step" — and only the second one gets fixed by changing a script.
 */
export const NOT_DISCLOSED =
  /did ?n.t\s+\w{0,12}\s*(disclose|explain|mention|inform|advise|confirm|verify)|failed to\s+\w{0,12}\s*(disclose|explain|mention|inform|advise|confirm|verify)|without\s+\w{0,12}\s*(disclosing|explaining|informing|confirming|verifying|advising)|never\s+\w{0,12}\s*(disclosed|explained|mentioned|informed|advised|confirmed)|no\s+(disclosure|explanation)/i;

/** The searchable text of one report: what happened plus how it should have gone. */
export const textOf = (r) => `${r.what || ''} ${r.how || ''}`;

/** Every theme this report touches. Can be none, can be several. */
export function themesOf(report) {
  const t = textOf(report);
  return THEMES.filter((th) => th.match.test(t)).map((th) => th.label);
}

/** Was this report's text cut off by the Slack reader? */
export const isTruncated = (r) => /\.\.\.$/.test(String(r.what || '')) || /\.\.\.$/.test(String(r.how || ''));

/** ISO week, matching src/analysis.js so the two agree on what a week is. */
export function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const sortDesc = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

/** The address false positive the NL "wrong category" pattern would otherwise catch. */
const ADDRESS_NOT_NL = /instead of the correct location|wrong address/i;

/**
 * Everything the sheet needs, from a list of reports.
 *
 * Deliberately returns counts and lists, not judgements. Whether 12 reports against
 * one operator is a problem depends on whether their reviewer files 3 a month or 71,
 * and this file is not the place to decide that.
 */
export function summarize(reports) {
  const perOperator = new Map();
  const perLead = new Map();
  const perReporter = new Map();
  const perWeek = new Map();
  const perType = new Map();

  for (const r of reports) {
    if (r.contractor) bump(perOperator, r.contractor);
    if (r.lead) bump(perLead, r.lead);
    if (r.reporter) bump(perReporter, r.reporter);
    if (r.date) bump(perWeek, isoWeek(r.date));
    bump(perType, r.type || 'Unknown');
  }

  const themes = THEMES.map((th) => {
    const hits = reports.filter((r) => th.match.test(textOf(r)));
    return {
      key: th.key,
      label: th.label,
      n: hits.length,
      pct: reports.length ? hits.length / reports.length : 0,
      parts: th.parts
        .map(([label, re]) => ({
          label,
          n: hits.filter((r) => {
            const t = textOf(r);
            if (label === 'Wrong category chosen' && ADDRESS_NOT_NL.test(t)) return false;
            return re.test(t);
          }).length,
        }))
        .sort((a, b) => b.n - a.n),
      reports: hits,
    };
  }).sort((a, b) => b.n - a.n);

  const untouched = reports.filter((r) => !THEMES.some((th) => th.match.test(textOf(r))));
  const notDisclosed = reports.filter((r) => NOT_DISCLOSED.test(textOf(r)));
  const dates = reports.map((r) => r.date).filter(Boolean).sort();

  return {
    total: reports.length,
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
    distinctDays: new Set(dates).size,
    withCallLog: reports.filter((r) => /^\d+$/.test(String(r.callLogId || ''))).length,
    truncated: reports.filter(isTruncated).length,
    themes,
    untouched: untouched.length,
    notDisclosed: {
      n: notDisclosed.length,
      about: [
        ['A fee, charge, fare or price', /\bfee|\bcharge|\bfare\b|price|cost|\$/i],
        ['Trial, plan or membership terms', /trial|\bplan\b|membership/i],
        ['The address, pin or drop-off', /address|location|\bpin\b|drop.?off/i],
        ['Accessibility or mobility needs', /wheelchair|walker|mobility|\bwav\b|\bcane\b/i],
      ]
        .map(([label, re]) => ({ label, n: notDisclosed.filter((r) => re.test(textOf(r))).length }))
        .sort((a, b) => b.n - a.n),
    },
    byType: sortDesc(perType),
    byOperator: sortDesc(perOperator),
    byLead: sortDesc(perLead),
    byReporter: sortDesc(perReporter),
    byWeek: [...perWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  };
}
