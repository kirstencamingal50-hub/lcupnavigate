-- Add explicit walkway and floor-transition semantics to the verified graph.
SET @has_connection_type = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'map_connections' AND COLUMN_NAME = 'connection_type'
);
SET @connection_type_sql = IF(
  @has_connection_type = 0,
  "ALTER TABLE map_connections ADD COLUMN connection_type ENUM('walkway','stairs','ramp','elevator') NOT NULL DEFAULT 'walkway' AFTER weight",
  'SELECT 1'
);
PREPARE connection_type_stmt FROM @connection_type_sql;
EXECUTE connection_type_stmt;
DEALLOCATE PREPARE connection_type_stmt;

SET @has_room_route_node = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rooms' AND COLUMN_NAME = 'route_node_id'
);
SET @room_route_node_sql = IF(
  @has_room_route_node = 0,
  'ALTER TABLE rooms ADD COLUMN route_node_id BIGINT UNSIGNED NULL AFTER building_id',
  'SELECT 1'
);
PREPARE room_route_node_stmt FROM @room_route_node_sql;
EXECUTE room_route_node_stmt;
DEALLOCATE PREPARE room_route_node_stmt;
