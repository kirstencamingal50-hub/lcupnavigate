// Regenerates the review-pending seed from the legacy map and directory modules.
// It does not make the data official: every imported record starts unverified.
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { mapPins, mapGates, mapJunctions, mapBackbone } from '../assets/js/map-pins.js';
const legacyDataSource = await readFile(new URL('../data/campus-data.js', import.meta.url), 'utf8');
const extractArray = (name) => {
  const found = legacyDataSource.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\]);`));
  if (!found) throw new Error(`Could not locate ${name} in data/campus-data.js`);
  return vm.runInNewContext(`(${found[1]})`);
};
const legacyBuildings = extractArray('CAMPUS_BUILDINGS');
const legacyRooms = extractArray('CAMPUS_ROOMS');
const normalize = (name) => name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const categoryFor = (name, hint = '') => {
  const text = `${name} ${hint}`.toLowerCase();
  if (/clinic|medical|health/.test(text)) return 'Medical';
  if (/cafe|coffee|canteen|dining|food/.test(text)) return 'Food and Dining';
  if (/court|pool|gym|sports|olympic/.test(text)) return 'Sports and Recreation';
  if (/auditorium|conference|activity center|hall/.test(text)) return 'Events and Conference';
  if (/forest|garden|farm|grotto|grounds|rotonda|stage|outdoor/.test(text)) return 'Outdoor';
  if (/administration|office|registrar|finance|president/.test(text)) return 'Administrative';
  if (/academic|building|laboratory|student center/.test(text)) return 'Academic';
  return null;
};

const locations = [];
const byName = new Map();
const roomBuildingNames = new Set(legacyRooms.map(([, , buildingName]) => normalize(buildingName)));
function addLocation(name, kind, legacyId = null, categoryHint = '') {
  const key = normalize(name);
  let item = byName.get(key);
  if (!item) {
    item = { legacy_id: legacyId, name, kind, category: categoryFor(name, categoryHint), description: null, verified: false };
    byName.set(key, item); locations.push(item);
  }
  return item;
}

for (const item of legacyBuildings) {
  const hint = item.category || '';
  const kind = roomBuildingNames.has(normalize(item.name)) || /academic|administrative building/i.test(hint) ? 'building' : 'facility';
  addLocation(item.name, kind, item.id, hint);
}
for (const pin of mapPins) addLocation(pin.name, 'building', pin.id, '');
for (const gate of mapGates) {
  const saved = addLocation(gate.name, 'facility', gate.id, '');
  saved.kind = 'facility';
  saved.category = null;
}

const rooms = legacyRooms.map(([room_number, name, building_name]) => ({
  building_name, room_number, name, floor_number: 0, floor_label: null,
  capacity: null, description: null, verified: false
}));

const markers = [...mapGates, ...mapPins].map((pin) => ({
  location_name: byName.get(normalize(pin.name)).name,
  x: pin.px[0], y: pin.px[1], floor_number: 0, map_key: 'campus', verified: false
}));
const nodes = Object.entries(mapJunctions).map(([node_key, point]) => ({
  node_key, x: point[0], y: point[1], floor_number: 0, verified: false
}));
const connections = mapBackbone.map(([from_node_key, to_node_key]) => ({
  from_node_key, to_node_key, weight: Math.hypot(
    mapJunctions[from_node_key][0] - mapJunctions[to_node_key][0],
    mapJunctions[from_node_key][1] - mapJunctions[to_node_key][1]
  ), verified: false, accessible: null
}));

const result = { source: 'legacy project files; pending campus review', locations, rooms, markers, nodes, connections };
await writeFile(new URL('./initial-data.json', import.meta.url), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(`Wrote ${locations.length} locations, ${rooms.length} rooms, ${markers.length} markers, ${nodes.length} nodes, ${connections.length} unverified connections.`);
