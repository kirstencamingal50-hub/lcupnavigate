# Start the LCUP campus system locally

This project now requires the XAMPP Apache/PHP and MySQL services. Opening `index.html` directly or using Live Server will not provide database-backed features.

1. Start Apache and MySQL in XAMPP.
2. If this is a fresh install, follow the schema and seed steps in [README.md](README.md).
3. Create the initial administrator with `.\scripts\create-admin.ps1 -Username your.admin`, or configure `LCUP_ADMIN_SETUP_KEY` in the Apache/PHP environment and use **Create Admin Account** on the login page. Web setup is one-time and requires a 32-character-or-longer server secret; remove that secret after creating the first admin account. Existing databases must also apply the setup migration documented in [README.md](README.md).
4. Open the app at `http://localhost/Capstone/`.
5. Sign in at `http://localhost/Capstone/pages/admin/login.html`.

Public administrator registration and password recovery require PHP mail configuration and `LCUP_MAIL_FROM`. Optional Google sign-in also requires the `GOOGLE_CLIENT_ID` environment variable and the PHP cURL extension. Newly registered accounts remain inactive until an administrator enables them in Admin Accounts.

Review imported campus records in the admin pages before relying on them. They are marked unverified; route calculation is limited to map connections explicitly verified by an authorized administrator.
