// OPS_TASK=leavers
//
// "Why are the operators who get let go being let go?" — Vee, 2026-10-05.
//
// The class workbooks only cover the people who went through training since June. The
// database knows about EVERY operator whose account was closed, with the reason someone
// typed when they closed it. This probe reads the last 12 months of closures and answers:
//
//   1. What reasons get recorded, grouped into plain buckets (call avoidance, attendance,
//      no-call-no-show, performance, resigned, ...).
//   2. How long people lasted before they were closed (first month? first 90 days? later?).
//   3. Whether the people who were let go were already behind on registrations in the
//      month before they left, compared with operators who are still here.
//
// Counts only. `deactivationReason` is free text typed by staff, so a raw reason could in
// principle name a customer; nothing raw is written out — every reason is reduced to a
// bucket first (Vee's no-customer-details rule). Names are never written either.
//
// Two known traps, both from discovery on 2026-08-31:
//   - `deactivationReason` is also used as a NOTES field on people who are not closed
//     ("Can't join June class…"). So churn is defined by `closedAt`, never by the reason.
//   - Values are messy (trailing spaces, tabs, a lone "."). Bucketing lowercases and trims.
//
// Read-only. Writes ONE tab on the Build Notes sheet. On failure it writes nothing to the
// sheet (an earlier probe's failure path overwrote a good snapshot — not repeating that).

import { connect, tryQ } from '../src/db.js';
import { writeTab, formatHeader } from '../src/sheets.js';
import { regCallsOf, ratio, pctStr } from '../src/analysis.js';
import { nowET } from '../src/time.js';

const TAB = '21 Why Operators Leave';

// Order matters only for the "main reason" column: a reason can mention several things,
// and every matching bucket is counted (multi-label), but the first match is shown as main.
const BUCKETS = [
  ['Call avoidance', /avoid|hung up|hang up|disconnect|dropp?ed call|dead air|not answering calls/],
  ['No call / no show', /\bncns\b|no ?call|no ?show|abandon|ghost|did not show|didn'?t show|never showed/],
  ['Attendance / tardiness', /attendance|absen|tard|\blate\b|early (out|logout)|schedule|adherence|shift/],
  ['Performance / registrations', /perform|metric|\bregs?\b|registration|ratio|quota|target|kpi|\bstars?\b/],
  ['Quality / QA / op reports', /\bqa\b|quality|op ?report|mistake|error|wrong|complain/],
  ['Behaviour / conduct', /rude|behav|conduct|unprofessional|insubordinat|attitude|harass|profan|curs/],
  ['Policy / fraud / integrity', /fraud|policy|violat|integrity|cheat|falsif|already registered|steal|security/],
  ['Tech / internet / equipment', /internet|tech|connection|power|outage|equipment|headset|computer|laptop/],
  ['Training (failed / not completed)', /training|orientation|sli|quiz|failed|did not (pass|complete)/],
  ['Resigned / personal / other job', /resign|quit|personal|school|stud|another job|new job|family|health|moved|relocat|voluntar/],
  ['Rehire / transfer / admin', /rehire|transfer|duplicate|test account|admin|merged|wrong account/],
];

const bucketsOf = (reason) => {
  const r = String(reason || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!r || r === '.' || r === '-') return ['(no reason written)'];
  const hit = BUCKETS.filter(([, re]) => re.test(r)).map(([b]) => b);
  return hit.length ? hit : ['Other (reason did not match a bucket)'];
};

const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86_400_000);
const TENURE = [
  ['Under 30 days', 0, 29],
  ['30–89 days', 30, 89],
  ['90–179 days', 90, 179],
  ['180–364 days', 180, 364],
  ['1 year or more', 365, Infinity],
];
const tenureOf = (days) => (TENURE.find(([, lo, hi]) => days >= lo && days <= hi) || ['?'])[0];

