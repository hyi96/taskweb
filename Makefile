SHELL := /bin/bash

.PHONY: test-backend test-frontend test-e2e test-all

test-backend:
	python manage.py test

test-frontend:
	npm --prefix frontend run test
	npm --prefix frontend run typecheck

test-e2e:
	npm --prefix frontend run test:e2e

test-all:
	bash scripts/test_all.sh
