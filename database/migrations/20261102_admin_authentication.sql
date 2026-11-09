ALTER TABLE admin_users
  ADD COLUMN email_verified_at TIMESTAMP NULL DEFAULT NULL AFTER password_hash,
  ADD COLUMN google_sub VARCHAR(255) NULL UNIQUE AFTER email_verified_at;

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
