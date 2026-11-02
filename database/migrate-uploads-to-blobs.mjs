import { getStore } from '@netlify/blobs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteID = process.env.NETLIFY_SITE_ID;
const token = process.env.NETLIFY_AUTH_TOKEN;

if (!siteID || !token) {
  throw new Error('Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in the migration process environment.');
}

const store = getStore('navigate-uploads', { siteID, token });
const mimeTypes = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['pdf', 'application/pdf'],
]);

async function filesIn(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await filesIn(fullPath));
      else if (entry.isFile()) files.push(fullPath);
    }
    return files;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

for (const category of ['photos', 'floorplans']) {
  const directory = path.join(root, 'uploads', category);
  for (const filePath of await filesIn(directory)) {
    const filename = path.basename(filePath);
    if (filename === '.htaccess') continue;
    if (!/^[a-f0-9]{48}\.(?:png|jpg|webp|pdf)$/.test(filename)) {
      throw new Error(`Unexpected upload filename; refusing to copy: ${path.relative(root, filePath)}`);
    }
    const extension = filename.split('.').pop();
    const contentType = mimeTypes.get(extension);
    if (category === 'photos' && extension === 'pdf') {
      throw new Error(`PDF found in photo storage; refusing to copy: ${path.relative(root, filePath)}`);
    }
    const fileStat = await stat(filePath);
    const maxBytes = category === 'photos' ? 5 * 1024 * 1024 : 15 * 1024 * 1024;
    if (fileStat.size > maxBytes) {
      throw new Error(`Upload exceeds the existing API size limit: ${path.relative(root, filePath)}`);
    }
    const key = `${category}/${filename}`;
    await store.set(key, new Blob([await readFile(filePath)], { type: contentType }), { metadata: { contentType } });
    console.log(`Copied ${key} (${fileStat.size} bytes)`);
  }
}

console.log('Upload file transfer finished. Verify the files through the deployed /uploads/* reader before switching frontend traffic.');
