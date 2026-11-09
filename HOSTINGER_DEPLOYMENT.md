# NaviGATE on Hostinger Cloud (PHP + MySQL)

## What this package changes

- Keeps the existing HTML/CSS/JavaScript frontend and PHP API.
- Keeps the current API endpoint (`api/index.php?resource=...`) and same-origin browser requests.
- Updates PHP Dotenv loading so production secrets can live one directory above `public_html`; local XAMPP `.env` still works.
- Adds Apache access restrictions for internal PHP includes, Composer vendor files, and uploads.
- Removes local backups, test files, editor settings, and the credential-bearing local `.env` from this deployment ZIP.

No Node.js, Vercel, Firebase, CORS proxy, or frontend rewrite is required.

## 1. Prepare Hostinger

1. Add your domain to the Hostinger Cloud website.
2. Enable SSL and force HTTPS for the domain.
3. Create a MySQL database and a dedicated database user in hPanel.
4. Copy the exact database host, database name, username, and password shown by Hostinger. Do not assume the database host is `localhost`.
5. Select PHP 8.2 or newer (PHP 8.3 is a suitable starting point) and ensure `pdo_mysql`, `mbstring`, `curl`, `fileinfo`, and `openssl` are enabled. `curl` is needed for optional Google sign-in; `fileinfo` is used for upload validation.

## 2. Upload the website

Upload the CONTENTS of this package into `public_html` (not the enclosing ZIP folder). The `index.html` file should end up at `public_html/index.html` and the API at `public_html/api/index.php`.

The project already uses relative API paths based on the current page location. Do not change them to localhost or a separate API domain. The live API remains `/api/index.php?resource=...`.

## 3. Create the private environment file

Create a file named `.env` one directory ABOVE `public_html`, alongside the `public_html` folder. Copy the contents of `.env.example` into it and fill in:

- `LCUP_ENV=production`
- `LCUP_DB_HOST`, `LCUP_DB_NAME`, `LCUP_DB_USER`, `LCUP_DB_PASS` using the exact values from hPanel
- `LCUP_DB_PORT=3306` unless Hostinger explicitly gives a different port
- `LCUP_COOKIE_SECURE=1`
- `LCUP_ADMIN_AUTH_BYPASS=0`
- `APP_URL=https://your-real-domain`

Keep SMTP fields blank until Brevo SMTP credentials and a verified sender are ready. Email registration, verification, and password recovery will not send mail until SMTP is configured.

The updated `api/bootstrap.php` loads the parent-folder `.env` first. It also retains support for a project-root `.env` for local XAMPP development. Never upload a real `.env` to GitHub.

If Hostinger's account layout does not permit a parent-folder `.env`, place it in the project root only after confirming the root `.htaccess` blocks direct requests to `/.env`; test that URL returns 403 or 404. The parent-folder location is preferred.

## 4. Import your existing database AND records

For your existing XAMPP installation, export the COMPLETE current `lcup_campus_nav` database (all tables and data) from phpMyAdmin using Export → Quick → SQL, or use:

```powershell
& 'C:\xampp\mysql\bin\mysqldump.exe' -u root -p --single-transaction lcup_campus_nav > "$env:USERPROFILE\Desktop\navigate_backup.sql"
```

Then in Hostinger phpMyAdmin:

1. Select the newly created Hostinger database.
2. Choose Import.
3. Upload `navigate_backup.sql`.
4. Run the import and confirm that the expected tables and records are present.

Important: When migrating the existing complete database dump, do NOT import `database/schema.sql` over it and do NOT rerun old migrations. The dump already carries the schema and records from your local database. Keep the SQL backup in a safe place.

For a brand-new empty installation only, import `database/schema.sql` into the selected Hostinger database, then use the documented seed importer if you intentionally want the review-pending sample campus data. Do not use the sample seed as verified official campus data.

## 5. First administrator

If the imported database already contains your active administrator account, sign in with that existing account. Do not create a second first administrator.

If the imported database has no administrator, temporarily set a random `LCUP_ADMIN_SETUP_KEY` with at least 32 characters in the private `.env`, open the Admin Login page, and use Create Admin Account. After the first admin is created, remove `LCUP_ADMIN_SETUP_KEY` from `.env` immediately.

## 6. Uploads and persistence

The app stores uploaded photos and floor plans under `uploads/` on the Hostinger server and stores their relative paths in MySQL. These files persist across user devices because the browser retrieves them from the same hosted site. Do not delete `uploads/` during a code redeployment. Back it up before deploying updates.

The package retains the current sample upload files. New user uploads are not committed to Git; they are stored on the server. Keep the `uploads` directory writable by the PHP process (use the hosting provider's recommended permissions; do not set 777 unless Hostinger support specifically directs it).

## 7. GitHub deployment

Connect the GitHub repository to Hostinger's Git deployment feature and select the production branch. Set the deployment directory to `public_html` (or upload this package manually through File Manager if Git deployment is unavailable on your plan).

Before each deployment:

- Back up the database.
- Back up `uploads/`.
- Confirm the deployment will not delete persistent uploads or the private `.env` outside `public_html`.
- Deploy code, not database dumps or secrets.

## 8. Post-deployment checks

- Open `https://your-real-domain/` and confirm the home page loads.
- Open `https://your-real-domain/api/index.php?resource=auth/login-status`; expect a JSON response, not an HTML 404 page.
- Sign in to the admin panel.
- Test adding/editing a building, room, route, and announcement.
- Upload a test image and confirm it remains visible after refresh.
- Open the site on a second device using a different Wi-Fi/network.
- Confirm changes made on one device appear on the other.
- Confirm `https://your-real-domain/.env` is not downloadable (normally 403/404 because the real file is outside the web root).
- Confirm direct requests to `/api/bootstrap.php` and `/api/email.php` are denied.
- If email is configured, use the admin email test.

## Important project limitations to review before public launch

- Imported campus records and route connections must be verified by authorized LCUP personnel before being treated as official directions.
- Browser display preferences stored in localStorage remain device-specific by design; campus data and admin changes are server-backed.
- Favorites/offline map behavior and a real multi-device acceptance test should be verified separately.
