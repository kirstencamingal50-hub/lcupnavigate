# NaviGATE Netlify/PostgreSQL migration checklist

This is the source-system audit and migration ledger for the Netlify migration brief. The PHP/MySQL application remains the current production-capable implementation until each replacement item is implemented and validated. No production migration or deployment has been performed.

## Audited architecture

- Frontend: 19 HTML pages, vanilla JavaScript, and existing CSS. Shared browser API client: `assets/js/campus-api.js`.
- Backend: PHP 8.2/PDO MySQL API in `api/index.php` (single resource dispatcher, approximately 802 lines), shared DB/session/security helpers in `api/bootstrap.php`, and one-time setup in `api/admin-setup.php`.
- Database: MySQL/MariaDB schema in `database/schema.sql`, with nine additive/operational SQL migrations. Initial data tooling is `database/build-initial-data.mjs` and `database/import-initial-data.php`.
- Authentication: PHP server-side sessions, CSRF token header, role checks (`viewer`, `editor`, `admin`), password hashes, rate limits, email OTP challenges, optional Google ID-token verification, and audit logs. The current first-admin setup endpoint is PHP-specific.
- File uploads: PHP multipart upload endpoint writes to `uploads/photos/` and `uploads/floorplans/`; database rows hold relative paths and floor-plan metadata. This filesystem is not persistent in Netlify Functions.
- Maps/routes: relational markers, nodes, connections, saved route points/segments, route verification/accessibility semantics.
- Browser storage: localStorage is used for device-local appearance/accessibility preferences and the visitor-entry choice. No sessionStorage use was found. These are not campus-record persistence, but the settings requirement needs a product decision about which preferences should become account- or device-synced database records.
- Hardcoded local API address: only the PHP integration smoke test uses `http://127.0.0.1/Capstone/api/index.php`; application requests use the relative PHP API client. `api/bootstrap.php` has a development-only loopback MySQL default.
- Netlify/PostgreSQL project configuration: now includes `netlify.toml`, Node dependencies, a static-only `dist/` build, a Netlify Database migration, and initial read/media Functions. These do not imply that a Netlify site/database has been provisioned.
- Local upload inventory: two hash-named PNGs under `uploads/photos/`, no floor-plan files; `.htaccess` files are access rules, not user uploads. The Blob migration utility skips those rules.

## Existing API compatibility map

All entries below are implemented by `api/index.php` unless noted. The replacement Netlify Functions must preserve the response envelope (`{ok,data}` / `{ok:false,error}`), status semantics, validation, authorization, and field shapes consumed by the frontend.

| Existing resource | Current behavior | Main data/dependencies | Netlify migration |
| --- | --- | --- | --- |
| `auth/csrf`, `auth/me`, `auth/login`, `auth/logout`, `auth/entry`, `auth/profile`, `auth/password` | CSRF/session lifecycle, visitor entry state, administrator sign-in/out and profile/password updates | `admin_users`; server session; `audit_logs`; `login_attempts` | Implemented against PostgreSQL API; local mock tests only, requires database integration verification |
| `auth/login-status`, `auth/google-config`, `auth/google` | First-admin state; Google config and verified Google login/registration | `admin_users`, setup state; Google OAuth configuration | Login status implemented; Google login is deliberately disabled and remains pending |
| `auth/register`, `auth/resend-code`, `auth/verify-code`, `auth/recover` | Email-verified editor signup, OTP resend/expiry/attempts, password recovery | `admin_users`, `admin_auth_challenges`, `login_attempts`; outbound email | Implemented using Resend API and bcrypt-compatible hashes; requires provider/database integration tests |
| `admin/accounts` | Admin-only list and role/active management; protects last active admin | `admin_users`, `audit_logs` | Pending |
| `admin/overview`, `admin/system` | Dashboard counts/activity and system status | Locations, rooms, routes, announcements, audit log | Pending |
| `categories` | Public list; admin-only create/update/delete with assignment checks | `categories`, `locations`, `rooms`, `audit_logs` | Pending |
| `directory`, `locations`, `rooms`, `facility-photos`, `floorplans` | Directory read with galleries/floor plans; admin CRUD/archive and gallery management | Locations, rooms, categories, photos, floor plans, markers, accounts | Read-only `directory` and `floorplans` implemented in Netlify Function; CRUD and gallery actions pending |
| `announcements` | Public published feed; admin CRUD, pinning and schedule | `announcements`, `locations`, `admin_users`, `audit_logs` | Public published feed implemented; admin CRUD pending |
| `map`, `map/admin`, `map/markers`, `map/nodes`, `map/connections` | Public verified graph; authenticated admin map/graph editing | Markers, locations, categories, nodes, connections, routes | Public verified map read implemented; admin/map writes pending |
| `routes/available`, `routes` | Public active route recommendations and admin route builder/CRUD | Routes, points, segments, markers, nodes, connections | Public available-route read implemented; route builder and CRUD pending |
| `uploads` | Admin multipart image/PDF validation and storage; floor-plan registration | `floor_plans`, `locations`, `audit_logs`, local filesystem | Pending; use persistent object storage and signed uploads |
| `api/admin-setup.php` | One-time first-admin creation protected by server secret and CSRF | `admin_setup_state`, `admin_users`, `login_attempts` | `auth/setup` Function implemented; login UI still calls the PHP file until an approved future cutover |

