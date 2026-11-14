# Repository instructions for NaviGATE

This repository contains the NaviGATE campus navigation application. The original PHP/MySQL application is retained alongside an additive Netlify + Supabase deployment path.

## Project boundaries
- Preserve the existing PHP/MySQL/XAMPP application unless a task explicitly requests changes to it.
- Netlify publishes only the static frontend built into `dist/` and the functions in `netlify/functions/`.
- Supabase is the PostgreSQL/Auth/Storage backend for the Netlify deployment. Never expose `SUPABASE_SERVICE_ROLE_KEY`, database credentials, or other secrets in browser code, committed files, or build output.
- Do not treat `database/initial-data.json` as production campus data. It is prototype data pending campus review.
- Do not switch production traffic until the real MySQL records and uploaded media have been migrated and the live acceptance checks in `NETLIFY_SUPABASE_DEPLOYMENT.md` pass.

## Development and validation
- Use Node.js 22 or newer.
- Run `npm test`, `npm run test:supabase-schema`, `npm run test:map-consistency`, and `npm run build:netlify` after relevant changes.
- Keep tests for security-sensitive behavior, API contracts, schema constraints, and frontend/backend compatibility.
- Keep migrations additive and ordered by filename. Review RLS, grants, and SECURITY DEFINER function permissions whenever database functions or tables change.
- Prefer soft-archiving campus entities when existing relationships or historical routes may reference them.
- Do not commit generated `dist/` output, local `.env` files, secrets, production database exports, or private campus uploads.

## Coding expectations
- Validate request methods, input types, lengths, IDs, and authorization on the server; never rely only on frontend validation.
- Use parameterized Supabase query-builder operations and the shared helpers in `netlify/functions/_shared/`.
- Keep public reads limited to active/approved campus information. Keep unverified floor plans and private media inaccessible to visitors.
- Preserve the student/guest public experience without requiring student accounts.
- Avoid unrelated refactors and destructive deletion of legacy PHP/MySQL files or campus data.
