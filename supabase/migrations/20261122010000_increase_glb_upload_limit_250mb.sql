-- Increase the campus GLB model upload limit from 100 MB to 250 MB.
update storage.buckets
set file_size_limit = 262144000
where id = 'campus-models';
