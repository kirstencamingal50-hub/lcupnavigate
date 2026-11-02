import mysql from 'mysql2/promise';
import pg from 'pg';

const tables = [
  'admin_users',
  'admin_auth_challenges',
  'admin_setup_state',
  'categories',
  'locations',
  'map_nodes',
  'rooms',
  'facility_photos',
  'map_markers',
  'map_connections',
  'campus_routes',
  'campus_route_points',
  'campus_route_segments',
  'floor_plans',
  'login_attempts',
  'announcements',
  'favorites',
  'audit_logs',
];
const targetTables = [...tables, 'app_sessions', 'system_settings'];

const booleanColumns = new Set([
  'admin_users.active',
  'locations.accessibility_status', 'locations.verified', 'locations.active',
  'rooms.accessibility_status', 'rooms.verified', 'rooms.active',
  'facility_photos.is_cover',
  'map_nodes.verified', 'map_nodes.active',
  'map_markers.verified', 'map_markers.accessibility_status', 'map_markers.active',
  'map_connections.verified', 'map_connections.accessibility_status', 'map_connections.active',
  'campus_routes.verified', 'campus_routes.accessibility_status',
  'floor_plans.verified',
  'announcements.featured',
]);

const jsonColumns = new Set([
  'locations.accessibility_features',
  'audit_logs.before_json',
  'audit_logs.after_json',
]);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the migration process environment.`);
  return value;
}

function normalizeValue(table, column, value) {
  const key = `${table}.${column}`;
  if (value === undefined) return null;
  if (booleanColumns.has(key)) return value === null ? null : Boolean(Number(value));
  if (jsonColumns.has(key) && value !== null && typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}

function parentFirstLocations(rows) {
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(row) {
    const id = String(row.id);
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cycle found in locations parent references at ID ${id}.`);
    visiting.add(id);
    if (row.parent_building_id !== null) {
      const parent = byId.get(String(row.parent_building_id));
      if (parent) visit(parent);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(row);
  }

  for (const row of rows) visit(row);
  return ordered;
}

async function main() {
  const sourceUrl = required('SOURCE_MYSQL_URL');
  const targetUrl = required('DATABASE_URL');
  if (sourceUrl === targetUrl) throw new Error('Source and target connection URLs must differ.');

  const source = await mysql.createConnection({
    ...mysqlConnectionOptions(sourceUrl),
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    timezone: 'Z',
  });
  const target = new pg.Client({ connectionString: targetUrl });
  const importedCounts = new Map();

  try {
    await target.connect();
    await target.query('BEGIN');
    await target.query("SET LOCAL TIME ZONE 'UTC'");
    for (const table of targetTables) {
      const { rows } = await target.query(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
      const expectedEmptySetupRow = table === 'admin_setup_state' && rows[0].count === '1';
      if (rows[0].count !== '0' && !expectedEmptySetupRow) {
        throw new Error(`Target table ${table} is not empty; refusing to merge or overwrite data.`);
      }
    }
    await target.query('DELETE FROM admin_setup_state');

    for (const table of tables) {
      const [sourceRows] = await source.query(`SELECT * FROM \`${table}\``);
      const rows = table === 'locations' ? parentFirstLocations(sourceRows) : sourceRows;
      if (rows.length === 0) {
        importedCounts.set(table, 0);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const quotedColumns = columns.map(column => `"${column}"`).join(', ');
      for (const row of rows) {
        const values = columns.map(column => normalizeValue(table, column, row[column]));
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        await target.query(
          `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`,
          values,
        );
      }
      importedCounts.set(table, rows.length);
    }

    const invalidForeignKeys = await target.query(`
      SELECT 'rooms.building_id' AS relation, COUNT(*)::bigint AS invalid
      FROM rooms r LEFT JOIN locations l ON l.id = r.building_id WHERE l.id IS NULL
      UNION ALL
      SELECT 'map_markers.location_id', COUNT(*)::bigint
      FROM map_markers m LEFT JOIN locations l ON l.id = m.location_id WHERE l.id IS NULL
      UNION ALL
      SELECT 'campus_routes.start_marker_id', COUNT(*)::bigint
      FROM campus_routes r LEFT JOIN map_markers m ON m.id = r.start_marker_id WHERE m.id IS NULL
      UNION ALL
      SELECT 'campus_route_points.node_id', COUNT(*)::bigint
      FROM campus_route_points p LEFT JOIN map_nodes n ON n.id = p.node_id WHERE n.id IS NULL
      UNION ALL
      SELECT 'campus_route_segments.connection_id', COUNT(*)::bigint
      FROM campus_route_segments s LEFT JOIN map_connections c ON c.id = s.connection_id WHERE c.id IS NULL
    `);
    const invalid = invalidForeignKeys.rows.filter(row => row.invalid !== '0');
    if (invalid.length) throw new Error(`Foreign-key validation failed: ${JSON.stringify(invalid)}`);

    const identityTables = tables.filter(name => !['admin_setup_state', 'campus_route_points', 'campus_route_segments'].includes(name));
    for (const table of identityTables) {
      await target.query(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1), EXISTS (SELECT 1 FROM "${table}"))`,
      );
    }

    for (const table of tables) {
      const { rows } = await target.query(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
      const targetCount = Number(rows[0].count);
      if (targetCount !== importedCounts.get(table)) {
        throw new Error(`Count mismatch for ${table}: imported ${importedCounts.get(table)}, target ${targetCount}.`);
      }
    }

    await target.query('COMMIT');
    for (const [table, count] of importedCounts) console.log(`${table}: ${count}`);
    console.log('Import committed. Verify the source backup and run staging API tests before cutover.');
  } catch (error) {
    try { await target.query('ROLLBACK'); } catch { /* The connection may already be closed. */ }
    throw error;
  } finally {
    await source.end();
    await target.end().catch(() => {});
  }
}

function mysqlConnectionOptions(connectionString) {
  const url = new URL(connectionString);
  if (!['mysql:', 'mysql2:'].includes(url.protocol)) {
    throw new Error('SOURCE_MYSQL_URL must use the mysql:// scheme.');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

main().catch(error => {
  console.error(`MySQL-to-PostgreSQL import failed: ${error.message}`);
  process.exitCode = 1;
});
