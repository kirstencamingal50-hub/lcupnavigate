# Ask NaviGATE and Department Directory (Netlify)

This feature is designed for the existing Netlify Functions + Supabase deployment. It does not add student or guest accounts. Administrator authentication remains unchanged.

## 1. Apply the department migration

Before testing department features, open the connected Supabase project's SQL Editor and run:

`supabase/migrations/20261115030000_add_department_directory.sql`

The migration is additive. It creates `departments` and `department_locations` and enables row-level security so public browser clients cannot write directly to these tables. It does not delete existing campus data.

## 2. Configure generated AI answers

In Netlify, open Site configuration → Environment variables and add:

- `OPENAI_API_KEY`: a server-side API key with access to the Responses API.
- `OPENAI_MODEL` (optional): defaults to `gpt-4.1-mini`.

Keep this key in Netlify only. Do not add it to frontend JavaScript, HTML, GitHub, or a public environment variable. Without the key, Ask NaviGATE still searches campus database records and returns a deterministic answer; generated AI responses are disabled.

## 3. Public pages

- `/pages/assistant.html`: Ask NaviGATE, campus Q&A, map links, favorites, recent questions and browser text-to-speech.
- `/pages/departments.html`: searchable department directory with building filters and multi-building assignments.

Favorites and recent questions are saved locally on the visitor's device. Shared campus records remain in the Supabase database.

## 4. Administrator page

After the migration is applied, an authorized administrator/editor can use:

`/pages/admin/manage-departments.html`

The page supports department create, edit, archive, contact details, office hours, description, and multiple building/room assignments. The API validates that selected rooms belong to the selected building.

## 5. Important limitations to verify

- Add real department records and building/room assignments in the admin page; the feature does not invent LCUP department assignments.
- Image path accepts an existing storage object path or URL. Dedicated department-photo upload is not yet wired to the existing media uploader.
- Ask NaviGATE only reports routes and accessibility details that are actually present in campus records. It does not compute a new shortest-path route or certify accessibility when the database has no verified route data.
- Events are currently read from published announcements with event dates and venues.
- The AI endpoint uses database records as its only factual context and falls back to deterministic record search if the model service is unavailable.
