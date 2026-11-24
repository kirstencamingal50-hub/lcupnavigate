import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getSavedRouteDirection } from '../assets/js/route-utils.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [mapPage, api, mutations, routeMigration] = await Promise.all([
  read('../pages/map.html'),
  read('../netlify/functions/api.mjs'),
  read('../netlify/functions/_shared/mutations.mjs'),
  read('../supabase/migrations/20261114230000_route_save_rpc.sql')
]);

test('map frontend keeps database nodes, legacy junctions, and API loading aligned', () => {
  const mapCall = mapPage.indexOf("CampusApi.get('map')");
  const directoryCall = mapPage.indexOf("CampusApi.get('directory')");
  const routesCall = mapPage.indexOf("CampusApi.get('routes/available')");
  assert.ok(mapCall >= 0 && mapCall < directoryCall && directoryCall < routesCall);
  assert.match(mapPage, /[\x60]\s*n:\$\{node\.id\}[\x60]/);
  assert.match(mapPage, /[\x60]\s*n:\$\{edge\.from_node_id\}[\x60]/);
  assert.match(mapPage, /id\.startsWith\('n:'\)\s*&&\s*nId\.startsWith\('n:'\)/);
  assert.match(mapPage, /id\.startsWith\('j:'\)\s*&&\s*nId\.startsWith\('j:'\)/);
  assert.doesNotMatch(mapPage, /if\s*\(!id\.startsWith\('j:'\)\)\s*return;/);
  assert.match(mapPage, /room\.buildingId/);
  assert.match(mapPage, /route\.accessible_confirmed/);
});

