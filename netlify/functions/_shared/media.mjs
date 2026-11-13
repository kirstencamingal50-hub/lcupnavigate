import { currentUser } from './authorization.mjs';
import { HttpError, jsonResponse, positiveId, requiredText, success, unwrap } from './http.mjs';
import { getServiceClient } from './supabase.mjs';

const db = () => getServiceClient();
const bucketNames = new Set(['campus-photos', 'floor-plans']);

export function mediaUrl(path) {
  const objectPath = storageObjectPath(path);
  return `/api/index.php?resource=media&path=${encodeURIComponent(objectPath)}`;
}

export function storageObjectPath(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('/api/index.php?')) {
    try {
      value = new URL(value, 'https://navigate.invalid').searchParams.get('path');
    } catch {
      return null;
    }
  }
  if (value.startsWith('uploads/photos/')) return null;
  const separator = value.indexOf('/');
  if (separator < 1) return null;
  const bucket = value.slice(0, separator);
  const name = value.slice(separator + 1);
  if (!bucketNames.has(bucket) || !/^[A-Za-z0-9._/-]{1,255}$/.test(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return `${bucket}/${name}`;
}

async function mediaIsPublic(bucket, name) {
  const database = db();
  if (bucket === 'floor-plans') {
    const plan = unwrap(await database.from('floor_plans')
      .select('id,verified,building:locations!floor_plans_building_id_fkey(active)')
      .eq('stored_name', name)
      .maybeSingle());
    return Boolean(plan?.verified && plan.building?.active);
  }
  const [locations, rooms, photos, announcements] = await Promise.all([
    database.from('locations').select('id').eq('image_path', `${bucket}/${name}`).eq('active', true).limit(1),
    database.from('rooms').select('id').eq('image_path', `${bucket}/${name}`).eq('active', true).limit(1),
    database.from('facility_photos').select('location_id,room_id').eq('image_path', `${bucket}/${name}`).limit(10),
    database.from('announcements').select('id').eq('image_path', `${bucket}/${name}`)
      .eq('status', 'published').or(`publish_at.is.null,publish_at.lte.${new Date().toISOString()}`).limit(1)
  ]);
  for (const result of [locations, rooms, photos, announcements]) if (result.error) throw result.error;
  if (locations.data?.length || rooms.data?.length || announcements.data?.length) return true;
  for (const photo of photos.data || []) {
    if (photo.location_id) {
      const location = unwrap(await database.from('locations').select('id').eq('id', photo.location_id).eq('active', true).maybeSingle());
      if (location) return true;
    } else if (photo.room_id) {
      const room = unwrap(await database.from('rooms').select('id,building:locations!rooms_building_id_fkey(active)').eq('id', photo.room_id).eq('active', true).maybeSingle());
      if (room?.building?.active) return true;
    }
  }
  return false;
}

export async function mediaHandler(event) {
  const objectPath = storageObjectPath(event.queryStringParameters?.path);
  if (!objectPath) throw new HttpError(400, 'A valid campus media path is required.');
  const separator = objectPath.indexOf('/');
  const bucket = objectPath.slice(0, separator);
  const name = objectPath.slice(separator + 1);
  const user = await currentUser(event, false, 'viewer');
  if (!user && !await mediaIsPublic(bucket, name)) {
    throw new HttpError(404, 'Campus media was not found or is not approved for public viewing.');
  }
  const result = await db().storage.from(bucket).createSignedUrl(name, 300);
  if (result.error) throw result.error;
  const target = new URL(result.data.signedUrl, process.env.SUPABASE_URL);
  return {
    statusCode: 302,
    headers: {
      'Cache-Control': 'private, no-store',
      Location: target.toString(),
      'X-Content-Type-Options': 'nosniff'
    },
    body: ''
  };
}

async function objectExists(bucket, name) {
  const result = await db().storage.from(bucket).list('', { limit: 100, search: name });
  if (result.error) throw result.error;
  return (result.data || []).some(item => item.name === name);
}

export async function uploadMetadata(event, body) {
  const user = await currentUser(event, true, 'editor');
  const type = body.type === 'floorplan' ? 'floorplan' : body.type === 'photo' ? 'photo' : null;
  if (!type) throw new HttpError(400, 'Choose a supported file type.');
  const bucket = type === 'floorplan' ? 'floor-plans' : 'campus-photos';
  const name = requiredText(body.object_path, 'Storage object path', 255);
  if (name.includes('/') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(name)) {
    throw new HttpError(400, 'The uploaded storage object path is invalid.');
  }
  const mimeType = requiredText(body.mime_type, 'MIME type', 100);
  const allowedTypes = type === 'floorplan'
    ? ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    : ['image/png', 'image/jpeg', 'image/webp'];
  const size = Number(body.file_size);
  const maximum = type === 'floorplan' ? 15 * 1024 * 1024 : 5 * 1024 * 1024;
  if (!allowedTypes.includes(mimeType) || !Number.isSafeInteger(size) || size < 1 || size > maximum) {
    throw new HttpError(400, 'The uploaded file type or size is not allowed.');
  }
  if (!await objectExists(bucket, name)) throw new HttpError(400, 'The uploaded file was not found in campus storage.');
  if (type === 'photo') return success({ path: `${bucket}/${name}` }, 201);

  const buildingId = positiveId(body.building_id, 'Building ID');
  const floorNumber = Number(body.floor_number);
  if (!Number.isSafeInteger(floorNumber) || floorNumber < 0 || floorNumber > 200) {
    throw new HttpError(400, 'Choose a valid floor number.');
  }
  const building = unwrap(await db().from('locations').select('id,kind,active')
    .eq('id', buildingId).maybeSingle());
  if (!building || building.kind !== 'building' || !building.active) {
    throw new HttpError(400, 'Choose a valid building for this floor plan.');
  }
  const record = unwrap(await db().from('floor_plans').insert({
    building_id: buildingId,
    floor_number: floorNumber,
    original_name: requiredText(body.original_name, 'File name', 255).replace(/[\\/]/g, '_'),
    stored_name: name,
    mime_type: mimeType,
    file_size: size,
    uploaded_by_legacy_admin_id: Number.isSafeInteger(Number(user.id)) ? Number(user.id) : null
  }).select('id').single());
  return success({ id: record.id, file_url: `${bucket}/${name}` }, 201);
}

export async function facilityPhotos(event, method, body, query) {
  const user = await currentUser(event, true, 'editor');
  const database = db();
  if (method === 'POST') {
    const ownerType = body.owner_type;
    if (!['location', 'room'].includes(ownerType)) throw new HttpError(400, 'Invalid photo record type.');
    const ownerId = positiveId(body.owner_id, 'Record ID');
    const ownerTable = ownerType === 'location' ? 'locations' : 'rooms';
    const owner = unwrap(await database.from(ownerTable).select('id,image_path,active')
      .eq('id', ownerId).eq('active', true).maybeSingle());
    if (!owner) throw new HttpError(404, 'Campus record not found.');
    const path = storageObjectPath(body.image_path);
    if (!path || !path.startsWith('campus-photos/') || !await objectExists('campus-photos', path.slice('campus-photos/'.length))) {
      throw new HttpError(400, 'Choose a photo uploaded through the campus admin form.');
    }
    const alt = requiredText(body.alt_text, 'Alternative text', 255);
    const photos = unwrap(await database.from('facility_photos')
      .select('id')
      .eq(ownerType === 'location' ? 'location_id' : 'room_id', ownerId)) || [];
    const cover = body.is_cover === undefined ? photos.length === 0 : Boolean(body.is_cover);
    if (cover) unwrap(await database.from('facility_photos')
      .update({ is_cover: false })
      .eq(ownerType === 'location' ? 'location_id' : 'room_id', ownerId));
    const record = unwrap(await database.from('facility_photos').insert({
      location_id: ownerType === 'location' ? ownerId : null,
      room_id: ownerType === 'room' ? ownerId : null,
      image_path: path,
      alt_text: alt,
      caption: optionalText(body.caption, 'Caption', 255),
      sort_order: Math.max(0, Math.min(65535, Number(body.sort_order) || photos.length)),
      is_cover: cover
    }).select('id').single());
    if (cover || !owner.image_path) unwrap(await database.from(ownerTable).update({ image_path: path }).eq('id', ownerId));
    return success({ id: record.id }, 201);
  }

  if (method === 'PUT') {
    const id = positiveId(body.id ?? query.id);
    const current = unwrap(await database.from('facility_photos')
      .select('id,location_id,room_id,image_path,is_cover')
      .eq('id', id).maybeSingle());
    if (!current) throw new HttpError(404, 'Photo not found.');
    const ownerType = current.location_id ? 'location' : 'room';
    const ownerId = current.location_id || current.room_id;
    const ownerTable = ownerType === 'location' ? 'locations' : 'rooms';
    const cover = Boolean(body.is_cover);
    if (cover) unwrap(await database.from('facility_photos')
      .update({ is_cover: false })
      .eq(ownerType === 'location' ? 'location_id' : 'room_id', ownerId));
    unwrap(await database.from('facility_photos').update({
      alt_text: requiredText(body.alt_text, 'Alternative text', 255),
      caption: optionalText(body.caption, 'Caption', 255),
      sort_order: Math.max(0, Math.min(65535, Number(body.sort_order) || 0)),
      is_cover: cover
    }).eq('id', id));
    if (cover) unwrap(await database.from(ownerTable).update({ image_path: current.image_path }).eq('id', ownerId));
    return success({ id });
  }

  if (method === 'DELETE') {
    const id = positiveId(body.id ?? query.id);
    const current = unwrap(await database.from('facility_photos')
      .select('id,location_id,room_id,image_path,is_cover')
      .eq('id', id).maybeSingle());
    if (!current) throw new HttpError(404, 'Photo not found.');
    await unwrap(await database.from('facility_photos').delete().eq('id', id).select('id').single());
    if (current.is_cover) {
      const ownerType = current.location_id ? 'location' : 'room';
      const ownerId = current.location_id || current.room_id;
      const ownerTable = ownerType === 'location' ? 'locations' : 'rooms';
      const next = unwrap(await database.from('facility_photos')
        .select('id,image_path')
        .eq(ownerType === 'location' ? 'location_id' : 'room_id', ownerId)
        .order('sort_order')
        .order('id')
        .limit(1)
        .maybeSingle());
      if (next) {
        unwrap(await database.from('facility_photos').update({ is_cover: true }).eq('id', next.id));
      }
      unwrap(await database.from(ownerTable).update({ image_path: next?.image_path || null }).eq('id', ownerId));
    }
    return success({ id });
  }
  throw new HttpError(405, 'Method not allowed.');
}

export async function deleteFloorplan(event, body, query) {
  await currentUser(event, true, 'editor');
  const id = positiveId(body.id ?? query.id);
  const database = db();
  const plan = unwrap(await database.from('floor_plans').select('id,stored_name').eq('id', id).maybeSingle());
  if (!plan) throw new HttpError(404, 'Floor plan not found.');
  unwrap(await database.from('floor_plans').delete().eq('id', id));
  const removed = await database.storage.from('floor-plans').remove([plan.stored_name]);
  if (removed.error) throw new HttpError(503, 'The floor plan record was removed, but its storage file could not be deleted. Contact the administrator.');
  return success({ id });
}
