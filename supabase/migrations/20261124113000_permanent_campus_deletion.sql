begin;

-- Permanent campus-record deletion. Every dependent route, route point,
-- route segment, marker, node, connection, room, photo metadata, floor plan,
-- announcement, favorite, and child location is removed in one transaction.
create or replace function public.delete_campus_record(
  p_record_type text,
  p_record_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_routes integer := 0;
begin
  if p_record_id is null or p_record_id <= 0 then
    raise exception 'A valid record ID is required.';
  end if;

  if p_record_type not in ('location', 'room', 'map_marker', 'map_node', 'map_connection') then
    raise exception 'Unsupported campus record type.';
  end if;

  create temporary table _delete_locations(id bigint primary key) on commit drop;
  create temporary table _delete_rooms(id bigint primary key) on commit drop;
  create temporary table _delete_markers(id bigint primary key) on commit drop;
  create temporary table _delete_nodes(id bigint primary key) on commit drop;
  create temporary table _delete_connections(id bigint primary key) on commit drop;
  create temporary table _delete_routes(id bigint primary key) on commit drop;

  if p_record_type = 'location' then
    insert into _delete_locations
    with recursive descendants(id) as (
      select id from public.locations where id = p_record_id
      union
      select child.id
      from public.locations child
      join descendants parent on child.parent_building_id = parent.id
    )
    select id from descendants;
    if not exists (select 1 from _delete_locations) then
      raise exception 'Campus location not found.';
    end if;
  end if;

  if p_record_type = 'room' then
    insert into _delete_rooms select id from public.rooms where id = p_record_id;
    if not exists (select 1 from _delete_rooms) then
      raise exception 'Room not found.';
    end if;
  elsif p_record_type = 'location' then
    insert into _delete_rooms
    select id from public.rooms where building_id in (select id from _delete_locations);
  end if;

  if p_record_type = 'map_marker' then
    insert into _delete_markers select id from public.map_markers where id = p_record_id;
    if not exists (select 1 from _delete_markers) then
      raise exception 'Map marker not found.';
    end if;
  elsif p_record_type = 'location' then
    insert into _delete_markers
    select id from public.map_markers where location_id in (select id from _delete_locations);
  end if;

  if p_record_type = 'map_node' then
    insert into _delete_nodes select id from public.map_nodes where id = p_record_id;
    if not exists (select 1 from _delete_nodes) then
      raise exception 'Walkway node not found.';
    end if;
  else
    insert into _delete_nodes
    select route_node_id from public.map_markers
    where id in (select id from _delete_markers) and route_node_id is not null
    union
    select route_node_id from public.rooms
    where id in (select id from _delete_rooms) and route_node_id is not null;
  end if;

  if p_record_type = 'map_connection' then
    insert into _delete_connections select id from public.map_connections where id = p_record_id;
    if not exists (select 1 from _delete_connections) then
      raise exception 'Walkway connection not found.';
    end if;
  else
    insert into _delete_connections
    select id from public.map_connections
    where from_node_id in (select id from _delete_nodes)
       or to_node_id in (select id from _delete_nodes);
  end if;

  -- Remove malformed routes globally as requested: a route must have two
  -- distinct endpoint markers to remain in the system.
  insert into _delete_routes
  select id from public.campus_routes
  where start_marker_id is null
     or destination_marker_id is null
     or start_marker_id = destination_marker_id
  union
  select id from public.campus_routes
  where start_marker_id in (select id from _delete_markers)
     or destination_marker_id in (select id from _delete_markers)
     or landmark_marker_id in (select id from _delete_markers)
  union
  select point.route_id from public.campus_route_points point
  where point.node_id in (select id from _delete_nodes)
  union
  select segment.route_id from public.campus_route_segments segment
  where segment.connection_id in (select id from _delete_connections);

  delete from public.campus_route_segments
  where route_id in (select id from _delete_routes);
  delete from public.campus_route_points
  where route_id in (select id from _delete_routes);
  delete from public.campus_routes
  where id in (select id from _delete_routes);
  get diagnostics deleted_routes = row_count;

  delete from public.map_connections where id in (select id from _delete_connections);
  delete from public.map_markers where id in (select id from _delete_markers);
  delete from public.facility_photos
  where location_id in (select id from _delete_locations)
     or room_id in (select id from _delete_rooms);
  delete from public.floor_plans
  where building_id in (select id from _delete_locations);
  delete from public.announcements
  where location_id in (select id from _delete_locations);
  delete from public.favorites
  where location_id in (select id from _delete_locations);
  delete from public.rooms where id in (select id from _delete_rooms);
  delete from public.map_nodes where id in (select id from _delete_nodes);
  delete from public.locations
  where id in (select id from _delete_locations);

  if p_record_type = 'map_marker' then
    delete from public.map_markers where id = p_record_id;
  elsif p_record_type = 'map_node' then
    delete from public.map_nodes where id = p_record_id;
  elsif p_record_type = 'map_connection' then
    delete from public.map_connections where id = p_record_id;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'record_type', p_record_type,
    'record_id', p_record_id,
    'deleted_routes', deleted_routes
  );
end;
$$;

revoke all on function public.delete_campus_record(text, bigint) from public, anon, authenticated;
grant execute on function public.delete_campus_record(text, bigint) to service_role;

-- Clean up any already-saved routes that do not have two distinct endpoints.
delete from public.campus_route_segments
where route_id in (
  select id from public.campus_routes
  where start_marker_id is null
     or destination_marker_id is null
     or start_marker_id = destination_marker_id
);
delete from public.campus_route_points
where route_id in (
  select id from public.campus_routes
  where start_marker_id is null
     or destination_marker_id is null
     or start_marker_id = destination_marker_id
);
delete from public.campus_routes
where start_marker_id is null
   or destination_marker_id is null
   or start_marker_id = destination_marker_id;

commit;
