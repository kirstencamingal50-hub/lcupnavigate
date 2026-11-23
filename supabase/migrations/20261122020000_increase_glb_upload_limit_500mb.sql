-- Increase the campus GLB model upload limit to 500 MB.
-- Run this migration in the Supabase SQL Editor for the hosted project.
update storage.buckets
set file_size_limit = 524288000
where id = 'campus-models';
