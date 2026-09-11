// Google Sheets client for the Operator Training tracker.
//
// THE WRITE GUARD IS THE POINT OF THIS FILE.
//
// This project shares a service account with the marketing projects, and that
// account has Editor on the marketing sheets. So "don't write to a marketing
// sheet" cannot rest on remembering. Every write goes through here, and any
// spreadsheet id that is not one of our two throws before the request is made.

import fs from 'node:fs';
import { google } from 'googleapis';

const DEFAULT_SA = 'C:/Users/K_jah/Documents/AI/GoGo-Reviews/google-service-account.json';

// Two sheets, two audiences, and they must never bleed into each other:
//
//   BUILD   — discovery output, column maps, probe results, working notes.
//             Vee and Claude only. Nobody on the training team wants this.
//   TRACKER — the clean, branded thing the trainer and the team leads open.
//
// OPS_SHEET_ID is the old single-sheet name, kept as a fallback so an older
// Railway config keeps working instead of failing at 3am over a rename.
/**
 * WHICH SHEET GETS WHAT — the standing rule, decided 2026-09-10.
 *
 * Vee: "any time we're gathering information, that's the sheet that needs to be
 * updated... we need to provide information that's useful for the training team."
 *
 *   TRACKER_SHEET_ID   the team sheet. Things a trainer or team lead ACTS on.
 *                      If nobody would change what they do because of it, it does
 *                      not belong here.
 *
 *   BUILD_SHEET_ID     Build Notes (internal). Everything we gather while working
 *                      out whether something is even possible: probes, schema dumps,
 *                      access checks, raw rows, and any table that exists to answer
 *                      "says who?".
 *
 * The test is AUDIENCE, not size or importance. A 281-row table of every op report is
 * important and still belongs on the build sheet, because a trainer opening the team
 * sheet needs to know what to teach differently, not to scroll.
 *
 * Default for writeTab is the BUILD sheet on purpose: writing to the team sheet has to
 * be a deliberate choice, never something that happens because a default drifted.
 */
export const BUILD_SHEET_ID = process.env.OPS_BUILD_SHEET_ID || process.env.OPS_SHEET_ID || '';
export const TRACKER_SHEET_ID = process.env.OPS_TRACKER_SHEET_ID || '';

/** Back-compat for code written before the split. Points at the build sheet. */
export const OPS_SHEET_ID = BUILD_SHEET_ID;

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw && raw.startsWith('{')) return JSON.parse(raw);
  return JSON.parse(fs.readFileSync(raw || DEFAULT_SA, 'utf8'));
}

/**
 * The only two spreadsheets this project may touch. Anything else is a bug, and
 * the most likely "anything else" is a marketing sheet — which the shared service
 * account genuinely has Editor on. So this throws rather than trusting anyone to
 * remember.
 */
function assertOurSheet(id) {
  if (!BUILD_SHEET_ID) {
    throw new Error('Missing OPS_BUILD_SHEET_ID. Set it in Railway before running anything.');
  }
  const allowed = [BUILD_SHEET_ID, TRACKER_SHEET_ID].filter(Boolean);
  if (!allowed.includes(id)) {
    throw new Error(
      `BLOCKED: refused to touch spreadsheet ${id}.\n` +
        `This project may only write to:\n` +
        `  OPS_BUILD_SHEET_ID   = ${BUILD_SHEET_ID}\n` +
        `  OPS_TRACKER_SHEET_ID = ${TRACKER_SHEET_ID || '(not set)'}\n` +
        `If that id belongs to a marketing sheet, this guard just did its job.`,
    );
  }
}

let _raw;
function rawClient() {
  if (_raw) return _raw;
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _raw = google.sheets({ version: 'v4', auth });
  return _raw;
}

/**
 * GOOGLE'S PER-MINUTE LIMIT.
 *
 * Sheets allows a fixed number of reads per minute for this account, and a full
 * tracker run uses a good share of it. On 2026-09-11 a check run straight after a
 * tracker run was refused with 429 "Read requests per minute". The client library
 * retries a 429 three times within a few seconds, which is too soon to help — the
 * allowance only refills when the minute is up.
 *
 * So on a 429 this waits a full minute and tries once more, at most three times.
 * That is Google's documented remedy for this limit, and it is a different thing from
 * knocking again on a service that has refused us: the refusal says "not this minute",
 * and we come back next minute.
 */
