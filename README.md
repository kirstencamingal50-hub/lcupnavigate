# LCUP Campus Navigation

This project is a PHP 8.2 and MySQL/MariaDB application served by Apache. It uses the existing HTML, CSS, and JavaScript pages, with a same-origin JSON API in `api/` and persistent data in `database/schema.sql`.

## Local setup (XAMPP on Windows)

1. Start Apache and MySQL in the XAMPP Control Panel.
2. From the project directory, import the schema:

   ```powershell
   & 'C:\xampp\mysql\bin\mysql.exe' -u root < database\schema.sql
   ```

   The schema creates `lcup_campus_nav` and its tables. For a protected XAMPP MySQL root account, add `-p` and enter its password when prompted.
3. Generate the review-pending seed and import it:

   ```powershell
   node database\build-initial-data.mjs
   & 'C:\xampp\php\php.exe' database\import-initial-data.php
   ```

   For an existing installation, apply the additive route-builder migration once:

   ```powershell
   Get-Content -Raw database\migrations\20261021_easy_route_builder.sql | & 'C:\xampp\mysql\bin\mysql.exe' -u root lcup_campus_nav
   ```

   Apply the route connection-type migration as well:

   ```powershell
   Get-Content -Raw database\migrations\20261022_route_connection_types.sql | & 'C:\xampp\mysql\bin\mysql.exe' -u root lcup_campus_nav
   ```

   Before clearing an existing route graph, inspect its current record counts:

   ```sql
   SELECT 'routes' AS record_type, COUNT(*) AS records FROM campus_routes
   UNION ALL SELECT 'route points', COUNT(*) FROM campus_route_points
   UNION ALL SELECT 'route segments', COUNT(*) FROM campus_route_segments
   UNION ALL SELECT 'connections', COUNT(*) FROM map_connections
   UNION ALL SELECT 'nodes', COUNT(*) FROM map_nodes;
   ```

   If those are the route records you intend to retire, run the one-time cleanup migration:

   ```powershell
   Get-Content -Raw database\migrations\20261022_reset_routes_with_backup.sql | & 'C:\xampp\mysql\bin\mysql.exe' -u root lcup_campus_nav
   ```

   It backs up the routes, points, segments, connections, nodes, and marker/room node references into `route_reset_backup_*_20261022` tables before clearing them. The migration records completion so re-running it will not erase routes created later. Verify the source counts are zero and the backup counts match the pre-cleanup counts before considering the retired data removable.

   Apply the additive administrator profile migration as well:

   ```powershell
   Get-Content -Raw database\migrations\20261021_admin_accounts_profile.sql | & 'C:\xampp\mysql\bin\mysql.exe' -u root lcup_campus_nav
   ```

   Apply the one-time administrator setup migration to existing databases:

   ```powershell
   Get-Content -Raw database\migrations\20261022_admin_first_setup.sql | & 'C:\xampp\mysql\bin\mysql.exe' -u root lcup_campus_nav
   ```

   Apply the administrator email-verification and Google sign-in migration to existing databases:

   ```powershell
   Get-Content -Raw database\migrations\20261102_admin_authentication.sql | & 'C:\xampp\mysql\bin\mysql.exe' -u root lcup_campus_nav
   ```

   Apply the facility details, accessibility, and photo-gallery migration to existing databases:

   ```powershell
   Get-Content -Raw database\migrations\20261022_facility_accessibility_photos.sql | & 'C:\xampp\mysql\bin\mysql.exe' -u root lcup_campus_nav
   ```

   This migration adds optional room/facility contact, service-hour, landmark, floor, and accessibility fields, creates ordered photo galleries, and copies existing cover-image references into those galleries. Apply it once after the existing location and room tables have been created.

   Apply the building-only accessibility feature migration to existing databases:

   ```powershell
   Get-Content -Raw database\migrations\20261023_building_accessibility_features.sql | & 'C:\xampp\mysql\bin\mysql.exe' -u root lcup_campus_nav
   ```

   Apply this once after the facility/photo migration. Building features are stored on locations and exposed only for building records; rooms and facilities do not use this feature list.

   Seed records are copied from the prototype's `data/campus-data.js` and `assets/js/map-pins.js`. They are explicitly unverified. The importer is repeatable and does not remove or certify records.
