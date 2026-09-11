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
 * A Sheets client whose every call is checked against OPS_SHEET_ID first.
 * Use this. Never reach for rawClient().
 */
export function sheets() {
  const api = rawClient();
  const check = (fn) => (params, ...rest) => {
    assertOurSheet(params?.spreadsheetId);
    return fn(params, ...rest);
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
 * Create the tab if it is missing, then replace its contents with `rows`.
 * Defaults to the BUILD sheet — writing to the team-facing tracker has to be
 * an explicit choice, never something that happens because a default drifted.
 */
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
 */
export function matchExistingOrder(existingHeader, rows, headerRowIndex) {
  if (!existingHeader?.length) return rows;
  const header = rows[headerRowIndex];
  if (!header?.length) return rows;

  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const ours = header.map(norm);
  // Only reorder when the tab genuinely looks like the same table. Otherwise the
  // sheet has been rebuilt into something else and the old order means nothing.
  const overlap = existingHeader.map(norm).filter((h) => h && ours.includes(h));
  if (overlap.length < 2) return rows;

  const order = [];
  for (const h of existingHeader.map(norm)) {
    const i = ours.indexOf(h);
    if (h && i !== -1 && !order.includes(i)) order.push(i);
  }
  // Anything we produce that the tab has never had goes on the end.
  for (let i = 0; i < ours.length; i += 1) if (!order.includes(i)) order.push(i);
  if (order.length === ours.length && order.every((v, i) => v === i)) return rows;

  return rows.map((r, ri) => (ri < headerRowIndex ? r : order.map((i) => r[i] ?? '')));
}

/**
 * @param {object} [opts]
 * @param {number} [opts.keepColumnOrderFromRow] header row index to match against the
 *   tab's existing column order. Omit to write columns exactly as given.
 */
export async function writeTab(title, rows, spreadsheetId = BUILD_SHEET_ID, opts = {}) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find((s) => s.properties.title === title);

  if (!existing) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  } else {
    // Read the header BEFORE clearing, so a hand-arranged column order can be kept.
    if (typeof opts.keepColumnOrderFromRow === 'number') {
      const hr = opts.keepColumnOrderFromRow + 1;
      const cur = await api.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title}'!A${hr}:ZZ${hr}`,
      }).catch(() => null);
      rows = matchExistingOrder(cur?.data?.values?.[0], rows, opts.keepColumnOrderFromRow);
    }
    await api.spreadsheets.values.clear({ spreadsheetId, range: `'${title}'!A:ZZ` });
  }

  if (!rows.length) return;

  // Sheets rejects a jagged grid, so pad every row to the widest one. Cells are
  // capped at 50k characters — call summaries can exceed that.
  const width = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => {
    const padded = [...r, ...Array(width - r.length).fill('')];
    return padded.map((c) => (typeof c === 'string' && c.length > 49_000 ? `${c.slice(0, 49_000)}…` : c));
  });

  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: grid },
  });
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
 * Indigo header, white bold text, frozen top row, auto-sized columns.
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
            wrapStrategy: 'CLIP',
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)',
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
  // There used to be an autoResizeDimensions call here. It had to go: Vee sets column
  // widths and wrap by hand, and this job reruns on a schedule. Auto-resizing would
  // quietly undo her layout every single time, and she would have to redo it. A
  // rebuild refreshes the numbers; it does not get an opinion about the layout.

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

/**
 * Colour the Priority column by what it says.
 *
 * Deliberately CONDITIONAL formatting rather than painting cells. Every run rebuilds
 * these tabs and the rows re-sort, so a colour baked onto row 8 would end up on
 * whoever happens to land in row 8 next week. A rule that follows the word cannot
 * drift. It also means a human editing the sheet by hand gets the same colours.
 *
 * Applies to the whole tab, so it catches the Priority column wherever it sits and
 * the Status column when it says the same thing.
 */
export async function priorityColors(title, { spreadsheetId = BUILD_SHEET_ID } = {}) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab) return;
  const sheetId = tab.properties.sheetId;

  // Drop any rules we added before, so repeated runs do not stack duplicates.
  const existing = tab.conditionalFormats?.length ?? 0;
  const requests = [];
  for (let i = existing - 1; i >= 0; i -= 1) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  const rule = (text, fg, bg) => ({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: text }] },
          format: { backgroundColor: bg, textFormat: { foregroundColor: fg, bold: true } },
        },
      },
    },
  });

  requests.push(
    rule('Escalate', BRAND.badText, BRAND.badFill),
    rule('Watch', BRAND.badText, BRAND.badFill),
    rule('Strong', BRAND.goodText, BRAND.goodFill),
  );

  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/**
 * Paint a set of rows as section banners: cornflower ground, white bold text.
 *
 * The colour is not a guess — it was read back off the tab after Vee styled a row by
 * hand (#454EBD, which is already the GoGo cornflower in BRAND). Section headings are
 * generated now rather than typed in, because every rebuild rewrites the rows and a
 * hand-added banner would vanish on the next run.
 *
 * `rowIndices` are 0-based over the values written, so index 1 is the second row.
 */
export async function formatBanners(title, rowIndices, { spreadsheetId = BUILD_SHEET_ID } = {}) {
  if (!rowIndices?.length) return;
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab) return;
  const sheetId = tab.properties.sheetId;

  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: rowIndices.map((i) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: i, endRowIndex: i + 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, foregroundColor: BRAND.white },
              backgroundColor: BRAND.cornflower,
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment)',
        },
      })),
    },
  });
}

/**
 * The Scorecard's own paint job.
 *
 * That tab is not one table — it is a goal row, then a block per class, then notes.
 * Generic header formatting cannot express that, and banding actively fights it.
 * These three colours were read back off the sheet after Vee styled it by hand, not
 * guessed: #1A1A4C for the goal row, #454EBD for a class title, #E6E6FA for the
 * column headers inside each class. Section headings are bold with no fill.
 *
 * All row indices are 0-based over the values written.
 */
export async function formatScorecard(title, { goalRow, classRows, headerRows, sectionRows, spreadsheetId = BUILD_SHEET_ID } = {}) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab) return;
  const sheetId = tab.properties.sheetId;

  const paint = (i, bg, fg, bold) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: i, endRowIndex: i + 1 },
      cell: {
        userEnteredFormat: {
          textFormat: { bold, foregroundColor: fg },
          ...(bg ? { backgroundColor: bg } : {}),
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        },
      },
      fields: `userEnteredFormat(textFormat,verticalAlignment,wrapStrategy${bg ? ',backgroundColor' : ''})`,
    },
  });

  const requests = [];
  if (typeof goalRow === 'number') requests.push(paint(goalRow, BRAND.indigo, BRAND.white, true));
  for (const i of classRows ?? []) requests.push(paint(i, BRAND.cornflower, BRAND.white, true));
  for (const i of headerRows ?? []) requests.push(paint(i, BRAND.lavender, BRAND.black, true));
  for (const i of sectionRows ?? []) requests.push(paint(i, null, BRAND.black, true));
  if (!requests.length) return;

  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/** Put a tab at a given position. Vee wants the Scorecard first — it is the tab
 *  anyone else opens the sheet to look at. */
export async function moveTab(title, index, { spreadsheetId = BUILD_SHEET_ID } = {}) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab || tab.properties.index === index) return;
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: tab.properties.sheetId, index },
          fields: 'index',
        },
      }],
    },
  });
}