const QUOTA_WAIT_MS = 65_000;
async function withQuotaWait(fn, params, rest) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(params, ...rest);
    } catch (err) {
      const status = err?.code ?? err?.response?.status;
      if (Number(status) !== 429 || attempt > 3) throw err;
      console.log(`[sheets] Google's per-minute limit reached — waiting a minute (${attempt}/3)`);
      await new Promise((r) => setTimeout(r, QUOTA_WAIT_MS));
    }
  }
}

/**
 * A Sheets client whose every call is checked against OPS_SHEET_ID first.
 * Use this. Never reach for rawClient().
 */
export function sheets() {
  const api = rawClient();
  const check = (fn) => (params, ...rest) => {
    assertOurSheet(params?.spreadsheetId);
    return withQuotaWait(fn, params, rest);
  };
  return {
    spreadsheets: {
      get: check(api.spreadsheets.get.bind(api.spreadsheets)),
      batchUpdate: check(api.spreadsheets.batchUpdate.bind(api.spreadsheets)),
      values: {
        get: check(api.spreadsheets.values.get.bind(api.spreadsheets.values)),
        update: check(api.spreadsheets.values.update.bind(api.spreadsheets.values)),
        append: check(api.spreadsheets.values.append.bind(api.spreadsheets.values)),
        clear: check(api.spreadsheets.values.clear.bind(api.spreadsheets.values)),
      },
    },
  };
}

/**
 * Rewrite `rows` so its columns sit in whatever order the tab already uses.
 *
 * WHY THIS EXISTS
 * Vee rearranges these tabs by hand — she moved Priority left so it is visible
 * without scrolling. Every rebuild clears the values and writes them back, so
 * without this her column order would be silently undone on the next run, every
 * run. Rebuilding should refresh the numbers, not relitigate the layout.
 *
 * Matching is by header TEXT, so it survives columns moving around.
 *   - A column she has moved keeps its new position.
 *   - A column in our output that the tab does not have gets appended on the right,
 *     where it is obvious something new turned up.
 *
 * That second rule cuts both ways, and it is a deliberate choice. A column missing
 * from the tab is ambiguous: it might be one she deleted, or one we just started
 * producing. The two are indistinguishable from here. Appending means a column she
 * deleted comes back; dropping would mean data silently disappearing because of a
 * header typo. Coming back is the cheaper mistake — she deletes it again and tells
 * us, and we remove it at the source, which is exactly how Personality was handled.
 *
 * `headerRowIndex` is which row holds the headers — several tabs open with a title
 * and a note before the real header row.
 *
 * `freeOrder` names columns whose order comes from the DATA, not from a person: the
 * week columns on Weekly Trend. Their old positions are ignored, so they always come
 * out in date order after her columns. Without it, weeks that turned up later were
 * appended after newer ones and the trend read W32…W37, W28…W31.
 */
export function matchExistingOrder(existingHeader, rows, headerRowIndex, freeOrder = null) {
  if (!existingHeader?.length) return rows;
  const header = rows[headerRowIndex];
  if (!header?.length) return rows;

  // "When (Eastern)" and "When" are the same column — a renamed header should not
  // make a column look brand new and get shoved to the far right.
  const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s*\(.*\)\s*$/, '');
  const ours = header.map(norm);
  // Only reorder when the tab genuinely looks like the same table. Otherwise the
  // sheet has been rebuilt into something else and the old order means nothing.
  const overlap = existingHeader.map(norm).filter((h) => h && ours.includes(h));
  if (overlap.length < 2) return rows;

  const order = [];
  for (const raw of existingHeader) {
    if (freeOrder && freeOrder.test(String(raw ?? '').trim())) continue;
    const h = norm(raw);
    const i = ours.indexOf(h);
    if (h && i !== -1 && !order.includes(i)) order.push(i);
  }
  // Anything we produce that the tab has never had goes on the end.
  for (let i = 0; i < ours.length; i += 1) if (!order.includes(i)) order.push(i);
  if (order.length === ours.length && order.every((v, i) => v === i)) return rows;

  return rows.map((r, ri) => (ri < headerRowIndex ? r : order.map((i) => r[i] ?? '')));
}

