# Netlify API migration status

The Netlify API is an incremental replacement and is **not ready for frontend cutover**. The PHP API remains the only complete implementation. The deployment build intentionally leaves `CAMPUS_API_BASE_URL` empty so a deploy cannot silently direct all current users to the incomplete API.

## Implemented Netlify resources

Base URL after deployment: `/api`. The function receives the existing query-style resource shape, for example `/api?resource=categories`. Successful responses use `{ "ok": true, "data": ... }`; errors use `{ "ok": false, "error": { "message": ... } }`.

| Resource | Method | Stage |
| --- | --- | --- |
| `health` | GET | Queries the managed PostgreSQL database and returns service/database status |
| `categories` | GET | Public categories |
| `directory` | GET | Locations, rooms, photo references, floor plans |
| `map` | GET | Public map markers, nodes, and verified connections |
| `routes/available` | GET | Published routes and route points |
| `announcements` | GET | Published, currently visible announcements |
| `floorplans` | GET | Public floor-plan metadata |
| `uploads/{photos\|floorplans}/<48-hex-name>` | GET/HEAD | Persistent Netlify Blobs media reader |
| `auth/csrf`, `auth/me`, `auth/entry`, `auth/login-status`, `auth/login`, `auth/logout` | GET/POST | PostgreSQL-backed expiring session, HttpOnly cookie, CSRF token, bcrypt-compatible password checks and rate limiting |
| `auth/setup` | GET/POST | One-time first-admin setup guarded by a server-only setup token |
| `auth/register`, `auth/resend-code`, `auth/verify-code`, `auth/recover` | POST | Email OTP challenge flow through Resend; registration creates inactive editor accounts pending approval |
| `auth/profile`, `auth/password` | GET/PUT/POST | Authenticated account profile and password change |
| `categories` | GET/POST/PUT/DELETE | Public category list; admin-only edits with assignment checks and audit records |
| `announcements` | GET/POST/PUT/DELETE | Public published feed; authenticated admin feed and editor/admin changes |

CORS allows same-origin requests automatically. Cross-origin requests require the exact requesting origin in the comma-separated `ALLOWED_ORIGINS` server environment variable (or the single `NETLIFY_SITE_ORIGIN` value). Credentialed CORS never uses wildcard origins.

## Deliberately unavailable

Google sign-in, administrator account management, location/room CRUD, map administration, authenticated uploads, gallery edits, system-settings writes, and route-builder operations are not yet implemented. Unsupported admin/write requests return HTTP 501 rather than a success-shaped placeholder. Authentication, category and announcement operations have only local mock-DB coverage so far; they have not been tested against a provisioned Netlify Database or Resend account. Do not configure `assets/js/deployment-config.js` to `/api` or publish this as a replacement production backend.

The media reader is implemented but uploaded files are not yet copied from the old PHP upload folders. The one-time `npm run migrate:uploads-to-blobs` utility requires the operator's Netlify site ID and personal access token in the process environment. Run it only after confirming the source backup and target site/store; then compare all local upload file counts and validate URLs before cutover.

## Development and smoke tests

```powershell
npm install
npm run build
npm run test:netlify
npm run dev
```

For local Netlify Database access, link a Netlify site and provision the database first so Netlify CLI can supply the appropriate database branch connection. Configure `RESEND_API_KEY`, `EMAIL_FROM`, `INITIAL_ADMIN_SETUP_TOKEN` (at least 32 characters), and `SESSION_COOKIE_SAMESITE` in Netlify environment settings; never put live values in the repository. Do not substitute production credentials in shared logs. `health` should return `ok` and `database: connected` only after a real connection succeeds. Google login is deliberately disabled in this migration stage.

## API parity gate

Before any frontend API cutover:

1. Implement every entry in the `Existing API compatibility map` in [MIGRATION_CHECKLIST.md](./MIGRATION_CHECKLIST.md), including exact response fields used by the current UI.
2. Add integration tests for each GET and each role-protected write, session expiry, CSRF, OTP delivery, rate limits, file permissions, graph transactions, and authorization boundaries.
3. Migrate MySQL data and uploads into isolated staging services, verify table counts and every foreign-key relationship, and test with copied data.
4. Run all browser flows on deploy preview. Only switch the API config after public and admin workflows pass and a rollback plan is approved.
