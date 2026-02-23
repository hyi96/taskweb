#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -f .env.wsl ]]; then
  echo "Missing .env.wsl. Copy .env.wsl.example to .env.wsl first." >&2
  exit 1
fi

echo "==> Starting WSL stack"
docker compose -f docker-compose.wsl.yml --env-file .env.wsl up -d --build

echo "==> Waiting for web container"
for i in {1..60}; do
  if curl -fsS http://127.0.0.1:8000/admin/login/ >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    echo "Web service did not become ready in time." >&2
    exit 1
  fi
done

echo "==> Running backend smoke checks in container"
docker compose -f docker-compose.wsl.yml --env-file .env.wsl exec -T web python manage.py check
docker compose -f docker-compose.wsl.yml --env-file .env.wsl exec -T web python manage.py test core.tests.test_api_scoping core.tests.test_task_actions

echo "==> WSL smoke checks passed"
