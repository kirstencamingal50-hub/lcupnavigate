import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

const SESSION_COOKIE = '__Host-NAVIGATE_SESSION';
const SESSION_SECONDS = 8 * 60 * 60;
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function equalHash(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function cookieOptions() {
  const sameSite = process.env.SESSION_COOKIE_SAMESITE || 'Lax';
  if (!['Strict', 'Lax', 'None'].includes(sameSite)) {
    throw new Error('SESSION_COOKIE_SAMESITE must be Strict, Lax, or None.');
  }
  return sameSite;
}

function cookieHeader(token, clear = false) {
  const sameSite = cookieOptions();
  const value = clear ? '' : token;
  const maxAge = clear ? 0 : SESSION_SECONDS;
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}

function readCookie(request) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=');
  }
  return '';
}

function csrfToken() {
  return randomBytes(32).toString('hex');
}

function publicUser(user) {
  return {
    id: Number(user.id),
    full_name: user.full_name,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 &&
    /[A-Z]/.test(password) && /[a-z]/.test(password) &&
    /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function bodyJson(request) {
  const text = await request.text();
  if (text.length > 32_768) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }
}

async function loadSession(db, request) {
  const token = readCookie(request);
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const tokenHash = hash(token);
  const { rows } = await db.sql`
    SELECT token_hash, payload, csrf_hash
    FROM app_sessions
    WHERE token_hash = ${tokenHash} AND expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const payload = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
  let tokenCsrf = payload?.csrf;
  if (typeof tokenCsrf !== 'string' || !equalHash(hash(tokenCsrf), rows[0].csrf_hash)) {
    tokenCsrf = csrfToken();
    payload.csrf = tokenCsrf;
  }
  await db.sql`
    UPDATE app_sessions
    SET payload = ${JSON.stringify(payload)}::jsonb,
        csrf_hash = ${hash(tokenCsrf)},
        expires_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'
    WHERE token_hash = ${tokenHash}
  `;
  return { token, tokenHash, payload, csrf: tokenCsrf };
}

async function createSession(db, payload, existingTokenHash = null) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hash(token);
  const csrf = csrfToken();
  const sessionPayload = { ...payload, csrf };
  await db.sql`
    INSERT INTO app_sessions (token_hash, payload, csrf_hash, expires_at)
    VALUES (${tokenHash}, ${JSON.stringify(sessionPayload)}::jsonb, ${hash(csrf)},
      CURRENT_TIMESTAMP + INTERVAL '8 hours')
  `;
  if (existingTokenHash) {
    await db.sql`DELETE FROM app_sessions WHERE token_hash = ${existingTokenHash}`;
  }
  return { token, csrf, payload: sessionPayload, tokenHash };
}

async function requireCsrf(db, request, session) {
  if (!session) throw Object.assign(new Error('The request security token is invalid. Reload and try again.'), { status: 419 });
  const supplied = request.headers.get('x-csrf-token') || '';
  if (!equalHash(hash(supplied), hash(session.csrf))) {
    throw Object.assign(new Error('The request security token is invalid. Reload and try again.'), { status: 419 });
  }
}

async function authenticatedUser(db, session) {
  const id = Number(session?.payload?.userId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const { rows } = await db.sql`
    SELECT id, full_name, username, email, role, active
    FROM admin_users WHERE id = ${id} LIMIT 1
  `;
  const user = rows[0];
  if (!user || !user.active) {
    await db.sql`DELETE FROM app_sessions WHERE token_hash = ${session.tokenHash}`;
    return null;
  }
  return user;
}

async function requireAdmin(db, session, minimumRole = 'viewer') {
  const user = await authenticatedUser(db, session);
  if (!user) throw Object.assign(new Error('Administrator sign-in is required.'), { status: 401 });
  if ((ROLE_RANK[user.role] || 0) < (ROLE_RANK[minimumRole] || ROLE_RANK.editor)) {
    throw Object.assign(new Error('This administrator role cannot perform that operation.'), { status: 403 });
  }
  return user;
}

async function rateLimit(db, request) {
  const ip = request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-real-ip') || 'unknown';
  const ipHash = hash(ip);
  await db.sql`DELETE FROM login_attempts WHERE attempted_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`;
  const { rows } = await db.sql`
    SELECT COUNT(*)::integer AS count FROM login_attempts
    WHERE ip_hash = ${ipHash} AND attempted_at >= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
  `;
  if (Number(rows[0]?.count || 0) >= 8) {
    throw Object.assign(new Error('Too many sign-in attempts. Try again in 15 minutes.'), { status: 429 });
  }
}

async function recordAttempt(db, request) {
  const ip = request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-real-ip') || 'unknown';
  await db.sql`INSERT INTO login_attempts (ip_hash) VALUES (${hash(ip)})`;
}

async function sendCode(email, code, purpose) {
  const apiKey = process.env.RESEND_API_KEY || process.env.EMAIL_PROVIDER_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw Object.assign(new Error('Email verification is not configured on the server.'), { status: 503 });
  }
  const subject = purpose === 'signup' ? 'Verify your NaviGATE account' : 'Reset your NaviGATE password';
  const text = `Your NaviGATE verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`;
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject, text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (cause) {
    console.error('NaviGATE verification email delivery failed:', cause);
    throw Object.assign(new Error('Verification email could not be sent. Please try again later.'), { status: 503 });
  }
  if (!response.ok) {
    console.error('NaviGATE verification email provider rejected the request:', response.status);
    throw Object.assign(new Error('Verification email could not be sent. Please try again later.'), { status: 503 });
  }
}

async function newChallenge(db, { purpose, email, fullName = null, username = null, passwordHash = null, accountId = null, sendEmail: shouldSendEmail = true }) {
  const challengeToken = randomBytes(32).toString('hex');
  const code = String(randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 12);
  await db.sql`
    DELETE FROM admin_auth_challenges
    WHERE expires_at < CURRENT_TIMESTAMP OR (email = ${email} AND purpose = ${purpose})
  `;
  await db.sql`
    INSERT INTO admin_auth_challenges
      (token_hash, purpose, account_id, email, full_name, username, password_hash,
       code_hash, expires_at, resend_after)
    VALUES (${hash(challengeToken)}, ${purpose}, ${accountId}, ${email}, ${fullName},
      ${username}, ${passwordHash}, ${codeHash}, CURRENT_TIMESTAMP + INTERVAL '10 minutes',
      CURRENT_TIMESTAMP + INTERVAL '60 seconds')
  `;
  if (shouldSendEmail) {
    try {
      await sendCode(email, code, purpose);
    } catch (cause) {
      await db.sql`DELETE FROM admin_auth_challenges WHERE token_hash = ${hash(challengeToken)}`;
      throw cause;
    }
  }
  return { challenge_token: challengeToken, resend_after: 60 };
}

async function verifyChallenge(db, challengeToken, code, request) {
  if (!/^[a-f0-9]{64}$/.test(challengeToken) || !/^[0-9]{6}$/.test(code)) {
    throw Object.assign(new Error('Enter the six-digit verification code.'), { status: 400 });
  }
  const { rows } = await db.sql`
    SELECT * FROM admin_auth_challenges
    WHERE token_hash = ${hash(challengeToken)} AND expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `;
  const challenge = rows[0];
  if (!challenge) throw Object.assign(new Error('This verification request is invalid or has expired. Start again.'), { status: 400 });
  if (Number(challenge.attempts) >= 5) {
    await db.sql`DELETE FROM admin_auth_challenges WHERE id = ${challenge.id}`;
    throw Object.assign(new Error('Too many incorrect codes. Start the request again.'), { status: 429 });
  }
  if (!(await bcrypt.compare(code, challenge.code_hash))) {
    const attempts = Number(challenge.attempts) + 1;
    if (attempts >= 5) await db.sql`DELETE FROM admin_auth_challenges WHERE id = ${challenge.id}`;
    else await db.sql`UPDATE admin_auth_challenges SET attempts = ${attempts} WHERE id = ${challenge.id}`;
    await recordAttempt(db, request);
    throw Object.assign(new Error(attempts >= 5
      ? 'Too many incorrect codes. Start the request again.'
      : 'That code is incorrect. Check your email and try again.'), { status: attempts >= 5 ? 429 : 400 });
  }
  return challenge;
}

function responseWithSession(response, data, session, status = 200, origin = '') {
  const headers = { 'Set-Cookie': cookieHeader(session.token) };
  return response({ ok: true, data }, status, origin, headers);
}

export async function authorizeRequest(db, request, minimumRole = 'editor') {
  const session = await loadSession(db, request);
  const user = await requireAdmin(db, session, minimumRole);
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    await requireCsrf(db, request, session);
  }
  return user;
}

export async function handleAuthRequest({ request, resource, db, origin, response, error }) {
  if (!resource.startsWith('auth/')) return null;
  const method = request.method.toUpperCase();
  let session = null;
  try {
    session = await loadSession(db, request);
    if (method === 'GET' && resource === 'auth/csrf') {
      if (!session) session = await createSession(db, {});
      return responseWithSession(response, { token: session.csrf }, session, 200, origin);
    }
    if (method === 'GET' && resource === 'auth/login-status') {
      const { rows } = await db.sql`SELECT COUNT(*)::integer AS count FROM admin_users WHERE role = 'admin' AND active = TRUE`;
      return response({ ok: true, data: { configured: Number(rows[0]?.count || 0) > 0 } }, 200, origin);
    }
    if (method === 'GET' && resource === 'auth/me') {
      if (!session) session = await createSession(db, {});
      const user = await authenticatedUser(db, session);
      return responseWithSession(response, { user: user ? publicUser(user) : null, csrf: session.csrf }, session, 200, origin);
    }
    if (method === 'GET' && resource === 'auth/entry') {
      if (!session) session = await createSession(db, {});
      const user = await authenticatedUser(db, session);
      return responseWithSession(response, { role: user ? 'admin' : session.payload.visitor || null }, session, 200, origin);
    }
    if (method === 'GET' && resource === 'auth/google-config') {
      return response({ ok: true, data: { client_id: '', nonce: '' } }, 200, origin);
    }
    if (method === 'GET' && resource === 'auth/setup') {
      const { rows } = await db.sql`
        SELECT (
          NOT EXISTS (SELECT 1 FROM admin_users WHERE role = 'admin')
          AND NOT EXISTS (
            SELECT 1 FROM admin_setup_state WHERE id = 1 AND completed_at IS NOT NULL
          )
        ) AS available
      `;
      return response({ ok: true, data: { available: Boolean(rows[0]?.available) && (process.env.INITIAL_ADMIN_SETUP_TOKEN || '').length >= 32 } }, 200, origin);
    }
    if (method === 'POST' && resource === 'auth/login') {
      await requireCsrf(db, request, session);
      await rateLimit(db, request);
      const body = await bodyJson(request);
      const username = String(body.username || '').trim();
      const password = typeof body.password === 'string' ? body.password : '';
      const { rows } = await db.sql`
        SELECT id, full_name, username, email, password_hash, role, active
        FROM admin_users WHERE username = ${username} OR email = ${username.toLowerCase()}
        LIMIT 1
      `;
      const user = rows[0];
      if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
        await recordAttempt(db, request);
        throw Object.assign(new Error('Invalid username or password.'), { status: 401 });
      }
      const next = await createSession(db, { userId: Number(user.id) }, session.tokenHash);
      await db.sql`
        DELETE FROM login_attempts WHERE ip_hash = ${hash(request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-real-ip') || 'unknown')}
      `;
      return responseWithSession(response, { user: publicUser(user), csrf: next.csrf }, next, 200, origin);
    }
    if (method === 'POST' && resource === 'auth/logout') {
      await requireAdmin(db, session);
      await requireCsrf(db, request, session);
      await db.sql`DELETE FROM app_sessions WHERE token_hash = ${session.tokenHash}`;
      return response({ ok: true, data: { logged_out: true } }, 200, origin, { 'Set-Cookie': cookieHeader('', true) });
    }
    if (method === 'POST' && resource === 'auth/entry') {
      await requireCsrf(db, request, session);
      if (!session) throw Object.assign(new Error('A secure browser session is required.'), { status: 401 });
      const body = await bodyJson(request);
      if (body.role !== 'visitor') throw Object.assign(new Error('Invalid entry role.'), { status: 400 });
      const user = await authenticatedUser(db, session);
      session.payload.visitor = user ? undefined : 'visitor';
      await db.sql`UPDATE app_sessions SET payload = ${JSON.stringify(session.payload)}::jsonb WHERE token_hash = ${session.tokenHash}`;
      return responseWithSession(response, { role: user ? 'admin' : 'visitor' }, session, 200, origin);
    }
    if (method === 'POST' && resource === 'auth/register') {
      await requireCsrf(db, request, session);
      await rateLimit(db, request);
      const body = await bodyJson(request);
      const fullName = String(body.full_name || body.username || '').trim();
      const username = String(body.username || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username)) throw Object.assign(new Error('Username must be 3–80 characters using letters, numbers, dots, underscores, or hyphens.'), { status: 400 });
      if (!validEmail(email)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
      if (!validPassword(password)) throw Object.assign(new Error('Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.'), { status: 400 });
      if (fullName.length > 160) throw Object.assign(new Error('Enter a name up to 160 characters.'), { status: 400 });
      const duplicate = await db.sql`
        SELECT id FROM admin_users WHERE username = ${username} OR email = ${email} LIMIT 1
      `;
      if (duplicate.rows[0]) throw Object.assign(new Error('That username or email is already registered.'), { status: 409 });
      const passwordHash = await bcrypt.hash(password, 12);
      const challenge = await newChallenge(db, { purpose: 'signup', email, fullName, username, passwordHash });
      await recordAttempt(db, request);
      return response({ ok: true, data: challenge }, 201, origin);
    }
    if (method === 'POST' && resource === 'auth/recover') {
      await requireCsrf(db, request, session);
      await rateLimit(db, request);
      const body = await bodyJson(request);
      const email = String(body.email || '').trim().toLowerCase();
      if (!validEmail(email)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
      const { rows } = await db.sql`SELECT id FROM admin_users WHERE email = ${email} AND active = TRUE LIMIT 1`;
      const challenge = await newChallenge(db, {
        purpose: 'password_reset',
        email,
        accountId: rows[0]?.id || null,
        sendEmail: Boolean(rows[0]?.id),
      });
      await recordAttempt(db, request);
      return response({
        ok: true,
        data: { ...challenge, message: 'If an active account matches that email, a verification code will be sent.' },
      }, 200, origin);
    }
    if (method === 'POST' && resource === 'auth/resend-code') {
      await requireCsrf(db, request, session);
      await rateLimit(db, request);
      const body = await bodyJson(request);
      const token = String(body.challenge_token || '');
      if (!/^[a-f0-9]{64}$/.test(token)) throw Object.assign(new Error('This verification request is invalid or has expired.'), { status: 400 });
      const { rows } = await db.sql`
        SELECT * FROM admin_auth_challenges
        WHERE token_hash = ${hash(token)} AND expires_at > CURRENT_TIMESTAMP LIMIT 1
      `;
      const challenge = rows[0];
      if (!challenge) throw Object.assign(new Error('This verification request is invalid or has expired.'), { status: 400 });
      if (new Date(challenge.resend_after).getTime() > Date.now()) {
        throw Object.assign(new Error('Please wait before requesting another code.'), { status: 429 });
      }
      const code = String(randomInt(100000, 1000000));
      const codeHash = await bcrypt.hash(code, 12);
      if (challenge.purpose === 'signup' || challenge.account_id) {
        await sendCode(challenge.email, code, challenge.purpose);
      }
      await db.sql`
        UPDATE admin_auth_challenges SET code_hash = ${codeHash},
          resend_after = CURRENT_TIMESTAMP + INTERVAL '60 seconds', attempts = 0
        WHERE id = ${challenge.id}
      `;
      await recordAttempt(db, request);
      return response({ ok: true, data: { resend_after: 60 } }, 200, origin);
    }
    if (method === 'POST' && resource === 'auth/verify-code') {
      await requireCsrf(db, request, session);
      await rateLimit(db, request);
      const body = await bodyJson(request);
      const challenge = await verifyChallenge(db, String(body.challenge_token || ''), String(body.code || ''), request);
      if (challenge.purpose === 'signup') {
        const { rows } = await db.sql`
          WITH consumed AS (
            DELETE FROM admin_auth_challenges
            WHERE id = ${challenge.id} AND token_hash = ${hash(String(body.challenge_token))}
            RETURNING full_name, username, email, password_hash
          )
          INSERT INTO admin_users (full_name, username, email, password_hash,
            email_verified_at, role, active)
          SELECT full_name, username, email, password_hash, CURRENT_TIMESTAMP, 'editor', FALSE
          FROM consumed RETURNING id
        `;
        if (!rows[0]) throw Object.assign(new Error('This verification request has already been used.'), { status: 409 });
        await recordAttempt(db, request);
        return response({ ok: true, data: { registered: true, pending_approval: true } }, 200, origin);
      }
      if (!validPassword(String(body.password || ''))) {
        throw Object.assign(new Error('Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.'), { status: 400 });
      }
      if (!challenge.account_id) {
        await db.sql`DELETE FROM admin_auth_challenges WHERE id = ${challenge.id}`;
        await recordAttempt(db, request);
        return response({ ok: true, data: { password_reset: true } }, 200, origin);
      }
      const passwordHash = await bcrypt.hash(String(body.password), 12);
      const { rows } = await db.sql`
        WITH consumed AS (
          DELETE FROM admin_auth_challenges
          WHERE id = ${challenge.id} AND token_hash = ${hash(String(body.challenge_token))}
          RETURNING account_id
        )
        UPDATE admin_users SET password_hash = ${passwordHash}
        WHERE id = (SELECT account_id FROM consumed) AND active = TRUE
        RETURNING id
      `;
      if (!rows[0]) throw Object.assign(new Error('This account is no longer active. Contact an administrator for help.'), { status: 403 });
      await db.sql`DELETE FROM app_sessions WHERE payload->>'userId' = ${String(rows[0].id)}`;
      await recordAttempt(db, request);
      return response({ ok: true, data: { password_reset: true } }, 200, origin);
    }
    if (method === 'POST' && resource === 'auth/setup') {
      await requireCsrf(db, request, session);
      await rateLimit(db, request);
      const setupToken = process.env.INITIAL_ADMIN_SETUP_TOKEN || '';
      if (setupToken.length < 32) throw Object.assign(new Error('One-time administrator setup is not configured on the server.'), { status: 503 });
      const body = await bodyJson(request);
      if (typeof body.setup_key !== 'string' || !equalHash(hash(body.setup_key), hash(setupToken))) {
        await recordAttempt(db, request);
        throw Object.assign(new Error('The setup secret is incorrect.'), { status: 403 });
      }
      const fullName = String(body.full_name || '').trim();
      const username = String(body.username || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      if (!fullName || fullName.length > 160) throw Object.assign(new Error('Enter a name up to 160 characters.'), { status: 400 });
      if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username)) throw Object.assign(new Error('Enter a valid administrator username.'), { status: 400 });
      if (!validEmail(email) || !validPassword(password)) throw Object.assign(new Error('Enter a valid email and a password that meets the security requirements.'), { status: 400 });
      const passwordHash = await bcrypt.hash(password, 12);
      const { rows } = await db.sql`
        WITH state_insert AS (
          INSERT INTO admin_setup_state (id, completed_at) VALUES (1, NULL)
          ON CONFLICT (id) DO NOTHING
          RETURNING id, completed_at
        ), state_source AS (
          SELECT id, completed_at FROM admin_setup_state WHERE id = 1
          UNION ALL
          SELECT id, completed_at FROM state_insert
        ), lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(7923381001)
        ), eligible AS (
          SELECT s.id FROM state_source s, lock
          WHERE s.id = 1 AND s.completed_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM admin_users WHERE role = 'admin')
        ), created AS (
          INSERT INTO admin_users (full_name, username, email, password_hash, role, active)
          SELECT ${fullName}, ${username}, ${email}, ${passwordHash}, 'admin', TRUE FROM eligible
          RETURNING id
        ), completed AS (
          UPDATE admin_setup_state SET completed_at = CURRENT_TIMESTAMP
          WHERE id = 1 AND EXISTS (SELECT 1 FROM created)
          RETURNING id
        )
        SELECT created.id FROM created JOIN completed ON TRUE
      `;
      if (!rows[0]) throw Object.assign(new Error('Administrator setup has already been completed or is unavailable.'), { status: 409 });
      const next = await createSession(db, { userId: Number(rows[0].id) }, session?.tokenHash || null);
      return responseWithSession(response, { created: true, csrf: next.csrf }, next, 201, origin);
    }
    if (resource === 'auth/google') {
      return error('Google sign-in is not yet migrated. Use email and password.', 501, origin);
    }
    if (resource === 'auth/profile' && method === 'GET') {
      const user = await requireAdmin(db, session);
      return response({ ok: true, data: publicUser(user) }, 200, origin);
    }
    if (resource === 'auth/profile' && method === 'PUT') {
      const user = await requireAdmin(db, session);
      await requireCsrf(db, request, session);
      const body = await bodyJson(request);
      const fullName = String(body.full_name || '').trim();
      const username = String(body.username || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      if (!fullName || fullName.length > 160) throw Object.assign(new Error('Enter a name up to 160 characters.'), { status: 400 });
      if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username) || !validEmail(email)) {
        throw Object.assign(new Error('Enter a valid username and email address.'), { status: 400 });
      }
      const { rows } = await db.sql`
        UPDATE admin_users SET full_name = ${fullName}, username = ${username}, email = ${email}
        WHERE id = ${user.id}
        RETURNING id, full_name, username, email, role
      `;
      return response({ ok: true, data: publicUser(rows[0]) }, 200, origin);
    }
    if (resource === 'auth/password' && method === 'POST') {
      const user = await requireAdmin(db, session);
      await requireCsrf(db, request, session);
      const body = await bodyJson(request);
      const { rows } = await db.sql`SELECT password_hash FROM admin_users WHERE id = ${user.id}`;
      if (!(await bcrypt.compare(String(body.current_password || ''), rows[0]?.password_hash || ''))) {
        throw Object.assign(new Error('The current password is incorrect.'), { status: 400 });
      }
      if (!validPassword(String(body.password || ''))) {
        throw Object.assign(new Error('Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.'), { status: 400 });
      }
      const passwordHash = await bcrypt.hash(body.password, 12);
      await db.sql`UPDATE admin_users SET password_hash = ${passwordHash} WHERE id = ${user.id}`;
      await db.sql`DELETE FROM app_sessions WHERE payload->>'userId' = ${String(user.id)} AND token_hash <> ${session.tokenHash}`;
      return response({ ok: true, data: { password_changed: true } }, 200, origin);
    }
    if (resource.startsWith('auth/')) return error('Authentication operation not found or not yet migrated.', 501, origin);
    return null;
  } catch (cause) {
    if (cause?.status) return error(cause.message, cause.status, origin);
    if (cause?.code === '23505') return error('That username or email is already registered.', 409, origin);
    console.error(`NaviGATE authentication request failed for ${resource}:`, cause);
    return error('The authentication request could not be completed.', 503, origin);
  }
}
