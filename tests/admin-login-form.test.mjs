import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('admin login prevents credentials from being submitted in the URL', async () => {
  const html = await read('../pages/admin/login.html');
  const auth = await read('../assets/js/admin/admin-auth.js');
  const form = html.match(/<form id="login-form"[^>]*>/)?.[0];

  assert.ok(form, 'login form exists');
  assert.match(form, /\bmethod="post"/i);
  assert.doesNotMatch(form, /\bmethod="get"/i);

  const handlerIndex = auth.indexOf("loginForm.addEventListener('submit'");
  const bootstrapIndex = auth.indexOf("window.CampusApi.get('admin/bootstrap')");
  assert.notEqual(handlerIndex, -1, 'login handler exists');
  assert.notEqual(bootstrapIndex, -1, 'bootstrap request exists');
  assert.ok(handlerIndex < bootstrapIndex, 'login handler attaches before asynchronous bootstrap');

  const handler = auth.slice(handlerIndex, auth.indexOf('    });', handlerIndex) + 7);
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.match(handler, /method:\s*'POST'/);
});

test('signup and auth-view click handlers are registered outside the login submit callback', async () => {
  const auth = await read('../assets/js/admin/admin-auth.js');
  const loginHandler = auth.indexOf("loginForm.addEventListener('submit'");
  const signupHandler = auth.indexOf("signupForm.addEventListener('submit'");
  const viewHandler = auth.indexOf("document.querySelectorAll('[data-auth-view]')");
  const loginHandlerEnd = auth.indexOf("\n    });", loginHandler);

  assert.ok(loginHandler >= 0 && signupHandler >= 0 && viewHandler >= 0);
  assert.ok(loginHandlerEnd > loginHandler);
  assert.ok(signupHandler > loginHandlerEnd, 'signup handler must not be nested inside login submit');
  assert.ok(viewHandler > loginHandlerEnd, 'tab click handlers must not be nested inside login submit');
});
