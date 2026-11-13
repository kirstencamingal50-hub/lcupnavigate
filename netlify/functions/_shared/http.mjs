export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(payload)
  };
}

export function success(data, statusCode = 200) {
  return jsonResponse(statusCode, { ok: true, data });
}

export function errorResponse(error) {
  if (error instanceof HttpError) {
    return jsonResponse(error.statusCode, {
      ok: false,
      error: { message: error.message }
    });
  }
  console.error('NaviGATE function failed:', error);
  return jsonResponse(500, {
    ok: false,
    error: { message: 'The request could not be completed.' }
  });
}

export function requestBody(event) {
  if (!event.body) return {};
  try {
    const body = JSON.parse(event.body);
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      throw new HttpError(400, 'Request body must be a JSON object.');
    }
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export function requireMethod(event, methods) {
  if (!methods.includes(event.httpMethod)) {
    throw new HttpError(405, 'Method not allowed.');
  }
}

export function positiveId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, `A valid ${field} is required.`);
  }
  return id;
}

export function requiredText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new HttpError(400, `${field} exceeds ${maxLength} characters.`);
  }
  return text;
}

export function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new HttpError(400, `${field} is invalid or exceeds ${maxLength} characters.`);
  }
  return value.trim() || null;
}

export function unwrap(result) {
  if (result.error) {
    const code = result.error.code;
    if (code === '23505') throw new HttpError(409, 'The change conflicts with an existing record.');
    if (code === '23503' || code === '23514') {
      throw new HttpError(409, 'The change conflicts with an existing record or relationship.');
    }
    if (code === 'PGRST116') throw new HttpError(404, 'The requested record was not found.');
    throw result.error;
  }
  return result.data;
}