4. For first-time web setup, configure a high-entropy `LCUP_ADMIN_SETUP_KEY` (at least 32 characters) in the Apache/PHP environment, then open the Admin Login page and use **Create Admin Account**. The endpoint allows setup only once, only while the setup marker is incomplete and no admin-role account exists, and requires the server-side secret. Remove the setup key from the Apache/PHP environment after the first administrator is created. Alternatively, create an administrator from a PowerShell prompt; the script requests the password without echoing it:

   ```powershell
   .\scripts\create-admin.ps1 -Username your.admin
   ```

5. Open `http://localhost/Capstone/` and sign in at `http://localhost/Capstone/pages/admin/login.html`.

For online deployment, remote database migration, HTTPS, persistent uploads, and multi-device validation steps, see [DEPLOYMENT.md](DEPLOYMENT.md). Configure the frontend API base URL in `assets/js/deployment-config.js`; keep all database and server secrets in the hosting provider's environment configuration.

## Netlify/PostgreSQL migration status

The Netlify migration is in progress and the PHP/MySQL application remains the active backend. Review [MIGRATION_CHECKLIST.md](MIGRATION_CHECKLIST.md) before deploying. The PostgreSQL migration is `netlify/database/migrations/20261102143000_initial_schema.sql`; Netlify Database applies it automatically after the managed database is provisioned. The guarded import script has not been run against a production database. Back up the source MySQL database, then run `npm run migrate:mysql-to-postgres` with `SOURCE_MYSQL_URL` and `DATABASE_URL` set in the migration process environment. Do not point production traffic at PostgreSQL until every Netlify Function and parity test is complete. See [NETLIFY_API.md](NETLIFY_API.md) for implemented and pending API resources.

The default database connection (`127.0.0.1`, database `lcup_campus_nav`, user `root`, blank password) is for a local development XAMPP install only. Set `LCUP_DB_HOST`, `LCUP_DB_PORT`, `LCUP_DB_NAME`, `LCUP_DB_USER`, `LCUP_DB_PASS`, and `LCUP_ENV=production` in the Apache/PHP service environment for deployment. Set `LCUP_ADMIN_SETUP_KEY` only during initial web setup; never expose it in frontend code or logs. Use a dedicated least-privilege database user, HTTPS (`LCUP_COOKIE_SECURE=1`), and never put database credentials in browser code. Do not expose the development configuration to a public server.

Public administrator sign-up and password recovery require a working PHP mail relay and a valid `LCUP_MAIL_FROM` sender address in the Apache/PHP environment. Configure the local XAMPP `mail()` relay or the production mail transport before enabling these flows. Google sign-in is optional: configure `GOOGLE_CLIENT_ID` in the Apache/PHP environment, enable Google Identity Services for that client, and allow the deployed site origin in its Google Cloud OAuth client. The PHP cURL extension must be enabled for server-side Google token verification. These values are server configuration; do not put a Google client secret in the browser. New email- or Google-registered accounts are stored as inactive editors until an active administrator approves them in **Admin Accounts**; Google sign-in never assigns an administrator role or links an existing account automatically.

## Current data and navigation limits

The schema includes categories, locations, rooms, floors, floor-plan references, map markers, route nodes/connections, announcements/events, favorites, administrator accounts, login-attempt records, and audit logs. Admin changes are stored in MySQL and public pages retrieve them through `api/index.php`.

Administrators can open **Build Routes** from the dashboard or use the Visual Route Builder in Manage Map. Add active map pins for route endpoints first, choose the endpoint markers, and click waypoint positions in order. Clicking near an existing node reuses it. Saving adds ordered named route records and creates/reuses segments in the shared route graph. Publishing does not require location, marker, or walkway verification; new walkway connections remain unverified until an administrator verifies them separately. Only verified accessible connections and accessible endpoint markers qualify for accessible-only routing. Distances are in map units because the current map has no verified scale, so the app does not invent meters or walking time. Treat routes published before verification as potentially inaccurate.

