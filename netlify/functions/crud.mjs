import { authorizeRequest } from './auth.mjs';

function failure(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) failure('A valid record ID is required.');
  return id;
}

function text(value, field, max, required = false) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) failure(`${field} is required.`);
  if (result.length > max) failure(`${field} exceeds ${max} characters.`);
  return result || null;
}

function imagePath(value) {
  const path = text(value, 'image_path', 255);
  if (path !== null && !/^uploads\/photos\/[a-f0-9]{48}\.(?:png|jpg|webp)$/.test(path)) {
    failure('Choose an image uploaded through the campus admin form.');
  }
  return path;
}

function nullableDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) failure(`${field} is not a valid date and time.`);
  return date.toISOString();
}

function booleanValue(value, field, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  failure(`${field} must be a boolean value.`);
}

async function writeAudit(db, request, user, action, entity, entityId, before, after) {
  const ip = request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-real-ip') || null;
  await db.sql`
    INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, before_json, after_json, ip_address)
    VALUES (${user.id}, ${action}, ${entity}, ${entityId},
      ${before ? JSON.stringify(before) : null}::jsonb,
      ${after ? JSON.stringify(after) : null}::jsonb, ${ip})
  `;
}

async function categoryRequest({ request, db, origin, response, error }) {
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'DELETE'].includes(method)) return null;
  try {
    const user = await authorizeRequest(db, request, 'admin');
    const body = await request.json();
    if (!body || Array.isArray(body) || typeof body !== 'object') failure('Request body must be a JSON object.');
    if (method === 'POST' || method === 'PUT') {
      const id = method === 'PUT' ? positiveId(body.id) : null;
      const name = text(body.name, 'name', 80, true);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let before = null;
      if (id) {
        const found = await db.sql`SELECT id, name, slug, sort_order FROM categories WHERE id = ${id}`;
        before = found.rows[0];
        if (!before) failure('Category not found.', 404);
      }
      const saved = id
        ? await db.sql`
            UPDATE categories SET name = ${name}, slug = ${slug}
            WHERE id = ${id} RETURNING id, name, slug, sort_order
          `
        : await db.sql`
            INSERT INTO categories (name, slug)
            VALUES (${name}, ${slug}) RETURNING id, name, slug, sort_order
          `;
      const category = saved.rows[0];
      await writeAudit(db, request, user, id ? 'update' : 'create', 'category', category.id, before, category);
      return response({ ok: true, data: { id: Number(category.id), name: category.name } }, id ? 200 : 201, origin);
    }

    const id = positiveId(body.id);
    const found = await db.sql`SELECT id, name, slug FROM categories WHERE id = ${id}`;
    const category = found.rows[0];
    if (!category) failure('Category not found.', 404);
    const used = await db.sql`
      SELECT (
        (SELECT COUNT(*) FROM locations WHERE category_id = ${id}) +
        (SELECT COUNT(*) FROM rooms WHERE category_id = ${id})
      )::integer AS count
    `;
    if (Number(used.rows[0]?.count || 0) > 0) {
      failure('Category is assigned to campus records and cannot be deleted.', 409);
    }
    await db.sql`DELETE FROM categories WHERE id = ${id}`;
    await writeAudit(db, request, user, 'delete', 'category', id, category, null);
    return response({ ok: true, data: { id } }, 200, origin);
  } catch (cause) {
    if (cause?.status) return error(cause.message, cause.status, origin);
    if (cause?.code === '23505') return error('A category with that name already exists.', 409, origin);
    if (cause instanceof SyntaxError) return error('Request body must be valid JSON.', 400, origin);
    console.error('NaviGATE category operation failed:', cause);
    return error('The category request could not be completed.', 503, origin);
  }
}

