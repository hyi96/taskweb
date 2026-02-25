SHELL := /bin/bash
E2E_ENV_FILE ?= .env.e2e

.PHONY: test-backend test-frontend test-e2e test-all wsl-up wsl-down wsl-logs wsl-smoke

test-backend:
	python manage.py test

test-frontend:
	npm --prefix frontend run test
	npm --prefix frontend run typecheck

test-e2e:
	npm --prefix frontend run test:e2e

test-all:
	E2E_ENV_FILE="$(CURDIR)/$(E2E_ENV_FILE)" bash scripts/test_all.sh

wsl-up:
	docker compose -f docker-compose.wsl.yml --env-file .env.wsl up -d --build

wsl-down:
	docker compose -f docker-compose.wsl.yml --env-file .env.wsl down

wsl-logs:
	docker compose -f docker-compose.wsl.yml --env-file .env.wsl logs -f --tail=200

wsl-smoke:
	bash scripts/wsl_smoke.sh
