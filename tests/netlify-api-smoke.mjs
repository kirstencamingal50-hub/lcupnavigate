import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { access, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import api from '../netlify/functions/api.mjs';
import media from '../netlify/functions/media.mjs';
import { handleAuthRequest } from '../netlify/functions/auth.mjs';
import { handleCrudRequest } from '../netlify/functions/crud.mjs';

const originalOrigins = process.env.ALLOWED_ORIGINS;
const originalSiteOrigin = process.env.NETLIFY_SITE_ORIGIN;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brokenReferences = [];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  }));
  return files.flat();
}

async function assertLocalReference(sourceFile, reference) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return;
  const cleanReference = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  if (!cleanReference) return;
  const target = cleanReference.startsWith('/')
    ? path.join(root, 'dist', cleanReference.slice(1))
    : path.resolve(path.dirname(sourceFile), cleanReference);
  try {
    await access(target);
  } catch {
    brokenReferences.push(`${path.relative(root, sourceFile)}: ${reference}`);
  }
}

try {
  process.env.ALLOWED_ORIGINS = 'https://frontend.example.test';
  delete process.env.NETLIFY_SITE_ORIGIN;

  const preflight = await api(new Request('https://api.example.test/api', {
    method: 'OPTIONS',
    headers: { Origin: 'https://frontend.example.test' },
  }));
  assert.equal(preflight.status, 204, 'allowlisted CORS preflight should succeed');
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://frontend.example.test');

  const rejectedOrigin = await api(new Request('https://api.example.test/api?resource=auth/me', {
    headers: { Origin: 'https://untrusted.example.test' },
  }));
  assert.equal(rejectedOrigin.status, 403, 'unlisted CORS origins should be rejected');

  const mockDb = {
    sql: async () => ({ rows: [] }),
  };
  const authResponse = (data, status = 200, origin = '', headers = {}) => {
    const responseHeaders = new Headers({ 'Content-Type': 'application/json', ...headers });
    if (origin) responseHeaders.set('Access-Control-Allow-Origin', origin);
    return new Response(JSON.stringify(data), { status, headers: responseHeaders });
  };
  const authError = (message, status, origin) => authResponse({ ok: false, error: { message } }, status, origin);
  const csrfResponse = await handleAuthRequest({
    request: new Request('https://api.example.test/api?resource=auth/csrf'),
    resource: 'auth/csrf',
    db: mockDb,
    origin: '',
    response: authResponse,
    error: authError,
  });
  assert.equal(csrfResponse.status, 200, 'CSRF endpoint should create a server session');
  assert.match(csrfResponse.headers.get('Set-Cookie') || '', /HttpOnly; Secure; SameSite=Lax/);
  assert.match((await csrfResponse.json()).data.token, /^[a-f0-9]{64}$/);

  const unauthorizedProfile = await handleAuthRequest({
    request: new Request('https://api.example.test/api?resource=auth/profile'),
    resource: 'auth/profile',
    db: mockDb,
    origin: '',
    response: authResponse,
    error: authError,
  });
  assert.equal(unauthorizedProfile.status, 401, 'protected profile access must require a server session');

  const unauthorizedCategoryWrite = await handleCrudRequest({
    request: new Request('https://api.example.test/api?resource=categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized category' }),
    }),
    resource: 'categories',
    url: new URL('https://api.example.test/api?resource=categories'),
    db: mockDb,
    origin: '',
    response: authResponse,
    error: authError,
  });
  assert.equal(unauthorizedCategoryWrite.status, 401, 'category writes must reject unauthenticated callers');

  const editorCookie = randomBytes(32).toString('base64url');
  const editorCsrf = randomBytes(32).toString('hex');
  const editorDb = {
    sql: async (parts) => {
      const query = parts.join(' ');
      if (query.includes('SELECT token_hash, payload, csrf_hash')) {
        return { rows: [{
          token_hash: createHash('sha256').update(editorCookie).digest('hex'),
          payload: { userId: 7, csrf: editorCsrf },
          csrf_hash: createHash('sha256').update(editorCsrf).digest('hex'),
        }] };
      }
      if (query.includes('SELECT id, full_name, username, email, role, active')) {
        return { rows: [{ id: 7, full_name: 'Editor', username: 'editor', email: 'editor@example.test', role: 'editor', active: true }] };
      }
      return { rows: [] };
    },
  };
  const forbiddenCategoryWrite = await handleCrudRequest({
    request: new Request('https://api.example.test/api?resource=categories', {
      method: 'POST',
      headers: {
        Cookie: `__Host-NAVIGATE_SESSION=${editorCookie}`,
        'X-CSRF-Token': editorCsrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Editor category' }),
    }),
    resource: 'categories',
    url: new URL('https://api.example.test/api?resource=categories'),
    db: editorDb,
    origin: '',
    response: authResponse,
    error: authError,
  });
  assert.equal(forbiddenCategoryWrite.status, 403, 'category writes must require the admin role');

  const adminDb = {
    sql: async (parts) => {
      const query = parts.join(' ');
      if (query.includes('SELECT token_hash, payload, csrf_hash')) {
        return { rows: [{
          token_hash: createHash('sha256').update(editorCookie).digest('hex'),
          payload: { userId: 7, csrf: editorCsrf },
          csrf_hash: createHash('sha256').update(editorCsrf).digest('hex'),
        }] };
      }
      if (query.includes('SELECT id, full_name, username, email, role, active')) {
        return { rows: [{ id: 7, full_name: 'Admin', username: 'admin', email: 'admin@example.test', role: 'admin', active: true }] };
      }
      if (query.includes('INSERT INTO categories')) {
        return { rows: [{ id: 11, name: 'Student Services', slug: 'student-services', sort_order: 0 }] };
      }
      if (query.includes('INSERT INTO announcements')) return { rows: [{ id: 21 }] };
      return { rows: [] };
    },
  };
  const adminHeaders = {
    Cookie: `__Host-NAVIGATE_SESSION=${editorCookie}`,
    'X-CSRF-Token': editorCsrf,
    'Content-Type': 'application/json',
  };
  const categoryCreated = await handleCrudRequest({
    request: new Request('https://api.example.test/api?resource=categories', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'Student Services' }),
    }),
    resource: 'categories',
    url: new URL('https://api.example.test/api?resource=categories'),
    db: adminDb,
    origin: '',
    response: authResponse,
    error: authError,
  });
  assert.equal(categoryCreated.status, 201, 'admins should be able to create categories');

  const announcementCreated = await handleCrudRequest({
    request: new Request('https://api.example.test/api?resource=announcements', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ title: 'Campus update', details: 'Test announcement', status: 'draft' }),
    }),
    resource: 'announcements',
    url: new URL('https://api.example.test/api?resource=announcements'),
    db: adminDb,
    origin: '',
    response: authResponse,
    error: authError,
  });
  assert.equal(announcementCreated.status, 201, 'admins should be able to create announcements');

  const unsupportedWrite = await api(new Request('https://api.example.test/api?resource=locations', {
    method: 'POST',
    headers: { Origin: 'https://api.example.test', 'Content-Type': 'application/json' },
    body: '{}',
  }));
  assert.equal(unsupportedWrite.status, 501, 'write API must not imply CRUD is available');
  const unavailableRouteManagement = await api(new Request('https://api.example.test/api?resource=routes'));
  assert.equal(unavailableRouteManagement.status, 501, 'route administration should be explicitly unavailable');

  const invalidMediaKey = await media(new Request('https://api.example.test/uploads/../../secret.txt'));
  assert.equal(invalidMediaKey.status, 404, 'media handler should reject unsafe/unrecognized keys');

  const builtConfig = await (await import('node:fs/promises')).readFile('dist/assets/js/deployment-config.js', 'utf8');
  assert.match(builtConfig, /CAMPUS_API_BASE_URL = ''/, 'the build must not switch users to a partial API');
  assert.equal(typeof api, 'function', 'Netlify API Function must have a default handler export');
  assert.equal(typeof media, 'function', 'Netlify media Function must have a default handler export');
  for (const requiredFile of [
    'netlify/functions/api.mjs',
    'netlify/functions/media.mjs',
    'netlify/database/migrations/20261102143000_initial_schema.sql',
    'database/schema.sql',
    'database/migrate-mysql-to-postgres.mjs',
    'database/migrate-uploads-to-blobs.mjs',
    'tests/integration-smoke.php',
  ]) {
    await access(path.join(root, requiredFile));
  }
  for (const excludedPath of [
    'api',
    'database',
    'netlify',
    'node_modules',
    'backups',
    'uploads',
    '.env',
    '.env.example',
  ]) {
    await assert.rejects(access(path.join(root, 'dist', excludedPath)), `dist must exclude ${excludedPath}`);
  }

  const sourcePages = await filesUnder(path.join(root, 'pages'));
  const publishedPages = await filesUnder(path.join(root, 'dist', 'pages'));
  assert.deepEqual(
    publishedPages.map(file => path.relative(path.join(root, 'dist'), file)).sort(),
    sourcePages.map(file => path.relative(path.join(root, 'pages'), file)).sort().map(file => path.join('pages', file)).sort(),
    'the build should copy every source frontend page',
  );
  const publishedAssets = await filesUnder(path.join(root, 'dist', 'assets'));
  const sourceAssets = await filesUnder(path.join(root, 'assets'));
  assert.deepEqual(
    publishedAssets.map(file => path.relative(path.join(root, 'dist'), file)).sort(),
    sourceAssets.map(file => path.relative(path.join(root, 'assets'), file)).sort().map(file => path.join('assets', file)).sort(),
    'the build should copy every source frontend asset',
  );
  const forbiddenPublishedFiles = [
    path.join(root, 'dist', 'index.html'),
    ...publishedPages,
    ...publishedAssets,
  ].filter(file =>
    /(?:^|[\\/])\.env(?:\.|$)|\.(?:php|sql|pem|key|p12|pfx)$/i.test(file)
  );
  assert.deepEqual(forbiddenPublishedFiles, [], 'server-only files and credentials must not be copied to dist');
  for (const htmlFile of [path.join(root, 'dist', 'index.html'), ...publishedPages.filter(file => file.endsWith('.html'))]) {
    const html = (await readFile(htmlFile, 'utf8')).replace(/<script\b[\s\S]*?<\/script>/gi, '');
    for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      await assertLocalReference(htmlFile, match[1]);
    }
  }
  for (const cssFile of publishedAssets.filter(file => file.endsWith('.css'))) {
    const css = await readFile(cssFile, 'utf8');
    for (const match of css.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/gi)) {
      await assertLocalReference(cssFile, match[1].trim());
    }
  }
  assert.deepEqual(brokenReferences, [], 'all local frontend asset and page references should resolve');

  const apiClientSource = await readFile('assets/js/campus-api.js', 'utf8');
  const calls = [];
  const context = {
    window: { CAMPUS_API_BASE_URL: '/api' },
    location: { pathname: '/pages/directory.html', href: 'https://api.example.test/pages/directory.html' },
    Headers,
    FormData,
    URL,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ ok: true, data: [] });
    },
  };
  vm.runInNewContext(apiClientSource, context);
  assert.equal(context.window.CampusApi.assetUrl('uploads/photos/example.png'), 'https://api.example.test/uploads/photos/example.png');
  assert.equal(context.window.CampusApi.assetUrl('assets/images/map.svg'), 'https://api.example.test/assets/images/map.svg');
  await context.window.CampusApi.get('categories');
  assert.equal(calls[0].url, '/api?resource=categories');
  assert.equal(calls[0].options.credentials, 'include');

  console.log('PASS: Netlify API CORS, auth/role gates, category/announcement write paths, unavailable-operation, media-key, and frontend URL checks');
} finally {
  if (originalOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = originalOrigins;
  if (originalSiteOrigin === undefined) delete process.env.NETLIFY_SITE_ORIGIN;
  else process.env.NETLIFY_SITE_ORIGIN = originalSiteOrigin;
}
