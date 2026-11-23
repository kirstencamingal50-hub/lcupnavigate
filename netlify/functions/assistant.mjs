import { getServiceClient } from './_shared/supabase.mjs';
import { HttpError, errorResponse, requestBody, requiredText, success, unwrap } from './_shared/http.mjs';

const db = () => getServiceClient();
const MAX_CONTEXT_ROWS = 250;
const STOP_WORDS = new Set([
  'where', 'is', 'the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for',
  'find', 'show', 'me', 'please', 'can', 'could', 'i', 'do', 'tell',
  'about', 'what', 'which', 'are', 'available', 'located', 'near',
  'give', 'directions', 'how', 'get', 'there', 'office', 'building',
  'room', 'place', 'campus', 'can', 'eat', 'food', 'dining', 'something',
  'want', 'like', 'need', 'looking', 'find', 'me', 'my', 'is', 'there'
]);

// Natural-language intents are mapped to campus directory categories and
// common facility names. Results still come only from active campus records.
const INTENTS = [
  { key: 'food', patterns: /\b(eat|food|dining|hungry|meal|lunch|snack|coffee|drink|canteen|cafeteria|cafe|restaurant)\b/i, terms: ['food', 'dining', 'canteen', 'cafeteria', 'cafe', 'coffee shop'] },
  { key: 'health', patterns: /\b(sick|ill|medicine|medical|clinic|nurse|first aid|doctor)\b/i, terms: ['health', 'medical', 'clinic', 'first aid'] },
  { key: 'library', patterns: /\b(library|books|study|research)\b/i, terms: ['library', 'learning resource'] },
  { key: 'comfort-room', patterns: /\b(toilet|restroom|comfort room|cr|washroom|bathroom)\b/i, terms: ['comfort room', 'restroom', 'toilet', 'washroom'] },
  { key: 'prayer', patterns: /\b(pray|prayer|chapel|mass|church)\b/i, terms: ['chapel', 'prayer'] },
  { key: 'sports', patterns: /\b(sport|exercise|basketball|court|gym|swim|pool)\b/i, terms: ['sports', 'recreation', 'gym', 'court', 'pool'] },
  { key: 'events', patterns: /\b(event|auditorium|conference|seminar|program|venue)\b/i, terms: ['events', 'conference', 'auditorium'] },
  { key: 'admin', patterns: /\b(registrar|enroll|enrollment|tuition|payment|pay|finance|admission|records|transcript)\b/i, terms: ['registrar', 'finance', 'administrative'] },
  { key: 'accessibility', patterns: /\b(accessible|accessibility|wheelchair|ramp|elevator|lift)\b/i, terms: ['accessibility', 'wheelchair', 'ramp', 'elevator'] }
];

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeWord(word) {
  const aliases = {
    registar: 'registrar',
    registrars: 'registrar',
    registrar: 'registrar',
    'registrars': 'registrar',
    cr: 'comfort',
    restroom: 'comfort'
  };
  return aliases[word] || word;
}

function words(value) {
  return (clean(value).toLowerCase().match(/[a-z0-9]+/g) || []).map(normalizeWord);
}

function score(question, record) {
  const terms = [...new Set(words(question).filter(word => word.length >= 3 && !STOP_WORDS.has(word)))];
  if (!terms.length) return 0;

  const nameWords = new Set(words(record.name));
  const haystackWords = new Set(words([
    record.name, record.kind, record.description, record.category, record.category_name, record.category_slug,
    record.building_name, record.parent_building_name, record.department_name,
    record.room_number, record.floor_number, record.services, record.function_description,
    record.contact_info, record.contact_email, record.service_hours
  ].join(' ')));

  return terms.reduce((total, word) => {
    if (nameWords.has(word)) return total + 6;
    if (haystackWords.has(word)) return total + 2;
    return total;
  }, 0);
}

