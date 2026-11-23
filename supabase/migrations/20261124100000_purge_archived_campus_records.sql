begin;

-- Archived campus records are represented by active = false. Remove them
-- permanently, together with map records that can no longer be used.
create temporary table archived_location_ids on commit drop as
select id from public.locations where active = false;

create temporary table archived_room_ids on commit drop as
select id
from public.rooms
where active = false
   or building_id in (select id from archived_location_ids);

create temporary table archived_marker_ids on commit drop as
select id
from public.map_markers
where active = false
   or location_id in (select id from archived_location_ids);

create temporary table archived_node_ids on commit drop as
select id from public.map_nodes where active = false;

create temporary table archived_connection_ids on commit drop as
select id
from public.map_connections
where active = false
   or from_node_id in (select id from archived_node_ids)
   or to_node_id in (select id from archived_node_ids);

create temporary table archived_route_ids on commit drop as
select route.id
from public.campus_routes route
where route.status = 'inactive'
   or route.start_marker_id in (select id from archived_marker_ids)
   or route.destination_marker_id in (select id from archived_marker_ids)
   or route.landmark_marker_id in (select id from archived_marker_ids)
   or exists (
     select 1 from public.campus_route_points point
     where point.route_id = route.id
       and point.node_id in (select id from archived_node_ids)
   )
   or exists (
     select 1 from public.campus_route_segments segment
     where segment.route_id = route.id
       and segment.connection_id in (select id from archived_connection_ids)
   );

-- Remove dependent routes before their markers, nodes, and connections.
delete from public.campus_routes
where id in (select id from archived_route_ids);

delete from public.map_connections
where id in (select id from archived_connection_ids);

delete from public.map_markers
where id in (select id from archived_marker_ids);

delete from public.rooms
where id in (select id from archived_room_ids);

delete from public.map_nodes
where id in (select id from archived_node_ids);

-- If an active alias points to an archived canonical record, make the active
-- record its own canonical record before the archived record is removed.
update public.locations
set canonical_location_id = null
where canonical_location_id in (select id from archived_location_ids);

delete from public.locations
where id in (select id from archived_location_ids);


-- Merge the known legacy spelling duplicate generated from map pin 34.
-- Keep the official "Sto. Niño Building" record and move any linked data.
do $
declare
  canonical_id bigint;
  duplicate_id bigint;
  duplicate_marker record;
  canonical_marker_id bigint;
begin
  select id into canonical_id
  from public.locations
  where name = 'Sto. Niño Building'
    and kind = 'building'
    and active
  order by verified desc, created_at asc, id asc
  limit 1;

  if canonical_id is not null then
    for duplicate_id in
      select id
      from public.locations
      where id <> canonical_id
        and kind = 'building'
        and active
        and lower(regexp_replace(translate(name, 'ñÑ', 'nN'), '[^a-z0-9]', '', 'g')) = 'stoninobuilding'
    loop
      if exists (
        select 1
        from public.rooms duplicate_room
        join public.rooms canonical_room
          on canonical_room.building_id = canonical_id
         and canonical_room.room_number = duplicate_room.room_number
         and canonical_room.floor_number = duplicate_room.floor_number
        where duplicate_room.building_id = duplicate_id
      ) then
        raise exception 'Cannot merge duplicate Sto. Nino Building record: duplicate room numbers need review first.';
      end if;

      update public.locations canonical
      set description = coalesce(nullif(canonical.description, ''), duplicate.description),
          image_path = coalesce(canonical.image_path, duplicate.image_path),
          building_number = coalesce(canonical.building_number, duplicate.building_number),
          floor_label = coalesce(canonical.floor_label, duplicate.floor_label),
          capacity = coalesce(canonical.capacity, duplicate.capacity),
          floor_count = greatest(canonical.floor_count, duplicate.floor_count),
          department_name = coalesce(canonical.department_name, duplicate.department_name),
          contact_email = coalesce(canonical.contact_email, duplicate.contact_email),
          contact_phone = coalesce(canonical.contact_phone, duplicate.contact_phone),
          website_url = coalesce(canonical.website_url, duplicate.website_url),
          model_3d_path = coalesce(canonical.model_3d_path, duplicate.model_3d_path),
          category_ids = coalesce(canonical.category_ids, duplicate.category_ids),
          access_hours = coalesce(canonical.access_hours, duplicate.access_hours),
          service_hours = coalesce(canonical.service_hours, duplicate.service_hours),
          days_open = coalesce(canonical.days_open, duplicate.days_open),
          lunch_break = coalesce(canonical.lunch_break, duplicate.lunch_break),
          services = coalesce(nullif(canonical.services, ''), duplicate.services),
          nearby_landmarks = coalesce(canonical.nearby_landmarks, duplicate.nearby_landmarks),
          accessibility_status = coalesce(canonical.accessibility_status, duplicate.accessibility_status),
          accessibility_details = coalesce(canonical.accessibility_details, duplicate.accessibility_details),
          accessibility_features = coalesce(canonical.accessibility_features, duplicate.accessibility_features),
          category_id = coalesce(canonical.category_id, duplicate.category_id),
          verified = canonical.verified or duplicate.verified
      from public.locations duplicate
      where canonical.id = canonical_id
        and duplicate.id = duplicate_id;

      update public.rooms set building_id = canonical_id where building_id = duplicate_id;
      update public.locations set parent_building_id = canonical_id where parent_building_id = duplicate_id;
      update public.facility_photos set location_id = canonical_id where location_id = duplicate_id;
      update public.floor_plans set building_id = canonical_id where building_id = duplicate_id;
      update public.announcements set location_id = canonical_id where location_id = duplicate_id;

      insert into public.favorites (account_key, location_id, created_at)
      select favorite.account_key, canonical_id, favorite.created_at
      from public.favorites favorite
      where favorite.location_id = duplicate_id
        and not exists (
          select 1 from public.favorites existing
          where existing.account_key = favorite.account_key
            and existing.location_id = canonical_id
        );
      delete from public.favorites where location_id = duplicate_id;

      update public.locations
      set canonical_location_id = canonical_id
      where canonical_location_id = duplicate_id;

      for duplicate_marker in
        select id, map_key, floor_number
        from public.map_markers
        where location_id = duplicate_id
      loop
        select id into canonical_marker_id
        from public.map_markers
        where location_id = canonical_id
          and map_key = duplicate_marker.map_key
          and floor_number = duplicate_marker.floor_number
          and active
        order by id
        limit 1;

        if canonical_marker_id is not null then
          if exists (
            select 1 from public.campus_routes
            where landmark_marker_id = canonical_marker_id
          ) and exists (
            select 1 from public.campus_routes
            where landmark_marker_id = duplicate_marker.id
          ) then
            raise exception 'Cannot merge duplicate Sto. Nino Building map markers: both markers are assigned as route landmarks.';
          end if;

          update public.campus_routes
          set start_marker_id = canonical_marker_id
          where start_marker_id = duplicate_marker.id;
          update public.campus_routes
          set destination_marker_id = canonical_marker_id
          where destination_marker_id = duplicate_marker.id;
          update public.campus_routes
          set landmark_marker_id = canonical_marker_id
          where landmark_marker_id = duplicate_marker.id;
          delete from public.map_markers where id = duplicate_marker.id;
        else
          update public.map_markers
          set location_id = canonical_id
          where id = duplicate_marker.id;
        end if;
      end loop;

      delete from public.locations where id = duplicate_id;
    end loop;
  end if;
end;
$;

commit;
