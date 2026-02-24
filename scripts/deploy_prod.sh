#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/../env/.env.prod}"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
  echo "Set ENV_FILE or create ../env/.env.prod from .env.prod.example"
  exit 1
fi

command -v rsync >/dev/null || { echo "rsync required"; exit 1; }

echo "[deploy] using env: $ENV_FILE"
echo "[deploy] pulling latest code..."
git -C "$ROOT_DIR" pull --ff-only

echo "[deploy] building and restarting backend containers..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo "[deploy] running migrations..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec web python manage.py migrate

echo "[deploy] running django checks..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec web python manage.py check

echo "[deploy] building frontend..."
npm --prefix "$ROOT_DIR/frontend" ci
VITE_STORAGE_MODE=api VITE_API_BASE_URL= npm --prefix "$ROOT_DIR/frontend" run build

echo "[deploy] syncing frontend build to /var/www/taskweb..."
sudo mkdir -p /var/www/taskweb
sudo rsync -a --delete "$ROOT_DIR/frontend/dist/" /var/www/taskweb/
sudo chown -R www-data:www-data /var/www/taskweb
sudo find /var/www/taskweb -type d -exec chmod 755 {} \;
sudo find /var/www/taskweb -type f -exec chmod 644 {} \;

echo "[deploy] reloading nginx..."
sudo nginx -t
sudo systemctl reload nginx

echo "[deploy] deployment complete."