/**
 * Create the tab if it is missing, then write `rows` into it.
 * Defaults to the BUILD sheet — writing to the team-facing tracker has to be
 * an explicit choice, never something that happens because a default drifted.
 *
 * @param {object} [opts]
 * @param {number} [opts.keepColumnOrderFromRow] header row index to match against the
 *   tab's existing column order. Omit to write columns exactly as given.
 * @param {RegExp} [opts.freeOrder] header pattern for data-driven columns; see
 *   matchExistingOrder. Those columns are also cleared when they stop being produced.
 * @param {boolean} [opts.readOld] also return the values that were on the tab before
 *   this write, so the caller can tell which old row was which kind of row.
 * @param {boolean} [opts.unmergeFirst] take merged cells apart BEFORE writing. Only for
 *   a caller that puts the right merges back afterwards (restyleRows). Google discards
 *   anything written into the hidden part of a merged cell — on 2026-09-11 that blanked
 *   the date and window on Scorecard rows that used to be merged note rows.
 * @returns {{ created, prevWidth, width, header, oldValues }}
 */
export async function writeTab(title, rows, spreadsheetId = BUILD_SHEET_ID, opts = {}) {
  const api = sheets();
  const meta = await api.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties),merges)',
  });
  let tab = meta.data.sheets.find((s) => s.properties.title === title);
  const created = !tab;
  const hri = typeof opts.keepColumnOrderFromRow === 'number' ? opts.keepColumnOrderFromRow : null;
  let prevWidth = 0;
  let existingHeader = null;
  let oldValues = [];

  if (created) {
    const res = await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
    tab = { properties: res.data.replies[0].addSheet.properties, merges: [] };
  } else {
    if (opts.readOld) oldValues = await readTab(title, { spreadsheetId });
    // Read the header BEFORE writing, so a hand-arranged column order can be kept.
    if (hri !== null) {
      if (opts.readOld) {
        existingHeader = oldValues[hri] ?? null;
      } else {
        const cur = await api.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A${hri + 1}:ZZ${hri + 1}`,
        }).catch(() => null);
        existingHeader = cur?.data?.values?.[0] ?? null;
      }
      prevWidth = existingHeader?.length ?? 0;
      rows = matchExistingOrder(existingHeader, rows, hri, opts.freeOrder);
    }
  }

  if (!rows.length) return { created, prevWidth, width: 0, header: [], oldValues };

  // Sheets rejects a jagged grid, so pad every row to the widest one. Cells are
  // capped at 50k characters — call summaries can exceed that.
  const width = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => {
    const padded = [...r, ...Array(width - r.length).fill('')];
    return padded.map((c) => (typeof c === 'string' && c.length > 49_000 ? `${c.slice(0, 49_000)}…` : c));
  });

  // Room for a new column or more rows, and merges out of the way, before any value
  // is written.
  const sheetId = tab.properties.sheetId;
  const gp = tab.properties.gridProperties ?? {};
  const prep = [];
  if ((gp.rowCount ?? 0) < grid.length) {
    prep.push({ appendDimension: { sheetId, dimension: 'ROWS', length: grid.length - (gp.rowCount ?? 0) } });
  }
  if ((gp.columnCount ?? 0) < width) {
    prep.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: width - (gp.columnCount ?? 0) } });
  }
  if (opts.unmergeFirst) {
    for (const m of tab.merges ?? []) {
      if ((m.startColumnIndex ?? 0) < width) prep.push({ unmergeCells: { range: m } });
    }
  }
  if (prep.length) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: prep } });
  const rowCount = Math.max(gp.rowCount ?? 0, grid.length);

  // UPDATE IN PLACE, then clear only what is genuinely left over.
  //
  // This used to clear A:ZZ first and rewrite everything. Vee: "make sure you're
  // updating the necessary information. You're not removing everything and then
  // reloading, which you tend to do that often."
  //
  // She is right, and the old way was destructive in a way that is easy to miss:
  // wiping A:ZZ removes every column, including ones she added to the right that this
  // code knows nothing about. Overwriting only the cells we actually produce leaves
  // her columns, her notes and her layout alone.
  //
  // Stale rows below the new data still have to go, or a shorter run would leave last
  // week's rows hanging underneath. But that clear is bounded to OUR columns and only
  // the rows past the end — never the whole sheet.
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: grid },
  });

  if (rowCount > grid.length) {
    await api.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${title}'!A${grid.length + 1}:${colLetter(width)}${rowCount}`,
    }).catch(() => {});
  }

  // A data-driven column that is no longer produced (a week that has dropped out of
  // the window) would otherwise sit on the right with frozen numbers. Only columns
  // whose header matches `freeOrder` are ever cleared this way — never one of hers.
  if (opts.freeOrder && existingHeader) {
    for (let c = width; c < existingHeader.length; c += 1) {
      if (!opts.freeOrder.test(String(existingHeader[c] ?? '').trim())) continue;
      const L = colLetter(c + 1);
      await api.spreadsheets.values.clear({ spreadsheetId, range: `'${title}'!${L}1:${L}${rowCount}` }).catch(() => {});
    }
  }

  // `merges` is what was merged when this call started — restyleRows copies from it,
  // because with unmergeFirst the tab itself no longer shows them.
  return { created, prevWidth, width, header: grid[hri ?? 0], oldValues, merges: tab.merges ?? [] };
}

