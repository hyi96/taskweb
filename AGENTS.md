# AGENTS.md

## Project Overview
- Stack: Django + Django REST Framework (DRF).
- Database: PostgreSQL in production.
- Local development: SQLite or local Postgres is acceptable for speed and convenience.

## Core Data Model Rule
- `Profile` is the tenant boundary.
- All tenant-scoped domain objects must link to `Profile` (directly when possible).
- Cross-object references must stay within the same `Profile`.
- Avoid introducing models that bypass tenant ownership semantics.

## Migration and Schema Safety
- Prefer migrations-safe changes:
- Additive schema changes first (new nullable fields, backfill, then tighten constraints).
- Avoid destructive changes in a single step.
- Keep constraint logic DB-portable when possible.
- Do not use cross-table `CheckConstraint` expressions that rely on joins.
- If a strict invariant cannot be enforced at DB level, enforce it in model/service validation with clear errors.

## Commands
- Install deps:
```bash
pip install -r requirements.txt
```
- Run dev server:
```bash
python manage.py runserver
```
- Create migrations:
```bash
python manage.py makemigrations
```
- Apply migrations:
```bash
python manage.py migrate
```
- Django system checks:
```bash
python manage.py check
```

### Tests
- Preferred:
```bash
python manage.py test
```
- If `pytest` is used/configured:
```bash
pytest -q
```

### Lint/Format (simple defaults if not already configured)
- Python lint:
```bash
ruff check .
```
- Python format:
```bash
ruff format .
```
- If Ruff is not available, fallback:
```bash
flake8 .
black .
```

## Code Style Expectations
- Keep changes small and focused.
- Preserve existing behavior unless explicitly changing requirements.
- Prefer explicit, readable code over clever shortcuts.
- Write docstrings for tricky invariants (especially tenant/profile rules, task-type rules, and validation assumptions).
- Add brief comments only where intent is non-obvious.

## API and Model Guidance
- DRF serializers/views should respect `Profile` scoping for all queries and writes.
- Never trust client-provided tenant ownership without verification.
- Use UUID primary keys for domain models by default.
- Add indexes and constraints only when needed to prevent invalid states or obvious performance issues.
