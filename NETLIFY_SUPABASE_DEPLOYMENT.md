# NaviGATE Netlify + Supabase Deployment

## Status and scope

This is an additive deployment path. The original PHP/MySQL application, its database schema, uploads, and local XAMPP workflow are retained; Netlify publishes only the static HTML/CSS/JavaScript site and the new Functions.

The Netlify Functions and Supabase schema are a migration foundation, not a verified production migration. The existing MySQL export and uploads inventory have not been supplied, and a live Supabase project and a complete Netlify + Supabase production deployment have not yet been verified. Do not switch production traffic until the data and media migration is completed and the live checks below pass. `database/initial-data.json` is pending prototype data; it is not a substitute for the actual database export.

The function API currently covers public directory/map/announcement reads; admin authentication and account profile operations; campus CRUD; map markers, nodes, connections, and route graph writes; announcements; and Storage metadata/media delivery. The original PHP endpoints remain unchanged. Live authentication, CRUD, storage, and cross-device behavior still require a configured project.

## Deployment files

- `netlify.toml` configures the static build, Functions, Node 22, and PHP-style API rewrites.
- `scripts/build-netlify.mjs` copies only `index.html`, `assets/`, `data/`, and `pages/` to `dist/`. PHP, `.env`, `database/`, `vendor/`, and local uploads are not published.
- `netlify/functions/` contains the API and shared authorization, Supabase, mutation, and media handlers.
- `supabase/migrations/20261113230000_initial_navigate_schema.sql` creates the PostgreSQL data model, RLS policies, auth profile triggers, one-time first-admin RPC, and private Storage buckets.
- `supabase/migrations/20261114230000_route_save_rpc.sql` adds the transactional route graph save operation.

Keep the original PHP and MySQL files in the repository. Do not copy `.env`, `vendor/`, or any database credentials to Netlify's published directory.

## Before deploying

1. **Back up the original system.** Export the real MySQL schema and records and inventory/copy the existing image and floor-plan files. Keep the original database and uploads unchanged until the migration is verified.
2. **Prepare the data mapping.** The Supabase schema preserves the campus entities and relationships, but no real data-import script has been run. Verify ID mappings and relationships for categories, locations, rooms, markers/nodes/connections, routes, announcements, admin accounts, and file references before importing. Do not import prototype seed data in place of production records.
3. **Create a Supabase project.** In SQL Editor, apply the two SQL files above in filename order. Confirm both execute successfully. The first migration creates private `campus-photos` and `floor-plans` buckets and their editor-only object policies.
4. **Configure Supabase Auth.**
   - Set the site URL to the deployed HTTPS origin.
   - Add `https://YOUR-SITE/pages/admin/login.html` to the Auth redirect URL allow-list. Add the Netlify deploy-preview domain only if previews need authentication.
   - Configure Supabase email delivery and the confirmation/recovery templates. The existing login screen supports Supabase email links and six-digit codes.
   - If Google sign-in is used, configure the Google provider in Supabase and use the matching client ID in Netlify. Add the deployed origin to the Google OAuth client.
5. **Migrate media before launch.** Upload each existing photo and floor plan to the corresponding private bucket, update its database reference to `campus-photos/<stored-name>` or `floor-plans/<stored-name>`, and verify public signed-link behavior. The Netlify build intentionally does not copy local `uploads/`. On Netlify, use **Manage Map → Floor plans → Verify** only after reviewing a plan; unverified plans remain private from visitors.

## Netlify environment variables

In Netlify, open **Site configuration → Environment variables** and set:

| Variable | Required | Scope / purpose |
|---|---:|---|
| `SUPABASE_URL` | Yes | Supabase project URL; Functions only |
| `SUPABASE_ANON_KEY` | Yes | Supabase publishable/anon key; Functions only (the client-config endpoint returns it to the browser as intended) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service-role secret; Functions only, never expose to builds or browser code |
| `APP_URL` | Yes | Deployed site origin, e.g. `https://your-site.netlify.app`; used for Auth email redirects |
| `INITIAL_ADMIN_SETUP_KEY` | For first setup | Random secret of at least 32 characters; used only by the one-time setup endpoint |
| `GOOGLE_CLIENT_ID` | Optional | Google Identity Services client ID; not a Google client secret |

Use the exact variable names. Do not add a service-role key to HTML, JavaScript, GitHub, or Netlify build-time public variables. Set `APP_URL` and Supabase redirect allow-lists before sending confirmation or recovery emails.

## Connect GitHub and deploy

1. Use the GitHub pull request for the audit branch to review the changes before merging them into `main`. The repository now has a GitHub Actions workflow at `.github/workflows/ci.yml`; it runs the test suite and Netlify build on pushes and pull requests. Do not merge while any required check is failing.
2. In Netlify, select **Add new site → Import an existing project**, authorize GitHub, and select the NaviGATE repository.
3. Set the base directory to the repository root. Use:
   - Build command: `node scripts/build-netlify.mjs`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions` (also set in `netlify.toml`)
4. Add the environment variables above, then trigger a deploy. Review the deploy log for a successful static build and Functions bundling.
5. Verify the deployed root opens the existing Role Selection page. Choose **Student / Guest** and verify public campus pages load; choose **Admin / Editor** and verify the existing Admin Login page opens. Refresh the root and confirm it remains on Role Selection.
6. After the data and media import is verified, create the first administrator from the login page using the one-time setup key. Confirm the account can sign in, then remove `INITIAL_ADMIN_SETUP_KEY` from Netlify.
7. Test a Netlify deploy preview and the production custom domain separately. Add only the needed HTTPS origins to Supabase Auth, Google OAuth, and Storage CORS settings.

The build is intentionally a whitelist. After a successful build, confirm that `dist/` contains no `.php`, `.env`, `vendor/`, `database/`, or local `uploads/` files.

## Validation completed in the local workspace

- `npm run test:supabase-schema` applies the schema in PGlite, checks the role/bootstrap and RLS model, and tests route graph creation, duplicate rejection, validation, and rollback behavior.
- JavaScript syntax checks and the Netlify static build must pass before deployment.
- These local checks do **not** prove that Supabase Auth email delivery, production RLS, Netlify rewrites, Storage uploads, real campus data, or cross-device persistence work. They must be checked against the actual Supabase project and a Netlify deploy preview.

## Required live acceptance checks

- Public building/facility/room directory, search, details, categories, announcements, map markers, route guidance, accessibility filters, and supported offline behavior.
- Initial Role Selection on a fresh visit and refresh; Student / Guest remains public, and Admin / Editor opens login.
- Admin login/logout, first-admin setup, email confirmation, recovery, optional Google login, account activation, and admin/editor/viewer authorization.
- Location, room, category, marker, node, connection, route, announcement, profile, and account role/status changes; verify editor/admin boundaries and that unauthorized users receive errors.
- Photo/floor-plan upload, public viewing of approved media, replacement/deletion, and verification that private/unapproved files are not accessible.
- Verify data and media on a separate browser/device after changes.

If any check fails, keep the PHP deployment available and do not point users to the Netlify site as the production system.
