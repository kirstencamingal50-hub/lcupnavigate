create or replace function public.save_campus_route(
  p_route_id bigint,
  p_name text,
  p_start_marker_id bigint,
  p_destination_marker_id bigint,
  p_status text,
  p_accessibility_status boolean,
  p_notes text,
  p_waypoints jsonb,
  p_created_by_legacy_admin_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_route_id bigint := p_route_id;
  v_start record;
  v_destination record;
  v_node record;
  v_connection record;
  v_point jsonb;
  v_node_id bigint;
  v_sequence integer := 0;
  v_waypoint_index integer := 0;
  v_floor integer;
  v_x numeric;
  v_y numeric;
  v_weight numeric;
  v_distance numeric := 0;
  v_all_accessible boolean := true;
  v_ordered_nodes bigint[] := array[]::bigint[];
  v_ordered_types text[] := array[]::text[];
  v_ordered_notes text[] := array[]::text[];
  v_candidate_nodes bigint[];
  v_same boolean;
  v_reverse_same boolean;
  v_candidate record;
  v_other record;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Route name must be between 1 and 120 characters.';
  end if;
  if p_status not in ('draft', 'incomplete', 'active', 'inactive') then
    raise exception 'Invalid route status.';
  end if;
  if p_waypoints is null or jsonb_typeof(p_waypoints) <> 'array' or jsonb_array_length(p_waypoints) > 100 then
    raise exception 'Route waypoints must be an array of at most 100 points.';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Route notes cannot exceed 1000 characters.';
  end if;

  perform pg_advisory_xact_lock(721904);

  select m.*, l.name as location_name, l.active as location_active
    into v_start
    from public.map_markers m
    join public.locations l on l.id = m.location_id
   where m.id = p_start_marker_id and m.active;
  select m.*, l.name as location_name, l.active as location_active
    into v_destination
    from public.map_markers m
    join public.locations l on l.id = m.location_id
   where m.id = p_destination_marker_id and m.active;
  if v_start.id is null or v_destination.id is null
      or not v_start.location_active or not v_destination.location_active then
    raise exception 'Both endpoints must use active campus markers.';
  end if;
  if p_status = 'active' and p_start_marker_id = p_destination_marker_id then
    raise exception 'A completed route needs two different endpoints.';
  end if;

  if v_route_id is not null then
    perform 1 from public.campus_routes where id = v_route_id for update;
    if not found then raise exception 'Saved route not found.'; end if;
    update public.campus_routes
       set name = btrim(p_name),
           start_marker_id = p_start_marker_id,
           destination_marker_id = p_destination_marker_id,
           status = p_status,
           accessibility_status = p_accessibility_status,
           notes = nullif(btrim(p_notes), ''),
           distance_map_units = null
     where id = v_route_id;
    delete from public.campus_route_points where route_id = v_route_id;
    delete from public.campus_route_segments where route_id = v_route_id;
  else
    insert into public.campus_routes (
      name, start_marker_id, destination_marker_id, status,
      accessibility_status, notes, created_by_legacy_admin_id
    ) values (
      btrim(p_name), p_start_marker_id, p_destination_marker_id, p_status,
      p_accessibility_status, nullif(btrim(p_notes), ''), p_created_by_legacy_admin_id
    ) returning id into v_route_id;
  end if;

  if p_start_marker_id = p_destination_marker_id and p_status <> 'active' then
    insert into public.audit_logs (admin_legacy_id, action, entity_type, entity_id, after_json)
    values (p_created_by_legacy_admin_id, case when p_route_id is null then 'create' else 'update' end,
            'campus_route', v_route_id, jsonb_build_object('status', p_status, 'segments', 0));
    return jsonb_build_object('id', v_route_id, 'distance_map_units', null,
                              'accessibility_status', p_accessibility_status);
  end if;

  if coalesce(v_start.route_node_id, 0) > 0 then
    select * into v_node from public.map_nodes where id = v_start.route_node_id and active;
    if not found then raise exception 'An endpoint points to an inactive route node. Update its map marker first.'; end if;
    v_node_id := v_node.id;
  else
    insert into public.map_nodes (node_key, x, y, floor_number)
    values ('route-' || v_route_id || '-start', v_start.x, v_start.y, v_start.floor_number)
    returning id into v_node_id;
    update public.map_markers set route_node_id = v_node_id where id = v_start.id;
  end if;
  v_ordered_nodes := array_append(v_ordered_nodes, v_node_id);
  v_ordered_types := array_append(v_ordered_types, 'start');
  v_ordered_notes := array_append(v_ordered_notes, null::text);

  for v_point in select value from jsonb_array_elements(p_waypoints)
  loop
    v_waypoint_index := v_waypoint_index + 1;
    if jsonb_typeof(v_point) <> 'object' then raise exception 'Invalid waypoint data.'; end if;
    if nullif(v_point->>'node_id', '') is not null then
      if (v_point->>'node_id') !~ '^[1-9][0-9]*$' then raise exception 'Invalid waypoint node ID.'; end if;
      v_node_id := (v_point->>'node_id')::bigint;
      perform 1 from public.map_nodes where id = v_node_id and active;
      if not found then raise exception 'A selected waypoint is missing or inactive.'; end if;
    else
      if coalesce(v_point->>'x', '') !~ '^[0-9]+([.][0-9]+)?$'
          or coalesce(v_point->>'y', '') !~ '^[0-9]+([.][0-9]+)?$' then
        raise exception 'Waypoint coordinates must be numbers.';
      end if;
      v_x := (v_point->>'x')::numeric;
      v_y := (v_point->>'y')::numeric;
      if v_x < 0 or v_x > 1330 or v_y < 0 or v_y > 1620 then
        raise exception 'A waypoint is outside the campus map bounds.';
      end if;
      if coalesce(v_point->>'floor_number', '0') !~ '^[0-9]{1,3}$' then
        raise exception 'Waypoint floor must be a non-negative whole number.';
      end if;
      v_floor := coalesce((v_point->>'floor_number')::integer, 0);
      if v_floor > 200 then raise exception 'Waypoint floor is outside the supported range.'; end if;
      insert into public.map_nodes (node_key, x, y, floor_number)
      values (
        'route-' || v_route_id || '-p' || v_waypoint_index || '-' || substr(md5(random()::text), 1, 6),
        v_x, v_y, v_floor
      ) returning id into v_node_id;
    end if;
    if v_point ? 'notes' and jsonb_typeof(v_point->'notes') not in ('string', 'null') then
      raise exception 'Waypoint notes must be text.';
    end if;
    if length(coalesce(v_point->>'notes', '')) > 255 then raise exception 'Waypoint notes cannot exceed 255 characters.'; end if;
    v_ordered_nodes := array_append(v_ordered_nodes, v_node_id);
    v_ordered_types := array_append(v_ordered_types, 'waypoint');
    v_ordered_notes := array_append(v_ordered_notes, nullif(btrim(v_point->>'notes'), ''));
  end loop;

  if coalesce(v_destination.route_node_id, 0) > 0 then
    select * into v_node from public.map_nodes where id = v_destination.route_node_id and active;
    if not found then raise exception 'An endpoint points to an inactive route node. Update its map marker first.'; end if;
    v_node_id := v_node.id;
  else
    insert into public.map_nodes (node_key, x, y, floor_number)
    values ('route-' || v_route_id || '-end', v_destination.x, v_destination.y, v_destination.floor_number)
    returning id into v_node_id;
    update public.map_markers set route_node_id = v_node_id where id = v_destination.id;
  end if;
  v_ordered_nodes := array_append(v_ordered_nodes, v_node_id);
  v_ordered_types := array_append(v_ordered_types, 'destination');
  v_ordered_notes := array_append(v_ordered_notes, null::text);

  for v_candidate in
    select id from public.campus_routes
     where id <> v_route_id
       and ((start_marker_id = p_start_marker_id and destination_marker_id = p_destination_marker_id)
         or (start_marker_id = p_destination_marker_id and destination_marker_id = p_start_marker_id))
  loop
    select array_agg(node_id order by sequence_no) into v_candidate_nodes
      from public.campus_route_points where route_id = v_candidate.id;
    if coalesce(array_length(v_candidate_nodes, 1), 0) <> array_length(v_ordered_nodes, 1) then continue; end if;
    v_same := true;
    v_reverse_same := true;
    for v_sequence in 1..array_length(v_ordered_nodes, 1)
    loop
      select x, y, floor_number into v_node from public.map_nodes where id = v_ordered_nodes[v_sequence];
      select x, y, floor_number into v_other from public.map_nodes where id = v_candidate_nodes[v_sequence];
      if v_node.floor_number <> v_other.floor_number
          or abs(v_node.x - v_other.x) > 1 or abs(v_node.y - v_other.y) > 1 then v_same := false; end if;
      select x, y, floor_number into v_other
        from public.map_nodes where id = v_candidate_nodes[array_length(v_candidate_nodes, 1) - v_sequence + 1];
      if v_node.floor_number <> v_other.floor_number
          or abs(v_node.x - v_other.x) > 1 or abs(v_node.y - v_other.y) > 1 then v_reverse_same := false; end if;
    end loop;
    if v_same or v_reverse_same then raise exception 'An identical route already exists. Edit the saved route instead of creating a duplicate.'; end if;
  end loop;

  for v_sequence in 1..array_length(v_ordered_nodes, 1)
  loop
    insert into public.campus_route_points (route_id, sequence_no, node_id, point_type, notes)
    values (v_route_id, v_sequence, v_ordered_nodes[v_sequence], v_ordered_types[v_sequence], v_ordered_notes[v_sequence]);
  end loop;

  for v_sequence in 1..array_length(v_ordered_nodes, 1) - 1
  loop
    select x, y, floor_number into v_node from public.map_nodes where id = v_ordered_nodes[v_sequence];
    select x, y, floor_number into v_other from public.map_nodes where id = v_ordered_nodes[v_sequence + 1];
    if v_ordered_nodes[v_sequence] = v_ordered_nodes[v_sequence + 1] then
      raise exception 'Two consecutive route points are the same. Remove or reorder the duplicate waypoint.';
    end if;
    if p_status <> 'active' then
      v_distance := v_distance + sqrt(
        power((v_node.x - v_other.x)::double precision, 2)
        + power((v_node.y - v_other.y)::double precision, 2)
      )::numeric;
      continue;
    end if;

    select * into v_connection from public.map_connections
     where (from_node_id = v_ordered_nodes[v_sequence] and to_node_id = v_ordered_nodes[v_sequence + 1])
        or (from_node_id = v_ordered_nodes[v_sequence + 1] and to_node_id = v_ordered_nodes[v_sequence])
     limit 1 for update;
    if found then
      if not v_connection.active then raise exception 'A route segment is archived. Choose different points.'; end if;
      if v_node.floor_number <> v_other.floor_number
          and v_connection.connection_type not in ('stairs', 'ramp', 'elevator') then
        raise exception 'Floor changes require a mapped stair, ramp, or elevator connection.';
      end if;
      v_weight := v_connection.weight;
      v_all_accessible := v_all_accessible and v_connection.verified and v_connection.accessibility_status is true;
    else
      if v_node.floor_number <> v_other.floor_number then
        raise exception 'Floor changes need a mapped stair, ramp, or elevator connection first.';
      end if;
      v_weight := greatest(0.1::numeric, sqrt(
        power((v_node.x - v_other.x)::double precision, 2)
        + power((v_node.y - v_other.y)::double precision, 2)
      )::numeric);
      insert into public.map_connections (from_node_id, to_node_id, weight, connection_type, verified, accessibility_status)
      values (v_ordered_nodes[v_sequence], v_ordered_nodes[v_sequence + 1], v_weight, 'walkway', false, null)
      returning * into v_connection;
      v_all_accessible := false;
    end if;
    v_distance := v_distance + v_weight;
    insert into public.campus_route_segments (route_id, sequence_no, connection_id)
    values (v_route_id, v_sequence, v_connection.id);
  end loop;

  v_all_accessible := v_all_accessible
    and v_start.accessibility_status is true
    and v_destination.accessibility_status is true;
  if p_accessibility_status is true and (p_status <> 'active' or not v_all_accessible) then
    raise exception 'Accessible routes require verified active paths, accessible endpoints, and every accessible segment.';
  end if;
  update public.campus_routes
     set distance_map_units = round(v_distance, 2),
         accessibility_status = p_accessibility_status
   where id = v_route_id;
  insert into public.audit_logs (admin_legacy_id, action, entity_type, entity_id, after_json)
  values (p_created_by_legacy_admin_id, case when p_route_id is null then 'create' else 'update' end,
          'campus_route', v_route_id,
          jsonb_build_object('status', p_status, 'segments', array_length(v_ordered_nodes, 1) - 1));
  return jsonb_build_object('id', v_route_id, 'distance_map_units', round(v_distance, 2),
                            'accessibility_status', p_accessibility_status);
end;
$$;

revoke all on function public.save_campus_route(bigint, text, bigint, bigint, text, boolean, text, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.save_campus_route(bigint, text, bigint, bigint, text, boolean, text, jsonb, bigint)
  to service_role;
