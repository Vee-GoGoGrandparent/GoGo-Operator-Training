// OPS_TASK=link
//
// Two open questions, both of which must be ANSWERED not assumed:
//
//   1. `callLogs.deepgramTranscriptId` is empty on every recent call, yet
//      `deepgramCalls` holds 1.15M transcripts. So how does a transcript get back
//      to an operator? The `request` JSON almost certainly names the audio file,
//      and that filename should carry a recording id that `callLogs` also knows.
//
//   2. The system MUTES the audio while a customer reads out payment details, so
//      card numbers are never recorded. Silence in that window is by design and
//      must never be counted as dead air or mentioned in coaching. Before writing
//      any rule to exclude it, look at what a payment call actually looks like.
//
// Read-only, date-bounded, LIMITed.

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

  out.push(['— PART 1: HOW DOES A TRANSCRIPT REACH AN OPERATOR? —', '']);

  // What does Deepgram get asked to transcribe? The answer should name a file.
  await ask('deepgramCalls — the request JSON (what audio was sent?)',
    `SELECT LEFT(request, 1200) AS request_, createdAt FROM deepgramCalls ORDER BY createdAt DESC LIMIT 2`);

  await ask('deepgramCalls — top-level keys of request',
    `SELECT JSON_KEYS(request) AS keys_ FROM deepgramCalls ORDER BY createdAt DESC LIMIT 3`);

  // Twilio recording SIDs start with "RE". If one appears in the request, that is
  // the bridge: deepgramCalls.request -> RExxx -> callLogs.recordingSid -> operator.
  await ask('deepgramCalls — is there a Twilio recording SID (RExxx) in the request?',
    `SELECT REGEXP_SUBSTR(request, 'RE[0-9a-f]{32}') AS recordingSid, createdAt
       FROM deepgramCalls
      WHERE request REGEXP 'RE[0-9a-f]{32}'
      ORDER BY createdAt DESC LIMIT 3`);

  // And does callLogs actually hold those same SIDs?
  await ask('callLogs — sample recordingSid values to compare shape',
    `SELECT id, recordingSid, LEFT(recording, 160) AS recording_, createdAt
       FROM callLogs
      WHERE recordingSid IS NOT NULL AND createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY createdAt DESC LIMIT 3`, [], 40_000);

  // THE JOIN, if the SID is really the bridge.
  await ask('LINK TEST — operator + call + transcript, joined on recording SID',
    `SELECT o.slackId, o.firstName, o.lastName, cl.id AS callLogId, cl.createdAt,
            LEFT(JSON_UNQUOTE(JSON_EXTRACT(d.response,'$.results.channels[0].alternatives[0].transcript')), 400) AS transcript
       FROM deepgramCalls d
       JOIN callLogs cl ON cl.recordingSid = REGEXP_SUBSTR(d.request, 'RE[0-9a-f]{32}')
       JOIN operators o ON o.id = cl.operatorId
      WHERE d.createdAt >= DATE_SUB('2026-08-21', INTERVAL 3 DAY)
      ORDER BY d.createdAt DESC LIMIT 3`, [], 60_000);

  // Fallback: callSummary already knows callLogId. If its text matches a Deepgram
  // transcript, that is a second route in.
  await ask('callSummary — does it carry callLogId AND line up in time with deepgramCalls?',
    `SELECT cs.callLogId, cs.agentId, cs.createdAt, LEFT(cs.summary, 200) AS summary_
       FROM callSummary cs
      WHERE cs.createdAt BETWEEN '2026-08-20' AND '2026-08-22'
      ORDER BY cs.createdAt DESC LIMIT 3`, [], 40_000);

  // Why did transcription stop on Aug 21? Daily counts will show whether it is a
  // hard stop or just a lag.
  await ask('deepgramCalls — daily volume for the last 30 days it was running',
    `SELECT DATE(createdAt) AS day_, COUNT(*) AS n
       FROM deepgramCalls
      WHERE createdAt >= DATE_SUB('2026-08-21', INTERVAL 30 DAY)
      GROUP BY day_ ORDER BY day_ DESC LIMIT 32`, [], 50_000);

  out.push(['— PART 2: WHAT DOES A PAYMENT CALL LOOK LIKE? —', '']);
  out.push(['Why this matters',
    'The system mutes audio while payment details are read out, so card data is never captured. Silence there is by design — it must never be counted as dead air or mentioned in a coaching note. These queries look at a real payment call before any exclusion rule gets written.']);

  // Find calls that clearly reached payment, and read what the transcript does.
  await ask('a transcript that clearly reaches payment — what happens around it?',
    `SELECT LEFT(JSON_UNQUOTE(JSON_EXTRACT(response,'$.results.channels[0].alternatives[0].transcript')), 2500) AS transcript, createdAt
       FROM deepgramCalls
      WHERE createdAt >= DATE_SUB('2026-08-21', INTERVAL 5 DAY)
        AND JSON_UNQUOTE(JSON_EXTRACT(response,'$.results.channels[0].alternatives[0].transcript'))
            REGEXP 'card number|debit or credit|expiration|security code|three digits'
      ORDER BY createdAt DESC LIMIT 2`, [], 60_000);

  // Word-level timings are what let us measure silence. Is there a long gap right
  // after the operator asks for a card — i.e. is the mute visible as a hole?
  await ask('word timings around a payment ask — is the mute a visible gap?',
    `SELECT JSON_EXTRACT(response,'$.results.channels[0].alternatives[0].words[100 to 130]') AS words_
       FROM deepgramCalls
      WHERE createdAt >= DATE_SUB('2026-08-21', INTERVAL 5 DAY)
        AND JSON_UNQUOTE(JSON_EXTRACT(response,'$.results.channels[0].alternatives[0].transcript'))
            REGEXP 'card number|expiration'
      ORDER BY createdAt DESC LIMIT 1`, [], 60_000);

  // How long are these calls? Sets expectations for what a "long silence" even is.
  await ask('call duration from the transcript metadata',
    `SELECT JSON_EXTRACT(response,'$.metadata.duration') AS duration_s, createdAt
       FROM deepgramCalls ORDER BY createdAt DESC LIMIT 5`);

  await conn.end();

  out.push([]);
  out.push(['Run at', nowET()]);
  await writeTab('06 Link + Payment', out);
  await formatHeader('06 Link + Payment').catch(() => {});
  await notify('🔗 Link + payment probe finished — see tab "06 Link + Payment".');
}

main().catch(async (err) => {
  console.error('LINK PROBE FAILED:', err.message);
  try {
    await writeTab('06 Link + Payment', [['Status', '❌ FAILED'], ['Error', err.message], ['Run at', nowET()]]);
  } catch (e) {
    console.error('could not write the failure:', e.message);
  }
  await notify(`❌ Link probe failed: ${err.message}`);
  process.exit(1);
});
