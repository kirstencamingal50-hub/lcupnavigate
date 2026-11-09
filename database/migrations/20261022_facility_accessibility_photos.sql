ALTER TABLE locations
  ADD COLUMN floor_label VARCHAR(80) NULL,
  ADD COLUMN department_name VARCHAR(160) NULL,
  ADD COLUMN contact_email VARCHAR(254) NULL,
  ADD COLUMN contact_phone VARCHAR(40) NULL,
  ADD COLUMN website_url VARCHAR(500) NULL,
  ADD COLUMN service_hours VARCHAR(500) NULL,
  ADD COLUMN access_hours VARCHAR(500) NULL,
  ADD COLUMN days_open VARCHAR(160) NULL,
  ADD COLUMN lunch_break VARCHAR(160) NULL,
  ADD COLUMN services TEXT NULL,
  ADD COLUMN nearby_landmarks VARCHAR(1000) NULL,
  ADD COLUMN accessibility_status TINYINT(1) NULL,
  ADD COLUMN accessibility_details VARCHAR(1000) NULL;

ALTER TABLE rooms
  ADD COLUMN contact_email VARCHAR(254) NULL,
  ADD COLUMN contact_phone VARCHAR(40) NULL,
  ADD COLUMN website_url VARCHAR(500) NULL,
  ADD COLUMN department_name VARCHAR(160) NULL,
  ADD COLUMN service_hours VARCHAR(500) NULL,
  ADD COLUMN days_open VARCHAR(160) NULL,
  ADD COLUMN lunch_break VARCHAR(160) NULL,
  ADD COLUMN services TEXT NULL,
  ADD COLUMN nearby_landmarks VARCHAR(1000) NULL,
  ADD COLUMN accessibility_status TINYINT(1) NULL,
  ADD COLUMN accessibility_details VARCHAR(1000) NULL;

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

INSERT INTO facility_photos (location_id, image_path, alt_text, caption, is_cover)
SELECT l.id, l.image_path, CONCAT('Campus photo: ', l.name), 'Cover photo', 1
FROM locations l
WHERE l.image_path IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM facility_photos p WHERE p.location_id=l.id);

INSERT INTO facility_photos (room_id, image_path, alt_text, caption, is_cover)
SELECT r.id, r.image_path, CONCAT('Room photo: ', r.name), 'Cover photo', 1
FROM rooms r
WHERE r.image_path IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM facility_photos p WHERE p.room_id=r.id);
