import { getServiceClient } from './_shared/supabase.mjs';
import { HttpError, errorResponse, requestBody, requiredText, success, unwrap } from './_shared/http.mjs';

const db = () => getServiceClient();
const MAX_CONTEXT_ROWS = 250;
const STOP_WORDS = new Set([
  'where', 'is', 'the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for',
  'find', 'show', 'me', 'please', 'can', 'could', 'i', 'do', 'tell',
  'about', 'what', 'which', 'are', 'available', 'located', 'near',
  'give', 'directions', 'how', 'get', 'there', 'office', 'building',
  'room', 'place', 'campus'
]);

function clean(value) {
  return String(value ?? '').replace(/\\s+/g, ' ').trim();
}

function words(value) {
  return clean(value).toLowerCase().match(/[a-z0-9]+/g) || [];
}

function score(question, record) {
  const terms = [...new Set(words(question).filter(word => word.length >= 3 && !STOP_WORDS.has(word)))];
  if (!terms.length) return 0;

  const nameWords = new Set(words(record.name));
  const haystackWords = new Set(words([
    record.name, record.kind, record.description, record.category,
    record.building_name, record.parent_building_name, record.department_name,
    record.room_number, record.floor_number, record.services,
    record.contact_email, record.service_hours
  ].join(' ')));

  return terms.reduce((total, word) => {
    if (nameWords.has(word)) return total + 6;
    if (haystackWords.has(word)) return total + 2;
    return total;
  }, 0);
}

async function campusContext(question) {
  const database = db();
  const [locationResult, roomResult, announcementResult, routeResult, departmentResult, departmentLocationResult] = await Promise.all([
    database.from('locations').select('id,name,kind,description,category_id,parent_building_id,department_name,contact_email,contact_phone,service_hours,access_hours,days_open,services,accessibility_status,accessibility_details,accessibility_features,image_path,active').eq('active', true).order('name').limit(MAX_CONTEXT_ROWS),
    database.from('rooms').select('id,name,room_number,floor_number,floor_label,description,function_description,department_name,contact_email,contact_info,service_hours,accessibility_status,accessibility_details,building_id,active').eq('active', true).order('name').limit(MAX_CONTEXT_ROWS),
    database.from('announcements').select('id,title,body,status,publish_at,event_start,event_end,location_id').eq('status', 'published').order('created_at', { ascending: false }).limit(50),
    database.from('campus_routes').select('id,name,notes,start_marker_id,destination_marker_id,status').eq('status', 'active').limit(100),
    database.from('departments').select('id,name,description,office_hours,contact_email,contact_phone,image_path,active').eq('active', true).order('name').limit(150),
    database.from('department_locations').select('department_id,building_id,room_id,floor_number,room_number').limit(300)
  ]);
  const locations = unwrap(locationResult) || [];
  const rooms = unwrap(roomResult) || [];
  const announcements = unwrap(announcementResult) || [];
  const routes = unwrap(routeResult) || [];
  const departments = unwrap(departmentResult) || [];
  const departmentAssignments = unwrap(departmentLocationResult) || [];
  const byId = new Map(locations.map(item => [String(item.id), item]));
  const records = [
    ...locations.map(item => ({ ...item, building_name: item.parent_building_id ? byId.get(String(item.parent_building_id))?.name : (item.kind === 'building' ? item.name : null), record_type: item.kind || 'location' })),
    ...rooms.map(item => ({ ...item, building_name: byId.get(String(item.building_id))?.name || null, record_type: 'room' })),
    ...announcements.map(item => ({ ...item, name: item.title, description: item.body, record_type: 'announcement', building_name: item.location_id ? byId.get(String(item.location_id))?.name : null })),
    ...routes.map(item => ({ ...item, description: item.notes, name: item.name || 'Campus route', record_type: 'route' })),
    ...departments.map(department => {
      const assignments = departmentAssignments.filter(item => String(item.department_id) === String(department.id));
      const buildingNames = assignments.map(item => byId.get(String(item.building_id))?.name).filter(Boolean);
      const roomNames = assignments.map(item => rooms.find(room => String(room.id) === String(item.room_id))?.room_number || item.room_number).filter(Boolean);
      return { ...department, name: department.name, department_name: department.name, building_name: [...new Set(buildingNames)].join(', '), room_number: roomNames.join(', '), record_type: 'department' };
    })
  ];

  const ranked = records
    .map(record => ({ ...record, relevance: score(question, record) }))
    .filter(record => record.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);

  if (!ranked.length) return [];

  // Keep only genuinely relevant matches. Generic words such as "office",
  // "building", and "where" must never pull unrelated campus records in.
  const bestScore = ranked[0].relevance;
  const minimumScore = bestScore >= 6 ? Math.max(2, bestScore - 2) : bestScore;
  return ranked.filter(record => record.relevance >= minimumScore).slice(0, 8);
}

