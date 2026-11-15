import { getServiceClient } from './_shared/supabase.mjs';
import { HttpError, errorResponse, requestBody, requiredText, success, unwrap } from './_shared/http.mjs';

const db = () => getServiceClient();
const MAX_CONTEXT_ROWS = 250;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function score(question, record) {
  const words = [...new Set(clean(question).toLowerCase().match(/[a-z0-9]{3,}/g) || [])];
  const haystack = clean([
    record.name, record.kind, record.description, record.category,
    record.building_name, record.parent_building_name, record.department_name,
    record.room_number, record.floor_number, record.services,
    record.contact_email, record.service_hours
  ].join(' ')).toLowerCase();
  return words.reduce((total, word) => total + (haystack.includes(word) ? (record.name?.toLowerCase().includes(word) ? 4 : 1) : 0), 0);
}

async function campusContext(question) {
  const database = db();
  const [locationResult, roomResult, announcementResult, routeResult, departmentResult, departmentLocationResult] = await Promise.all([
    database.from('locations').select('id,name,kind,description,category_id,parent_building_id,department_name,contact_email,contact_phone,service_hours,access_hours,days_open,services,accessibility_status,accessibility_details,accessibility_features,image_path,active').eq('active', true).order('name').limit(MAX_CONTEXT_ROWS),
    database.from('rooms').select('id,name,room_number,floor_number,floor_label,description,function_description,department_name,contact_email,contact_info,service_hours,accessibility_status,accessibility_details,building_id,active').eq('active', true).order('name').limit(MAX_CONTEXT_ROWS),
    database.from('announcements').select('id,title,body,status,publish_at,event_start,event_end,location_id').eq('status', 'published').order('created_at', { ascending: false }).limit(50),
    database.from('campus_routes').select('id,name,description,start_marker_id,destination_marker_id,status').eq('status', 'active').limit(100),
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
    ...routes.map(item => ({ ...item, name: item.name || 'Campus route', record_type: 'route' })),
    ...departments.map(department => {
      const assignments = departmentAssignments.filter(item => String(item.department_id) === String(department.id));
      const buildingNames = assignments.map(item => byId.get(String(item.building_id))?.name).filter(Boolean);
      const roomNames = assignments.map(item => rooms.find(room => String(room.id) === String(item.room_id))?.room_number || item.room_number).filter(Boolean);
      return { ...department, name: department.name, department_name: department.name, building_name: [...new Set(buildingNames)].join(', '), room_number: roomNames.join(', '), record_type: 'department' };
    })
  ];
  return records.map(record => ({ ...record, relevance: score(question, record) }))
    .filter(record => record.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 12);
}

function publicAnswer(question, matches) {
  if (!matches.length) {
    return 'I could not find a matching campus record. Try the exact building, department, office, room, or facility name, or browse the Campus Directory.';
  }
  const placeRecords = matches.filter(item => ['building', 'facility', 'room', 'location', 'department'].includes(item.record_type));
  const lines = matches.slice(0, 5).map(item => {
    const location = [item.building_name, item.floor_number != null ? `Floor ${item.floor_number}` : null, item.room_number ? `Room ${item.room_number}` : null].filter(Boolean).join(' · ');
    const details = [clean(item.description), clean(item.service_hours) ? `Hours: ${clean(item.service_hours)}` : null, clean(item.contact_email) ? `Email: ${clean(item.contact_email)}` : null].filter(Boolean);
    return `• ${clean(item.name)}${location ? ` — ${location}` : ''}${details.length ? `\n  ${details.join(' · ')}` : ''}`;
  });
  if (!placeRecords.length && matches[0].record_type === 'announcement') return `Here is the campus update I found:\n\n${lines.join('\n')}`;
  return `Here is what I found in the campus records:\n\n${lines.join('\n')}\n\nSelect “Show on Map” on a location result to open it on the campus map.`;
}

async function answer(question, matches) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { answer: publicAnswer(question, matches), mode: 'campus-record-search' };
  const context = matches.map(item => ({
    type: item.record_type,
    name: item.name,
    building: item.building_name,
    floor: item.floor_number,
    room: item.room_number,
    description: item.description,
    hours: item.service_hours,
    email: item.contact_email,
    accessibility: item.accessibility_details || item.accessibility_features,
    event_start: item.event_start,
    event_end: item.event_end
  }));
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      instructions: 'You are Ask NaviGATE, the public campus information assistant for La Consolacion University Philippines. Answer only from the supplied campus records. Do not invent buildings, room numbers, office hours, contacts, routes, events, or accessibility details. If the records do not contain the answer, say so clearly. Be concise and helpful. Do not answer questions about student schedules, subjects, sections, grades, or student-specific records.',
      input: `Visitor question: ${question}\n\nCampus database records (authoritative):\n${JSON.stringify(context)}`,
      max_output_tokens: 450
    })
  });
  if (!response.ok) {
    console.error('Ask NaviGATE model request failed:', response.status);
    return { answer: publicAnswer(question, matches), mode: 'campus-record-search' };
  }
  const payload = await response.json();
  const generated = (payload.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  return { answer: generated || publicAnswer(question, matches), mode: 'ai-grounded' };
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
        const targetName = item.record_type === 'department'
          ? String(item.building_name || '').split(',')[0].trim()
          : item.name;
        return {
          id: item.id,
          name: item.name,
          kind: item.record_type,
          building: item.building_name || null,
          floor: item.floor_number ?? null,
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