/**
 * Swap a run of columns for a longer run, IN PLACE.
 *
 * Hard Regs had "Reg calls (4wk)", "Hard regs (4wk)", "Reg ratio (4wk)". Vee asked for
 * 30 / 60 / 90 day columns there instead (2026-09-11). Writing the new headers any other
 * way would put them on the far right and slide every column after the old three into a
 * different position — each one landing under the WIDTH Vee set for its neighbour.
 *
 * So real columns are inserted right after the old run, copying the look and width of
 * the column before them, and the headers are renamed. Everything to the right moves
 * over together with its width, colour rules and banding. Runs once: if any of the new
 * headers is already on the tab, it does nothing.
 *
 * @returns {Promise<boolean>} true if the tab was changed
 */
export async function widenColumns(title, { from, to, headerRowIndex = 0, spreadsheetId = BUILD_SHEET_ID } = {}) {
  const api = sheets();
  const header = (await readTab(title, { spreadsheetId, range: `A${headerRowIndex + 1}:ZZ${headerRowIndex + 1}` }))[0] ?? [];
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const have = header.map(norm);
  if (to.some((h) => have.includes(norm(h)))) return false;
  const start = have.findIndex((_, i) => from.every((f, k) => have[i + k] === norm(f)));
  if (start === -1) return false;

  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  const sheetId = meta.data.sheets.find((s) => s.properties.title === title)?.properties.sheetId;
  if (sheetId === undefined) return false;

  const extra = to.length - from.length;
  if (extra > 0) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          insertDimension: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: start + from.length, endIndex: start + from.length + extra },
            inheritFromBefore: true,
          },
        }],
      },
    });
  }
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!${colLetter(start + 1)}${headerRowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [to] },
  });
  return true;
}

/** 1 -> A, 26 -> Z, 27 -> AA. Used to bound a clear to the columns we wrote. */
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// GoGo brand palette. Every tab this project creates uses these and nothing else.
const rgb = (hex) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
});

export const BRAND = {
  indigo: rgb('#1A1A4C'), // headers
  cornflower: rgb('#454EBD'), // sub-headers / section bands
  yellow: rgb('#FFC000'), // the number that matters / needs attention
  indigoTint: rgb('#E8E9F2'), // banded rows
  lavender: rgb('#E6E6FA'),   // column-header rows inside a tab — Vee's pick
  white: rgb('#FFFFFF'),
  black: rgb('#000000'),

  // Priority colours. Vee picked the two text colours by hand in the sheet; the
  // backgrounds are the matching light tints from the same columns of the Google
  // Sheets palette, so they read as a set rather than two unrelated reds.
  badText: rgb('#990000'), //  Escalate and Watch — Vee's choice
  badFill: rgb('#FFF1F1'), //  her fill; deliberately paler than the palette tint
  goodText: rgb('#38761D'), // Strong — Vee's choice
  goodFill: rgb('#E9F4E5'), // her fill
};

/**
 * Indigo header, white bold text, frozen top row. For a BRAND-NEW tab only.
 * Cosmetic, but these tabs get read by a trainer who did not ask for a database.
 */
