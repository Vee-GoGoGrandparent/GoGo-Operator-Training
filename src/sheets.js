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
export async function writeTab(title, rows, spreadsheetId = BUILD_SHEET_ID) {
  const api = sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find((s) => s.properties.title === title);

  if (!existing) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  } else {
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
  white: rgb('#FFFFFF'),
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
  const cols = tab.properties.gridProperties.columnCount;

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
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: Math.min(cols, 40) },
      },
    },
  ];

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