async function campusContext(question) {
  const database = db();
  const [locationResult, roomResult, announcementResult, routeResult, departmentResult, departmentLocationResult, categoryResult] = await Promise.all([
    database.from('locations').select('id,name,kind,description,category_id,parent_building_id,department_name,contact_email,contact_phone,service_hours,access_hours,days_open,services,accessibility_status,accessibility_details,accessibility_features,image_path,active').eq('active', true).order('name').limit(MAX_CONTEXT_ROWS),
    database.from('rooms').select('id,name,room_number,floor_number,floor_label,description,function_description,department_name,contact_email,contact_info,service_hours,accessibility_status,accessibility_details,building_id,active').eq('active', true).order('name').limit(MAX_CONTEXT_ROWS),
    database.from('announcements').select('id,title,body,status,publish_at,event_start,event_end,location_id').eq('status', 'published').order('created_at', { ascending: false }).limit(50),
    database.from('campus_routes').select('id,name,notes,start_marker_id,destination_marker_id,status').eq('status', 'active').limit(100),
    database.from('departments').select('id,name,description,office_hours,contact_email,contact_phone,image_path,active').eq('active', true).order('name').limit(150),
    database.from('department_locations').select('department_id,building_id,room_id,floor_number,room_number').limit(300),
    database.from('categories').select('id,name,slug').order('sort_order').limit(100)
  ]);
  const locations = unwrap(locationResult) || [];
  const rooms = unwrap(roomResult) || [];
  const announcements = unwrap(announcementResult) || [];
  const routes = unwrap(routeResult) || [];
  const departments = unwrap(departmentResult) || [];
  const departmentAssignments = unwrap(departmentLocationResult) || [];
  const categories = unwrap(categoryResult) || [];
  const categoryById = new Map(categories.map(item => [String(item.id), item]));
  const byId = new Map(locations.map(item => [String(item.id), item]));
  const records = [
    ...locations.map(item => ({ ...item, category_name: categoryById.get(String(item.category_id))?.name || '', category_slug: categoryById.get(String(item.category_id))?.slug || '', building_name: item.parent_building_id ? byId.get(String(item.parent_building_id))?.name : (item.kind === 'building' ? item.name : null), record_type: item.kind || 'location' })),
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

  const normalizedQuestion = words(question).join(' ');
  const asksRegistrar = /\bregistrar\b/.test(normalizedQuestion);
  const ranked = records
    .map(record => {
      const searchable = words([
        record.name, record.kind, record.description, record.function_description,
        record.category, record.category_name, record.category_slug,
        record.building_name, record.parent_building_name, record.department_name
      ].join(' ')).join(' ');
      const registrarMatch = asksRegistrar && /\bregistrar\b/.test(searchable);
      return { ...record, relevance: Math.max(score(question, record), registrarMatch ? 14 : 0) };
    })
    .filter(record => record.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);

  const intent = INTENTS.find(item => item.patterns.test(question));
  if (intent) {
    const intentTerms = intent.terms.map(term => term.toLowerCase());
    const intentMatches = records.filter(record => {
      const searchable = [
        record.name, record.kind, record.description, record.category,
        record.category_name, record.category_slug, record.services
      ].join(' ').toLowerCase();
      return intentTerms.some(term => searchable.includes(term));
    }).map(record => ({ ...record, relevance: Math.max(score(question, record), 8) }));
    if (intentMatches.length) {
      const unique = new Map();
      [...intentMatches, ...ranked].forEach(item => {
        const key = `${item.record_type}:${item.id}`;
        if (!unique.has(key)) unique.set(key, item);
      });
      return [...unique.values()].sort((a, b) => b.relevance - a.relevance).slice(0, 8);
    }
  }

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
  const intent = INTENTS.find(item => item.patterns.test(question));
  if (!matches.length) {
    return 'I could not find a matching campus record. Try the exact building, department, office, room, or facility name, or browse the Campus Directory.';
  }

  const placeRecords = matches.filter(item => ['building', 'facility', 'room', 'location', 'department'].includes(item.record_type));
  if (intent?.key === 'food' && placeRecords.length) {
    const options = placeRecords.slice(0, 5).map(item => {
      const where = locationDescription(item);
      return `• ${displayName(item, question)}${where ? ` — ${where}` : ''}`;
    });
    return `Here are the campus food and dining options I found:\n\n${options.join('\n')}\n\nChoose “Show on Map” to see where each option is located. If you are looking for a specific menu or operating hours, please check with the establishment.`;
  }
  if (!placeRecords.length && matches[0].record_type === 'announcement') {
    const item = matches[0];
    return `Here is the campus update I found: ${clean(item.title)}. ${clean(item.body)}`.trim();
  }

  // A direct office/room question should receive one direct answer, not a
  // generic list of loosely related buildings and facilities.
  const best = placeRecords[0];
  if (/\bregistrar\b/i.test(words(question).join(' '))) {
    const registrar = placeRecords.find(item => /\bregistrar\b/i.test(words([
      item.name, item.department_name, item.description, item.function_description
    ].join(' ')).join(' ')));
    if (registrar) {
      const where = locationDescription(registrar);
      return `The Registrar's Office is located in ${where || registrar.building_name || 'the campus directory'}.`;
    }
  }
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
    return `• ${displayName(item, question)}${location ? ` — ${location}` : ''}${details.length ? `\n  ${details.join(' · ')}` : ''}`;
  });

  return `Here is the most relevant campus information I found:\n\n${lines.join('\n')}\n\nSelect “Show on Map” to view a location on the campus map.`;
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