export async function formatHeader(title, { bandRows = false, spreadsheetId = BUILD_SHEET_ID } = {}) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab) return;
  const sheetId = tab.properties.sheetId;

  const requests = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, foregroundColor: BRAND.white, fontSize: 10 },
            backgroundColor: BRAND.indigo,
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ];

  // Column widths and wrapping are DELIBERATELY not touched.
  //
  // There used to be an autoResizeDimensions call here, and later a forced
  // wrapStrategy: 'CLIP'. Both had to go. Vee sets column widths and wraps her header
  // rows by hand, and the CLIP undid her wrap on every scheduled run (found
  // 2026-09-11). A rebuild refreshes the numbers; it does not get an opinion about the
  // layout.

  if (bandRows) {
    requests.push({
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: 0 },
          rowProperties: {
            headerColor: BRAND.indigo,
            firstBandColor: BRAND.white,
            secondBandColor: BRAND.indigoTint,
          },
        },
      },
    });
  }

  // Banding throws if one already exists; nothing else here is destructive, so a
  // second run should not fail over a cosmetic detail.
  try {
    await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  } catch (err) {
    if (!/banding/i.test(err.message)) throw err;
    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: requests.slice(0, -1) },
    });
  }
}

/** Cornflower band across a row — used to separate sections inside a tab. */
export async function bandRow(title, rowIndex, spreadsheetId = BUILD_SHEET_ID) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab) return;
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: tab.properties.sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, foregroundColor: BRAND.white },
                backgroundColor: BRAND.cornflower,
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
      ],
    },
  });
}

const clone = (f) => (f ? JSON.parse(JSON.stringify(f)) : null);

/**
 * Give every row the look of its KIND, copied from how Vee has styled that kind.
 *
 * THE PROBLEM THIS SOLVES (found 2026-09-11)
 * Cell formatting in Google Sheets belongs to a POSITION, not to the data in it. These
 * tabs re-sort and grow every run, so formatting that was right yesterday lands on the
 * wrong row today:
 *   - A class banner painted on row 37 stayed cornflower after row 37 became a person.
 *   - Reg ratio cells coloured red and green by hand ended up on other people —
 *     Arianne Comique at 7.1% was showing green.
 *   - Adding a "who left" list to the Scorecard would have pushed her merged rows onto
 *     rows holding numbers, hiding them.
 *
 * THE RULE
 * Each row is labelled with a kind (header, stamp, classBanner, active, gone, blank on
 * the per-person tabs; goal, classTitle, colHeader, figures, whoLeftRow, section, note
 * on the Scorecard). Before anything is restyled, the rows ALREADY on the tab are
 * sorted into the same kinds, and each kind's look — every cell's format and its
 * merges — is taken from the rows of that kind as she left them. Where rows of one
 * kind disagree, the most common look wins, so one drifted row cannot become the
 * pattern. Then every row is given its kind's look.
 *
 * So her styling always wins, including changes she makes tomorrow: restyle a header
 * row, and every header row of that kind follows on the next run. `defaults` is only
 * the first-time look for a kind the tab has never had, and `fallback` borrows a
 * similar kind's look (a "gone" row looks like an "active" row) before a default is used.
 *
 * Not touched: column widths, row heights, frozen rows/columns, banding, conditional
 * formatting, tab order.
 *
 * @param {object} o
 * @param {string[]} o.oldKinds  kind of each row that was on the tab before this run
 * @param {string[]} o.newKinds  kind of each row just written
 * @param {number}   o.width     columns written
 * @param {number|null} o.newColsFrom first column index the tab never had before; those
 *   columns copy the look of the column to their left
 * @param {object} [o.adjust]    kind -> function(format) for a rule Vee stated in words
 *   (the "Last updated" line is italic, never bold)
 */
