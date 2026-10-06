// Sign in with Slack (OpenID Connect) and a signed session cookie. No passwords are ever stored.
import crypto from 'node:crypto';
import { one, run } from './db.js';

const SECRET = process.env.SESSION_SECRET || '';
const ON_RAILWAY = !!process.env.RAILWAY_ENVIRONMENT;
const KEY = SECRET || 'local-dev-only-secret-do-not-use-in-production';
const WEEK = 7 * 24 * 3600 * 1000;

const sign = (data) => crypto.createHmac('sha256', KEY).update(data).digest('base64url');

export function setCookie(res, name, value, { maxAgeMs, secure } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...[].concat(prev), parts.join('; ')]);
}

export function readCookies(req) {
  const out = {};
  for (const c of (req.headers.cookie || '').split(';')) {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  }
  return out;
}

export function startSession(res, slackId, secure) {
  const body = Buffer.from(JSON.stringify({ s: slackId, exp: Date.now() + WEEK })).toString('base64url');
  setCookie(res, 'pa_session', `${body}.${sign(body)}`, { maxAgeMs: WEEK, secure });
}

export function endSession(res, secure) { setCookie(res, 'pa_session', '', { maxAgeMs: 0, secure }); }

export function currentUser(req) {
  const raw = readCookies(req).pa_session;
  if (!raw) return null;
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const want = sign(body);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!data.exp || data.exp < Date.now()) return null;
  return one('SELECT * FROM users WHERE slack_id = ?', data.s) || null;
}

// Admins: anyone listed in ADMIN_SLACK_IDS, plus anyone an admin promoted inside the app.
const envAdmins = () => (process.env.ADMIN_SLACK_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

export function upsertUser({ slackId, name, email }) {
  const isEnvAdmin = envAdmins().includes(slackId);
  const existing = one('SELECT * FROM users WHERE slack_id = ?', slackId);
  if (existing) {
    run(`UPDATE users SET name = ?, email = ?, last_login = datetime('now'), role = CASE WHEN ? THEN 'admin' ELSE role END WHERE slack_id = ?`,
      name, email || null, isEnvAdmin ? 1 : 0, slackId);
  } else {
    run(`INSERT INTO users (slack_id, name, email, role, last_login) VALUES (?, ?, ?, ?, datetime('now'))`,
      slackId, name, email || null, isEnvAdmin ? 'admin' : 'trainee');
  }
  return one('SELECT * FROM users WHERE slack_id = ?', slackId);
}

// ── Slack OpenID Connect ───────────────────────────────────────────────
// On Railway, sign-in also needs a real SESSION_SECRET (32+ characters); until then it stays switched off.
export const slackConfigured = () => !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET) && (!ON_RAILWAY || SECRET.length >= 32);

export function slackLoginUrl(res, baseUrl, secure) {
  const state = crypto.randomBytes(16).toString('base64url');
  const nonce = crypto.randomBytes(16).toString('base64url');
  setCookie(res, 'pa_state', `${state}.${nonce}`, { maxAgeMs: 10 * 60 * 1000, secure });
  const p = new URLSearchParams({
    response_type: 'code', scope: 'openid profile email',
    client_id: process.env.SLACK_CLIENT_ID, redirect_uri: `${baseUrl}/auth/slack/callback`, state, nonce,
  });
  if (process.env.SLACK_TEAM_ID) p.set('team', process.env.SLACK_TEAM_ID);
  return `https://slack.com/openid/connect/authorize?${p}`;
}

export async function slackCallback(req, url, baseUrl) {
  const [state] = (readCookies(req).pa_state || '').split('.');
  if (!state || url.searchParams.get('state') !== state) throw new Error('Sign-in expired or was tampered with. Please try again.');
  const code = url.searchParams.get('code');
  if (!code) throw new Error(url.searchParams.get('error') || 'Slack did not send a sign-in code.');

  const tokenRes = await fetch('https://slack.com/api/openid.connect.token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID, client_secret: process.env.SLACK_CLIENT_SECRET,
      code, redirect_uri: `${baseUrl}/auth/slack/callback`,
    }),
  }).then(r => r.json());
  if (!tokenRes.ok) throw new Error(`Slack sign-in failed (${tokenRes.error}).`);

  const info = await fetch('https://slack.com/api/openid.connect.userInfo', {
    headers: { Authorization: `Bearer ${tokenRes.access_token}` },
  }).then(r => r.json());
  if (!info.ok) throw new Error(`Slack sign-in failed (${info.error}).`);

  const teamId = info['https://slack.com/team_id'];
  if (process.env.SLACK_TEAM_ID && teamId !== process.env.SLACK_TEAM_ID) {
    throw new Error('That Slack account is not in the GoGo workspace.');
  }
  return {
    slackId: info['https://slack.com/user_id'],
    name: info.name || info.given_name || info['https://slack.com/user_id'],
    email: info.email,
  };
}

// Local testing only: sign in as anyone without Slack. Refuses to run on Railway.
export const devLoginAllowed = () => process.env.DEV_LOGIN === '1' && !ON_RAILWAY;