## MySQL-to-PostgreSQL table mapping

The current schema defines 18 core tables. These names and relationships are to be preserved unless PostgreSQL-specific migrations require an explicit, reviewed change.

The connected local MySQL database was readable during this audit. Its current source row counts are: `categories` 7, `locations` 51, `rooms` 17, `map_nodes` 37, `map_markers` 40, and `map_connections` 40. `admin_setup_state` contains 1 row and `login_attempts` contains 1 row; the other 10 core tables are empty. These counts are an audit baseline only; the import script must re-read live counts when run, and they are not evidence of a cloud import.

| MySQL table | PostgreSQL migration notes |
| --- | --- |
| `admin_users` | Identity `BIGINT`, unique username/email/Google subject, role and active booleans; preserve existing password hashes and test PHP hash compatibility |
| `admin_auth_challenges` | OTP/reset challenge hashes, expiry/resend timestamps, attempts and account FK |
| `admin_setup_state` | Singleton setup marker and check constraint |
| `categories` | Unique name/slug and sort order |
| `locations` | Buildings/facilities/landmarks, self-parent and category FKs, JSON accessibility features, soft-active/verified fields |
| `rooms` | Room/classroom/office data, building/category FKs, composite room uniqueness, accessibility and image references |
| `facility_photos` | Gallery rows with exactly-one-owner check, location/room FKs and cascade behavior |
| `map_nodes` | Unique key, decimal coordinates, floor and active/verified state |
| `map_markers` | Location/node FKs and map coordinates/accessibility |
| `map_connections` | Node FKs, positive weight check, connection enum equivalent, verification/accessibility |
| `campus_routes` | Marker/admin FKs, status/accessibility, distance and update timestamp |
| `campus_route_points` | Ordered node points, route/node FKs, point-type constraint |
| `campus_route_segments` | Ordered route-to-connection join; preserve references and restrict deletion |
| `floor_plans` | Building/admin FKs, file metadata and storage key |
| `login_attempts` | IP hash and time index; retain server-side rate-limiting behavior |
| `announcements` | Status, schedule/event timestamps, location/admin FKs and persistent image key |
| `favorites` | Account-key/location unique pair; clarify migration/identity behavior before changing visitor semantics |
| `audit_logs` | JSON before/after snapshots, admin FK and date/entity indexes |

PostgreSQL conversion must account for MySQL `ENUM`, `TINYINT(1)`, `JSON`, `AUTO_INCREMENT`, `NOW()`/date arithmetic, `LIMIT`, insert IDs, and MySQL-specific constraint/error codes. Sequences must be reset above imported IDs. Import must preserve IDs, row counts, and foreign-key validity; it must not run seed insertion over existing production records.

## Frontend API callers

The API client resource inventory from `assets/js` is: `admin/accounts`, `admin/overview`, `admin/system`, `announcements`, `auth/csrf`, `auth/entry`, `auth/google`, `auth/google-config`, `auth/login`, `auth/login-status`, `auth/logout`, `auth/me`, `auth/password`, `auth/profile`, `auth/recover`, `auth/register`, `auth/resend-code`, `auth/verify-code`, `categories`, `directory`, `facility-photos`, `floorplans`, `locations`, `map/admin`, `map/connections`, `map/markers`, `rooms`, `routes`, and `uploads`.

