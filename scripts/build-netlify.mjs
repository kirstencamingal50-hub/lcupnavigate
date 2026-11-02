import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ['index.html', 'assets', 'pages']) {
  await cp(path.join(root, entry), path.join(output, entry), { recursive: true });
}

console.log('Prepared static frontend in dist/. The API URL remains on the existing PHP path until parity testing is complete.');
