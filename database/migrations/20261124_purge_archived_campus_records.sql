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

COMMIT;

DROP TEMPORARY TABLE IF EXISTS archived_route_ids;
DROP TEMPORARY TABLE IF EXISTS archived_connection_ids;
DROP TEMPORARY TABLE IF EXISTS archived_node_ids;
DROP TEMPORARY TABLE IF EXISTS archived_marker_ids;
DROP TEMPORARY TABLE IF EXISTS archived_room_ids;
DROP TEMPORARY TABLE IF EXISTS archived_location_ids;
