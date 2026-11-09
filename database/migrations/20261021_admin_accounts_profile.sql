-- Safely adds profile fields to existing administrator accounts.
SET @has_full_name = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_users' AND COLUMN_NAME='full_name');
SET @full_name_sql = IF(@has_full_name=0,'ALTER TABLE admin_users ADD COLUMN full_name VARCHAR(160) NULL AFTER id','SELECT 1');
PREPARE full_name_stmt FROM @full_name_sql; EXECUTE full_name_stmt; DEALLOCATE PREPARE full_name_stmt;

SET @has_email = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_users' AND COLUMN_NAME='email');
SET @email_sql = IF(@has_email=0,'ALTER TABLE admin_users ADD COLUMN email VARCHAR(254) NULL AFTER username','SELECT 1');
PREPARE email_stmt FROM @email_sql; EXECUTE email_stmt; DEALLOCATE PREPARE email_stmt;

SET @has_email_index = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_users' AND INDEX_NAME='uq_admin_email');
SET @email_index_sql = IF(@has_email_index=0,'ALTER TABLE admin_users ADD UNIQUE INDEX uq_admin_email (email)','SELECT 1');
PREPARE email_index_stmt FROM @email_index_sql; EXECUTE email_index_stmt; DEALLOCATE PREPARE email_index_stmt;