Manage Map also includes independent **Walkway graph connections** controls. Add or edit an edge between active nodes, select its walkway/stairs/ramp/elevator type, set its map-unit cost and accessibility status, and explicitly confirm it before marking it verified. Public pathfinding uses verified active edges even when they are not attached to a named saved route. A connection referenced by a saved route cannot be archived until that route is edited or removed.

The Admin Panel includes **Admin Accounts** (admin-role only) for reviewing and managing saved account access, plus **Settings** for profile, password, local display preferences, and database connection status. Account creation is handled only through the authorized backend provisioning process. Student/Visitor Settings save non-sensitive preferences in the current browser. They do not grant access or sync across devices.

Manage Buildings, Facilities, and Rooms allow administrators to edit rich directory details and manage photo galleries. Building records additionally support building-wide features such as wheelchair-accessible entrances, elevators, ramps, accessible restrooms, and tactile guidance; these are not room-level accessibility claims. The responsive directory shows building feature badges, filters by building/facility/room, and provides search and sorting. Each gallery image has editable alternative text and caption; existing single-image covers remain compatible. Visitor and administrator settings include text size, contrast, reduced motion, speech language/voice/rate, and opt-in automatic facility-description reading. Manual speech controls and written route directions remain available when automatic reading is off. Accessibility route filtering excludes links without explicitly recorded accessible status; an empty result is not a claim that no accessible route exists, only that one cannot be confirmed from the stored data.

### Access from another device on trusted private Wi-Fi

Apache and MySQL must remain running on the computer hosting the project. To enable private-LAN access on the XAMPP host, open PowerShell **as Administrator** on that host, change to the project folder, and run:

```powershell
Set-Location C:\xampp\htdocs\Capstone
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\enable-private-wifi-access.ps1
```

Run this only when the connected Wi-Fi is trusted. The script marks that adapter's network profile Private, allows Apache TCP port 80 only from the local subnet on that Wi-Fi adapter, blocks Apache on Public networks, and blocks inbound MariaDB port 3306. It does not expose the database to other devices or configure public-internet access. On another device connected to the same Wi-Fi, open `http://<host-computer-Wi-Fi-IP>/Capstone/`; find the host IP with `ipconfig` and reserve it in the router if the address changes. Client devices use the shared database through the host's web API; they must not connect directly to MySQL.

Prototype campus records and map coordinates are not verified official LCUP data. Imported map links and markers remain unverified, and the map only calculates routes through connections administrators have marked verified. Confirm names, positions, entrances, walkways, accessibility, and floor connections with authorized campus sources before publishing them as factual directions. A duplicate-looking legacy marker in the existing local database also needs administrator review.

Favorites and offline map download/viewing, a real second-device deployment check, and browser-based UI automation remain outstanding. This local setup proves independent sessions read shared database updates; it does not make the site reachable from other devices. Multi-device access requires Apache/PHP and MySQL hosted on a reachable secured server/network, appropriate firewall/DNS configuration, and HTTPS.

## Verification

Run the integration smoke test while Apache/MySQL are running:

```powershell
& 'C:\xampp\php\php.exe' tests\integration-smoke.php
```

It creates temporary test records and removes them on completion. The test covers visitor and admin session handling, admin account authorization/creation/password hashing/profile updates, public API reads, route graph behavior, persisted room changes visible in a separate session, announcement changes, duplicate validation, and logout. It does not verify official campus data or replace a mobile-browser/device acceptance test.

## Key paths

- `api/` — API and security/session/database bootstrap
- `database/schema.sql` — repeatable MySQL schema
- `database/` — legacy data conversion and CLI importer
- `pages/` — responsive public and administrator interfaces
- `assets/js/campus-api.js` — browser API client
- `scripts/create-admin.ps1` — secure local initial administrator setup
- `tests/integration-smoke.php` — local API integration checks