test('public map cleanup removes deleted-location nodes and every dependent route edge', () => {
  assert.match(api, /from\('locations'\)[\s\S]*?\.eq\('active', true\)/);
  assert.match(api, /like\('node_key', 'location-%'\)/);
  assert.match(api, /match\(\/\^location-\(/);
  assert.match(api, /incidentConnectionIds\.has\(Number\(row\.connection_id\)\)/);
  assert.match(api, /from\('map_connections'\)\.delete\(\)\.in\('id', connectionIds\)/);
  assert.match(api, /from\('map_nodes'\)\.delete\(\)\.in\('id', staleLocationNodeIds\)/);
});

test('public map cleanup removes orphaned route geometry before loading graph data', () => {
  assert.match(api, /await cleanupOrphanedRouteGeometry\(db\)/);
  assert.match(api, /from\('campus_route_segments'\)/);
  assert.match(api, /from\('campus_route_points'\)/);
  assert.match(api, /like\('node_key', 'route-%'\)/);
  assert.match(api, /update\(\{ route_node_id: null \}\)/);
  assert.match(api, /from\('map_connections'\)\.delete\(\)/);
  assert.match(api, /route\.start_marker\?\.id !== route\.destination_marker\?\.id/);
});

test('Netlify map queries use schema foreign keys and frontend-compatible directory fields', () => {
  // Parent buildings are resolved in JavaScript to avoid depending on the
  // PostgREST self-referencing relationship being present in its schema cache.
  assert.match(api, /Resolve the self-referencing parent building in JavaScript/);
  assert.match(api, /locationById\.get\(String\(row\.parent_building_id\)\)/);
  assert.match(api, /building:locations!fk_rooms_building/);
  assert.match(api, /location:locations!fk_marker_location/);
  assert.match(api, /map_markers!campus_routes_start_marker_id_fkey/);
  assert.match(api, /map_markers!campus_routes_destination_marker_id_fkey/);
  assert.match(api, /buildingId:\s*row\.building_id/);
  assert.match(api, /floorNumber:\s*row\.floor_number/);
  assert.match(api, /node:map_nodes\(id,node_key,x,y,floor_number\)/);
  assert.match(api, /accessible_confirmed:\s*accessibleConfirmed/);
  assert.match(api, /filter\(edge => admin \|\| \(edge\.isValidFloorTransition && edge\.verified\)\)/);
  // Published route segments are included separately from the verified
  // general walkway network, and their endpoints are attached to map markers.
  assert.ok(mapPage.includes(".filter(route => route.status === 'active')"));
  assert.ok(mapPage.includes(".sort((a,b)=>Number(a.sequence_no)-Number(b.sequence_no))"));
  // The selected visitor path must use the same saved waypoint sequence as the graph.
  assert.match(mapPage, /let points = \(route\.points \|\| \[\]\)\s*\.filter\(point => point\.node_id && graph\[`n:\$\{point\.node_id\}`\]\)\s*\.sort\(\(a,b\)=>Number\(a\.sequence_no\)-Number\(b\.sequence_no\)\);/);
  // The public map shows the selected route by default; the general walkway
  // network is optional so old/shared connections do not look like saved routes.
  assert.match(mapPage, /id="netToggleBox" class=/);
  assert.doesNotMatch(mapPage, /id="netToggleBox" checked/);
  // Keep the faint blue walkway network available when visitors enable it.
  assert.ok(mapPage.includes("opacity: 0.28, lineCap: 'round', lineJoin: 'round', interactive: false"));
  assert.ok(!mapPage.includes('networkLayer.eachLayer(l => l.bringToBack())'));
  assert.ok(mapPage.includes('If an administrator published this exact origin/destination pair'));
  assert.ok(mapPage.includes('if (savedOptions.length)'));
  assert.ok(mapPage.includes('During navigation, show only the selected route'));
  assert.ok(!mapPage.includes('addEdge(previous,current,null,accessible)'));
  assert.ok(mapPage.includes("locations.filter(loc => String(loc.routeLocationId ?? loc.id) === String(route.start_location_id))"));
  assert.ok(mapPage.includes("locations.filter(loc => String(loc.routeLocationId ?? loc.id) === String(route.destination_location_id))"));
  assert.ok(mapPage.includes("if (path[0] !== startId)"));
  assert.ok(mapPage.includes("if (path[path.length - 1] !== endId)"));
  assert.ok(mapPage.includes("path.push(endId)"));
});

test('map and route API pagination loads every record beyond the Supabase row cap', () => {
  assert.match(api, /async function fetchAllRows\(buildQuery, pageSize = 500\)/);
  assert.match(api, /buildQuery\(\)\.range\(offset, offset \+ pageSize - 1\)/);
  // Map markers, nodes, and connections all feed the route graph.
  assert.match(api, /fetchAllRows\(\(\) => db\.from\('map_markers'\)/);
  assert.match(api, /fetchAllRows\(\(\) => db\.from\('map_nodes'\)/);
  assert.match(api, /fetchAllRows\(\(\) => db\.from\('map_connections'\)/);
  // Both route headers and the complete waypoint table must be paged.
  assert.match(api, /const routes = await fetchAllRows\(\(\) =>/);
  assert.match(api, /const pointsResult = await fetchAllRows\(\(\) => db\.from\('campus_route_points'\)/);
  assert.match(api, /\.order\('sequence_no'\)\s*\.order\('route_id'\)/);
});

test('mapping mutations generate and preserve node keys and call the route RPC contract', () => {
  assert.match(mutations, /[\x60]node-\$\{randomUUID\(\)\}[\x60]/);
  assert.match(mutations, /existing\?\.node_key/);
  assert.match(mutations, /deleteCampusRecord\(database, 'map_connection', id\)/);
  // Deleting a saved route must also remove its own geometry and only orphaned
  // route-generated map connections, while retaining shared walkway edges.
  assert.match(mutations, /from\('campus_route_segments'\)\.delete\(\)\.eq\('route_id', id\)/);
  assert.match(mutations, /from\('campus_route_points'\)\.delete\(\)\.eq\('route_id', id\)/);
  assert.match(mutations, /startsWith\([\x60]route-\$\{id\}-[\x60]\)/);
  assert.match(mutations, /shared_walkways_preserved: true/);
  assert.match(mutations, /node_key: [\x60]location-\$\{locationId\}[\x60]/);
  assert.match(mutations, /existingMarker\?\.route_node_id/);
  assert.match(mutations, /route_node_id: nodeId/);
  assert.match(mutations, /\.upsert\([\s\S]*?onConflict: 'node_key'/);
  assert.match(mutations, /database\.rpc\('save_campus_route',\s*\{/);
  for (const parameter of [
    'p_route_id', 'p_name', 'p_start_marker_id', 'p_destination_marker_id',
    'p_status', 'p_accessibility_status', 'p_notes', 'p_waypoints',
    'p_created_by_legacy_admin_id'
  ]) {
    assert.match(mutations, new RegExp(parameter + ':'));
    assert.match(routeMigration, new RegExp('\\b' + parameter + '\\b'));
  }
});

test('admin map no longer exposes floor-plan uploads or manual graph connection forms', async () => {
  const adminMap = await read('../pages/admin/manage-map.html');
  const mapScript = await read('../assets/js/admin/manage-map.js');
  assert.doesNotMatch(adminMap, /floorplan-form|floorplans-list|floorplan-title|Upload floor plan/i);
  assert.doesNotMatch(adminMap, /map-connection-form|map-connection-list|map-connections\.js/i);
  assert.doesNotMatch(adminMap, /name="route_node_id"/);
  assert.doesNotMatch(mapScript, /floorplans|form\.elements\.route_node_id/);
  assert.match(adminMap, /generated automatically from saved route paths/i);
});

test('a published saved route is available in both endpoint directions without a duplicate route record', async () => {
  const mapPage = await read('../pages/map.html');
  assert.ok(mapPage.includes("getSavedRouteDirection(route, startLocation, endLocation)"));
  assert.ok(mapPage.includes("if (direction === 'reverse') points = points.reverse()"));
  assert.ok(mapPage.includes('graph[startId].neighbors[path[0]]'));
  assert.ok(mapPage.includes('graph[endId].neighbors[path[path.length - 1]]'));
  assert.ok(mapPage.includes("path[0] !== startId || path[path.length - 1] !== endId"));
});

test('saved routes resolve in both directions using marker or location IDs', () => {
  const route = { start_marker_id: 12, destination_marker_id: 29, start_location_id: 4, destination_location_id: 9 };
  const buildingA = { id: '4', markerId: '12' };
  const buildingB = { id: '9', markerId: '29' };
  assert.equal(getSavedRouteDirection(route, buildingA, buildingB), 'forward');
  assert.equal(getSavedRouteDirection(route, buildingB, buildingA), 'reverse');
  assert.equal(getSavedRouteDirection(route, buildingA, { id: 10, markerId: 35 }), null);
});

test('saved route direction falls back to location IDs when marker IDs are unavailable', () => {
  const route = { start_location_id: 4, destination_location_id: 9 };
  assert.equal(getSavedRouteDirection(route, { id: 4 }, { id: 9 }), 'forward');
  assert.equal(getSavedRouteDirection(route, { id: 9 }, { id: 4 }), 'reverse');
});


test('saved route location endpoints take priority over shared building marker IDs', () => {
  const route = { start_marker_id: 12, destination_marker_id: 29, start_location_id: 4, destination_location_id: 9 };
  const roomInBuildingA = { id: 'room-101', routeLocationId: '4', markerId: 12 };
  const roomInBuildingB = { id: 'room-202', routeLocationId: '9', markerId: 29 };
  const unrelatedRoomWithSameStartMarker = { id: 'room-303', routeLocationId: '15', markerId: 12 };
  assert.equal(getSavedRouteDirection(route, roomInBuildingA, roomInBuildingB), 'forward');
  assert.equal(getSavedRouteDirection(route, roomInBuildingB, roomInBuildingA), 'reverse');
  assert.equal(getSavedRouteDirection(route, unrelatedRoomWithSameStartMarker, roomInBuildingB), null);
});

test('room locations retain their parent building route location ID', () => {
  assert.match(mapPage, /routeLocationId:building\.id/);
});
