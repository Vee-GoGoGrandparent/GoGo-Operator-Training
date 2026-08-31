// Railway entrypoint for the Operator Training tracker.
//
// Deliberately minimal. It stays alive so Railway keeps the service, and it runs
// whatever `OPS_TASK` names — a whitelist, so the value can never become an
// arbitrary command.
//
// The trigger is OPS_TASK, not DB_TASK. That is the whole point: a variable left
// behind on the marketing service cannot fire an operator job, and a variable
// left behind here cannot fire a marketing one.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TASKS = {
  discover: 'discover.js',
};

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
    for (const t of known) await run(TASKS[t]);
    console.log('[task] all done — remove OPS_TASK from Railway now.');
  })();
} else {
  console.log('[server] no OPS_TASK set; idle.');
}
