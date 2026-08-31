// Read-only connection to the gogo production replica (gogo-db-read).
//
// A deliberate copy of the Marketing Growth OS client, not an import. This project
// must not depend on that one — see README, "Separation guarantees".
//
// Two things worth knowing:
//   1. This only works from Railway. The DB sits behind an IP allowlist holding
//      Railway's static outbound IPs — a laptop will be refused.
//   2. We try TLS first and fall back to plaintext, then report which one won.

import mysql from 'mysql2/promise';

const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

// Only these verbs may reach the database. We are a guest on another team's
// replica; the account is meant to be SELECT-only, but a typo in a script should
// never be the thing that discovers otherwise.
const READ_ONLY = /^\s*(select|show|describe|desc|explain|with)\b/i;

function explain(err) {
  const code = err.code || '';
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED')
    return 'Could not reach the server. Most likely this Railway service\'s outbound IP is not on the allowlist — meaning the static IP did NOT carry over from the Marketing Growth OS service, and the DBA needs to add this one.';
  if (code === 'ENOTFOUND')
    return `Hostname "${process.env.DB_HOST}" does not resolve. Check DB_HOST for a typo.`;
  if (code === 'ER_ACCESS_DENIED_ERROR')
    return 'The server answered but rejected the login. Wrong username or password — likely the password was rotated and Railway still has the old one.';
  if (code === 'ER_DBACCESS_DENIED_ERROR')
    return `Login worked, but this user cannot open the "${process.env.DB_NAME}" database.`;
  if (code === 'ER_BAD_DB_ERROR')
    return `There is no database named "${process.env.DB_NAME}" on this server.`;
  if (code === 'HANDSHAKE_NO_SSL_SUPPORT')
    return 'This server does not support SSL at all.';
  return err.message;
}

export class DbError extends Error {
  constructor(err) {
    super(explain(err));
    this.name = 'DbError';
    this.code = err.code;
    this.original = err;
  }
}

function baseConfig() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length)
    throw new Error(`Missing Railway variable(s): ${missing.join(', ')}. Add them in the Variables tab.`);

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 15_000,
    // Big text columns (call summaries) come back as strings, not Buffers.
    charset: 'utf8mb4',
  };
}

/**
 * Connect, preferring TLS. Resolves to { conn, tls } where `tls` is:
 *   'verified'   — encrypted against the CA the DBA gave us (DB_SSL_CA set)
 *   'unverified' — encrypted, but we cannot confirm we are talking to the real
 *                  server. Stops passive eavesdropping, not an active attacker.
 *   'none'       — plaintext. The server refused TLS.
 */
async function connectOnce() {
  const cfg = baseConfig();
  const ca = process.env.DB_SSL_CA;

  try {
    const conn = await mysql.createConnection({
      ...cfg,
      ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    });
    return { conn, tls: ca ? 'verified' : 'unverified' };
  } catch (err) {
    if (err.code !== 'HANDSHAKE_NO_SSL_SUPPORT') throw new DbError(err);
  }

  try {
    const conn = await mysql.createConnection(cfg);
    return { conn, tls: 'none' };
  } catch (err) {
    throw new DbError(err);
  }
}

/**
 * Connect, retrying on the errors that mean "we drew an un-allowlisted IP".
 *
 * Railway spreads outbound traffic across several static IPs and picks one per
 * connection. When only some of them are on the DBA's allowlist, a single attempt
 * is a coin flip — but each retry is a fresh draw. With two of three allowed,
 * five attempts fail together about once in 250 runs.
 *
 * We only retry the network-level refusals. A wrong password or a missing grant
 * will fail identically forever, and retrying those just wastes a minute before
 * showing the same message.
 */
const RETRYABLE = new Set(['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH']);

export async function connect({ attempts = 5, delayMs = 3_000 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const result = await connectOnce();
      if (i > 1) console.log(`[db] connected on attempt ${i}/${attempts}`);
      return result;
    } catch (err) {
      last = err;
      const code = err.code || err.original?.code;
      if (!RETRYABLE.has(code)) throw err; // auth/grant problems will never fix themselves
      console.log(`[db] attempt ${i}/${attempts} drew an un-allowlisted IP (${code}); retrying…`);
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(
    `${last.message}\n\n` +
      `Tried ${attempts} times. Railway rotates across its static IPs, so this means NONE of them ` +
      `are on the allowlist — not just bad luck. Send the DBA the IPs from Railway → Settings → Networking.`,
  );
}

/**
 * Run a read-only query. Returns rows, or throws.
 *
 * `timeoutMs` becomes a MAX_EXECUTION_TIME hint so one heavy query cannot hang
 * the whole job — these are big tables on somebody else's replica and we do not
 * get to be the reason it slows down.
 */
export async function q(conn, sql, params = [], timeoutMs = 20_000) {
  if (!READ_ONLY.test(sql)) {
    throw new Error(`Refused: this project is read-only, and that query is not a SELECT.\n${sql.slice(0, 200)}`);
  }
  const hinted = sql.replace(/^\s*select/i, `SELECT /*+ MAX_EXECUTION_TIME(${timeoutMs}) */`);
  const [rows] = await conn.query(hinted, params);
  return rows;
}

/** Same as q(), but a failure returns { error } instead of throwing. */
export async function tryQ(conn, sql, params = [], timeoutMs = 20_000) {
  try {
    return { rows: await q(conn, sql, params, timeoutMs) };
  } catch (err) {
    return { error: err.message, code: err.code };
  }
}