export async function restyleRows(title, {
  spreadsheetId = BUILD_SHEET_ID, oldKinds = [], newKinds, width, newColsFrom = null,
  defaults = {}, fallback = {}, mergesByKind = {}, adjust = {}, oldMerges = null,
} = {}) {
  const api = sheets();
  const head = await api.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties),merges)',
  });
  const tab = head.data.sheets.find((s) => s.properties.title === title);
  if (!tab) return;
  const sheetId = tab.properties.sheetId;
  // The whole width she has formatted, not just the columns we write: her banners run
  // to column X on Hard Regs, and a banner's colour left behind in Q:X would still sit
  // on a person's row after a re-sort.
  const cols = Math.max(width, tab.properties.gridProperties?.columnCount ?? 0);
  const inCols = (m) => (m.startColumnIndex ?? 0) < cols;
  // `merges` = what is merged right now, to take apart. `before` = what was merged when
  // the run started, to copy from. They differ when writeTab already unmerged
  // (unmergeFirst), which it must do before writing values into merged cells.
  const merges = (tab.merges ?? []).filter(inCols);
  const before = (oldMerges ?? tab.merges ?? []).filter(inCols);
  const oldRows = oldKinds.length;

  let rowData = [];
  if (oldRows) {
    const g = await api.spreadsheets.get({
      spreadsheetId,
      ranges: [`'${title}'!A1:${colLetter(cols)}${oldRows}`],
      includeGridData: true,
      fields: 'sheets(data(rowData(values(userEnteredFormat))))',
    });
    rowData = g.data.sheets[0].data?.[0]?.rowData ?? [];
  }
  const formatsOf = (i) => Array.from({ length: cols }, (_, c) => rowData[i]?.values?.[c]?.userEnteredFormat ?? null);

  const templates = {};
  const pick = (kind) => {
    if (kind in templates) return templates[kind];
    const tally = new Map();
    oldKinds.forEach((k, i) => {
      if (k !== kind) return;
      const key = JSON.stringify(formatsOf(i));
      if (!tally.has(key)) tally.set(key, { i, n: 0 });
      tally.get(key).n += 1;
    });
    if (!tally.size) return (templates[kind] = null);
    const row = [...tally.values()].sort((a, b) => b.n - a.n || a.i - b.i)[0].i;
    return (templates[kind] = {
      cells: formatsOf(row),
      merges: before
        .filter((m) => m.startRowIndex === row && m.endRowIndex === row + 1)
        .map((m) => [m.startColumnIndex ?? 0, Math.min(m.endColumnIndex ?? cols, cols)]),
    });
  };

  const looks = {};
  const lookOf = (kind) => {
    if (looks[kind]) return looks[kind];
    const own = pick(kind);
    const borrowed = !own && fallback[kind] ? pick(fallback[kind]) : null;
    let cells;
    if (own) cells = own.cells.map(clone);
    else if (borrowed) cells = borrowed.cells.map(clone);
    else cells = Array.from({ length: cols }, () => clone(defaults[kind] ?? null));
    if (newColsFrom !== null && newColsFrom > 0) {
      for (let c = newColsFrom; c < width; c += 1) cells[c] = clone(cells[newColsFrom - 1]);
    }
    if (adjust[kind]) cells = cells.map((f) => adjust[kind](f ?? {}));
    // A kind's merges come from Vee's rows of that kind when there are any. A kind
    // this code introduced (the who-left list) uses its own.
    const ownMerges = own && own.merges.length ? own.merges : null;
    return (looks[kind] = { cells, merges: ownMerges ?? mergesByKind[kind] ?? [] });
  };

  const requests = [];
  // Every old merge comes apart first. The ones that belong are put back below, on the
  // rows that are that kind NOW — a merge left where it was would hide a row of numbers.
  for (const m of merges) requests.push({ unmergeCells: { range: m } });

  newKinds.forEach((kind, i) => {
    const look = lookOf(kind);
    requests.push({
      updateCells: {
        start: { sheetId, rowIndex: i, columnIndex: 0 },
        rows: [{ values: look.cells.map((f) => ({ userEnteredFormat: f ?? {} })) }],
        fields: 'userEnteredFormat',
      },
    });
    for (const [s, e] of look.merges) {
      requests.push({
        mergeCells: {
          mergeType: 'MERGE_ALL',
          range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: s, endColumnIndex: e },
        },
      });
    }
  });

  // Rows the tab no longer uses lose their old look too, or a banner colour would sit
  // on empty rows below the data.
  const lastOld = Math.max(oldRows, ...merges.map((m) => m.endRowIndex ?? 0));
  for (let i = newKinds.length; i < lastOld; i += 1) {
    requests.push({
      updateCells: {
        start: { sheetId, rowIndex: i, columnIndex: 0 },
        rows: [{ values: Array.from({ length: cols }, () => ({ userEnteredFormat: {} })) }],
        fields: 'userEnteredFormat',
      },
    });
  }

  if (requests.length) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/** A formula rule written by ruleColors — how it recognises its own rules later. */
const RATIO_RULE = /SUBSTITUTE\([A-Z]+\d+,"%",""\)/;
const PRIORITY_WORDS = ['Escalate', 'Watch', 'Strong'];

