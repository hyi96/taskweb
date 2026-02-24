# taskweb

Task + habit tracker with a Django/DRF backend and a React frontend.

## Live demo
- App: https://taskweb.hyi96.dev
- API health: https://taskweb-api.hyi96.dev/healthz/
- You can sign up for a cloud account or use guest mode (local IndexedDB storage).

## Stack
- Backend: Django, DRF, PostgreSQL
- Frontend: React, TypeScript, Vite
- E2E: Playwright

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
