# Taskweb Deployment Plan (IndexedDB First + Dockerized VPS Backend)

## Goal
- Ship an offline-first frontend using IndexedDB for local daily usage.
- Add authenticated cloud mode backed by Django/DRF on a VPS.
- Use Docker for backend deployment on VPS.
- Use WSL as the primary pre-production test ground.

## Deployment Strategy
- **Phase A (Local-first):** frontend runs with IndexedDB only, no backend dependency.
- **Phase B (Cloud-ready):** backend auth + API mode available.
- **Phase C (Production):** Dockerized backend stack deployed to VPS, frontend served publicly.

## Environment Model
- **Dev/Test Ground:** WSL (authoritative staging-like environment).
- **Production:** VPS running Docker Compose.

## Stage 0: Storage Abstraction (No Behavior Change)
### Tasks
- Add repository layer in frontend (`Task/Profile/Tag/Log/Activity`).
- Keep existing API behavior behind `ApiRepository`.
- Add `IndexedDbRepository` shell.
- Add runtime flag `VITE_STORAGE_MODE=api|indexeddb`.

### Acceptance
- `api` mode behavior unchanged.
- Existing test suite passes.

## Stage 1: IndexedDB Local Mode
### Tasks
- Implement IndexedDB schema (profiles, tasks, tags, checklist, streak rules, logs, current activity).
- Implement action semantics in local repo:
- habit increment, daily complete, todo complete, reward claim, new-day checks, activity logging.
- Ensure parity with backend invariants:
- tenant/profile scoping, gold balance/log consistency, task-type constraints.
- Keep TaskApp import/export available in local mode.

### Acceptance
- App fully usable with backend offline.
- Data persists across reload/browser restart.
- Core journeys (tasks/logs/graphs/new-day/activity) work.

## Stage 2: WSL as Pre-Prod Test Ground
### Tasks
- Create WSL runbook for deterministic test env:
- backend (Django), frontend (Vite), DB (local Postgres), env vars.
- Add Docker Compose **in WSL** for backend stack rehearsal:
- `web` (Django + gunicorn), `db` (Postgres), optional `nginx`.
- Add backend smoke script for WSL:
- migrations, checks, backend tests.

### Acceptance
- Backend stack runs in WSL via Compose.
- Same env var contract as VPS.
- Reproducible one-command validation.

## Stage 2.5: Local Frontend Deployment Validation (Pre-Auth)
### Tasks
- Build and run frontend in WSL in both modes:
- `VITE_STORAGE_MODE=indexeddb` (offline local mode).
- `VITE_STORAGE_MODE=api` against WSL backend.
- Validate static build path:
- `npm --prefix frontend run build`
- serve build (`vite preview` or lightweight static server) and verify routing/pages.
- Verify key journeys in browser:
- profiles, tasks/actions, new day modal, logs, graphs, admin/API reachability.
- Confirm mode-specific UX:
- local mode hides cloud-only import/export actions.

### Acceptance
- Frontend is runnable in WSL as a deployed build, not only dev server.
- IndexedDB mode works without backend.
- API mode works against WSL backend at `http://127.0.0.1:8000`.

## Stage 3: Auth + Cloud Mode
### Tasks
- Implement backend auth for SPA (JWT preferred).
- Enforce auth on profile/task/tag/log endpoints.
- Frontend login/logout/session bootstrap.
- Mode toggle UX:
- Local (IndexedDB) vs Cloud (API).

### Acceptance
- Cloud mode works in WSL against authenticated backend.
- Unauthorized access is blocked.

## Stage 4: Local-to-Cloud Migration
### Tasks
- Add explicit migration action in UI.
- Read local IndexedDB data and upload to selected cloud profile/account.
- Upsert order:
- profiles -> tags -> tasks -> checklist/streak rules -> logs.
- Preserve UUIDs when possible; remap collisions.
- Return and display migration report (created/updated/skipped/errors).

### Acceptance
- User can migrate local data safely and verify counts.
- No silent data loss.

## Stage 5: Dockerized VPS Deployment
### Docker Topology
- `web`: Django app container (gunicorn).
- `db`: Postgres container with named volume.
- `nginx`: reverse proxy + TLS termination (or external Caddy/Traefik).
- Optional `worker`/`beat` for async jobs later.

### Tasks
- Add production `Dockerfile` for Django.
- Add `docker-compose.prod.yml` with:
- restart policies, healthchecks, env files, volumes.
- Configure Django prod settings:
- `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, secure cookies, static/media strategy.
- Add deployment script:
- pull image/build, run migrations, restart stack, run health check.
- Add backup strategy:
- Postgres dump cron + retention + restore drill.

### Acceptance
- VPS serves API over HTTPS.
- `docker compose up -d` produces healthy stack.
- Migrations run successfully in deployment flow.
- Frontend cloud mode can login and operate end-to-end.

## Security and Secrets
- Keep secrets in `.env`/VPS secret store, never in git.
- Use unique production DB credentials.
- Enforce HTTPS and secure cookie settings.
- Rate-limit auth endpoints.
- Audit import/migration operations.

## CI/CD Outline (After Stage 3)
- On main branch:
1. Backend tests + checks.
2. Frontend typecheck + tests.
3. Build/push backend Docker image.
4. Deploy to VPS (manual approval step recommended).
5. Run post-deploy smoke checks.

## WSL Validation Checklist (Before Every VPS Deploy)
1. `docker compose -f docker-compose.wsl.yml up -d --build`
2. `python manage.py migrate`
3. `python manage.py check`
4. `python manage.py test`
5. `npm --prefix frontend run typecheck`
6. `npm --prefix frontend run test`
7. Local smoke of login, task actions, new day, import/export.

## Risks and Mitigations
- **Parity drift (IndexedDB vs API):** shared service rules + parity tests.
- **Migration mismatches:** deterministic import order + explicit report.
- **Env drift (WSL vs VPS):** same Compose model and env schema.
- **Auth/CORS issues:** explicit WSL checklist before VPS deploy.

## Deliverables
- `DEPLOYMENT_PLAN_INDEXEDDB.md` (this file).
- Frontend storage abstraction + IndexedDB implementation.
- Auth-enabled backend cloud mode.
- Local-to-cloud migration flow.
- Dockerized backend deployment assets (`Dockerfile`, compose, runbooks).

## Recommended Execution Order
1. Stage 0
2. Stage 1
3. Stage 2 (WSL pre-prod baseline)
4. Stage 2.5 (frontend deployment validation in WSL)
5. Stage 3
6. Stage 4
7. Stage 5
