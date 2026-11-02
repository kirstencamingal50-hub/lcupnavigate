CREATE TABLE IF NOT EXISTS admin_setup_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT chk_admin_setup_singleton CHECK (id = 1)
) ENGINE=InnoDB;

INSERT IGNORE INTO admin_setup_state (id, completed_at)
SELECT 1, CASE WHEN EXISTS (SELECT 1 FROM admin_users WHERE role='admin') THEN CURRENT_TIMESTAMP ELSE NULL END;
