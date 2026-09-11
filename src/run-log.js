// The Run Log — one line per run, on BOTH sheets.
//
// Vee, 2026-09-10: she turned the team sheet's old README tab into "Run Log" and asked
// for the run information — including which outbound IP was used — to land there AND
// on Build Notes. So:
//
//   Build Notes  ->  "Run Log" (or "12 Run Log" until she renames it). Every run,
//                    including local test runs from a laptop.
//   Team sheet   ->  "Run Log". Real Railway runs only. A laptop test showing up on
//                    the team sheet is how a false "missing DB_USER" error once made
//                    it look like the Railway variables had vanished.
//
// HER LAYOUT WINS. Rows are matched to her columns by header NAME, so she can reorder
// columns or rename "When (Eastern)" to "When" and old rows still land in the right
// place. Columns she has not got yet are added on the right. A tab that already
// exists is never restyled — she has styled these by hand.
//
// ONE WEEK. Vee: "I only want it for the last week... and then a new week starts."
// Anything older than seven days drops off.

import { sheets, writeTab, readTab, formatHeader, TRACKER_SHEET_ID, BUILD_SHEET_ID } from './sheets.js';
import { outboundIp } from './db.js';
import { nowET } from './time.js';

export const RUN_LOG_HEADER = ['When', 'Where', 'Status', 'Outbound IP', 'Detail', 'Deployment'];

/** "When (Eastern)" and "When" are the same column. */
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s*\(.*\)\s*$/, '');

/**
 * Take the rows already on a tab — in whatever column order SHE has — and rebuild
 * them in our order by header name. Without this, reading her rows and writing them
 * back would shuffle values into the wrong columns the moment she moved one.
 */
function reshape(existing) {
  const first = existing[0] ?? [];
  if (!first.some((c) => norm(c) === 'when')) return [];
  const idx = RUN_LOG_HEADER.map((h) => first.findIndex((c) => norm(c) === norm(h)));
  return existing
    .slice(1)
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((r) => idx.map((i) => (i === -1 ? '' : (r[i] ?? ''))));
}

/**
 * Add one line to the top of a run-log tab. Uses the first tab name that exists,
 * so renaming "12 Run Log" to "Run Log" needs no code change.
 */
export async function appendRunLog(spreadsheetId, tabCandidates, line) {
  const meta = await sheets().spreadsheets.get({ spreadsheetId });
  const names = meta.data.sheets.map((s) => s.properties.title);
  const tab = tabCandidates.find((c) => names.includes(c)) ?? tabCandidates[0];
  const existed = names.includes(tab);

  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const past = existed
    ? reshape(await readTab(tab, { spreadsheetId })).filter((r) => String(r[0]).slice(0, 10) >= cutoff)
    : [];

  await writeTab(tab, [RUN_LOG_HEADER, line, ...past], spreadsheetId, { keepColumnOrderFromRow: 0 });
  // Only a brand-new tab gets default styling. An existing one is hers.
  if (!existed) await formatHeader(tab, { spreadsheetId }).catch(() => {});
  return { tab, existed };
}

export async function logRun({ status, detail }) {
  const ip = await outboundIp();
  const onRailway = Object.keys(process.env).some((k) => k.startsWith('RAILWAY_'));
  const where = onRailway ? 'Railway' : 'local test';

  // Which deployment ran this. Railway keeps the same outbound IP for the life of a
  // deployment, so two runs with the same ID SHOULD share an IP — and two runs with
  // different IDs sharing one is the thing worth noticing. Blank if Railway does not
  // provide the variable.
  const deployment = (process.env.RAILWAY_DEPLOYMENT_ID || '').slice(0, 8);

  const line = [nowET(), where, status, ip || '(could not determine)', detail, deployment];

  const targets = [];
  if (BUILD_SHEET_ID) targets.push({ label: 'Build Notes', id: BUILD_SHEET_ID, tabs: ['Run Log', '12 Run Log'] });
  if (TRACKER_SHEET_ID && onRailway) targets.push({ label: 'team sheet', id: TRACKER_SHEET_ID, tabs: ['Run Log'] });

  for (const t of targets) {
    try {
      const { tab } = await appendRunLog(t.id, t.tabs, line);
      console.log(`[run log] ${status} -> ${t.label} "${tab}" (${where}, ${ip || 'unknown IP'}${deployment ? `, deployment ${deployment}` : ''})`);
    } catch (e) {
      console.error(`[run log] could not write to the ${t.label}:`, e.message);
    }
  }
}
