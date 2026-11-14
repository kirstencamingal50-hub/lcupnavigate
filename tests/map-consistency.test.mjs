import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

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
  assert.match(mapPage, /`\s*n:\$\{node\.id\}`/);
  assert.match(mapPage, /`\s*n:\$\{edge\.from_node_id\}`/);
  assert.match(mapPage, /id\.startsWith\('n:'\)\s*&&\s*nId\.startsWith\('n:'\)/);
  assert.match(mapPage, /id\.startsWith\('j:'\)\s*&&\s*nId\.startsWith\('j:'\)/);
  assert.doesNotMatch(mapPage, /if\s*\(!id\.startsWith\('j:'\)\)\s*return;/);
  assert.match(mapPage, /room\.buildingId/);
  assert.match(mapPage, /route\.accessible_confirmed/);
});

test('Netlify map queries use schema foreign keys and frontend-compatible directory fields', () => {
  assert.match(api, /locations!fk_locations_parent/);
  assert.match(api, /locations!fk_rooms_building/);
  assert.match(api, /locations!fk_marker_location/);
  assert.match(api, /map_markers!campus_routes_start_marker_id_fkey/);
  assert.match(api, /map_markers!campus_routes_destination_marker_id_fkey/);
  assert.match(api, /buildingId:\s*row\.building_id/);
  assert.match(api, /floorNumber:\s*row\.floor_number/);
  assert.match(api, /node:map_nodes\(id,node_key,x,y,floor_number\)/);
  assert.match(api, /accessible_confirmed:\s*accessibleConfirmed/);
  assert.match(api, /edge => admin \|\| \(edge\.isValidFloorTransition && edge\.verified\)/);
});

test('mapping mutations generate and preserve node keys and call the route RPC contract', () => {
  assert.match(mutations, /`node-\$\{randomUUID\(\)\}`/);
  assert.match(mutations, /existing\?\.node_key/);
  assert.match(mutations, /updateById\('map_connections', id, \{ active: false \}, 'Connection not found\.'\)/);
  assert.match(mutations, /database\.rpc\('save_campus_route',\s*\{/);
  for (const parameter of [
    'p_route_id', 'p_name', 'p_start_marker_id', 'p_destination_marker_id',
    'p_status', 'p_accessibility_status', 'p_notes', 'p_waypoints',
    'p_created_by_legacy_admin_id'
  ]) {
    assert.match(mutations, new RegExp(`${parameter}:`));
    assert.match(routeMigration, new RegExp(`\\b${parameter}\\b`));
  }
});
