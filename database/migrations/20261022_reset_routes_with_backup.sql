CREATE TABLE IF NOT EXISTS route_reset_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT chk_route_reset_singleton CHECK (id = 1)
) ENGINE=InnoDB;

INSERT IGNORE INTO route_reset_state (id, completed_at) VALUES (1, NULL);
SET @route_reset_needed = (SELECT completed_at IS NULL FROM route_reset_state WHERE id = 1);

CREATE TABLE IF NOT EXISTS route_reset_backup_routes_20261022 LIKE campus_routes;
CREATE TABLE IF NOT EXISTS route_reset_backup_route_points_20261022 LIKE campus_route_points;
CREATE TABLE IF NOT EXISTS route_reset_backup_route_segments_20261022 LIKE campus_route_segments;
CREATE TABLE IF NOT EXISTS route_reset_backup_connections_20261022 LIKE map_connections;
CREATE TABLE IF NOT EXISTS route_reset_backup_nodes_20261022 LIKE map_nodes;
CREATE TABLE IF NOT EXISTS route_reset_backup_marker_nodes_20261022 (
  marker_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  route_node_id BIGINT UNSIGNED NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS route_reset_backup_room_nodes_20261022 (
  room_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  route_node_id BIGINT UNSIGNED NULL
) ENGINE=InnoDB;

START TRANSACTION;
REPLACE INTO route_reset_backup_routes_20261022 SELECT * FROM campus_routes WHERE @route_reset_needed = 1;
REPLACE INTO route_reset_backup_route_points_20261022 SELECT * FROM campus_route_points WHERE @route_reset_needed = 1;
REPLACE INTO route_reset_backup_route_segments_20261022 SELECT * FROM campus_route_segments WHERE @route_reset_needed = 1;
REPLACE INTO route_reset_backup_connections_20261022 SELECT * FROM map_connections WHERE @route_reset_needed = 1;
REPLACE INTO route_reset_backup_nodes_20261022 SELECT * FROM map_nodes WHERE @route_reset_needed = 1;
REPLACE INTO route_reset_backup_marker_nodes_20261022 (marker_id, route_node_id)
  SELECT id, route_node_id FROM map_markers WHERE route_node_id IS NOT NULL AND @route_reset_needed = 1;
REPLACE INTO route_reset_backup_room_nodes_20261022 (room_id, route_node_id)
  SELECT id, route_node_id FROM rooms WHERE route_node_id IS NOT NULL AND @route_reset_needed = 1;

DELETE FROM campus_route_segments WHERE @route_reset_needed = 1;
DELETE FROM campus_route_points WHERE @route_reset_needed = 1;
DELETE FROM campus_routes WHERE @route_reset_needed = 1;
DELETE FROM map_connections WHERE @route_reset_needed = 1;
UPDATE map_markers SET route_node_id = NULL WHERE @route_reset_needed = 1;
UPDATE rooms SET route_node_id = NULL WHERE @route_reset_needed = 1;
DELETE FROM map_nodes WHERE @route_reset_needed = 1;
UPDATE route_reset_state SET completed_at = CURRENT_TIMESTAMP WHERE id = 1 AND completed_at IS NULL;
COMMIT;
