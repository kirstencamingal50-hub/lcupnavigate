(() => {
  const path = location.pathname.toLowerCase();
  const prefix = path.includes('/pages/admin/') ? '../../' : path.includes('/pages/') ? '../' : './';
  const endpoint = `${prefix}api/index.php?resource=`;
  const tokenKey = 'navigatorate.supabase.session';
  let csrf = null;
  let backendPromise = null;
  let supabaseConfig = null;

  function readSession() {
    try {
      const session = JSON.parse(localStorage.getItem(tokenKey) || 'null');
      return session && typeof session.access_token === 'string' ? session : null;
    } catch (error) {
      console.warn('The saved administrator session could not be read.', error);
      return null;
    }
  }

  function saveSession(session) {
    try {
      localStorage.setItem(tokenKey, JSON.stringify(session));
    } catch (error) {
      console.error('The administrator session could not be saved.', error);
      throw new Error('Your browser could not save the sign-in session. Check its storage settings and try again.');
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(tokenKey);
    } catch (error) {
      console.error('The administrator session could not be cleared.', error);
    }
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      const isHtml = /(?:<!doctype\s+html|<html[\s>])/i.test(text.slice(0, 500));
      throw new Error(isHtml
        ? 'The campus API returned an HTML page. Check the API route and hosting configuration.'
        : 'The campus server returned an invalid response. Try again or contact the administrator.');
    }
  }

  async function backend() {
    if (!backendPromise) {
      backendPromise = (async () => {
        let response;
        try {
          response = await fetch(`${endpoint}client-config`, { credentials: 'same-origin' });
        } catch {
          throw new Error('Could not reach the campus server. Check your connection and retry.');
        }
        const result = await readJsonResponse(response);
        if (response.ok && result.ok && result.data?.url && result.data?.anonKey) {
          supabaseConfig = result.data;
          return 'netlify';
        }
        if ((response.status === 404 && result.error?.message === 'API resource not found.') ||
            (response.status === 401 && result.error?.message === 'Administrator sign-in is required.')) {
          return 'php';
        }
        throw new Error(result.error?.message || `The campus API could not be configured (${response.status}).`);
      })();
    }
    return backendPromise;
  }

  async function refreshSession() {
    const session = readSession();
    if (!session?.refresh_token) return false;
    const response = await fetch(`${endpoint}auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
      credentials: 'same-origin'
    });
    const result = await readJsonResponse(response);
    if (!response.ok || !result.ok || !result.data?.access_token) {
      clearSession();
      return false;
    }
    saveSession(result.data);
    return true;
  }

  async function uploadToStorage(formData) {
    const file = formData.get('file');
    if (!(file instanceof File)) throw new Error('Choose a file to upload.');
    const isPlan = formData.get('type') === 'floorplan';
    const maxSize = isPlan ? 15 * 1024 * 1024 : 5 * 1024 * 1024;
    const allowed = isPlan
      ? ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
      : ['image/png', 'image/jpeg', 'image/webp'];
    if (file.size > maxSize) throw new Error(isPlan ? 'Floor plans must be 15 MB or smaller.' : 'Images must be 5 MB or smaller.');
    if (!allowed.includes(file.type)) throw new Error('Unsupported file type.');

    const session = readSession();
    if (!session?.access_token) throw new Error('Administrator sign-in is required to upload files.');
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const storagePath = `${crypto.randomUUID()}.${extension}`;
    const bucket = isPlan ? 'floor-plans' : 'campus-photos';
    const uploadUrl = `${supabaseConfig.url}/storage/v1/object/${bucket}/${encodeURIComponent(storagePath)}`;
    let response;
    try {
      response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          apikey: supabaseConfig.anonKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': file.type,
          'x-upsert': 'false'
        },
        body: file
      });
    } catch {
      throw new Error('Could not reach Supabase Storage. Check the Supabase project and allowed origins.');
    }
    if (!response.ok) {
      const result = await readJsonResponse(response);
      throw new Error(result.message || result.error || `File upload failed (${response.status}).`);
    }

    const metadata = {
      type: isPlan ? 'floorplan' : 'photo',
      object_path: storagePath,
      original_name: file.name,
      mime_type: file.type,
      file_size: file.size,
      building_id: formData.get('building_id'),
      floor_number: formData.get('floor_number')
    };
    try {
      return await request('uploads', { method: 'POST', body: metadata });
    } catch (error) {
      await fetch(`${supabaseConfig.url}/storage/v1/object/${bucket}/${encodeURIComponent(storagePath)}`, {
        method: 'DELETE',
        headers: {
          apikey: supabaseConfig.anonKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefixes: [storagePath] })
      }).catch(cleanupError => console.error('Uploaded file cleanup failed.', cleanupError));
      throw error;
    }
  }

  async function request(resource, options = {}, canRefresh = true) {
    if (resource === 'uploads' && options.body instanceof FormData && (await backend()) === 'netlify') {
      return uploadToStorage(options.body);
    }

    const mode = await backend();
    const [resourcePath, query = ''] = resource.split('?');
    const headers = new Headers(options.headers || {});
    const method = (options.method || 'GET').toUpperCase();
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (mode === 'php' && !['GET', 'HEAD'].includes(method)) {
      if (!csrf) {
        const seedResponse = await fetch(`${endpoint}auth/csrf`, { credentials: 'same-origin' });
        const seed = await readJsonResponse(seedResponse);
        if (!seedResponse.ok || !seed.ok) throw new Error(seed.error?.message || 'Could not start a secure request.');
        csrf = seed.data.token;
      }
      headers.set('X-CSRF-Token', csrf);
    } else if (mode === 'netlify') {
      const session = readSession();
      if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
    }

    let response;
    try {
      response = await fetch(`${endpoint}${encodeURIComponent(resourcePath)}${query ? `&${query}` : ''}`, {
        ...options,
        method,
        headers,
        body,
        credentials: 'same-origin'
      });
    } catch {
      throw new Error(mode === 'php'
        ? 'Could not reach the campus server. Check that Apache and MySQL are running, then retry.'
        : 'Could not reach the campus server. Check your connection and retry.');
    }

    if (mode === 'netlify' && response.status === 401 && canRefresh && await refreshSession()) {
      return request(resource, options, false);
    }

    const result = await readJsonResponse(response);
    if (!response.ok || !result.ok) {
      if (response.status === 419) csrf = null;
      throw new Error(result.error?.message || `Request failed (${response.status}).`);
    }
    const data = result.data;
    if (mode === 'netlify' && data?.access_token && data?.refresh_token) saveSession(data);
    if (mode === 'netlify' && resource === 'auth/logout') clearSession();
    if (data?.csrf) csrf = data.csrf;
    return data;
  }

  window.CampusApi = {
    request,
    async isNetlify() { return (await backend()) === 'netlify'; },
    async get(resource) { return request(resource); },
    async save(resource, data, id = null) {
      return request(resource, { method: id ? 'PUT' : 'POST', body: id ? { ...data, id } : data });
    },
    async remove(resource, id) { return request(resource, { method: 'DELETE', body: { id } }); }
  };
})();
