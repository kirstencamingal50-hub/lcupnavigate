-- Allow each campus location and room to belong to more than one directory category.
-- category_id remains the primary category for compatibility with existing clients.
alter table public.locations
  add column if not exists category_ids bigint[] not null default '{}';

alter table public.rooms
  add column if not exists category_ids bigint[] not null default '{}';

update public.locations
set category_ids = array[category_id]
where category_id is not null and cardinality(category_ids) = 0;

update public.rooms
set category_ids = array[category_id]
where category_id is not null and cardinality(category_ids) = 0;

create index if not exists locations_category_ids_gin_idx
  on public.locations using gin (category_ids);

create index if not exists rooms_category_ids_gin_idx
  on public.rooms using gin (category_ids);
