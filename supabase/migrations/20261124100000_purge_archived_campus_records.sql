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

commit;
