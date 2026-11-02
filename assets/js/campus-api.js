(() => {
  const path = location.pathname.toLowerCase();
  const prefix = path.includes('/pages/admin/') ? '../../' : path.includes('/pages/') ? '../' : './';
  const configuredApiBase = (window.CAMPUS_API_BASE_URL || '').trim();
  const endpoint = configuredApiBase
    ? `${configuredApiBase.replace(/\/+$/, '')}?resource=`
    : `${prefix}api/index.php?resource=`;
  const assetBase = configuredApiBase
    ? new URL('../', new URL(`${configuredApiBase.replace(/\/+$/, '')}/`, location.href))
    : new URL(prefix, location.href);
  let csrf = null;

  async function request(resource, options = {}) {
    const [resourcePath, query = ''] = resource.split('?');
    const headers = new Headers(options.headers || {});
    const method = (options.method || 'GET').toUpperCase();
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (!['GET', 'HEAD'].includes(method)) {
      if (!csrf) {
        const seed = await fetch(`${endpoint}auth/csrf`, { credentials: 'include' }).then(readJsonResponse);
        if (!seed.ok) throw new Error(seed.error?.message || 'Could not start a secure request.');
        csrf = seed.data.token;
      }
      headers.set('X-CSRF-Token', csrf);
    }
    let response;
    try {
      response = await fetch(`${endpoint}${encodeURIComponent(resourcePath)}${query ? `&${query}` : ''}`, { ...options, method, headers, body, credentials: 'include' });
    } catch {
      throw new Error('Could not reach the campus server. Check the internet connection and API deployment, then retry.');
    }
    const result = await readJsonResponse(response);
    if (!response.ok || !result.ok) {
      if (response.status === 419) csrf = null;
      throw new Error(result.error?.message || `Request failed (${response.status}).`);
    }
    if (result.data?.csrf) csrf = result.data.csrf;
    return result.data;
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    try { return JSON.parse(text); }
    catch {
      const isHtml = /(?:<!doctype\s+html|<html[\s>])/i.test(text.slice(0, 500));
      throw new Error(isHtml
        ? 'The campus API returned an HTML page. Check the API path and make sure Apache is serving the project folder.'
        : 'The campus server returned an invalid response. Try again or contact the administrator.');
    }
  }

  window.CampusApi = { request, assetUrl(path) { if (!path) return ''; const value = String(path); if (!configuredApiBase || !value.startsWith('uploads/')) return new URL(value.replace(/^\/+/, ''), assetBase).toString(); return new URL(value.slice('uploads/'.length), new URL('uploads/', assetBase)).toString(); }, async get(resource) { return request(resource); }, async save(resource, data, id = null) { return request(resource, { method: id ? 'PUT' : 'POST', body: id ? { ...data, id } : data }); }, async remove(resource, id) { return request(resource, { method: 'DELETE', body: { id } }); } };
})();
