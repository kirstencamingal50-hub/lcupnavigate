CREATE DATABASE IF NOT EXISTS lcup_campus_nav CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lcup_campus_nav;

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(160) NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(254) NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at TIMESTAMP NULL DEFAULT NULL,
  google_sub VARCHAR(255) NULL UNIQUE,
  role ENUM('admin','editor','viewer') NOT NULL DEFAULT 'editor',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_auth_challenges (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  purpose ENUM('signup','password_reset') NOT NULL,
  account_id BIGINT UNSIGNED NULL,
  email VARCHAR(254) NOT NULL,
  full_name VARCHAR(160) NULL,
  username VARCHAR(80) NULL,
  password_hash VARCHAR(255) NULL,
  code_hash VARCHAR(255) NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  resend_after DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_auth_challenge_account FOREIGN KEY (account_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  INDEX idx_admin_auth_challenge_email (email, purpose),
  INDEX idx_admin_auth_challenge_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_setup_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT chk_admin_setup_singleton CHECK (id = 1)
) ENGINE=InnoDB;

INSERT IGNORE INTO admin_setup_state (id, completed_at)
SELECT 1, CASE WHEN EXISTS (SELECT 1 FROM admin_users WHERE role='admin') THEN CURRENT_TIMESTAMP ELSE NULL END;

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS locations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  kind ENUM('building','facility') NOT NULL DEFAULT 'building',
  description TEXT NULL,
  image_path VARCHAR(255) NULL,
  building_number VARCHAR(40) NULL,
  floor_label VARCHAR(80) NULL,
  capacity INT UNSIGNED NULL,
  floor_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  department_name VARCHAR(160) NULL,
  contact_email VARCHAR(254) NULL,
  contact_phone VARCHAR(40) NULL,
  website_url VARCHAR(500) NULL,
  service_hours VARCHAR(500) NULL,
  access_hours VARCHAR(500) NULL,
  days_open VARCHAR(160) NULL,
  lunch_break VARCHAR(160) NULL,
  services TEXT NULL,
  nearby_landmarks VARCHAR(1000) NULL,
  accessibility_status TINYINT(1) NULL,
  accessibility_details VARCHAR(1000) NULL,
  accessibility_features JSON NULL,
  category_id BIGINT UNSIGNED NULL,
  parent_building_id BIGINT UNSIGNED NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_locations_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_locations_parent FOREIGN KEY (parent_building_id) REFERENCES locations(id) ON DELETE SET NULL,
  INDEX idx_locations_name (name), INDEX idx_locations_kind (kind), INDEX idx_locations_active (active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rooms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  building_id BIGINT UNSIGNED NOT NULL,
  route_node_id BIGINT UNSIGNED NULL,
  name VARCHAR(150) NOT NULL,
  room_number VARCHAR(50) NOT NULL,
  floor_number SMALLINT NOT NULL DEFAULT 0,
  floor_label VARCHAR(80) NULL,
  capacity INT UNSIGNED NULL,
  description TEXT NULL,
  function_description VARCHAR(1000) NULL,
  department_head VARCHAR(120) NULL,
  contact_info VARCHAR(180) NULL,
  contact_email VARCHAR(254) NULL,
  contact_phone VARCHAR(40) NULL,
  website_url VARCHAR(500) NULL,
  department_name VARCHAR(160) NULL,
  service_hours VARCHAR(500) NULL,
  days_open VARCHAR(160) NULL,
  lunch_break VARCHAR(160) NULL,
  services TEXT NULL,
  nearby_landmarks VARCHAR(1000) NULL,
  accessibility_status TINYINT(1) NULL,
  accessibility_details VARCHAR(1000) NULL,
  image_path VARCHAR(255) NULL,
  category_id BIGINT UNSIGNED NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rooms_building FOREIGN KEY (building_id) REFERENCES locations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rooms_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  UNIQUE KEY uq_room_building_number_floor (building_id, room_number, floor_number), INDEX idx_rooms_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS facility_photos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  location_id BIGINT UNSIGNED NULL,
  room_id BIGINT UNSIGNED NULL,
  image_path VARCHAR(255) NOT NULL,
  alt_text VARCHAR(255) NOT NULL,
  caption VARCHAR(255) NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_cover TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_facility_photo_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
  CONSTRAINT fk_facility_photo_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT chk_facility_photo_owner CHECK ((location_id IS NOT NULL AND room_id IS NULL) OR (location_id IS NULL AND room_id IS NOT NULL)),
  INDEX idx_facility_photos_location (location_id, sort_order),
  INDEX idx_facility_photos_room (room_id, sort_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS map_nodes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  node_key VARCHAR(80) NOT NULL UNIQUE,
  x DECIMAL(9,2) NOT NULL,
  y DECIMAL(9,2) NOT NULL,
  floor_number SMALLINT NOT NULL DEFAULT 0,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS map_markers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  location_id BIGINT UNSIGNED NOT NULL,
  route_node_id BIGINT UNSIGNED NULL,
  x DECIMAL(9,2) NOT NULL,
  y DECIMAL(9,2) NOT NULL,
  floor_number SMALLINT NOT NULL DEFAULT 0,
  map_key VARCHAR(40) NOT NULL DEFAULT 'campus',
  verified TINYINT(1) NOT NULL DEFAULT 0,
  accessibility_status TINYINT(1) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_marker_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
  CONSTRAINT fk_marker_route_node FOREIGN KEY (route_node_id) REFERENCES map_nodes(id) ON DELETE SET NULL,
  INDEX idx_markers_map (map_key, floor_number)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS map_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_node_id BIGINT UNSIGNED NOT NULL,
  to_node_id BIGINT UNSIGNED NOT NULL,
  weight DECIMAL(10,2) NOT NULL,
  connection_type ENUM('walkway','stairs','ramp','elevator') NOT NULL DEFAULT 'walkway',
  verified TINYINT(1) NOT NULL DEFAULT 0,
  accessibility_status TINYINT(1) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_connection_from FOREIGN KEY (from_node_id) REFERENCES map_nodes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_connection_to FOREIGN KEY (to_node_id) REFERENCES map_nodes(id) ON DELETE RESTRICT,
  CONSTRAINT chk_connection_positive CHECK (weight > 0),
  UNIQUE KEY uq_connection_pair (from_node_id, to_node_id), INDEX idx_connections_to (to_node_id)
) ENGINE=InnoDB;

-- Named route descriptions sit on top of the reusable shared walkway graph.
CREATE TABLE IF NOT EXISTS campus_routes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  start_marker_id BIGINT UNSIGNED NOT NULL,
  destination_marker_id BIGINT UNSIGNED NOT NULL,
  landmark_marker_id BIGINT UNSIGNED NULL,
  status ENUM('draft','incomplete','active','inactive') NOT NULL DEFAULT 'incomplete',
  verified TINYINT(1) NOT NULL DEFAULT 0,
  accessibility_status TINYINT(1) NULL,
  distance_map_units DECIMAL(10,2) NULL,
  notes VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_campus_route_start_marker FOREIGN KEY (start_marker_id) REFERENCES map_markers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_campus_route_end_marker FOREIGN KEY (destination_marker_id) REFERENCES map_markers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_campus_route_landmark_marker FOREIGN KEY (landmark_marker_id) REFERENCES map_markers(id) ON DELETE CASCADE,
  CONSTRAINT fk_campus_route_admin FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_campus_routes_status (status), INDEX idx_campus_routes_endpoints (start_marker_id,destination_marker_id),
  UNIQUE KEY uq_campus_route_landmark_marker (landmark_marker_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campus_route_points (
  route_id BIGINT UNSIGNED NOT NULL,
  sequence_no SMALLINT UNSIGNED NOT NULL,
  node_id BIGINT UNSIGNED NOT NULL,
  point_type ENUM('start','waypoint','destination') NOT NULL,
  notes VARCHAR(255) NULL,
  PRIMARY KEY (route_id,sequence_no),
  CONSTRAINT fk_campus_route_point_route FOREIGN KEY (route_id) REFERENCES campus_routes(id) ON DELETE CASCADE,
  CONSTRAINT fk_campus_route_point_node FOREIGN KEY (node_id) REFERENCES map_nodes(id) ON DELETE RESTRICT,
  INDEX idx_campus_route_point_node (node_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campus_route_segments (
  route_id BIGINT UNSIGNED NOT NULL,
  sequence_no SMALLINT UNSIGNED NOT NULL,
  connection_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (route_id,sequence_no),
  CONSTRAINT fk_campus_route_segment_route FOREIGN KEY (route_id) REFERENCES campus_routes(id) ON DELETE CASCADE,
  CONSTRAINT fk_campus_route_segment_connection FOREIGN KEY (connection_id) REFERENCES map_connections(id) ON DELETE RESTRICT,
  INDEX idx_campus_route_segment_connection (connection_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS floor_plans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  building_id BIGINT UNSIGNED NOT NULL,
  floor_number SMALLINT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_floorplan_building FOREIGN KEY (building_id) REFERENCES locations(id) ON DELETE CASCADE,
  CONSTRAINT fk_floorplan_admin FOREIGN KEY (uploaded_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_hash CHAR(64) NOT NULL,
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_attempts_ip_time (ip_hash, attempted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('draft','published','unpublished') NOT NULL DEFAULT 'draft',
  publish_at DATETIME NULL,
  event_start DATETIME NULL,
  event_end DATETIME NULL,
  location_id BIGINT UNSIGNED NULL,
  image_path VARCHAR(255) NULL,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_announcement_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_announcement_admin FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_announcement_public (status, publish_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS favorites (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_key CHAR(64) NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_favorite_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
  UNIQUE KEY uq_favorite (account_key, location_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id BIGINT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_audit_entity (entity_type, entity_id), INDEX idx_audit_date (created_at)
) ENGINE=InnoDB;

INSERT IGNORE INTO categories (name, slug, sort_order) VALUES
('Academic','academic',1),('Administrative','administrative',2),('Medical','medical',3),
('Events and Conference','events-and-conference',4),('Food and Dining','food-and-dining',5),
('Sports and Recreation','sports-and-recreation',6),('Outdoor','outdoor',7);
