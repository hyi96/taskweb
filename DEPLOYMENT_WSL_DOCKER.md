# WSL Docker Stage 2 Runbook

## Purpose
- Run the Django backend + Postgres in Docker Compose inside WSL.
- Provide a staging-like local test ground before VPS deploys.

## Prerequisites
- Docker Desktop running with WSL integration enabled, or Docker Engine inside WSL.
- `.env.wsl` file present (copy from `.env.wsl.example`).

## One-time setup
```bash
cp .env.wsl.example .env.wsl
```

## Start stack
```bash
make wsl-up
```

Services:
- API/Admin: `http://127.0.0.1:8000`
- Postgres: `127.0.0.1:5432`

## Watch logs
```bash
make wsl-logs
```

## Run smoke checks
```bash
make wsl-smoke
```

This runs:
- `python manage.py check`
- selected backend tests in the web container

## Stop stack
```bash
make wsl-down
```

## Notes
- `web` container command runs migrations and Django checks before gunicorn startup.
- DB host should be `db` when running in compose.
- Keep `.env.wsl` out of git (contains secrets).
