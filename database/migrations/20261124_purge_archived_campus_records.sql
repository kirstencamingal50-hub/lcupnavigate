-- Run once against the LCUP campus database after taking a database backup.
-- Archived catalog rows are active = 0. Their dependent route/map data is
-- removed first so the remaining foreign-key relationships stay valid.
START TRANSACTION;

CREATE TEMPORARY TABLE archived_location_ids AS
SELECT id FROM locations WHERE active = 0;

CREATE TEMPORARY TABLE archived_room_ids AS
SELECT id
FROM rooms
WHERE active = 0
   OR building_id IN (SELECT id FROM archived_location_ids);

CREATE TEMPORARY TABLE archived_marker_ids AS
SELECT id
FROM map_markers
WHERE active = 0
   OR location_id IN (SELECT id FROM archived_location_ids);

CREATE TEMPORARY TABLE archived_node_ids AS
SELECT id FROM map_nodes WHERE active = 0;

CREATE TEMPORARY TABLE archived_connection_ids AS
SELECT id
FROM map_connections
WHERE active = 0
   OR from_node_id IN (SELECT id FROM archived_node_ids)
   OR to_node_id IN (SELECT id FROM archived_node_ids);

CREATE TEMPORARY TABLE archived_route_ids AS
SELECT route.id
FROM campus_routes route
WHERE route.status = 'inactive'
   OR route.start_marker_id IN (SELECT id FROM archived_marker_ids)
   OR route.destination_marker_id IN (SELECT id FROM archived_marker_ids)
   OR route.landmark_marker_id IN (SELECT id FROM archived_marker_ids)
   OR EXISTS (
     SELECT 1 FROM campus_route_points point
     WHERE point.route_id = route.id
       AND point.node_id IN (SELECT id FROM archived_node_ids)
   )
   OR EXISTS (
     SELECT 1 FROM campus_route_segments segment
     WHERE segment.route_id = route.id
       AND segment.connection_id IN (SELECT id FROM archived_connection_ids)
   );

DELETE route
FROM campus_routes route
JOIN archived_route_ids archived ON archived.id = route.id;

DELETE connection
FROM map_connections connection
JOIN archived_connection_ids archived ON archived.id = connection.id;

DELETE marker
FROM map_markers marker
JOIN archived_marker_ids archived ON archived.id = marker.id;

DELETE room
FROM rooms room
JOIN archived_room_ids archived ON archived.id = room.id;

DELETE node
FROM map_nodes node
JOIN archived_node_ids archived ON archived.id = node.id;

DELETE location
FROM locations location
JOIN archived_location_ids archived ON archived.id = location.id;


-- Merge the known legacy spelling duplicate created by map pin 34.
-- The official record is "Sto. Niño Building".
SET @canonical_location_id = (
  SELECT id FROM locations
  WHERE name = 'Sto. Niño Building' AND kind = 'building' AND active = 1
  ORDER BY verified DESC, created_at ASC, id ASC LIMIT 1
);
SET @duplicate_location_id = (
  SELECT id FROM locations
  WHERE name = 'Sto. Nino Building' AND kind = 'building' AND active = 1
  ORDER BY verified DESC, created_at ASC, id ASC LIMIT 1
);

UPDATE locations canonical
JOIN locations duplicate ON duplicate.id = @duplicate_location_id
SET canonical.description = COALESCE(NULLIF(canonical.description, ''), duplicate.description),
    canonical.image_path = COALESCE(canonical.image_path, duplicate.image_path),
    canonical.building_number = COALESCE(canonical.building_number, duplicate.building_number),
    canonical.floor_label = COALESCE(canonical.floor_label, duplicate.floor_label),
    canonical.capacity = COALESCE(canonical.capacity, duplicate.capacity),
    canonical.floor_count = GREATEST(canonical.floor_count, duplicate.floor_count),
    canonical.department_name = COALESCE(canonical.department_name, duplicate.department_name),
    canonical.contact_email = COALESCE(canonical.contact_email, duplicate.contact_email),
    canonical.contact_phone = COALESCE(canonical.contact_phone, duplicate.contact_phone),
    canonical.website_url = COALESCE(canonical.website_url, duplicate.website_url),
    canonical.service_hours = COALESCE(canonical.service_hours, duplicate.service_hours),
    canonical.access_hours = COALESCE(canonical.access_hours, duplicate.access_hours),
    canonical.days_open = COALESCE(canonical.days_open, duplicate.days_open),
    canonical.lunch_break = COALESCE(canonical.lunch_break, duplicate.lunch_break),
    canonical.services = COALESCE(NULLIF(canonical.services, ''), duplicate.services),
    canonical.nearby_landmarks = COALESCE(canonical.nearby_landmarks, duplicate.nearby_landmarks),
    canonical.accessibility_status = COALESCE(canonical.accessibility_status, duplicate.accessibility_status),
    canonical.accessibility_details = COALESCE(canonical.accessibility_details, duplicate.accessibility_details),
    canonical.accessibility_features = COALESCE(canonical.accessibility_features, duplicate.accessibility_features),
    canonical.category_id = COALESCE(canonical.category_id, duplicate.category_id),
    canonical.verified = GREATEST(canonical.verified, duplicate.verified)
