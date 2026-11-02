import { getDatabase } from '@netlify/database';
import { handleAuthRequest } from './auth.mjs';
import { handleCrudRequest } from './crud.mjs';

const allowedOrigins = () => (process.env.ALLOWED_ORIGINS || process.env.NETLIFY_SITE_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function response(data, status = 200, origin = '', additionalHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const [name, value] of Object.entries(additionalHeaders)) headers.set(name, value);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function error(message, status, origin) {
  return response({ ok: false, error: { message } }, status, origin);
}

export default async function handler(request) {
  const origin = request.headers.get('origin') || '';
  const allowed = allowedOrigins();
  const sameOrigin = origin !== '' && origin === new URL(request.url).origin;
  const allowedOrigin = sameOrigin || allowed.includes(origin);
  if (origin && !allowedOrigin) {
    return error('This website origin is not allowed to use the API.', 403);
  }
  if (request.method === 'OPTIONS') {
    if (!origin || !allowedOrigin) return error('This website origin is not allowed to use the API.', 403);
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
    });
  }

  const url = new URL(request.url);
  const resource = (url.searchParams.get('resource') || '').replace(/^\/+|\/+$/g, '');
  if (resource.startsWith('auth/')) {
    try {
      return await handleAuthRequest({ request, resource, db: getDatabase(), origin, response, error });
    } catch (cause) {
      console.error(`NaviGATE authentication initialization failed for ${resource}:`, cause);
      return error('The authentication service is unavailable.', 503, origin);
    }
  }
  if (resource === 'categories' || resource === 'announcements') {
    try {
      const result = await handleCrudRequest({
        request, resource, url, db: getDatabase(), origin, response, error,
      });
      if (result) return result;
    } catch (cause) {
      console.error(`NaviGATE record API initialization failed for ${resource}:`, cause);
      return error('The campus database request could not be completed.', 503, origin);
    }
  }
  if (resource.startsWith('admin/')) return error('Administrator management endpoints are not yet migrated.', 501, origin);
  if (['locations', 'rooms', 'facility-photos', 'routes', 'uploads', 'map/admin', 'map/markers', 'map/nodes', 'map/connections'].includes(resource)) {
    return error('This administrative resource is not yet migrated.', 501, origin);
  }
  if (resource === 'health' && request.method === 'GET') {
    try {
      const { rows } = await getDatabase().sql`SELECT CURRENT_TIMESTAMP AS database_time`;
      return response({ ok: true, data: { status: 'ok', database: 'connected', timestamp: rows[0].database_time } }, 200, origin);
    } catch (cause) {
      console.error('NaviGATE database health check failed:', cause);
      return error('The campus database is unavailable.', 503, origin);
    }
  }

  if (request.method !== 'GET') return error('This API migration stage is read-only. Write endpoints are not deployed yet.', 501, origin);

  try {
    const db = getDatabase();
    if (resource === 'categories') {
      const { rows } = await db.sql`SELECT id, name, slug FROM categories ORDER BY sort_order, name`;
      return response({ ok: true, data: rows }, 200, origin);
    }
    if (resource === 'announcements') {
      if (url.searchParams.has('admin')) return error('Administrator authentication is not yet available on this API.', 501, origin);
      const { rows } = await db.sql`
        SELECT a.id, a.title, a.body AS details, a.status, a.featured AS pinned,
          a.event_start, a.event_end, a.created_at AS "createdAt",
          a.image_path AS photo, l.name AS location
        FROM announcements a
        LEFT JOIN locations l ON l.id = a.location_id
        WHERE a.status = 'published'
          AND (a.publish_at IS NULL OR a.publish_at <= CURRENT_TIMESTAMP)
        ORDER BY a.featured DESC, a.publish_at DESC, a.created_at DESC
      `;
      return response({ ok: true, data: rows }, 200, origin);
    }
    if (resource === 'directory') {
      const [locations, rooms, photos, floorPlans] = await Promise.all([
        db.sql`
          SELECT l.id, l.name, l.kind, l.description, l.image_path AS image,
            l.building_number, l.capacity, l.floor_count,
            l.department_name AS "departmentName", l.contact_email AS "contactEmail",
            l.contact_phone AS "contactPhone", l.website_url AS "websiteUrl",
            l.service_hours AS "serviceHours", l.access_hours AS "accessHours",
            l.days_open AS "daysOpen", l.lunch_break AS "lunchBreak", l.services,
            l.nearby_landmarks AS "nearbyLandmarks",
            l.accessibility_status AS "accessibilityStatus",
            l.accessibility_details AS "accessibilityDetails",
            l.accessibility_features AS "accessibilityFeatures", l.floor_label AS "floorLabel",
            l.parent_building_id AS "parentBuildingId", l.verified, c.name AS category,
            m.x, m.y, m.floor_number, m.map_key, b.name AS parent_building,
            m.id AS marker_id, m.route_node_id
          FROM locations l
          LEFT JOIN categories c ON c.id = l.category_id
          LEFT JOIN locations b ON b.id = l.parent_building_id
          LEFT JOIN map_markers m ON m.location_id = l.id AND m.active = TRUE
          WHERE l.active = TRUE
          ORDER BY l.kind, l.name
        `,
        db.sql`
          SELECT r.id, r.building_id AS "buildingId", r.name,
            r.room_number AS "roomNumber", r.floor_number AS "floorNumber",
            r.floor_label AS "floorLabel", r.capacity, r.description,
            r.function_description AS "functionDescription", r.image_path AS image,
            r.department_head AS "departmentHead", r.contact_info AS "contactInfo",
            r.contact_email AS "contactEmail", r.contact_phone AS "contactPhone",
            r.website_url AS "websiteUrl", r.department_name AS "departmentName",
            r.service_hours AS "serviceHours", r.days_open AS "daysOpen",
            r.lunch_break AS "lunchBreak", r.services,
            r.nearby_landmarks AS "nearbyLandmarks",
            r.accessibility_status AS "accessibilityStatus",
            r.accessibility_details AS "accessibilityDetails", r.verified,
            c.name AS category, b.name AS "buildingName"
          FROM rooms r
          JOIN locations b ON b.id = r.building_id
          LEFT JOIN categories c ON c.id = r.category_id
          WHERE r.active = TRUE AND b.active = TRUE
          ORDER BY b.name, r.floor_number, r.room_number
        `,
        db.sql`
          SELECT id, location_id AS "locationId", room_id AS "roomId",
            image_path AS image, alt_text AS "altText", caption,
            sort_order AS "sortOrder", is_cover AS "isCover"
          FROM facility_photos ORDER BY sort_order, id
        `,
        db.sql`
          SELECT id, building_id, floor_number, original_name, mime_type,
            file_size, verified, 'uploads/floorplans/' || stored_name AS file_url
          FROM floor_plans ORDER BY building_id, floor_number
        `,
      ]);
      const locationsWithPhotos = locations.rows.map(location => ({
        ...location,
        accessibilityFeatures: location.kind === 'building' ? location.accessibilityFeatures || [] : [],
        photos: photos.rows.filter(photo => photo.locationId === location.id),
      }));
      const roomsWithPhotos = rooms.rows.map(room => ({
        ...room,
        photos: photos.rows.filter(photo => photo.roomId === room.id),
      }));
      return response({
        ok: true,
        data: { locations: locationsWithPhotos, rooms: roomsWithPhotos, floorPlans: floorPlans.rows },
      }, 200, origin);
    }
    if (resource === 'map') {
      const [markers, nodes, connections] = await Promise.all([
        db.sql`
          SELECT m.id, m.location_id, m.route_node_id, l.name, l.kind, l.description,
            c.name AS category, m.x, m.y, m.floor_number, m.map_key,
            m.accessibility_status AS accessibility_value
          FROM map_markers m
          JOIN locations l ON l.id = m.location_id
          LEFT JOIN categories c ON c.id = l.category_id
          WHERE m.active = TRUE AND l.active = TRUE ORDER BY m.id
        `,
        db.sql`SELECT id, node_key, x, y, floor_number FROM map_nodes WHERE active = TRUE ORDER BY id`,
        db.sql`
          SELECT e.id, e.from_node_id, e.to_node_id, e.weight, e.connection_type,
            e.verified, e.accessibility_status AS accessibility_value
          FROM map_connections e
          JOIN map_nodes f ON f.id = e.from_node_id
          JOIN map_nodes t ON t.id = e.to_node_id
          WHERE e.active = TRUE AND e.verified = TRUE AND f.active = TRUE AND t.active = TRUE
            AND (f.floor_number = t.floor_number OR e.connection_type IN ('stairs', 'ramp', 'elevator'))
          ORDER BY e.id
        `,
      ]);
      return response({
        ok: true,
        data: { markers: markers.rows, nodes: nodes.rows, connections: connections.rows },
      }, 200, origin);
    }
    if (resource === 'routes/available') {
      const { rows } = await db.sql`
        SELECT r.*, sm.location_id AS start_location_id, sl.name AS start_name,
          dm.location_id AS destination_location_id, dl.name AS destination_name,
          sm.x AS start_x, sm.y AS start_y, dm.x AS destination_x, dm.y AS destination_y,
          CASE WHEN r.accessibility_status = TRUE
            AND sm.accessibility_status = TRUE AND dm.accessibility_status = TRUE
            AND EXISTS (SELECT 1 FROM campus_route_segments rs WHERE rs.route_id = r.id)
            AND (SELECT COUNT(*) FROM campus_route_segments rs WHERE rs.route_id = r.id)
              = (SELECT COUNT(*) - 1 FROM campus_route_points rp WHERE rp.route_id = r.id)
            AND NOT EXISTS (
              SELECT 1 FROM campus_route_segments rs
              LEFT JOIN map_connections c ON c.id = rs.connection_id
              WHERE rs.route_id = r.id
                AND (COALESCE(c.active, FALSE) = FALSE OR COALESCE(c.verified, FALSE) = FALSE
                  OR COALESCE(c.accessibility_status, FALSE) = FALSE)
            )
            THEN TRUE ELSE FALSE END AS accessible_confirmed
        FROM campus_routes r
        JOIN map_markers sm ON sm.id = r.start_marker_id
        JOIN locations sl ON sl.id = sm.location_id
        JOIN map_markers dm ON dm.id = r.destination_marker_id
        JOIN locations dl ON dl.id = dm.location_id
        WHERE r.status = 'active' AND sm.active = TRUE AND dm.active = TRUE
          AND sl.active = TRUE AND dl.active = TRUE
        ORDER BY r.updated_at DESC, r.id DESC
      `;
      const routes = await Promise.all(rows.map(async route => {
        const points = await db.sql`
          SELECT p.sequence_no, p.point_type, p.notes, n.id AS node_id, n.node_key,
            n.x, n.y, n.floor_number
          FROM campus_route_points p
          JOIN map_nodes n ON n.id = p.node_id
          WHERE p.route_id = ${route.id}
          ORDER BY p.sequence_no
        `;
        return { ...route, points: points.rows };
      }));
      return response({ ok: true, data: routes }, 200, origin);
    }
    if (resource === 'floorplans') {
      const { rows } = await db.sql`
        SELECT f.id, f.building_id, f.floor_number, f.original_name, f.mime_type,
          f.file_size, f.created_at, 'uploads/floorplans/' || f.stored_name AS file_url
        FROM floor_plans f ORDER BY f.building_id, f.floor_number
      `;
      return response({ ok: true, data: rows }, 200, origin);
    }
    return error('API resource not found or not yet migrated.', 404, origin);
  } catch (cause) {
    console.error(`NaviGATE API read failed for ${resource || '(empty resource)'}:`, cause);
    return error('The campus database request could not be completed.', 503, origin);
  }
}
