# NaviGATE online deployment

> **Migration notice:** Netlify configuration, a PostgreSQL schema, data/file migration tools, public reads, initial server-side authentication, and category/announcement CRUD have been added. The Netlify Functions backend is not yet at feature parity or connected to a live provider. The frontend remains configured for the current PHP API. Do not publish this as a replacement production backend or point users at `/api` before the gates in [MIGRATION_CHECKLIST.md](./MIGRATION_CHECKLIST.md) and [NETLIFY_API.md](./NETLIFY_API.md) pass.

## Current Netlify setup

The current Netlify configuration builds a static-only `dist/` folder, deploys Functions from `netlify/functions`, rewrites `/api` to the Netlify API Function, and rewrites `/uploads/*` to the Netlify Blobs reader. It excludes PHP/API source and server-only configuration from the static publish directory. `npm run build` does not switch the frontend API URL because most administrator and write operations are not migrated yet.

Netlify Database is currently documented as available on credit-based plans. The Netlify pricing page lists a Free plan with 300 monthly credits and includes Database, Blobs, Functions, and custom-domain SSL. Database-specific Free limits include up to 3 databases, 48 compute units per billing period, 5 GB of data written, 5 GB network egress, and 5 GB maximum storage; database compute currently costs 10 credits per compute unit and database bandwidth 20 credits per GB. Netlify warns that exhausting the Free credit balance pauses the site's projects, so confirm current limits and usage in the account before a demo. Netlify Blobs is persistent site-wide storage and can be accessed by Functions, but its costs/limits are subject to current plan/usage policies. Prices and limits can change:

