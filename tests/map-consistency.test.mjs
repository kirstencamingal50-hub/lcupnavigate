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


test('admin route editor keeps building marker nodes separate from shared walkway junctions', async () => {
  const routeBuilder = await read('../assets/js/admin/route-builder.js');
  assert.match(routeBuilder, /function markerNodeIds\(\)/);
  assert.match(routeBuilder, /marker\.route_node_id/);
  assert.match(routeBuilder, /const junctionNodes = mapData\.nodes\.filter\(node =>[\s\S]*?!buildingNodeIds\.has\(String\(node\.id\)\)/);
  assert.match(routeBuilder, /Shared walkway junction/);
  assert.match(routeBuilder, /saved route/);
});

test('new route waypoints snap only to reusable walkway junctions, never building marker nodes', async () => {
  const routeBuilder = await read('../assets/js/admin/route-builder.js');
  assert.match(routeBuilder, /const protectedMarkerNodes = markerNodeIds\(\)/);
  assert.match(routeBuilder, /!protectedMarkerNodes\.has\(String\(node\.id\)\)/);
  assert.match(routeBuilder, /Number\(node\.floor_number \|\| 0\) === 0/);
  assert.match(routeBuilder, /nearest\.distance<=Math\.max\(26,26\*W\/mapElement\.clientWidth\)/);
});


test('admin route editor provides a visible alignment grid and optional grid snapping', async () => {
  const adminMap = await read('../pages/admin/manage-map.html');
  const routeBuilder = await read('../assets/js/admin/route-builder.js');
  assert.match(adminMap, /id="route-grid-toggle"/);
  assert.match(adminMap, /id="route-snap-toggle"/);
  assert.match(adminMap, /id="route-grid-layer"/);
  assert.match(adminMap, /route-grid-minor/);
  assert.match(adminMap, /route-grid-major/);
  assert.match(routeBuilder, /const GRID_SIZE = 50/);
  assert.match(routeBuilder, /function snapToGrid\(point\)/);
  assert.match(routeBuilder, /gridLayer\.style\.display/);
  assert.match(routeBuilder, /snapToGrid\(mapPoint\(event\)\)/);
});


test('admin route editor includes synchronized zoom controls and a wider map layout', async () => {
  const adminMap = await read('../pages/admin/manage-map.html');
  const routeBuilder = await read('../assets/js/admin/route-builder.js');
  const adminCss = await read('../assets/css/admin.css');
  for (const id of ['route-zoom-in', 'route-zoom-out', 'route-zoom-reset', 'route-zoom-level']) {
    assert.ok(adminMap.includes(`id="${id}"`));
  }
  assert.match(routeBuilder, /function applyMapZoom\(\)/);
  assert.match(routeBuilder, /zoomTargets\.forEach/);
  assert.match(routeBuilder, /\/mapZoom/);
  assert.match(routeBuilder, /mapPanX/);
  assert.match(routeBuilder, /panning\.originX/);
  assert.match(routeBuilder, /route-map-fullscreen/);
  assert.match(adminMap, /id="route-map-fullscreen"/);
  assert.match(adminCss, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(adminCss, /\.route-builder-layout\.is-map-fullscreen/);
  assert.match(adminCss, /\.route-editor-map\.is-zoomed/);
});

test('admin route editor displays a responsive alignment grid above the campus map', async () => {
  const adminMap = await read('../pages/admin/manage-map.html');
  const adminCss = await read('../assets/css/admin.css');
  assert.match(adminMap, /id="route-grid-layer" class="route-editor-grid"/);
  assert.match(adminMap, /id="route-grid-toggle"/);
  assert.match(adminCss, /\.route-editor-grid\s*\{/);
  assert.match(adminCss, /background-image:[\s\S]*linear-gradient\(to right/);
  assert.match(adminCss, /background-size:[\s\S]*3\.7594% 100%/);
  assert.match(adminCss, /\.route-editor-map > svg \{ z-index: 2/);
});

test('admin route editor can add reusable junction waypoints along long route segments', async () => {
  const adminMap = await read('../pages/admin/manage-map.html');
  const routeBuilder = await read('../assets/js/admin/route-builder.js');
  assert.match(adminMap, /id="route-add-junctions"/);
  assert.match(routeBuilder, /const maxSpacing = 150/);
  assert.match(routeBuilder, /route-add-junctions/);
  assert.match(routeBuilder, /Save the route to store them in the shared walkway network/);
  assert.match(routeBuilder, /markerNodes\.has\(String\(node\.id\)\)/);
  assert.match(routeBuilder, /expanded\.length > 100/);
});


test('route editor renders small round fixed-size junctions matching building markers', async () => {
  const adminMap = await read('../pages/admin/manage-map.html');
  const routeBuilder = await read('../assets/js/admin/route-builder.js');
  const adminCss = await read('../assets/css/admin.css');
  assert.match(adminMap, /id="route-editor-junctions"/);
  assert.match(routeBuilder, /route-editor-junctions/);
  assert.match(routeBuilder, /route-junction-marker/);
  assert.match(adminCss, /\.route-map-location \{[^}]*width: 12px; height: 12px/s);
  assert.match(adminCss, /\.route-editor-junctions \.route-junction-marker\s*\{[^}]*width: 12px;[^}]*height: 12px/s);
  assert.match(adminCss, /border-radius: 50%/);
});


test('route editor preserves the campus map aspect ratio and visually aligns nearby walkway nodes', async () => {
  const routeBuilder = await read('../assets/js/admin/route-builder.js');
  const adminCss = await read('../assets/css/admin.css');
  assert.match(routeBuilder, /displayPointById/);
  assert.match(routeBuilder, /Math\.hypot\(cluster\.x - Number\(node\.x\), cluster\.y - Number\(node\.y\)\) <= 28/);
  assert.match(routeBuilder, /displayPointById\.get/);
  assert.match(adminCss, /calc\(min\(78vh, 1100px\) \* 1330 \/ 1620\)/);
  assert.match(adminCss, /width: 12px;\s*height: 12px;/);
});


test('landmark picker and route editor share the same campus map dimensions', async () => {
  const adminMap = await read('../pages/admin/manage-map.html');
  const adminCss = await read('../assets/css/admin.css');
  const landmarkJs = await read('../assets/js/admin/manage-map.js');
  assert.match(adminMap, /id="landmark-map-picker"[^>]*class="landmark-map-picker/);
  assert.match(adminCss, /\.landmark-map-picker,[\s\S]*?\.route-editor-map\s*\{/);
  assert.match(adminCss, /width: min\(100%, calc\(min\(78vh, 1100px\) \* 1330 \/ 1620\)\)/);
  assert.doesNotMatch(adminMap, /landmark-map-picker[^>]*max-w-\[520px\]/);
  assert.match(landmarkJs, /const getMapCoordinates = event =>/);
  assert.match(landmarkJs, /event\.clientX - rect\.left - picker\.clientLeft/);
});


test('route save and publish actions stay in the waypoint panel beside the map', async () => {
  const adminMap = await read('../pages/admin/manage-map.html');
  const adminCss = await read('../assets/css/admin.css');
  const asideStart = adminMap.indexOf('<aside class="route-waypoint-panel">');
  const saveActions = adminMap.indexOf('class="route-save-actions');
  const asideEnd = adminMap.indexOf('</aside>', asideStart);
  assert.ok(saveActions > asideStart && saveActions < asideEnd);
  assert.match(adminCss, /grid-template-columns: minmax\(0, 2fr\) minmax\(260px, \.82fr\)/);
  assert.match(adminCss, /\.route-save-actions \{ position: sticky/);
  assert.match(adminMap, /id="route-publish"/);
  assert.match(adminMap, /id="route-save-draft"/);
});
