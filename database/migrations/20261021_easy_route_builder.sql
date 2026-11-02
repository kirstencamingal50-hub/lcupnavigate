-- Adds verified accessibility data to destination markers. Safe to run after schema.sql.
SET @has_marker_accessibility = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'map_markers' AND COLUMN_NAME = 'accessibility_status'
);
SET @marker_accessibility_sql = IF(
  @has_marker_accessibility = 0,
  'ALTER TABLE map_markers ADD COLUMN accessibility_status TINYINT(1) NULL AFTER verified',
  'SELECT 1'
);
PREPARE marker_accessibility_stmt FROM @marker_accessibility_sql;
EXECUTE marker_accessibility_stmt;
DEALLOCATE PREPARE marker_accessibility_stmt;
