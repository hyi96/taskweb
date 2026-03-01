# taskweb

Task + habit tracker with a Django/DRF backend and a React frontend.

## Live demo
- App: https://taskweb.hyi96.dev
- API health: https://taskweb-api.hyi96.dev/healthz/
- You can sign up for a cloud account or use guest mode (local IndexedDB storage).

## Desktop version
- TaskApp (desktop): https://github.com/hyi96/TaskApp
- `.taskapp` import/export is intended for portability between TaskApp and taskweb profiles.

## Stack
- Backend: Django, DRF, PostgreSQL
- Frontend: React, TypeScript, Vite
- E2E: Playwright

## Major features
- Cloud mode and guest mode:
  - Cloud mode stores data on the Django API (account-based).
  - Guest mode stores data in browser IndexedDB (no account required).
- Multi-profile tracking:
  - Create multiple profiles with separate gold balances, tasks, logs, and tags.
  - Import/export profile archives (`.taskapp`) and import local data into cloud profiles.
- Task system:
  - Habits with count increments and optional reset cadence.
  - Dailies with cadence/repeat rules, streak tracking, and streak bonus rules.
  - Todos with due date/time and checklist items.
  - Rewards with repeatable or one-time claim behavior.
- Current activity timer:
  - Start/pause/reset/remove activity sessions.
  - Logs `activity_duration` entries and supports auto-complete thresholds for dailies.
- Task workflow quality-of-life:
  - Per-profile persisted sort modes and filter tabs.
  - Tag filtering, search, hide/unhide, and quick action menu.
  - Clear completed-state badges/styles for dailies, todos, and rewards.
- Reporting and history:
  - Logs page for action history and filtering.
  - Graphs page for aggregated trend views.
- Theme and UX:
  - Light, dark, and follow-system theme modes.
  - Daily quote header.

## How to use taskweb
1. Choose storage mode:
  - Sign in/sign up for cloud mode.
  - Or use guest mode for local-only tracking.
2. Create/select an active profile:
  - Open `Profiles` and create a profile.
  - Select it from the `Active Profile` selector in the header.
3. Set up tags (optional):
  - Open `Tags`, add/edit tags, then assign tags in task edit modal.
4. Create tasks:
  - Open `Tasks`.
  - Use quick-add in each column (Habits/Dailies/Todos/Rewards).
  - Click a task to open edit modal for advanced fields.
5. Run daily workflow:
  - Complete dailies/todos, increment habits, claim rewards.
  - Use per-column sort/filter tabs and search/tags to focus work.
6. Track focused work:
  - Click the ... button on a task card and select "Set as current activity".
  - Start/pause/reset timer; sessions are logged automatically.
7. Review progress:
  - Open `Logs` for history.
  - Open `Graphs` for trends by type/metric/instance.
8. Backup or migrate data:
  - In cloud mode, use `Profiles` actions: `Export`, `Import`, `Import local`.

## Repo layout
- `core/` - Django app domain logic + API
- `taskweb/` - Django project settings/urls
- `frontend/` - React app
- `scripts/` - test/deploy helpers

## Local development
1. Install backend deps:
```bash
pip install -r requirements.txt
```
2. Run backend:
```bash
python manage.py migrate
python manage.py runserver
```
3. Run frontend (guest/local mode):
```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

## Frontend storage modes
- Local/guest mode:
```bash
VITE_STORAGE_MODE=indexeddb npm --prefix frontend run dev
```
- API/cloud mode:
```bash
VITE_STORAGE_MODE=api VITE_API_BASE_URL=http://127.0.0.1:8000 npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

## Tests
```bash
make test-backend
make test-frontend
make test-e2e
make test-all
```

## Docker (WSL test stack)
```bash
make wsl-up
make wsl-logs
make wsl-smoke
make wsl-down
```

## Production deploy
- Example env: `.env.prod.example`
- Main guide: `DEPLOYMENT_PROD.md`
- Deploy script:
```bash
./scripts/deploy_prod.sh
```

## Security notes
- Never commit real `.env` files.
- `.taskapp` archives are ignored by default.
