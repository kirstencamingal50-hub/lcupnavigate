import { cp, copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'dist');

await mkdir(output, { recursive: true });
await copyFile(resolve(root, 'index.html'), resolve(output, 'index.html'));

for (const directory of ['assets', 'data', 'pages']) {
  await cp(resolve(root, directory), resolve(output, directory), {
    recursive: true,
    force: true
  });
}

console.log('Prepared Netlify static site without PHP sources, local configuration, or local uploads.');