The login page also calls `api/admin-setup.php` directly, so it must be moved to the shared client/function API rather than left as a PHP production dependency.

## Completion gates

- [x] Add an initial PostgreSQL schema migration reflecting the 18 source tables, constraints/indexes, and server-side session/settings tables. It has not yet been applied to a managed database.
- [x] Add a guarded MySQL-to-PostgreSQL importer with target-empty checks, identity sequence alignment, row-count and FK validation. It has not yet been run against the production source/target.
- [x] Add a one-time migration tool for existing local uploads to the site's persistent Netlify Blobs store.
- [x] Add Netlify static build and function routing without changing frontend traffic to an incomplete API.
- [x] Add initial public read endpoints for categories, directory, map, routes, announcements, floor plans, and database health.
- [x] Add local smoke tests for CORS, unavailable admin/write endpoints, media key validation, API URLs, and static publish isolation.
- [x] Add PostgreSQL-backed auth routes with secure cookie sessions, CSRF, bcrypt-compatible passwords, rate limiting, email OTP, recovery and guarded first-admin setup.
- [x] Add mock-database smoke checks for CSRF session creation and rejection of unauthenticated profile access.
- [x] Add admin-only category CRUD and authenticated announcement admin listing/CRUD with validation and audit records.
- [ ] Implement and test every endpoint above as Netlify Functions before changing frontend routing. Public reads, authentication routes, category CRUD, and announcement CRUD/admin listing are implemented locally; other admin/write endpoints remain unavailable.
- [ ] Verify server-side sessions, CSRF, role checks, rate limits, OTP email and one-time admin setup against real staging PostgreSQL/email services; Google verification remains pending.
- [ ] Move uploads to persistent cloud storage; migrate existing files and references; verify read access from another device.
- [ ] Move only the agreed system preferences to PostgreSQL; keep device-specific speech voices and presentation preferences local if appropriate.
- [x] Add Netlify build/function routing and `.env.example` containing placeholder values only.
- [ ] Point the frontend to the Functions API only after parity tests pass; keep the PHP/MySQL source available during transition.
- [ ] Implement remaining administrator management, building/room CRUD, map administration, route editing, uploads and system settings endpoints; do not cut over until full parity.
- [ ] Run CRUD, auth, route-graph, upload, and cross-session integration tests against PostgreSQL and staging storage.
- [ ] Configure production secrets, HTTPS, CORS, provider backups, and run browser/device/network acceptance tests before cutover.

## Outstanding external prerequisites

No Netlify account/site, managed PostgreSQL connection, production frontend origin/domain, email-provider credentials, Google OAuth configuration, storage migration authorization, or deployment access is available in this workspace. Netlify docs indicate the managed database is on credit-based plans; usage billing and limits vary by plan. Netlify Blobs supports persistent site-wide object storage and is used by the initial media reader, but current MySQL uploads have not been copied into it and no upload endpoint is active. Do not send secrets in chat or commit them; configure them directly in Netlify environment settings. `.env.example` contains placeholders only. The live data migration and public multi-device validation cannot be claimed until those services are provisioned and tested.

## Validation results (local only)

- `npm run build`: passed; `dist/` contains no PHP or SQL files and does not change the frontend API setting.
- `npm run test:netlify`: passed; API client URL resolution, CORS/preflight, mock-auth session/authorization behavior, explicit unimplemented API responses, and media-key validation.
- Both Netlify Function entry points were bundled with esbuild successfully.
- Existing PHP/MySQL integration smoke test: passed all 21 checks.
- `npm audit --omit=dev`: zero production dependency vulnerabilities.
- `netlify build`: not run to completion because Netlify CLI reports there is no linked project ID. No site is linked or deployed.
- No PostgreSQL/Netlify Database connection or Netlify Blobs site is configured here; database-backed function behavior, MySQL import, upload migration, production deployment, and multi-device/browser/network tests remain unverified.
- Full dependency-tree installation reported 19 advisories (2 low, 17 moderate), all in the development dependency tree. The npm suggested automated fix requires a breaking Netlify CLI downgrade; it was not applied.
