#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:5173}"
E2E_ENV_FILE="${E2E_ENV_FILE:-${ROOT_DIR}/.env.e2e}"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" || true
  fi
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" || true
  fi
}
trap cleanup EXIT

load_e2e_env() {
  if [[ -f "${E2E_ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${E2E_ENV_FILE}"
    set +a
  fi
}

wait_for_url() {
  local url="$1"
  local max_tries="${2:-60}"
  local i
  for ((i = 1; i <= max_tries; i += 1)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${url}" >&2
  return 1
}

echo "==> Backend tests"
cd "${ROOT_DIR}"
python manage.py test

echo "==> Frontend unit/integration tests"
npm --prefix frontend run test
npm --prefix frontend run typecheck

load_e2e_env
if [[ -z "${E2E_ADMIN_USERNAME:-}" || -z "${E2E_ADMIN_PASSWORD:-}" ]]; then
  echo "Missing E2E credentials." >&2
  echo "Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD in shell or ${E2E_ENV_FILE}." >&2
  exit 1
fi

echo "==> Starting Django server for E2E"
python manage.py runserver 127.0.0.1:8000 --noreload >/tmp/taskweb-e2e-backend.log 2>&1 &
BACKEND_PID="$!"
wait_for_url "${BACKEND_URL}/admin/login/"

echo "==> Starting Vite server for E2E"
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 >/tmp/taskweb-e2e-frontend.log 2>&1 &
FRONTEND_PID="$!"
wait_for_url "${FRONTEND_URL}/"

echo "==> Playwright E2E tests"
npm --prefix frontend run test:e2e

echo "==> All checks passed"
