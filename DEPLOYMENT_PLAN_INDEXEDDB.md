# Taskweb Deployment Plan: IndexedDB First, Backend Login Later

## Goal
- Ship a locally usable version that works without backend auth by storing data in browser IndexedDB.
- Later add backend login and sync/persistence to a VPS-hosted Django API.
- Keep migration safe so current users do not lose data.

## Scope
- Frontend: React app supports two storage modes:
- Local mode: IndexedDB only.
- Cloud mode: authenticated API mode (Django + Postgres on VPS).
- Backend: remains source for cloud mode; no breaking changes for current API consumers.

## Architecture Direction
- Introduce a storage abstraction in frontend:
- `TaskRepository`, `ProfileRepository`, `TagRepository`, `LogRepository`, `ActivityRepository`.
- Provide implementations:
- `IndexedDbRepository` (offline/local).
- `ApiRepository` (current DRF endpoints).
- Runtime mode switch:
- `local` mode uses IndexedDB.
- `cloud` mode uses API after login.
- Optional later:
- `hybrid` mode with sync queue/conflict resolution.

## Stage 0: Foundation (No Behavior Change)
### Tasks
- Add repository interfaces and adapters without changing UI behavior.
- Wrap existing API calls behind repository layer.
- Add feature flag/config: `VITE_STORAGE_MODE=api|indexeddb`.
- Keep default as `api` for zero regression.

### Acceptance
- App behavior unchanged in `api` mode.
- Existing tests still pass.

## Stage 1: IndexedDB Local Mode
### Tasks
- Add IndexedDB schema (Dexie or idb) for:
- profiles, tasks, tags, checklist_items, streak_bonus_rules, logs, current_activity state.
- Implement CRUD/action operations in IndexedDB repo matching current semantics:
- habit increment, daily complete, todo complete, reward claim, activity logging, new-day checks.
- Preserve existing invariants at repo/service layer:
- profile scoping, task-type constraints, gold balance consistency, log append behavior.
- Add local import/export support (TaskApp archive) in local mode.

### Acceptance
- With backend unavailable, app is fully usable in browser.
- Existing flows work: tasks, profiles, tags, logs, graphs, current activity, new day.
- Data persists across refresh/restart in same browser profile.

## Stage 2: Local Deployment Packaging
### Tasks
- Build static frontend bundle for local usage:
- `npm run build` and serve with simple static server (or packaged desktop shell later).
- Add environment presets:
- `VITE_STORAGE_MODE=indexeddb`
- `VITE_API_BASE_URL` optional/empty.
- Document local deployment:
- run command, browser requirements, data backup strategy.

### Acceptance
- Non-technical local usage path documented and reproducible.
- App starts and runs without Django backend.

## Stage 3: Backend Auth and Cloud Mode
### Tasks
- Implement auth endpoints in Django (session or JWT; prefer JWT for SPA deployment).
- Add frontend auth flow:
- login, logout, auth bootstrap, token/session refresh strategy.
- Enforce auth on existing profile/task/tag/log endpoints.
- Keep profile tenancy rule unchanged (`Profile` scoped to account).
- Add mode switch UX:
- “Use Local Data” vs “Use Cloud Account”.

### Acceptance
- User can log in and use cloud mode against VPS backend.
- Unauthorized requests are blocked.
- Cloud mode parity with current behavior.

## Stage 4: Local-to-Cloud Migration (One-Time Import)
### Tasks
- Add explicit “Upload Local Data to Cloud” action.
- Migration flow:
- Read all local IndexedDB entities.
- Create/select cloud profile(s).
- Upsert records in dependency order:
- profiles -> tags -> tasks -> checklist/streak rules -> logs.
- Preserve UUIDs where possible; map collisions safely.
- Show migration report:
- created/updated/skipped counts and errors.

### Acceptance
- User can migrate local data to account with clear result summary.
- No silent data loss.

## Stage 5: VPS Deployment
### Tasks
- Provision VPS:
- Ubuntu, Python env, Postgres, Nginx, systemd service.
- Deploy Django:
- env vars, secrets, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, static files, HTTPS.
- Deploy frontend static bundle:
- Nginx serving build artifacts.
- Configure CORS/CSRF according to auth method.
- Add backups:
- Postgres daily backup + retention.

### Acceptance
- Public HTTPS endpoint for API and frontend.
- Login + cloud mode works from browser.
- Health checks and restart strategy documented.

## Data and Security Requirements
- Never commit secrets (`.env` only, ignored by git).
- Use unique, rotated production credentials.
- Enforce HTTPS in production.
- Rate-limit auth endpoints.
- Add audit logs for import/migration actions.

## Testing Plan for Rollout
- Unit tests:
- repository parity (api vs indexeddb) for action semantics.
- Integration tests:
- local mode end-to-end without backend.
- cloud mode end-to-end with auth.
- Migration tests:
- local sample dataset -> cloud import verification.
- Smoke checks on VPS after deployment.

## Risks and Mitigations
- Risk: Divergent behavior between local and cloud actions.
- Mitigation: shared service logic + parity tests per action.
- Risk: Data mismatch during migration.
- Mitigation: deterministic import order + detailed migration report + dry-run option.
- Risk: Browser storage limits.
- Mitigation: export/backup tooling + size warning in UI.
- Risk: Auth/CORS misconfiguration.
- Mitigation: staging checklist with explicit CSRF/CORS tests.

## Deliverables
- `DEPLOYMENT_PLAN_INDEXEDDB.md` (this file).
- Frontend storage abstraction + IndexedDB implementation.
- Auth-enabled backend and cloud mode.
- Migration tooling local -> cloud.
- VPS deployment scripts/docs.

## Recommended Execution Order
1. Stage 0 + Stage 1 (make local mode fully usable).
2. Stage 2 (document and package local deployment).
3. Stage 3 (auth and cloud mode).
4. Stage 4 (local-to-cloud migration).
5. Stage 5 (production VPS rollout).
