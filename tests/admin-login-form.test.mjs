import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('admin login never falls back to a GET that exposes credentials in the URL', async () => {
  const html = await read('../pages/admin/login.html');
  const auth = await read('../assets/js/admin/admin-auth.js');
  const form = html.match(/<form id="login-form"[^>]*>/)?.[0];

  assert.ok(form, 'login form exists');
  assert.match(form, /\bmethod="post"/i);
  assert.doesNotMatch(form, /\bmethod="get"/i);

  const handlerIndex = auth.indexOf("loginForm.addEventListener('submit'");
  const bootstrapIndex = auth.indexOf("const state = await window.CampusApi.get('admin/bootstrap')");

  assert.notEqual(handlerIndex, -1, 'login submit handler exists');
  assert.notEqual(bootstrapIndex, -1, 'admin bootstrap check exists');
  assert.ok(
    handlerIndex < bootstrapIndex,
    'login handler is attached before the first awaited bootstrap request'
  );

  const handlerEnd = auth.indexOf('    });', handlerIndex);
  const handler = auth.slice(handlerIndex, handlerEnd + 7);
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.match(handler, /method:\s*'POST'/);
});