async function announcementRequest({ request, url, db, origin, response, error }) {
  const method = request.method.toUpperCase();
  const adminList = method === 'GET' && url.searchParams.has('admin');
  if (!['POST', 'PUT', 'DELETE'].includes(method) && !adminList) return null;
  try {
    const user = await authorizeRequest(db, request, 'editor');
    if (adminList) {
      const { rows } = await db.sql`
        SELECT id, title, body AS details, status, featured AS pinned,
          publish_at, event_start, event_end, location_id, image_path AS photo,
          created_at AS "createdAt"
        FROM announcements ORDER BY created_at DESC
      `;
      return response({ ok: true, data: rows }, 200, origin);
    }
    const body = await request.json();
    if (!body || Array.isArray(body) || typeof body !== 'object') failure('Request body must be a JSON object.');
    if (method === 'POST' || method === 'PUT') {
      const id = method === 'PUT' ? positiveId(body.id) : null;
      const title = text(body.title, 'title', 180, true);
      const details = text(body.details, 'details', 10000, true);
      const status = body.status || 'draft';
      if (!['draft', 'published', 'unpublished'].includes(status)) failure('Invalid announcement status.');
      const publishAt = nullableDate(body.publish_at, 'publish_at');
      const eventStart = nullableDate(body.event_start, 'event_start');
      const eventEnd = nullableDate(body.event_end, 'event_end');
      if (eventStart && eventEnd && new Date(eventEnd) < new Date(eventStart)) {
        failure('The event end time must follow its start time.');
      }
      const locationId = body.location_id === '' || body.location_id === null || body.location_id === undefined
        ? null : positiveId(body.location_id);
      if (locationId) {
        const location = await db.sql`SELECT id FROM locations WHERE id = ${locationId} AND active = TRUE`;
        if (!location.rows[0]) failure('Choose a valid campus location.');
      }
      const pinned = booleanValue(body.pinned, 'pinned');
      const photo = imagePath(body.photo ?? body.image_path);
      let before = null;
      if (id) {
        const found = await db.sql`SELECT * FROM announcements WHERE id = ${id}`;
        before = found.rows[0];
        if (!before) failure('Announcement not found.', 404);
      }
      const values = [title, details, status, publishAt, eventStart, eventEnd, locationId, pinned, photo];
      const saved = id
        ? await db.sql`
            UPDATE announcements SET title = ${values[0]}, body = ${values[1]},
              status = ${values[2]}, publish_at = ${values[3]}, event_start = ${values[4]},
              event_end = ${values[5]}, location_id = ${values[6]}, featured = ${values[7]},
              image_path = ${values[8]} WHERE id = ${id} RETURNING id
          `
        : await db.sql`
            INSERT INTO announcements
              (title, body, status, publish_at, event_start, event_end, location_id,
                featured, image_path, created_by)
            VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]},
              ${values[5]}, ${values[6]}, ${values[7]}, ${values[8]}, ${user.id})
            RETURNING id
          `;
      const savedId = Number(saved.rows[0]?.id);
      if (!savedId) failure('The announcement could not be saved.', 503);
      const after = { id: savedId, title, details, status, pinned, publish_at: publishAt, event_start: eventStart, event_end: eventEnd, location_id: locationId, photo };
      await writeAudit(db, request, user, id ? 'update' : 'create', 'announcement', savedId, before, after);
      return response({ ok: true, data: { id: savedId } }, id ? 200 : 201, origin);
    }

    const id = positiveId(body.id);
    const found = await db.sql`SELECT * FROM announcements WHERE id = ${id}`;
    if (!found.rows[0]) failure('Announcement not found.', 404);
    await db.sql`DELETE FROM announcements WHERE id = ${id}`;
    await writeAudit(db, request, user, 'delete', 'announcement', id, found.rows[0], null);
    return response({ ok: true, data: { id } }, 200, origin);
  } catch (cause) {
    if (cause?.status) return error(cause.message, cause.status, origin);
    if (cause?.code === '23505') return error('The announcement conflicts with an existing record.', 409, origin);
    if (cause instanceof SyntaxError) return error('Request body must be valid JSON.', 400, origin);
    console.error('NaviGATE announcement operation failed:', cause);
    return error('The announcement request could not be completed.', 503, origin);
  }
}

export async function handleCrudRequest(context) {
  if (context.resource === 'categories') return categoryRequest(context);
  if (context.resource === 'announcements') return announcementRequest(context);
  return null;
}
