-- Route drafts are anchored to a landmark and remain private until validated.
ALTER TABLE campus_routes
  MODIFY status ENUM('draft','incomplete','active','inactive') NOT NULL DEFAULT 'incomplete';

SET @has_landmark_marker = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campus_routes' AND COLUMN_NAME='landmark_marker_id'
);
SET @landmark_column_sql = IF(@has_landmark_marker=0,
  'ALTER TABLE campus_routes ADD COLUMN landmark_marker_id BIGINT UNSIGNED NULL AFTER destination_marker_id', 'SELECT 1');
PREPARE landmark_column_stmt FROM @landmark_column_sql;
EXECUTE landmark_column_stmt;
DEALLOCATE PREPARE landmark_column_stmt;

SET @has_landmark_fk = (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='campus_routes' AND CONSTRAINT_NAME='fk_campus_route_landmark_marker'
);
SET @landmark_fk_sql = IF(@has_landmark_fk=0,
  'ALTER TABLE campus_routes ADD CONSTRAINT fk_campus_route_landmark_marker FOREIGN KEY (landmark_marker_id) REFERENCES map_markers(id) ON DELETE CASCADE', 'SELECT 1');
PREPARE landmark_fk_stmt FROM @landmark_fk_sql;
EXECUTE landmark_fk_stmt;
DEALLOCATE PREPARE landmark_fk_stmt;

SET @has_landmark_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campus_routes' AND INDEX_NAME='uq_campus_route_landmark_marker'
);
SET @landmark_index_sql = IF(@has_landmark_index=0,
  'ALTER TABLE campus_routes ADD UNIQUE KEY uq_campus_route_landmark_marker (landmark_marker_id)', 'SELECT 1');
PREPARE landmark_index_stmt FROM @landmark_index_sql;
EXECUTE landmark_index_stmt;
DEALLOCATE PREPARE landmark_index_stmt;

-- Remove existing named routes and their route-owned, unreferenced waypoint
-- connections/nodes. Shared map nodes and connections between retained nodes stay.
CREATE TABLE IF NOT EXISTS app_migrations (
  version VARCHAR(120) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
SET @clear_legacy_routes = NOT EXISTS (
  SELECT 1 FROM app_migrations WHERE version='20261022_landmark_route_drafts'
);
START TRANSACTION;
DELETE FROM campus_routes WHERE @clear_legacy_routes=1;
DELETE c FROM map_connections c
  JOIN map_nodes n ON n.id=c.from_node_id OR n.id=c.to_node_id
  WHERE n.node_key LIKE 'route-%'
    AND NOT EXISTS (SELECT 1 FROM map_markers m WHERE m.route_node_id=n.id)
    AND @clear_legacy_routes=1;
DELETE n FROM map_nodes n
  WHERE n.node_key LIKE 'route-%'
    AND NOT EXISTS (SELECT 1 FROM map_markers m WHERE m.route_node_id=n.id)
    AND NOT EXISTS (SELECT 1 FROM map_connections c WHERE c.from_node_id=n.id OR c.to_node_id=n.id)
    AND NOT EXISTS (SELECT 1 FROM campus_route_points p WHERE p.node_id=n.id)
    AND @clear_legacy_routes=1;
COMMIT;
INSERT IGNORE INTO app_migrations (version) VALUES ('20261022_landmark_route_drafts');
