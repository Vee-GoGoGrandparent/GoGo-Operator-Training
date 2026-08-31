// OPS_TASK=transcripts
//
// The AI grading (callSummary) and the call-avoidance detector (qualityAssurances)
// are not reviewed by anyone, and the trainer says they are wrong often enough that
// we must not treat them as truth. So: is the raw transcript available instead?
//
// `callLogs.deepgramTranscriptId` points at `deepgramCalls`. Deepgram is a
// speech-to-text service, so its `response` JSON should hold the real words. This
// probe confirms that — or proves it does not — before anything gets designed
// around it.
//
// Read-only. Every query is date-bounded or LIMITed; callLogs is 51M rows and we
// are guests on somebody else's replica.

import { connect, tryQ } from '../src/db.js';
import { writeTab, formatHeader } from '../src/sheets.js';
import { notify } from '../src/slack.js';
import { nowET, fmtDbDate } from '../src/time.js';

const fmt = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fmtDbDate(v); // stored value, not an instant
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

async function main() {
  const { conn } = await connect();
  const out = [['Question', 'Answer']];

  const ask = async (label, sql, params = [], timeout = 25_000) => {
    const r = await tryQ(conn, sql, params, timeout);
    if (r.error) {
      out.push([label, `ERROR: ${r.error.slice(0, 400)}`]);
      console.log(`${label}\n  ERROR: ${r.error.slice(0, 200)}`);
      return null;
    }
    const text = r.rows
      .map((row) => Object.entries(row).map(([k, v]) => `${k}=${fmt(v)}`).join('  '))
      .join('\n');
    out.push([label, text || '(no rows)']);
    console.log(`${label}\n  ${text.slice(0, 300)}`);
    return r.rows;
  };

  // 1. Can we even read it, and how big / how old?
  await ask('deepgramCalls — can we read it? how many, what range?',
    `SELECT COUNT(*) AS rows_, MIN(createdAt) AS first, MAX(createdAt) AS last FROM deepgramCalls`, [], 40_000);

  // 2. `kind` tells us whether these are transcripts or some other Deepgram product.
  await ask('deepgramCalls — what kinds of record are these?',
    `SELECT kind, COUNT(*) AS n FROM deepgramCalls GROUP BY kind ORDER BY n DESC LIMIT 20`, [], 40_000);

  // 3. The whole question: does `response` contain readable words?
  //    Pull the top-level JSON keys first — cheaper than dumping a whole blob.
  await ask('deepgramCalls — top-level keys of the response JSON',
    `SELECT JSON_KEYS(response) AS keys_, kind, createdAt
       FROM deepgramCalls ORDER BY createdAt DESC LIMIT 3`);

  // 4. Deepgram's usual shape is results.channels[0].alternatives[0].transcript.
  //    If that path resolves, we have the transcript and we are done guessing.
  await ask('deepgramCalls — pull the standard Deepgram transcript path',
    `SELECT LEFT(JSON_UNQUOTE(JSON_EXTRACT(response, '$.results.channels[0].alternatives[0].transcript')), 1200) AS transcript,
            createdAt
       FROM deepgramCalls
      WHERE JSON_EXTRACT(response, '$.results.channels[0].alternatives[0].transcript') IS NOT NULL
      ORDER BY createdAt DESC LIMIT 2`);

  // 5. If that path is empty, show a raw slice so we can read the real shape.
  await ask('deepgramCalls — raw response slice (fallback if the path above was empty)',
    `SELECT LEFT(response, 1500) AS raw, kind, createdAt FROM deepgramCalls ORDER BY createdAt DESC LIMIT 1`);

  // 6. Is there speaker separation? Coaching is about who talked when — an
  //    undifferentiated wall of words is much less useful than a diarized one.
  await ask('deepgramCalls — is there speaker diarization / utterances?',
    `SELECT JSON_EXTRACT(response, '$.results.utterances[0]') AS first_utterance
       FROM deepgramCalls
      WHERE JSON_EXTRACT(response, '$.results.utterances') IS NOT NULL
      ORDER BY createdAt DESC LIMIT 1`);

  // 7. The join we actually need: a call belonging to a known operator, with its
  //    transcript attached. Date-bounded so we never scan 51M rows.
  await ask('callLogs — how many recent calls have a transcript id and an operator?',
    `SELECT COUNT(*) AS calls_,
            SUM(deepgramTranscriptId IS NOT NULL) AS with_transcript,
            SUM(recording IS NOT NULL) AS with_recording,
            SUM(operatorId IS NOT NULL) AS with_operator
       FROM callLogs
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`, [], 40_000);

  // 8. End to end: operator → call → transcript. If this returns a row, the whole
  //    idea works and we can grade a call on what was actually said.
  await ask('END TO END — operator + call + real transcript text',
    `SELECT o.slackId, o.firstName, o.lastName, cl.id AS callLogId, cl.createdAt,
            LEFT(JSON_UNQUOTE(JSON_EXTRACT(d.response, '$.results.channels[0].alternatives[0].transcript')), 900) AS transcript
       FROM callLogs cl
       JOIN operators o     ON o.id = cl.operatorId
       JOIN deepgramCalls d ON d.id = cl.deepgramTranscriptId
      WHERE cl.createdAt >= DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND cl.deepgramTranscriptId IS NOT NULL
      ORDER BY cl.createdAt DESC
      LIMIT 2`, [], 45_000);

  // 9. How far back does coverage go? Decides whether we can review past classes
  //    or only ones from here forward.
  await ask('coverage — share of calls WITH a transcript, by month',
    `SELECT DATE_FORMAT(createdAt,'%Y-%m') AS month, COUNT(*) AS calls_,
            SUM(deepgramTranscriptId IS NOT NULL) AS with_transcript
       FROM callLogs
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 8 MONTH)
      GROUP BY month ORDER BY month`, [], 60_000);

  // 10. The AI verdicts we are NOT trusting — but we still want to know how loudly
  //     they are firing, since people are being coached and fired on them.
  await ask('qualityAssurances — how many avoidance flags, and how many are "yes"?',
    `SELECT COUNT(*) AS rows_,
            SUM(JSON_EXTRACT(response,'$.isAvoidance') = TRUE) AS flagged_yes,
            MIN(createdAt) AS first, MAX(createdAt) AS last
       FROM qualityAssurances`, [], 30_000);

  await ask('qualityAssurances — avoidance types being alleged',
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(response,'$.avoidanceType')) AS type_, COUNT(*) AS n
       FROM qualityAssurances GROUP BY type_ ORDER BY n DESC LIMIT 15`, [], 30_000);

  await conn.end();

  out.push([]);
  out.push(['Run at', nowET()]);
  await writeTab('05 Transcripts', out);
  await formatHeader('05 Transcripts').catch(() => {});
  await notify('🎙️ Transcript probe finished — see tab "05 Transcripts".');
}

main().catch(async (err) => {
  console.error('TRANSCRIPT PROBE FAILED:', err.message);
  try {
    await writeTab('05 Transcripts', [['Status', '❌ FAILED'], ['Error', err.message], ['Run at', nowET()]]);
    await formatHeader('05 Transcripts').catch(() => {});
  } catch (e) {
    console.error('could not write the failure:', e.message);
  }
  await notify(`❌ Transcript probe failed: ${err.message}`);
  process.exit(1);
});
