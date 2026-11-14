import { randomUUID } from 'node:crypto';
import { currentUser } from './authorization.mjs';
import { storageObjectPath } from './media.mjs';
import { getServiceClient } from './supabase.mjs';
import { HttpError, optionalText, positiveId, requiredText, success, unwrap } from './http.mjs';

const db = () => getServiceClient();
async function editor(event, minimum = 'editor') {
  return currentUser(event, true, minimum);
}

function nullableId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return positiveId(value, field);
}

function booleanValue(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if ([true, 1, '1', 'true'].includes(value)) return true;
  if ([false, 0, '0', 'false'].includes(value)) return false;
  throw new HttpError(400, `${field} must be true, false, or empty.`);
}

function dateValue(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} must be a valid date and time.`);
  }
  return value;
}

function legacyId(user) {
  return Number.isSafeInteger(Number(user.id)) ? Number(user.id) : null;
}

function storedMediaPath(value) {
  if (value === undefined || value === null || value === '') return null;
  const path = storageObjectPath(value);
  if (!path) throw new HttpError(400, 'Choose an image uploaded through the campus admin form.');
  return path;
}

async function audit(user, action, entity, entityId, after = null) {
  unwrap(await db().from('audit_logs').insert({
    admin_legacy_id: legacyId(user),
    action,
    entity_type: entity,
    entity_id: entityId ?? null,
    after_json: after
  }));
}

async function updateById(table, id, fields, notFound) {
  const result = await db().from(table).update(fields).eq('id', id).select('id').maybeSingle();
  const row = unwrap(result);
  if (!row) throw new HttpError(404, notFound);
  return row.id;
}

async function locations(event, method, body, query) {
  const user = await editor(event);
  const database = db();
  if (method === 'POST' || method === 'PUT') {
    const id = method === 'PUT' ? positiveId(body.id ?? query.id) : null;
    const name = requiredText(body.name, 'Name', 150);
    const kind = body.kind || 'building';
    if (!['building', 'facility'].includes(kind)) throw new HttpError(400, 'Invalid location kind.');
    const categoryId = nullableId(body.category_id, 'Category ID');
    const parentId = nullableId(body.parent_building_id, 'Parent building ID');
    if (parentId && parentId === id) throw new HttpError(400, 'A building cannot be its own parent.');
    if (parentId) {
      const parent = unwrap(await database.from('locations').select('id,kind,active').eq('id', parentId).maybeSingle());
      if (!parent || parent.kind !== 'building' || !parent.active) throw new HttpError(400, 'Choose a valid parent building.');
    }
    const email = optionalText(body.contact_email, 'Contact email', 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid contact email.');
    const website = optionalText(body.website_url, 'Website URL', 500);
    if (website && !/^https?:\/\/\S+$/i.test(website)) throw new HttpError(400, 'Enter a valid HTTP or HTTPS website URL.');
    const features = body.accessibility_features ?? [];
    const allowedFeatures = ['wheelchair_entrance', 'elevator', 'ramp', 'accessible_restroom', 'accessible_parking', 'handrails', 'tactile_paving', 'braille_signage', 'hearing_assistance'];
    if (!Array.isArray(features) || features.some(feature => !allowedFeatures.includes(feature)) ||
        (kind !== 'building' && features.length)) {
      throw new HttpError(400, 'Choose only supported building accessibility features.');
    }
    const fields = {
      name,
      kind,
      description: optionalText(body.description, 'Description', 4000),
      building_number: optionalText(body.building_number, 'Building number', 40),
      floor_label: optionalText(body.floor_label, 'Floor label', 80),
      capacity: body.capacity === '' || body.capacity == null ? null : Math.max(0, Number(body.capacity)),
      floor_count: Math.max(1, Math.min(100, Number(body.floor_count) || 1)),
      category_id: categoryId,
      parent_building_id: parentId,
      image_path: storedMediaPath(body.image_path),
      department_name: optionalText(body.department_name, 'Department', 160),
      contact_email: email,
      contact_phone: optionalText(body.contact_phone, 'Contact phone', 40),
      website_url: website,
      service_hours: optionalText(body.service_hours, 'Service hours', 500),
      access_hours: optionalText(body.access_hours, 'Access hours', 500),
      days_open: optionalText(body.days_open, 'Days open', 160),
      lunch_break: optionalText(body.lunch_break, 'Lunch break', 160),
      services: optionalText(body.services, 'Services', 4000),
      nearby_landmarks: optionalText(body.nearby_landmarks, 'Nearby landmarks', 1000),
      accessibility_status: booleanValue(body.accessibility_status, 'Accessibility status'),
      accessibility_details: optionalText(body.accessibility_details, 'Accessibility details', 1000),
      accessibility_features: kind === 'building' ? [...new Set(features)] : []
    };
    if (fields.capacity !== null && (!Number.isSafeInteger(fields.capacity) || fields.capacity < 0)) {
      throw new HttpError(400, 'Capacity must be a non-negative whole number.');
    }
    const savedId = id
      ? await updateById('locations', id, fields, 'Location not found.')
      : unwrap(await database.from('locations').insert(fields).select('id').single()).id;
    await audit(user, id ? 'update' : 'create', 'location', savedId, { name, kind });
    return success({ id: savedId, name }, id ? 200 : 201);
  }
  if (method === 'DELETE') {
    const id = positiveId(body.id ?? query.id);
    const record = unwrap(await database.from('locations').select('id,kind').eq('id', id).eq('active', true).maybeSingle());
    if (!record) throw new HttpError(404, 'Location not found.');
    if (record.kind === 'building') {
      const rooms = await database.from('rooms').select('id', { count: 'exact', head: true }).eq('building_id', id).eq('active', true);
      if (rooms.error) throw rooms.error;
      if (rooms.count) throw new HttpError(409, 'Move or remove this building’s rooms before archiving the building.');
    }
    await updateById('locations', id, { active: false }, 'Location not found.');
    await audit(user, 'archive', 'location', id);
    return success({ id });
  }
  throw new HttpError(405, 'Method not allowed.');
}

async function rooms(event, method, body, query) {
  const user = await editor(event);
  const database = db();
  if (method === 'POST' || method === 'PUT') {
    const id = method === 'PUT' ? positiveId(body.id ?? query.id) : null;
    const buildingId = positiveId(body.building_id, 'Building ID');
    const building = unwrap(await database.from('locations').select('id,kind,active').eq('id', buildingId).maybeSingle());
    if (!building || building.kind !== 'building' || !building.active) throw new HttpError(400, 'Select a valid campus building.');
    const number = requiredText(body.room_number, 'Room number', 50);
    const fields = {
      building_id: buildingId,
      route_node_id: nullableId(body.route_node_id, 'Route node ID'),
      name: requiredText(body.name, 'Name', 150),
      room_number: number,
      floor_number: Math.max(0, Math.min(200, Number(body.floor_number) || 0)),
      floor_label: optionalText(body.floor_label, 'Floor label', 80),
      capacity: body.capacity === '' || body.capacity == null ? null : Number(body.capacity),
      description: optionalText(body.description, 'Description', 4000),
      function_description: optionalText(body.function_description, 'Function description', 1000),
      department_head: optionalText(body.department_head, 'Department head', 120),
      contact_info: optionalText(body.contact_info, 'Contact information', 180),
      contact_email: optionalText(body.contact_email, 'Contact email', 254),
      contact_phone: optionalText(body.contact_phone, 'Contact phone', 40),
      website_url: optionalText(body.website_url, 'Website URL', 500),
      department_name: optionalText(body.department_name, 'Department', 160),
      service_hours: optionalText(body.service_hours, 'Service hours', 500),
      days_open: optionalText(body.days_open, 'Days open', 160),
      lunch_break: optionalText(body.lunch_break, 'Lunch break', 160),
      services: optionalText(body.services, 'Services', 4000),
      nearby_landmarks: optionalText(body.nearby_landmarks, 'Nearby landmarks', 1000),
      accessibility_status: booleanValue(body.accessibility_status, 'Accessibility status'),
      accessibility_details: optionalText(body.accessibility_details, 'Accessibility details', 1000),
      image_path: storedMediaPath(body.image_path),
      category_id: nullableId(body.category_id, 'Category ID')
    };
    if (fields.capacity !== null && (!Number.isSafeInteger(fields.capacity) || fields.capacity < 0)) {
      throw new HttpError(400, 'Capacity must be a non-negative whole number.');
    }
    const savedId = id
      ? await updateById('rooms', id, fields, 'Room not found.')
      : unwrap(await database.from('rooms').insert(fields).select('id').single()).id;
    await audit(user, id ? 'update' : 'create', 'room', savedId, { building_id: buildingId, room_number: number });
    return success({ id: savedId }, id ? 200 : 201);
  }
  if (method === 'DELETE') {
    const id = positiveId(body.id ?? query.id);
    const record = unwrap(await database.from('rooms').select('id').eq('id', id).eq('active', true).maybeSingle());
    if (!record) throw new HttpError(404, 'Room not found.');
    await updateById('rooms', id, { active: false }, 'Room not found.');
    await audit(user, 'archive', 'room', id);
    return success({ id });
  }
  throw new HttpError(405, 'Method not allowed.');
}

async function categories(event, method, body, query) {
  const user = await editor(event);
  const database = db();
  if (method === 'POST' || method === 'PUT') {
    const id = method === 'PUT' ? positiveId(body.id ?? query.id) : null;
    const name = requiredText(body.name, 'Name', 80);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
    if (!slug) throw new HttpError(400, 'Category name must include a letter or number.');
    let savedId;
    if (id) {
      savedId = await updateById('categories', id, { name, slug }, 'Category not found.');
    } else {
      savedId = unwrap(await database.from('categories').insert({ name, slug }).select('id').single()).id;
    }
    await audit(user, id ? 'update' : 'create', 'category', savedId, { name });
    return success({ id: savedId, name }, id ? 200 : 201);
  }
  if (method === 'DELETE') {
    const id = positiveId(body.id ?? query.id);
    const [locations, rooms] = await Promise.all([
      database.from('locations').select('id', { count: 'exact', head: true }).eq('category_id', id),
      database.from('rooms').select('id', { count: 'exact', head: true }).eq('category_id', id)
    ]);
    if (locations.error) throw locations.error;
    if (rooms.error) throw rooms.error;
    if (locations.count || rooms.count) throw new HttpError(409, 'Category is assigned to campus records and cannot be deleted.');
    unwrap(await database.from('categories').delete().eq('id', id).select('id').single());
    await audit(user, 'delete', 'category', id);
    return success({ id });
  }
  throw new HttpError(405, 'Method not allowed.');
}

async function announcements(event, method, body, query) {
  const user = await editor(event);
  const database = db();
  if (method === 'POST' || method === 'PUT') {
    const id = method === 'PUT' ? positiveId(body.id ?? query.id) : null;
    const status = body.status || 'draft';
    if (!['draft', 'published', 'unpublished'].includes(status)) throw new HttpError(400, 'Invalid announcement status.');
    const fields = {
      title: requiredText(body.title, 'Title', 180),
      body: requiredText(body.details ?? body.body, 'Details', 10000),
      status,
      featured: Boolean(body.pinned),
      publish_at: dateValue(body.publish_at, 'Publish date'),
      event_start: dateValue(body.event_start, 'Event start'),
      event_end: dateValue(body.event_end, 'Event end'),
      location_id: nullableId(body.location_id, 'Location ID'),
      image_path: storedMediaPath(body.image_path ?? body.photo)
    };
    const savedId = id
      ? await updateById('announcements', id, fields, 'Announcement not found.')
      : unwrap(await database.from('announcements')
        .insert({ ...fields, created_by_legacy_admin_id: legacyId(user) })
        .select('id')
        .single()).id;
    await audit(user, id ? 'update' : 'create', 'announcement', savedId, { title: fields.title, status });
    return success({ id: savedId }, id ? 200 : 201);
  }
  if (method === 'DELETE') {
    const id = positiveId(body.id ?? query.id);
    unwrap(await database.from('announcements').delete().eq('id', id).select('id').single());
    await audit(user, 'delete', 'announcement', id);
    return success({ id });
  }
  throw new HttpError(405, 'Method not allowed.');
}

async function mapNodes(event, method, body, query) {
  const user = await editor(event);
  const database = db();
  if (method === 'DELETE') {
    const id = positiveId(body.id ?? query.id);
    const references = await database.from('campus_route_points')
      .select('route_id, route:campus_routes!campus_route_points_route_id_fkey(status)')
      .eq('node_id', id);
    const points = unwrap(references) || [];
    if (points.some(point => point.route?.status === 'active')) {
      throw new HttpError(409, 'This node is used by an active route. Edit or deactivate those routes first.');
    }
    unwrap(await database.from('map_connections')
      .update({ active: false })
      .or(`from_node_id.eq.${id},to_node_id.eq.${id}`)
      .eq('active', true));
    await updateById('map_nodes', id, { active: false }, 'Walkway node not found.');
    await audit(user, 'archive', 'map_node', id);
    return success({ id, connections_archived: true });
  }
  if (!['POST', 'PUT'].includes(method)) throw new HttpError(405, 'Method not allowed.');
  const x = Number(body.x), y = Number(body.y), floor = Number(body.floor_number) || 0;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1330 || y < 0 || y > 1620 ||
      !Number.isSafeInteger(floor) || floor < 0 || floor > 200) {
    throw new HttpError(400, 'Node coordinates are outside the campus map bounds.');
  }
  const id = method === 'PUT' ? positiveId(body.id ?? query.id) : null;
  const existing = id
    ? unwrap(await database.from('map_nodes').select('id,node_key').eq('id', id).maybeSingle())
    : null;
  if (id && !existing) throw new HttpError(404, 'Walkway node not found.');
  const suppliedKey = optionalText(body.node_key, 'Node key', 80);
  const nodeKey = suppliedKey || existing?.node_key || `node-${randomUUID()}`;
  const fields = { node_key: nodeKey, x, y, floor_number: floor, active: true };
  const savedId = id
    ? await updateById('map_nodes', id, fields, 'Walkway node not found.')
    : unwrap(await database.from('map_nodes').insert(fields).select('id').single()).id;
  await audit(user, id ? 'update' : 'create', 'map_node', savedId);
  return success({ id: savedId }, id ? 200 : 201);
}

async function mapMarkers(event, method, body, query) {
  const user = await editor(event);
  const database = db();
  if (method === 'DELETE') {
    const id = positiveId(body.id ?? query.id);
    const routes = unwrap(await database.from('campus_routes').select('id')
      .eq('status', 'active')
      .or(`start_marker_id.eq.${id},destination_marker_id.eq.${id},landmark_marker_id.eq.${id}`)) || [];
    if (routes.length) throw new HttpError(409, 'This marker is used by an active route. Edit or deactivate those routes first.');
    await updateById('map_markers', id, { active: false }, 'Marker not found.');
    await audit(user, 'archive', 'map_marker', id);
    return success({ id });
  }
  if (!['POST', 'PUT'].includes(method)) throw new HttpError(405, 'Method not allowed.');
  const x = Number(body.x), y = Number(body.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1330 || y < 0 || y > 1620) {
    throw new HttpError(400, 'Marker coordinates are outside the campus map bounds.');
  }
  const locationId = positiveId(body.location_id, 'Location ID');
  const location = unwrap(await database.from('locations').select('id,active').eq('id', locationId).maybeSingle());
  if (!location?.active) throw new HttpError(400, 'Marker location does not exist or is inactive.');
  const id = method === 'PUT' ? positiveId(body.id ?? query.id) : null;
  const routeNodeId = nullableId(body.route_node_id, 'Route node ID');
  if (routeNodeId) {
    const node = unwrap(await database.from('map_nodes').select('id,active').eq('id', routeNodeId).maybeSingle());
    if (!node?.active) throw new HttpError(400, 'Select an active walkway node for this marker.');
  }
  const fields = {
    location_id: locationId,
    route_node_id: routeNodeId,
    x,
    y,
    floor_number: Math.max(0, Number(body.floor_number) || 0),
    map_key: optionalText(body.map_key, 'Map key', 40) || 'campus',
    accessibility_status: booleanValue(body.accessibility_status, 'Accessibility status'),
    active: true
  };
  const savedId = id
    ? await updateById('map_markers', id, fields, 'Marker not found.')
    : unwrap(await database.from('map_markers').insert(fields).select('id').single()).id;
  if (!id) {
    unwrap(await database.from('campus_routes').insert({
      name: `Draft: ${String(body.name || 'Campus location').slice(0, 112)}`,
      start_marker_id: savedId,
      destination_marker_id: savedId,
      landmark_marker_id: savedId,
      status: 'incomplete',
      created_by_legacy_admin_id: legacyId(user)
    }));
  }
  await audit(user, id ? 'update' : 'create', 'map_marker', savedId);
  return success({ id: savedId, draft_status: id ? undefined : 'incomplete' }, id ? 200 : 201);
}

async function mapConnections(event, method, body, query) {
  const user = await editor(event);
  const database = db();
  const id = method === 'PUT' || method === 'DELETE' ? positiveId(body.id ?? query.id) : null;
  if (method === 'DELETE') {
    const refs = await database.from('campus_route_segments')
      .select('route_id')
      .eq('connection_id', id);
    if (unwrap(refs)?.length) throw new HttpError(409, 'This connection is still referenced by a saved route. Edit those routes first.');
    await updateById('map_connections', id, { active: false }, 'Connection not found.');
    await audit(user, 'archive', 'map_connection', id);
    return success({ id });
  }
  if (!['POST', 'PUT'].includes(method)) throw new HttpError(405, 'Method not allowed.');
  let from = positiveId(body.from_node_id, 'Start node ID');
  let to = positiveId(body.to_node_id, 'End node ID');
  const weight = Number(body.weight);
  if (from === to || !Number.isFinite(weight) || weight <= 0) {
    throw new HttpError(400, 'Connections need two different nodes and a positive distance.');
  }
  const nodes = unwrap(await database.from('map_nodes').select('id,floor_number')
    .in('id', [from, to]).eq('active', true)) || [];
  if (nodes.length !== 2) throw new HttpError(400, 'Both connection nodes must exist.');
  const type = body.connection_type || 'walkway';
  if (!['walkway', 'stairs', 'ramp', 'elevator'].includes(type)) throw new HttpError(400, 'Invalid connection type.');
  if (nodes[0].floor_number !== nodes[1].floor_number && !['stairs', 'ramp', 'elevator'].includes(type)) {
    throw new HttpError(400, 'Floor changes require a stairs, ramp, or elevator connection.');
  }
  const verified = booleanValue(body.verified, 'Verification status') ?? false;
  if (verified && body.confirm_walkway !== true) {
    throw new HttpError(400, 'Confirm that this connection follows the selected campus path before verifying it.');
  }
  if (from > to) [from, to] = [to, from];
  if (id) {
    const current = unwrap(await database.from('map_connections')
      .select('from_node_id,to_node_id,connection_type')
      .eq('id', id).maybeSingle());
    if (!current) throw new HttpError(404, 'Connection not found.');
    if ((current.from_node_id !== from || current.to_node_id !== to) &&
        (unwrap(await database.from('campus_route_segments').select('route_id').eq('connection_id', id)) || []).length) {
      throw new HttpError(409, 'This connection belongs to a saved route. Edit the route before changing its endpoints.');
    }
  }
  const fields = {
    from_node_id: from,
    to_node_id: to,
    weight,
    connection_type: type,
    verified,
    accessibility_status: booleanValue(body.accessible, 'Accessibility status'),
    active: true
  };
  const savedId = id
    ? await updateById('map_connections', id, fields, 'Connection not found.')
    : unwrap(await database.from('map_connections').insert(fields).select('id').single()).id;
  await audit(user, id ? 'update' : 'create', 'map_connection', savedId);
  return success({ id: savedId }, id ? 200 : 201);
}

async function routes(event, method, body, query) {
  const user = await editor(event);
  const database = db();
  if (method === 'DELETE') {
    const id = positiveId(body.id ?? query.id);
    const removed = unwrap(await database.from('campus_routes').delete().eq('id', id).select('id').maybeSingle());
    if (!removed) throw new HttpError(404, 'Saved route not found.');
    await audit(user, 'delete', 'campus_route', id);
    return success({ id, walkways_preserved: true });
  }
  if (method !== 'POST' && method !== 'PUT') throw new HttpError(405, 'Method not allowed.');
  const id = method === 'PUT' ? positiveId(body.id ?? query.id) : null;
  const waypoints = body.waypoints ?? [];
  if (!Array.isArray(waypoints) || waypoints.length > 80) {
    throw new HttpError(400, 'A route can have up to 80 intermediate points.');
  }
  const routeStatus = body.status || 'incomplete';
  if (!['draft', 'incomplete', 'active', 'inactive'].includes(routeStatus)) {
    throw new HttpError(400, 'Choose a valid route status.');
  }
  const accessibility = booleanValue(body.accessibility_status, 'Accessibility status');
  const normalizedWaypoints = waypoints.map((point, index) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) {
      throw new HttpError(400, `Waypoint ${index + 1} is invalid.`);
    }
    const notes = optionalText(point.notes, 'Waypoint notes', 255);
    if (point.node_id !== undefined && point.node_id !== null && point.node_id !== '') {
      return { node_id: positiveId(point.node_id, `Waypoint ${index + 1} node ID`), notes };
    }
    const x = Number(point.x), y = Number(point.y);
    const floor = point.floor_number === undefined || point.floor_number === '' ? 0 : Number(point.floor_number);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1330 || y < 0 || y > 1620 ||
        !Number.isSafeInteger(floor) || floor < 0 || floor > 200) {
      throw new HttpError(400, `Waypoint ${index + 1} is outside the campus map bounds.`);
    }
    return { x, y, floor_number: floor, notes };
  });
  const saved = unwrap(await database.rpc('save_campus_route', {
    p_route_id: id,
    p_name: requiredText(body.name, 'Route name', 120),
    p_start_marker_id: positiveId(body.start_marker_id, 'Start marker ID'),
    p_destination_marker_id: positiveId(body.destination_marker_id, 'Destination marker ID'),
    p_status: routeStatus,
    p_accessibility_status: accessibility,
    p_notes: optionalText(body.notes, 'Notes', 1000),
    p_waypoints: normalizedWaypoints,
    p_created_by_legacy_admin_id: legacyId(user)
  }));
  return success(saved, id ? 200 : 201);
}

async function floorplans(event, method, body, query) {
  const user = await editor(event);
  if (method !== 'PUT') throw new HttpError(405, 'Method not allowed.');
  const id = positiveId(body.id ?? query.id);
  const verified = booleanValue(body.verified, 'Verification status');
  if (verified === null) throw new HttpError(400, 'Choose whether the floor plan is verified.');
  const record = unwrap(await db().from('floor_plans')
    .update({ verified })
    .eq('id', id)
    .select('id')
    .maybeSingle());
  if (!record) throw new HttpError(404, 'Floor plan not found.');
  await audit(user, verified ? 'verify' : 'unverify', 'floor_plan', id, { verified });
  return success({ id, verified });
}

async function adminAccounts(event, method, body, query) {
  const actor = await editor(event, 'admin');
  const database = db();
  if (method === 'GET') {
    const rows = unwrap(await database.from('admin_profiles')
      .select('id,legacy_admin_id,full_name,username,email,role,active,created_at')
      .order('created_at', { ascending: false })) || [];
    return success(rows.map(publicAdminAccount));
  }
  if (method !== 'PUT') throw new HttpError(405, 'Method not allowed.');
  const id = body.id ?? query.id;
  if (id === undefined || id === null || id === '') throw new HttpError(400, 'A valid account ID is required.');
  const targetQuery = database.from('admin_profiles')
    .select('id,legacy_admin_id,role,active,username');
  const target = typeof id === 'string' && id.includes('-')
    ? unwrap(await targetQuery.eq('id', id).maybeSingle())
    : unwrap(await targetQuery.eq('legacy_admin_id', positiveId(id)).maybeSingle());
  if (!target) throw new HttpError(404, 'Administrator account not found.');
  const role = body.role;
  if (!['admin', 'editor', 'viewer'].includes(role)) throw new HttpError(400, 'Choose a valid administrator role.');
  const active = booleanValue(body.active, 'Account status');
  if (active === null) throw new HttpError(400, 'Account status must be active or inactive.');
  if (target.id === actor.auth_id && (!active || role !== 'admin')) {
    throw new HttpError(409, 'You cannot deactivate or demote your own account.');
  }
  if (target.role === 'admin' && target.active && (!active || role !== 'admin')) {
    const countResult = await database.from('admin_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('active', true);
    if (countResult.error) throw countResult.error;
    if ((countResult.count || 0) <= 1) throw new HttpError(409, 'The last active administrator cannot be disabled or demoted.');
  }
  unwrap(await database.from('admin_profiles')
    .update({ role, active })
    .eq('id', target.id)
    .select('id')
    .single());
  await audit(actor, 'update', 'admin_account', target.legacy_admin_id, { role, active });
  return success({ id: target.legacy_admin_id ?? target.id, role, active });
}

function publicAdminAccount(profile) {
  return {
    id: profile.legacy_admin_id ?? profile.id,
    full_name: profile.full_name,
    username: profile.username,
    email: profile.email,
    role: profile.role,
    active: profile.active,
    created_at: profile.created_at
  };
}

async function adminOverview(event) {
  await editor(event, 'viewer');
  const database = db();
  const [buildings, facilities, roomsCount, markers, routes, announcements, events] = await Promise.all([
    database.from('locations').select('id', { count: 'exact', head: true }).eq('kind', 'building').eq('active', true),
    database.from('locations').select('id', { count: 'exact', head: true }).eq('kind', 'facility').eq('active', true),
    database.from('rooms').select('id', { count: 'exact', head: true }).eq('active', true),
    database.from('map_markers').select('id', { count: 'exact', head: true }).eq('active', true),
    database.from('campus_routes').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    database.from('announcements').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    database.from('announcements').select('id', { count: 'exact', head: true }).eq('status', 'published').gte('event_start', new Date().toISOString())
  ]);
  for (const result of [buildings, facilities, roomsCount, markers, routes, announcements, events]) {
    if (result.error) throw result.error;
  }
  const activity = unwrap(await database.from('audit_logs')
    .select('action,entity_type,entity_id,created_at,admin:admin_profiles!audit_logs_admin_legacy_id_fkey(username)')
    .order('created_at', { ascending: false })
    .limit(8)) || [];
  return success({
    counts: {
      buildings: buildings.count || 0,
      facilities: facilities.count || 0,
      rooms: roomsCount.count || 0,
      landmarks: markers.count || 0,
      campus_routes: routes.count || 0,
      announcements: announcements.count || 0,
      upcoming_events: events.count || 0
    },
    recent_activity: activity.map(row => ({
      ...row,
      administrator: row.admin?.username || 'Former administrator'
    }))
  });
}

export async function mutateResource(event, resource, method, body, query) {
  if (resource === 'locations') return locations(event, method, body, query);
  if (resource === 'rooms') return rooms(event, method, body, query);
  if (resource === 'categories') return categories(event, method, body, query);
  if (resource === 'announcements') return announcements(event, method, body, query);
  if (resource === 'map/nodes') return mapNodes(event, method, body, query);
  if (resource === 'map/markers') return mapMarkers(event, method, body, query);
  if (resource === 'map/connections') return mapConnections(event, method, body, query);
  if (resource === 'routes') return routes(event, method, body, query);
  if (resource === 'floorplans') return floorplans(event, method, body, query);
  if (resource === 'admin/accounts') return adminAccounts(event, method, body, query);
  if (resource === 'admin/overview' && method === 'GET') return adminOverview(event);
  if (resource === 'admin/system' && method === 'GET') {
    await editor(event);
    return success({ application: 'NaviGATE LCUP Campus Navigation', version: 'Supabase / Netlify', database: 'Connected', php: null });
  }
  throw new HttpError(404, 'API resource not found.');
}