function displayName(item, question = '') {
  const name = clean(item.name);
  if (item.record_type === 'room' && /^registrar$/i.test(name) && /registrar/i.test(question)) {
    return "Registrar's Office";
  }
  return name;
}

function locationDescription(item) {
  return [
    item.building_name,
    item.floor_label || (item.floor_number != null ? `Floor ${item.floor_number}` : null),
    item.room_number ? `Room ${item.room_number}` : null
  ].filter(Boolean).join(', ');
}

function publicAnswer(question, matches) {
  if (!matches.length) {
    return 'I could not find a matching campus record. Try the exact building, department, office, room, or facility name, or browse the Campus Directory.';
  }

  const placeRecords = matches.filter(item => ['building', 'facility', 'room', 'location', 'department'].includes(item.record_type));
  if (!placeRecords.length && matches[0].record_type === 'announcement') {
    const item = matches[0];
    return `Here is the campus update I found: ${clean(item.title)}. ${clean(item.body)}`.trim();
  }

  // A direct office/room question should receive one direct answer, not a
  // generic list of loosely related buildings and facilities.
  const best = placeRecords[0];
  if (best && best.record_type === 'room' && best.building_name) {
    const where = locationDescription(best);
    const label = displayName(best, question);
    return `${label} is located in ${where}.`;
  }

  if (placeRecords.length === 1) {
    const item = placeRecords[0];
    const where = locationDescription(item);
    return where ? `${displayName(item, question)} is located at ${where}.` : `I found ${displayName(item, question)} in the campus records.`;
  }

  const lines = placeRecords.slice(0, 5).map(item => {
    const location = locationDescription(item);
    const details = [clean(item.description), clean(item.service_hours) ? `Hours: ${clean(item.service_hours)}` : null, clean(item.contact_email) ? `Email: ${clean(item.contact_email)}` : null].filter(Boolean);
    return `• ${displayName(item, question)}${location ? ` — ${location}` : ''}${details.length ? `\\n  ${details.join(' · ')}` : ''}`;
  });

  return `Here is the most relevant campus information I found:\\n\\n${lines.join('\\n')}\\n\\nSelect “Show on Map” to view a location on the campus map.`;
}

function answer(question, matches) {
  return { answer: publicAnswer(question, matches), mode: 'campus-record-search' };
}

export const handler = async event => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const body = requestBody(event);
    const question = requiredText(body.question, 'Question', 500);
    const matches = await campusContext(question);
    const result = await answer(question, matches);
    const locations = matches
      .filter(item => ['building', 'facility', 'room', 'location', 'department'].includes(item.record_type))
      .slice(0, 6)
      .map(item => {
        const targetName = item.record_type === 'room'
          ? item.building_name
          : item.record_type === 'department'
            ? String(item.building_name || '').split(',')[0].trim()
            : item.name;
        return {
          id: item.id,
          name: displayName(item, question),
          kind: item.record_type,
          building: item.building_name || null,
          floor: item.floor_number ?? null,
          floor_label: item.floor_label || null,
          room: item.room_number || null,
          description: item.description || null,
          image: item.image_path || null,
          map_url: targetName ? `/pages/map.html?search=${encodeURIComponent(targetName)}` : null
        };
      });
    return success({ answer: result.answer, mode: result.mode, results: locations });
  } catch (error) {
    return errorResponse(error);
  }
};