/**
 * Colour by RULE, never by paint — the colour follows the value when rows re-sort.
 *
 * 1. Priority words anywhere on the tab: Escalate and Watch in Vee's red, Strong in her
 *    green, with her pale fills.
 * 2. Every column whose header starts "Reg ratio": bold red under 15%, bold green at
 *    19% and above — the thresholds Vee set 2026-09-11, the same ones Priority uses, and
 *    the same bold-text-no-fill look she had painted by hand. The cells hold text like
 *    "13.8%", so the rule reads the number back out of the text.
 *
 * Only rules this function made are replaced. It used to delete EVERY conditional
 * format on the tab, which would have thrown away any rule Vee added herself.
 *
 * `header` is the header row as just written, when the caller has it — saves a read.
 */
export async function ruleColors(title, {
  spreadsheetId = BUILD_SHEET_ID, headerRowIndex = 0, ratioHeader = null, header = null, redBelow = 15, greenFrom = 19,
} = {}) {
  const api = sheets();
  const meta = await api.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties),conditionalFormats)',
  });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab) return;
  const sheetId = tab.properties.sheetId;
  const rowCount = tab.properties.gridProperties?.rowCount ?? 1000;

  const isOurs = (cf) => {
    const c = cf.booleanRule?.condition;
    const v = c?.values?.[0]?.userEnteredValue ?? '';
    if (c?.type === 'TEXT_EQ') return PRIORITY_WORDS.includes(v);
    if (c?.type === 'CUSTOM_FORMULA') return RATIO_RULE.test(v);
    return false;
  };
  const ours = [];
  (tab.conditionalFormats ?? []).forEach((cf, i) => { if (isOurs(cf)) ours.push(i); });
  const deletes = ours.reverse().map((index) => ({ deleteConditionalFormatRule: { sheetId, index } }));

  const add = (range, condition, format) => ({
    addConditionalFormatRule: { index: 0, rule: { ranges: [range], booleanRule: { condition, format } } },
  });
  const adds = [];
  const dataFrom = headerRowIndex + 1;

  for (const [word, fg, bg] of [['Escalate', BRAND.badText, BRAND.badFill], ['Watch', BRAND.badText, BRAND.badFill], ['Strong', BRAND.goodText, BRAND.goodFill]]) {
    adds.push(add(
      { sheetId, startRowIndex: dataFrom, endRowIndex: rowCount },
      { type: 'TEXT_EQ', values: [{ userEnteredValue: word }] },
      { backgroundColor: bg, textFormat: { foregroundColor: fg, bold: true } },
    ));
  }

  if (ratioHeader) {
    const hdr = header ?? (await readTab(title, { spreadsheetId, range: `A${dataFrom}:ZZ${dataFrom}` }))[0] ?? [];
    hdr.forEach((h, c) => {
      if (!ratioHeader.test(String(h ?? '').trim())) return;
      const cell = `${colLetter(c + 1)}${dataFrom + 1}`;
      const num = (fallbackValue) => `IFERROR(VALUE(SUBSTITUTE(${cell},"%","")),${fallbackValue})`;
      const range = { sheetId, startRowIndex: dataFrom, endRowIndex: rowCount, startColumnIndex: c, endColumnIndex: c + 1 };
      adds.push(add(range,
        { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=AND(${cell}<>"",${num(999)}<${redBelow})` }] },
        { textFormat: { foregroundColor: BRAND.badText, bold: true } }));
      adds.push(add(range,
        { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=AND(${cell}<>"",${num(-1)}>=${greenFrom})` }] },
        { textFormat: { foregroundColor: BRAND.goodText, bold: true } }));
    });
  }

  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [...deletes, ...adds] } });
}

/**
 * Stretch the tab's existing alternating-row colours over any new rows or columns.
 * Only ever grows the range, never shrinks it, and never changes Vee's colours.
 */
