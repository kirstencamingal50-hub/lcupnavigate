
import {
  cp,
  copyFile,
  mkdir,
  rm
} from 'node:fs/promises';

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'dist');

// Remove old build files so unrelated files are not published.
await rm(output, {
  recursive: true,
  force: true
});

// Create a clean deployment folder.
await mkdir(output, {
  recursive: true
});

// Copy the main page.
await copyFile(
  resolve(root, 'index.html'),
  resolve(output, 'index.html')
);

// Copy only the frontend folders required by NaviGATE.
for (const directory of ['assets', 'data', 'pages']) {
  await cp(
    resolve(root, directory),
    resolve(output, directory),
    {
      recursive: true,
      force: true
    }
  );
}

// Fail the deployment if the public admin login page is missing from the publish folder.
const adminLoginPage = resolve(output, 'pages/admin/login.html');
await access(adminLoginPage);

console.log('Verified publish file: pages/admin/login.html');
console.log('NaviGATE Netlify build completed.');
