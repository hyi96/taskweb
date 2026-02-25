#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT_DIR}/scripts/test_all.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

pass_file="${TMP_DIR}/pass.env"
missing_file="${TMP_DIR}/missing.env"

cat >"${pass_file}" <<'EOF'
E2E_ADMIN_USERNAME=admin
E2E_ADMIN_PASSWORD='secret'
EOF

cat >"${missing_file}" <<'EOF'
E2E_ADMIN_USERNAME=admin
EOF

echo "==> test_all env check: succeeds when both credentials exist"
TEST_ALL_CHECK_ENV_ONLY=1 E2E_ENV_FILE="${pass_file}" bash "${SCRIPT}"

echo "==> test_all env check: fails when password is missing"
if TEST_ALL_CHECK_ENV_ONLY=1 E2E_ENV_FILE="${missing_file}" bash "${SCRIPT}" >/dev/null 2>&1; then
  echo "Expected failure when E2E_ADMIN_PASSWORD is missing" >&2
  exit 1
fi

echo "==> test_all env checks passed"
