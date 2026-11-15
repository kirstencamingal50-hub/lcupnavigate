begin;

-- A campus location may have alternate directory records, but it must have
-- only one active marker for a given map and floor.
alter table public.locations
  add column if not exists canonical_location_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.locations'::regclass
      and conname = 'locations_canonical_location_id_fkey'
  ) then
    alter table public.locations
      add constraint locations_canonical_location_id_fkey
      foreign key (canonical_location_id)
      references public.locations(id)
      on delete set null;
  end if;
end;
$$;

-- Self-references are unnecessary: NULL means the row is the canonical record.
update public.locations
set canonical_location_id = null
where canonical_location_id = id;

alter table public.map_markers
  add column if not exists canonical_location_id bigint;

update public.map_markers marker
set canonical_location_id = coalesce(location.canonical_location_id, location.id)
from public.locations location
where location.id = marker.location_id
  and marker.canonical_location_id is distinct from coalesce(location.canonical_location_id, location.id);

alter table public.map_markers
  alter column canonical_location_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.map_markers'::regclass
      and conname = 'map_markers_canonical_location_id_fkey'
  ) then
    alter table public.map_markers
      add constraint map_markers_canonical_location_id_fkey
      foreign key (canonical_location_id)
      references public.locations(id)
      on delete restrict;
  end if;
end;
$$;

create or replace function public.sync_map_marker_canonical_location()
returns trigger
language plpgsql
set search_path = ''
as $$
declare resolved_id bigint;
begin
  select coalesce(location.canonical_location_id, location.id)
    into resolved_id
  from public.locations location
  where location.id = new.location_id
    and location.active;

  if resolved_id is null then
    raise exception 'Marker location does not exist or is inactive';
  end if;

  new.canonical_location_id := resolved_id;
  return new;
end;
$$;

drop trigger if exists map_markers_sync_canonical_location on public.map_markers;
create trigger map_markers_sync_canonical_location
before insert or update of location_id, canonical_location_id
on public.map_markers
for each row execute function public.sync_map_marker_canonical_location();

-- Keep marker canonical IDs synchronized if an admin changes an alias mapping.
create or replace function public.sync_location_marker_canonical_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.map_markers
     set canonical_location_id = coalesce(new.canonical_location_id, new.id)
   where location_id = new.id
     and canonical_location_id is distinct from coalesce(new.canonical_location_id, new.id);
  return new;
end;
$$;

drop trigger if exists locations_sync_marker_canonical_location on public.locations;
create trigger locations_sync_marker_canonical_location
after update of canonical_location_id
on public.locations
for each row execute function public.sync_location_marker_canonical_location();

do $$
begin
  if exists (
    select 1
    from public.map_markers
    where active
    group by canonical_location_id, map_key, floor_number
    having count(*) > 1
  ) then
    raise exception 'Duplicate active campus markers already exist for a canonical location. Resolve the duplicates in Map Management before applying this migration.';
  end if;
end;
$$;

create unique index if not exists uq_active_map_marker_canonical_location
on public.map_markers(canonical_location_id, map_key, floor_number)
where active;

commit;
