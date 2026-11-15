import { currentUser } from './_shared/authorization.mjs';
import { getServiceClient } from './_shared/supabase.mjs';
import { HttpError, errorResponse, requestBody, requiredText, optionalText, success, unwrap } from './_shared/http.mjs';

const db = () => getServiceClient();

async function listDepartments() {
  const database = db();
  const [departmentResult, assignmentResult, buildingResult, roomResult] = await Promise.all([
    database.from('departments').select('*').eq('active', true).order('name'),
    database.from('department_locations').select('id,department_id,building_id,room_id,floor_number,room_number').order('id'),
    database.from('locations').select('id,name,kind,active').eq('active', true),
    database.from('rooms').select('id,name,room_number,floor_number,building_id,active').eq('active', true)
  ]);
  const departments = unwrap(departmentResult) || [];
  const assignments = unwrap(assignmentResult) || [];
  const buildings = new Map((unwrap(buildingResult) || []).map(row => [String(row.id), row]));
  const rooms = new Map((unwrap(roomResult) || []).map(row => [String(row.id), row]));
  return departments.map(department => ({
    ...department,
    locations: assignments.filter(row => String(row.department_id) === String(department.id))
      .map(row => ({
        id: row.id,
        building: buildings.get(String(row.building_id)) || null,
        room: row.room_id ? rooms.get(String(row.room_id)) || null : null,
        floor_number: row.floor_number,
        room_number: row.room_number
      }))
      .filter(row => row.building)
  }));
}

export const handler = async event => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' }, body: '' };
    const database = db();
    if (event.httpMethod === 'GET') return success(await listDepartments());

    const user = await currentUser(event, true, 'editor');
    const body = requestBody(event);
    const id = event.httpMethod === 'PUT' || event.httpMethod === 'DELETE' ? Number(body.id || event.queryStringParameters?.id) : null;
    if (id !== null && (!Number.isSafeInteger(id) || id < 1)) throw new HttpError(400, 'A valid department ID is required.');

    if (event.httpMethod === 'DELETE') {
      unwrap(await database.from('departments').update({ active: false }).eq('id', id).select('id').single());
      await database.from('audit_logs').insert({ admin_legacy_id: user.id, action: 'archive', entity_type: 'department', entity_id: id });
      return success({ id, archived: true });
    }
    if (!['POST', 'PUT'].includes(event.httpMethod)) throw new HttpError(405, 'Method not allowed.');

    const name = requiredText(body.name, 'Department name', 180);
    const email = optionalText(body.contact_email, 'Contact email', 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid department email.');
    const fields = {
      name,
      description: optionalText(body.description, 'Description', 4000),
      office_hours: optionalText(body.office_hours, 'Office hours', 500),
      contact_email: email,
      contact_phone: optionalText(body.contact_phone, 'Contact phone', 40),
      image_path: optionalText(body.image_path, 'Photograph path', 255),
      active: true
    };
    const saved = id
      ? unwrap(await database.from('departments').update(fields).eq('id', id).select('id').single())
      : unwrap(await database.from('departments').insert(fields).select('id').single());

    if (!Array.isArray(body.locations) || body.locations.length > 100) throw new HttpError(400, 'Provide a list of department building assignments (up to 100).');
    const assignments = [];
    for (const item of body.locations) {
      const buildingId = Number(item.building_id);
      if (!Number.isSafeInteger(buildingId) || buildingId < 1) throw new HttpError(400, 'Each assignment needs a valid building.');
      const building = unwrap(await database.from('locations').select('id,kind,active').eq('id', buildingId).maybeSingle());
      if (!building || building.kind !== 'building' || !building.active) throw new HttpError(400, 'Department assignments must reference active campus buildings.');
      let roomId = item.room_id ? Number(item.room_id) : null;
      if (roomId) {
        const room = unwrap(await database.from('rooms').select('id,building_id,active').eq('id', roomId).maybeSingle());
        if (!room || !room.active || String(room.building_id) !== String(buildingId)) throw new HttpError(400, 'The selected room must belong to the selected building.');
      }
      assignments.push({
        department_id: saved.id,
        building_id: buildingId,
        room_id: roomId,
        floor_number: item.floor_number === '' || item.floor_number == null ? null : Number(item.floor_number),
        room_number: optionalText(item.room_number, 'Room number', 50)
      });
    }
    if (id) unwrap(await database.from('department_locations').delete().eq('department_id', saved.id));
    if (assignments.length) unwrap(await database.from('department_locations').insert(assignments));
    await database.from('audit_logs').insert({ admin_legacy_id: user.id, action: id ? 'update' : 'create', entity_type: 'department', entity_id: saved.id, after_json: { name, assignments: assignments.length } });
    return success({ id: saved.id, name, locations: assignments.length }, id ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
};