WHERE canonical.id = @canonical_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL
  AND @canonical_location_id <> @duplicate_location_id;

UPDATE rooms SET building_id = @canonical_location_id
WHERE building_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

UPDATE locations SET parent_building_id = @canonical_location_id
WHERE parent_building_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

UPDATE facility_photos SET location_id = @canonical_location_id
WHERE location_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

UPDATE floor_plans SET building_id = @canonical_location_id
WHERE building_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

UPDATE announcements SET location_id = @canonical_location_id
WHERE location_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

INSERT IGNORE INTO favorites (account_key, location_id, created_at)
SELECT account_key, @canonical_location_id, created_at
FROM favorites
WHERE location_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

DELETE FROM favorites
WHERE location_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

-- Preserve route endpoints by redirecting them to an existing canonical
-- marker when one exists for the same map and floor.
UPDATE campus_routes route
JOIN map_markers duplicate_marker ON duplicate_marker.id = route.start_marker_id
JOIN map_markers canonical_marker
  ON canonical_marker.location_id = @canonical_location_id
 AND canonical_marker.map_key = duplicate_marker.map_key
 AND canonical_marker.floor_number = duplicate_marker.floor_number
 AND canonical_marker.active = 1
SET route.start_marker_id = canonical_marker.id
WHERE duplicate_marker.location_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

UPDATE campus_routes route
JOIN map_markers duplicate_marker ON duplicate_marker.id = route.destination_marker_id
JOIN map_markers canonical_marker
  ON canonical_marker.location_id = @canonical_location_id
 AND canonical_marker.map_key = duplicate_marker.map_key
 AND canonical_marker.floor_number = duplicate_marker.floor_number
 AND canonical_marker.active = 1
SET route.destination_marker_id = canonical_marker.id
WHERE duplicate_marker.location_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

UPDATE campus_routes route
JOIN map_markers duplicate_marker ON duplicate_marker.id = route.landmark_marker_id
JOIN map_markers canonical_marker
  ON canonical_marker.location_id = @canonical_location_id
 AND canonical_marker.map_key = duplicate_marker.map_key
 AND canonical_marker.floor_number = duplicate_marker.floor_number
 AND canonical_marker.active = 1
SET route.landmark_marker_id = canonical_marker.id
WHERE duplicate_marker.location_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

DELETE duplicate_marker
FROM map_markers duplicate_marker
JOIN map_markers canonical_marker
  ON canonical_marker.location_id = @canonical_location_id
 AND canonical_marker.map_key = duplicate_marker.map_key
 AND canonical_marker.floor_number = duplicate_marker.floor_number
 AND canonical_marker.active = 1
WHERE duplicate_marker.location_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

UPDATE map_markers
SET location_id = @canonical_location_id
WHERE location_id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL;

DELETE FROM locations
WHERE id = @duplicate_location_id
  AND @canonical_location_id IS NOT NULL
  AND @duplicate_location_id IS NOT NULL
  AND @canonical_location_id <> @duplicate_location_id;

COMMIT;

DROP TEMPORARY TABLE IF EXISTS archived_route_ids;
DROP TEMPORARY TABLE IF EXISTS archived_connection_ids;
DROP TEMPORARY TABLE IF EXISTS archived_node_ids;
DROP TEMPORARY TABLE IF EXISTS archived_marker_ids;
DROP TEMPORARY TABLE IF EXISTS archived_room_ids;
DROP TEMPORARY TABLE IF EXISTS archived_location_ids;