// The bucketing must work before it is trusted on real data.
function selfTest() {
  const cases = [
    ['Call Avoidance ', 'Call avoidance'],
    ['NCNS x3', 'No call / no show'],
    ['\tTardiness and absences', 'Attendance / tardiness'],
    ['low regs for 3 months', 'Performance / registrations'],
    ['Resigned - going back to school', 'Resigned / personal / other job'],
    ['.', '(no reason written)'],
    ['zzz', 'Other (reason did not match a bucket)'],
  ];
  const bad = cases.filter(([txt, want]) => bucketsOf(txt)[0] !== want);
  if (bad.length) throw new Error(`bucket self-test failed: ${bad.map(([t, w]) => `"${t}" -> ${bucketsOf(t)[0]} (wanted ${w})`).join('; ')}`);
}

async function main() {
  selfTest();
  const { conn } = await connect({ attempts: 5 });

  // 1. Everyone closed in the last 12 months.
  const closed = await tryQ(conn,
    `SELECT id, createdAt, closedAt, deactivationReason, isRehireEligible, defaultType
       FROM operators
      WHERE closedAt IS NOT NULL AND closedAt >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)`, [], 60_000);
  if (closed.error) throw new Error(`closed operators: ${closed.error}`);

  // 2. Each closed operator's registrations in the 30 days before they left, and the same
  //    30-day window for operators who are still active (the comparison group).
  const perfLeavers = await tryQ(conn,
    `SELECT p.operatorId,
            SUM(p.rideRegCalls) AS rideRegCalls, SUM(p.gourmetRegCalls) AS gourmetRegCalls,
            SUM(p.groceryRegCalls) AS groceryRegCalls, SUM(p.noMembershipCalls) AS noMembershipCalls,
            SUM(p.hardRegs) AS hardRegs
       FROM operatorPerformances p
       JOIN operators o ON o.id = p.operatorId
      WHERE o.closedAt IS NOT NULL AND o.closedAt >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        AND p.aggregationDate >= DATE_SUB(DATE(o.closedAt), INTERVAL 30 DAY)
        AND p.aggregationDate <  DATE(o.closedAt)
      GROUP BY p.operatorId`, [], 120_000);
  const perfActive = await tryQ(conn,
    `SELECT p.operatorId,
            SUM(p.rideRegCalls) AS rideRegCalls, SUM(p.gourmetRegCalls) AS gourmetRegCalls,
            SUM(p.groceryRegCalls) AS groceryRegCalls, SUM(p.noMembershipCalls) AS noMembershipCalls,
            SUM(p.hardRegs) AS hardRegs
       FROM operatorPerformances p
       JOIN operators o ON o.id = p.operatorId
      WHERE o.closedAt IS NULL AND o.suspendedAt IS NULL
        AND p.aggregationDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY p.operatorId`, [], 120_000);
  // 3. How many operators were actually on the phones, so op reports per new grad can be
  //    compared with op reports per everyone else (Vee, 2026-10-05). "On the phones" =
  //    at least one registration call that month; test calls are not in regCallsOf.
  const onPhones = await tryQ(conn,
    `SELECT DATE_FORMAT(aggregationDate, '%Y-%m') AS month, COUNT(DISTINCT operatorId) AS operators
       FROM operatorPerformances
      WHERE aggregationDate >= '2026-07-01'
        AND (rideRegCalls + gourmetRegCalls + groceryRegCalls + noMembershipCalls) > 0
      GROUP BY month ORDER BY month`, [], 120_000);
  const onPhonesWindow = await tryQ(conn,
    `SELECT COUNT(DISTINCT operatorId) AS operators
       FROM operatorPerformances
      WHERE aggregationDate BETWEEN '2026-07-10' AND '2026-09-10'
        AND (rideRegCalls + gourmetRegCalls + groceryRegCalls + noMembershipCalls) > 0`, [], 120_000);
  await conn.end();

  const rows = closed.rows;
  const out = [['What', 'Count', 'Share', 'Notes']];
  const share = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '');
  out.push([`Operators closed in the last 12 months`, rows.length, '', 'closedAt set; deactivationReason ignored for deciding who left']);
  out.push([]);

  // Reasons, multi-label.
  out.push(['— Recorded reasons (a reason can mention more than one thing, so counts add up to more than the total) —', '', '', '']);
  const byBucket = new Map();
  for (const r of rows) for (const b of bucketsOf(r.deactivationReason)) byBucket.set(b, (byBucket.get(b) || 0) + 1);
  for (const [b, n] of [...byBucket].sort((a, c) => c[1] - a[1])) out.push([b, n, share(n, rows.length), '']);
  out.push([]);

  // Tenure at closing, and the main reason inside each tenure band.
  out.push(['— How long they lasted (account created → closed) —', '', '', 'createdAt is ~1 week before class starts, so "under 30 days" is mostly people who left during training']);
  for (const [band] of TENURE) {
    const inBand = rows.filter((r) => tenureOf(daysBetween(r.createdAt, r.closedAt)) === band);
    const top = new Map();
    for (const r of inBand) { const b = bucketsOf(r.deactivationReason)[0]; top.set(b, (top.get(b) || 0) + 1); }
    const top3 = [...top].sort((a, c) => c[1] - a[1]).slice(0, 3).map(([b, n]) => `${b} ${n}`).join(' · ');
    out.push([band, inBand.length, share(inBand.length, rows.length), top3 ? `Top reasons: ${top3}` : '']);
  }
  out.push([]);

  // Were they already behind before they left?
  out.push(['— Registrations in the 30 days before leaving vs operators still here (last 30 days) —', '', '', 'Only people with at least 20 reg calls in the window, so a few calls cannot swing it']);
  const summarise = (label, perfRows, onlyIds = null) => {
    const ratios = perfRows
      .filter((p) => !onlyIds || onlyIds.has(p.operatorId))
      .map((p) => ({ calls: regCallsOf(p), r: ratio(Number(p.hardRegs || 0), regCallsOf(p)) }))
      .filter((x) => x.calls >= 20 && x.r !== null)
      .map((x) => x.r)
      .sort((a, b) => a - b);
    if (!ratios.length) { out.push([label, 0, '', 'nobody with 20+ reg calls']); return; }
    const median = ratios[Math.floor(ratios.length / 2)];
    const under15 = ratios.filter((r) => r < 0.15).length;
    out.push([label, ratios.length, `median ${pctStr(median)}`, `${share(under15, ratios.length)} were under the 15% target`]);
  };
  if (perfLeavers.error) out.push(['Leavers — registrations before leaving', '', '', `ERROR: ${perfLeavers.error.slice(0, 200)}`]);
  else {
    summarise('Everyone who left', perfLeavers.rows);
    for (const [b] of BUCKETS.slice(0, 5)) {
      const ids = new Set(rows.filter((r) => bucketsOf(r.deactivationReason).includes(b)).map((r) => r.id));
      summarise(`  …left for: ${b}`, perfLeavers.rows, ids);
    }
  }
  if (perfActive.error) out.push(['Still here — last 30 days', '', '', `ERROR: ${perfActive.error.slice(0, 200)}`]);
  else summarise('Operators still here', perfActive.rows);
  out.push([]);

  out.push(['— Operators on the phones (at least one registration call) —', '', '', 'For comparing op reports per new grad with op reports per everyone else']);
  if (onPhones.error) out.push(['By month', '', '', `ERROR: ${onPhones.error.slice(0, 200)}`]);
  else for (const r of onPhones.rows) out.push([`  ${r.month}`, Number(r.operators), '', '']);
  if (onPhonesWindow.error) out.push(['Jul 10 – Sep 10 2026', '', '', `ERROR: ${onPhonesWindow.error.slice(0, 200)}`]);
  else out.push(['Jul 10 – Sep 10 2026 (the op report archive window)', Number(onPhonesWindow.rows[0]?.operators || 0), '', '']);
  out.push([]);

  const rehire = rows.filter((r) => r.isRehireEligible).length;
  out.push(['Marked rehire-eligible', rehire, share(rehire, rows.length), '']);
  out.push(['Run at', nowET(), '', '']);

  await writeTab(TAB, out);
  await formatHeader(TAB).catch(() => {});
  console.log(`wrote "${TAB}": ${rows.length} closed operators`);
}

main().catch((err) => {
  // Deliberately writes nothing to the sheet on failure — see header.
  console.error('LEAVERS PROBE FAILED:', err.message);
  process.exit(1);
});
