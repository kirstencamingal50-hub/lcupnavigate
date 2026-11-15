# Ask NaviGATE and Department Directory (Netlify)

These features use the existing Netlify Functions + Supabase deployment. Ask NaviGATE is a **rule-based campus-record assistant**, not a generative AI chatbot. It searches active campus records and formats matching results into predefined responses. It does not call OpenAI or any other external AI service, and no AI API key is required.

Student and guest access remains public; no student or guest accounts are introduced. Administrator authentication and role checks remain in place.

## 1. Required Netlify environment variables

In Netlify, open **Site configuration → Environment variables** and confirm these server-side variables are configured:

- `SUPABASE_URL`: URL of the connected Supabase project.
- `SUPABASE_ANON_KEY`: Supabase publishable/anon key.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role key. Keep this secret and available only to server-side Netlify Functions. Never place it in frontend code or expose it as a public variable.

Some administrator email and first-admin setup flows also use:

- `APP_URL`: the deployed HTTPS site URL, used to construct authentication links.
- `INITIAL_ADMIN_SETUP_KEY`: the secret configured for the first-admin bootstrap flow, if that flow is being used.

Do not add an OpenAI key for this feature; the current assistant implementation does not use one.

## 2. Apply the department migration

Before using department features, open the connected Supabase project's SQL Editor and run:

`supabase/migrations/20261115030000_add_department_directory.sql`

The migration is additive. It creates `departments` and `department_locations` and enables row-level security so public browser clients cannot write directly to these tables. It does not delete existing campus data. The Netlify Functions use the server-side service-role key for the validated department operations.

## 3. Public pages

- `/pages/assistant.html`: Ask NaviGATE, campus Q&A, map links, favorites, recent questions and browser text-to-speech.
- `/pages/departments.html`: searchable department directory with building filters and multi-building assignments.

Favorites and recent questions are saved locally on the visitor's device. Shared campus records remain in Supabase.

## 4. Administrator page

After the migration is applied, an authorized administrator/editor can use:

`/pages/admin/manage-departments.html`

The page supports department create, edit, archive, contact details, office hours, description, and multiple building/room assignments. The API validates that selected rooms belong to the selected building.

## 5. Important limitations to verify

- Add real department records and building/room assignments in the admin page; the feature does not invent LCUP department assignments.
- Image path accepts an existing storage object path or URL. Dedicated department-photo upload is not yet wired to the existing media uploader.
- Ask NaviGATE searches existing database records and uses predefined response templates. It cannot answer from general knowledge, generate new content, or compute a new shortest-path route.
- Ask NaviGATE only reports route and accessibility details that are actually present in campus records. It does not certify accessibility when the database has no verified route data.
- Events are read from published announcements with event dates and venues; keep announcement records current.
- The assistant's factual context comes only from active campus database records. If a record is missing or incomplete, add or correct it in the campus data rather than expecting the assistant to infer it.

## 6. Deploy Preview verification

For a pull-request Deploy Preview, confirm that Netlify builds the PR head commit and detects all three function entry points:

- `netlify/functions/api.mjs`
- `netlify/functions/assistant.mjs`
- `netlify/functions/departments.mjs`

The site build is configured in `netlify.toml` to publish `dist` while Netlify packages functions from `netlify/functions`. A successful static-site build alone is not sufficient; verify the function packaging and test the public assistant and department endpoints in the Deploy Preview.
