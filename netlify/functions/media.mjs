import { getStore } from '@netlify/blobs';

const allowedExtensions = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['pdf', 'application/pdf'],
]);

export default async function handler(request) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const url = new URL(request.url);
  const key = url.pathname.replace(/^\/(?:\.netlify\/functions\/media|uploads)\/?/, '');
  if (!/^(?:photos|floorplans)\/[a-f0-9]{48}\.(?:png|jpg|webp|pdf)$/.test(key)) {
    return new Response('File not found', { status: 404 });
  }
  const extension = key.split('.').pop();
  const contentType = allowedExtensions.get(extension);
  if (!contentType || (key.startsWith('photos/') && extension === 'pdf')) {
    return new Response('File not found', { status: 404 });
  }
  try {
    const file = await getStore('navigate-uploads').get(key, { type: 'arrayBuffer' });
    if (!file) return new Response('File not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : file, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(file.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (cause) {
    console.error(`NaviGATE file lookup failed for ${key}:`, cause);
    return new Response('File storage is unavailable', { status: 503 });
  }
}