- [Netlify pricing](https://www.netlify.com/pricing/)
- [Netlify Database billing and usage](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)

To provision after approval: connect the repository to a new Netlify site, select the repository root as the base directory, allow the `npm run build` command and `dist` publish directory from `netlify.toml`, enable Netlify Database so its automatic migrations run, and set `NETLIFY_SITE_ORIGIN` plus `ALLOWED_ORIGINS` in site environment settings. For authentication, also set `RESEND_API_KEY`, a verified `EMAIL_FROM`, a random `INITIAL_ADMIN_SETUP_TOKEN` of at least 32 characters, and `SESSION_COOKIE_SAMESITE`. Use `Lax` when the UI and API are same-site; use `None` only for a genuinely cross-site frontend and HTTPS. Add the separate GitHub repository/site binding and deploy context configuration in Netlify. No site has been linked or deployed from this workspace.

The schema migration is stored in Netlify's automatic migration directory at `netlify/database/migrations/20261102143000_initial_schema.sql`. Do not manually apply this migration and also enable Netlify's automatic runner on the same database. For existing MySQL data, back up first and use `npm run migrate:mysql-to-postgres` with protected local process environment values for `SOURCE_MYSQL_URL` and `DATABASE_URL`; the importer refuses non-empty target tables. For local uploads, `npm run migrate:uploads-to-blobs` transfers only known safe filenames into the Netlify Blobs store and requires `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN`. Neither tool has been run against a production service.

Netlify API stage details and unavailable operations are documented in [NETLIFY_API.md](./NETLIFY_API.md).

The existing application still uses the PHP API and MySQL/MariaDB schema in `api/` and `database/schema.sql`. Records are read and written by the API; the browser is not the primary database. The repository does not contain hosting accounts or credentials, so no hosting service or source database has been migrated.

## Legacy PHP/MySQL hosting reference (not the Netlify migration)

Choose a PHP 8.2+ host with PDO MySQL, HTTPS, environment-variable support, scheduled backups, and a MySQL/MariaDB database reachable from the PHP application. The uploaded-file directory must be persistent across deploys/restarts and web-accessible. The current upload API stores photos and floor plans in `uploads/photos/` and `uploads/floorplans/`; for a mounted volume, mount it at the application's `uploads/` directory. Do not use an ephemeral deployment filesystem for uploads.

A free tier is suitable only if it offers those capabilities without sleeping/expiry behavior that is unacceptable for the demo. Managed database connection restrictions and storage limits vary by provider. If frontend and backend use different origins, the backend must also support credentialed CORS and cookies; hosting both under the same HTTPS origin is the simpler option.

## Move the existing installation

1. Back up the local database and the complete `uploads/` directory. Keep both backups outside the public web root. For XAMPP, a database export can be created with:

   ```powershell
   & 'C:\xampp\mysql\bin\mysqldump.exe' --single-transaction -u root -p lcup_campus_nav > C:\private-backups\lcup_campus_nav.sql
   ```

   Create the destination directory first, use a protected location, and enter the local database password at the prompt. Restore the dump using the provider's secure import facility or MySQL client.
2. Provision the online MySQL database and a dedicated application user with only the required schema/data privileges. Do not expose MySQL to browser clients or the public internet.
3. If this is a fresh database, import `database/schema.sql`, generate/import seed data as described in `README.md`, and apply the documented migrations. To preserve an existing installation, export and restore its complete database instead of importing the seed again; this preserves administrator records and current data.
4. Copy the existing `uploads/` files to the persistent online upload volume, preserving the `photos/` and `floorplans/` subdirectories and file names. Verify uploaded image URLs are HTTPS-accessible.
5. Deploy the project files to the PHP host. Configure the environment on the server (not in source control or frontend JavaScript):

   | Variable | Required value |
   | --- | --- |
   | `LCUP_ENV` | `production` |
   | `LCUP_DB_HOST` | Provider's private/restricted MySQL hostname |
   | `LCUP_DB_PORT` | Provider's MySQL port, usually `3306` |
   | `LCUP_DB_NAME` | Online database name |
   | `LCUP_DB_USER` | Dedicated, non-root application user |
   | `LCUP_DB_PASS` | Strong database password |
   | `LCUP_COOKIE_SECURE` | `1` |
   | `LCUP_COOKIE_SAMESITE` | `Strict`/`Lax` for same-site deployment; `None` for a genuinely cross-site frontend, with Secure cookies |
   | `LCUP_CORS_ORIGINS` | Comma-separated exact HTTPS frontend origins, e.g. `https://navigate.example.edu` (origins only; no paths or trailing slash) |

   Configure mail (`LCUP_MAIL_FROM` and the server mail relay) and optional Google sign-in (`GOOGLE_CLIENT_ID`) only if those features will be used. Set `LCUP_ADMIN_SETUP_KEY` temporarily only when creating the first online administrator, then remove it.
6. Configure the frontend API URL in `assets/js/deployment-config.js`. For example:

   ```js
   window.CAMPUS_API_BASE_URL = 'https://api.example.edu/api/';
   ```

   The value is public and must contain no secrets. It must point to the deployed `api/` directory and include the trailing slash. Leave it empty when the site and API are deployed together at the expected relative path. The deployment config is loaded by all pages before the API client.
7. Require HTTPS on both frontend and API; redirect HTTP to HTTPS. For separate origins, enter the frontend's exact origin in `LCUP_CORS_ORIGINS`. Cross-site cookies require `LCUP_COOKIE_SAMESITE=None` and `LCUP_COOKIE_SECURE=1`. Do not use `Access-Control-Allow-Origin: *` with credentials.
8. Configure a scheduled encrypted database backup using the hosting provider's backup feature or its managed MySQL dump facility. Retain backups off-host, restrict who can restore them, and periodically test a restore. Back up the persistent `uploads/` volume as well as MySQL; database backups alone do not include image files.
9. From the deployed host, check the API and public site over HTTPS. Sign in as an administrator, create/update a harmless test record, verify it from a second browser/device/network, then remove the test record. Verify a test upload from another device and confirm session cookies, CORS preflight, and login all work before demonstration.

## Configuration and safety notes

- Never put database credentials, admin setup keys, mail passwords, or provider tokens in HTML, JavaScript, or public repositories.
- Do not point a public application at the XAMPP development database or use MySQL `root`.
- The existing session-backed administrator authentication, role checks, CSRF token validation, prepared database statements, and audit logging remain on the PHP backend. Production requires a persistent session handler if the host runs multiple PHP instances; configure a shared server-side session store at the host.
- Uploaded files are served from the application's persistent `uploads/` directory. If a provider only offers object storage and no durable mounted filesystem, this version needs a provider-specific object-storage adapter before using it; a local/temporary upload directory is not an acceptable substitute.
- Public single-origin deployment may not need cross-origin CORS headers. Keep the frontend origin allowlist minimal whenever CORS is enabled.

The repository cannot confirm a live public URL, complete a provider-specific deployment, or test mobile-data/multi-network availability until a hosting provider, account, domain, and deployment access are provided.
