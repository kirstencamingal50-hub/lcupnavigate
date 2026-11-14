import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Netlify logout revokes only the current Supabase refresh-token session', async () => {
  const api = await read('../netlify/functions/api.mjs');
  assert.match(api, /resource === 'auth\/logout'[\s\S]*?db\.auth\.admin\.signOut\(token, 'local'\)/);
  assert.match(api, /if \(error\)[\s\S]*?Your session could not be revoked/);
});

test('repository guidance protects the legacy deployment and production secrets', async () => {
  const instructions = await read('../AGENTS.md');
  assert.match(instructions, /original PHP\/MySQL\/XAMPP application/);
  assert.match(instructions, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(instructions, /real MySQL records and uploaded media/);
});