export async function extendBanding(title, { spreadsheetId = BUILD_SHEET_ID, rows, cols } = {}) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title),bandedRanges)' });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab?.bandedRanges?.length) return;
  const requests = [];
  for (const b of tab.bandedRanges) {
    const r = b.range;
    const needRows = r.endRowIndex !== undefined && r.endRowIndex < rows;
    const needCols = r.endColumnIndex !== undefined && r.endColumnIndex < cols;
    if (!needRows && !needCols) continue;
    requests.push({
      updateBanding: {
        bandedRange: {
          bandedRangeId: b.bandedRangeId,
          range: { ...r, ...(needRows ? { endRowIndex: rows } : {}), ...(needCols ? { endColumnIndex: cols } : {}) },
        },
        fields: 'range',
      },
    });
  }
  if (requests.length) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/**
 * Paint a tab that is not one flat table.
 *
 * Used by Op Reports: a goal row, section banners, column headers inside each section,
 * and plain bold headings. Every row kind is optional, so a tab uses only the ones it
 * has. The tracker's Scorecard no longer uses this — it moved to restyleRows, because
 * its rows now move and this paints by position.
 * These three colours were read back off the sheet after Vee styled it by hand, not
 * guessed: #1A1A4C for the goal row, #454EBD for a class title, #E6E6FA for the
 * column headers inside each class. Section headings are bold with no fill.
 *
 * All row indices are 0-based over the values written.
 */
export async function formatScorecard(title, { goalRow, classRows, headerRows, sectionRows, indigoRows, spreadsheetId = BUILD_SHEET_ID } = {}) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab) return;
  const sheetId = tab.properties.sheetId;

  const paint = (i, bg, fg, bold, align) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: i, endRowIndex: i + 1 },
      cell: {
        userEnteredFormat: {
          textFormat: { bold, foregroundColor: fg },
          ...(bg ? { backgroundColor: bg } : {}),
          ...(align ? { horizontalAlignment: align } : {}),
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        },
      },
      fields: `userEnteredFormat(textFormat,verticalAlignment,wrapStrategy${bg ? ',backgroundColor' : ''}${align ? ',horizontalAlignment' : ''})`,
    },
  });

  const requests = [];
  if (typeof goalRow === 'number') requests.push(paint(goalRow, BRAND.indigo, BRAND.white, true));
  for (const i of classRows ?? []) requests.push(paint(i, BRAND.cornflower, BRAND.white, true));
  for (const i of headerRows ?? []) requests.push(paint(i, BRAND.lavender, BRAND.black, true));
  for (const i of sectionRows ?? []) requests.push(paint(i, null, BRAND.black, true));
  // Indigo, white, bold, CENTRED — the treatment Vee applied by hand to the section
  // headers inside a build-sheet tab, read back off the sheet rather than guessed.
  for (const i of indigoRows ?? []) requests.push(paint(i, BRAND.indigo, BRAND.white, true, 'CENTER'));
  if (!requests.length) return;

  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

// There is deliberately no function here that moves tabs. One used to put the
// Scorecard first on every run; Vee keeps Run Log first and Scorecard second, and the
// tab order is hers.

/**
 * Remove tabs that a rebuild has replaced.
 *
 * Writing a tab never removes one, so a renamed or relocated tab lingers with frozen
 * numbers — and stale numbers on a team sheet are worse than no numbers, because
 * nothing about them looks wrong. Only ever called with names this code itself
 * created, never with a pattern.
 */
export async function deleteTabs(titles, { spreadsheetId = BUILD_SHEET_ID } = {}) {
  if (!titles?.length) return [];
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const targets = meta.data.sheets.filter((s) => titles.includes(s.properties.title));
  if (!targets.length) return [];
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: targets.map((t) => ({ deleteSheet: { sheetId: t.properties.sheetId } })) },
  });
  return targets.map((t) => t.properties.title);
}

/**
 * Update a specific range and leave the rest of the tab alone.
 *
 * `writeTab` rewrites a whole table, which is right for a rebuild and badly wrong for
 * a status line. A failed run used to call writeTab on the README and destroy every
 * word explaining how to read the sheet, replacing it with a three-row error — so the
 * one moment the team most needed the instructions was the moment they disappeared.
 * This writes one range and nothing else.
 */
export async function writeCells(title, a1, rows, { spreadsheetId = BUILD_SHEET_ID } = {}) {
  const api = sheets();
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!${a1}`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

/** Read a tab's values. Returns [] if the tab does not exist yet. */
export async function readTab(title, { spreadsheetId = BUILD_SHEET_ID, range = 'A1:ZZ2000' } = {}) {
  const api = sheets();
  const r = await api.spreadsheets.values
    .get({ spreadsheetId, range: `'${title}'!${range}` })
    .catch(() => null);
  return r?.data?.values ?? [];
}
