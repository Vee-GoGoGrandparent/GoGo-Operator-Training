// Railway entrypoint for the Operator Training tracker.
//
// Deliberately minimal. It stays alive so Railway keeps the service, and it runs
// whatever `OPS_TASK` names — a whitelist, so the value can never become an
// arbitrary command.
//
// The trigger is OPS_TASK, not DB_TASK. That is the whole point: a variable left
// behind on the marketing service cannot fire an operator job, and a variable
// left behind here cannot fire a marketing one.

import cron from 'node-cron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TASKS = {
  discover: 'discover.js',
  transcripts: 'probe-transcripts.js',
  link: 'probe-link.js',
  tracker: 'build-tracker.js',
  reports: 'probe-reports.js',
  opreports: 'build-op-reports.js',
  star: 'probe-star.js',
  starsources: 'probe-star-sources.js',
};

let running = false;

function run(script) {
  return new Promise((resolve) => {
    const started = Date.now();
    console.log(`[task] starting ${script}`);
    const child = spawn(process.execPath, [path.join(HERE, script)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(`[task] ${script} exited ${code} after ${secs}s`);
      resolve(code);
    });
    child.on('error', (err) => {
      console.error(`[task] ${script} could not start:`, err.message);
      resolve(1);
    });
  });
}

// Railway wants something listening. It also gives us a trivially cheap way to
// confirm the service is actually up before blaming the database.
const port = process.env.PORT || 3000;
http
  .createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('gogo-operator-training: alive\n');
  })
  .listen(port, () => console.log(`[server] listening on ${port}`));

// ---------------------------------------------------------------- daily refresh
//
// Two different ways to run something, on purpose:
//
//   OPS_TASK   one shot. Set it, redeploy, read the sheet, remove it. This is for
//              probes and for anything you want to watch happen.
//
//   OPS_DAILY  a standing schedule. Set it once and leave it. The service is
//              already alive to satisfy Railway, so it may as well do the work.
//
// The schedule runs in EASTERN TIME, not UTC. If it ran in UTC, "6am" would drift
// an hour twice a year against every date on the sheet, and a job that lands either
// side of midnight would stamp the wrong day.
const DAILY = String(process.env.OPS_DAILY ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .filter((t) => {
    if (TASKS[t]) return true;
    console.error(`[cron] ignoring unknown OPS_DAILY value: ${t}`);
    return false;
  });

const DAILY_AT = process.env.OPS_DAILY_AT || '0 6 * * *'; // 6am Eastern

if (DAILY.length) {
  if (!cron.validate(DAILY_AT)) {
    console.error(`[cron] OPS_DAILY_AT is not a valid cron expression: "${DAILY_AT}" — nothing scheduled.`);
  } else {
    cron.schedule(
      DAILY_AT,
      async () => {
        // If a run is somehow still going, skip rather than stack two writes to the
        // same tabs. Overlapping writes to one sheet is how you get half a table.
        if (running) {
          console.error('[cron] previous run still going — skipping this one.');
          return;
        }
        running = true;
        console.log(`[cron] daily run starting: ${DAILY.join(', ')}`);
        try {
          for (const t of DAILY) await run(TASKS[t]);
        } finally {
          running = false;
        }
      },
      { timezone: 'America/New_York' },
    );
    console.log(`[cron] daily: ${DAILY.join(', ')} at "${DAILY_AT}" Eastern`);
  }
} else {
  console.log('[cron] OPS_DAILY not set — no schedule.');
}

const requested = String(process.env.OPS_TASK ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

const known = requested.filter((t) => TASKS[t]);
const unknown = requested.filter((t) => !TASKS[t]);

if (unknown.length) {
  console.error(`[task] ignoring unknown OPS_TASK value(s): ${unknown.join(', ')}. Known: ${Object.keys(TASKS).join(', ')}`);
}

if (known.length) {
  (async () => {
    running = true;
    try {
      for (const t of known) await run(TASKS[t]);
    } finally {
      running = false;
    }
    console.log('[task] all done — remove OPS_TASK from Railway now.');
  })();
} else {
  console.log('[server] no OPS_TASK set; idle.');
}
