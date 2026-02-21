# Testing Plan for `taskweb`

## Goals
- Catch regressions in core task actions and profile scoping.
- Verify frontend behavior for daily usage flows.
- Add confidence for release via automated checks (unit, integration, E2E).

## Scope
- Backend: Django + DRF services/endpoints in `core/`.
- Frontend: React app in `frontend/`.
- Cross-layer flows: auth/session + profile-scoped API usage.

## Test Stages

## Stage 1: Baseline Tooling
- Backend runner: `python manage.py test` (or `pytest` if already configured).
- Frontend runner: `vitest` + `@testing-library/react` (add if missing).
- E2E runner: `playwright` (add if missing).
- CI baseline checks:
  - `python manage.py check`
  - `python manage.py test`
  - `npm --prefix frontend run typecheck`
  - frontend unit/integration tests

## Stage 2: Backend Service Tests (Highest Risk)
- Target module: `core/services/task_actions.py`.
- Cover each action:
  - `habit_increment`
  - `daily_complete`
  - `todo_complete`
  - `reward_claim`
  - `log_activity_duration`
- Assertions for each:
  - ownership enforcement (`task.profile`, `profile.account`)
  - task-type guardrails
  - atomic updates:
    - task fields updated correctly
    - profile `gold_balance` updated correctly
    - `LogEntry` inserted with expected values
  - idempotency/validation:
    - daily double-complete same period rejected
    - todo double-complete rejected
    - reward insufficient funds rejected
    - non-repeatable reward double-claim rejected
  - consistency check:
    - `profile.gold_balance == latest_log.user_gold`

## Stage 3: Backend API Tests (DRF)
- Endpoints:
  - `/api/tasks/` + action routes
  - `/api/profiles/`
  - `/api/tags/`
  - `/api/checklist-items/`
  - `/api/streak-bonus-rules/`
  - `/api/logs/`
  - `/api/activity-duration/`
- Assertions:
  - unauthenticated blocked
  - wrong profile/task ownership returns 404/validation as expected
  - `profile_id` required where intended
  - schema and field-level validation errors are clear/stable
  - activity-duration logging works with duration/title and optional task/reward refs

## Stage 4: Frontend Unit + Integration Tests
- Unit tests:
  - task filtering/sorting selectors
  - daily period-end date calculation with `repeat_every`
  - logs formatting helpers (`activity_duration`, `habit_incremented`, gold sign formatting)
  - graph bucketing and aggregation functions
- Integration tests (React Testing Library + mocked API):
  - task board load by profile
  - action button pending state is row-scoped (no global disable/flicker regression)
  - quick action menu:
    - opens, closes on outside click
    - closes on action click
  - current activity:
    - start/pause/reset/remove behavior
    - profile switch logs running session
  - logs page filters:
    - default 50 / past 7 days
    - limit and date range refetch behavior

## Stage 5: End-to-End (Playwright)
- Critical user journeys:
  - create/select profile
  - add habit/daily/todo/reward and perform actions
  - reward insufficient-funds toast path
  - current activity start/pause and log visibility
  - refresh/close while running activity logs duration
  - quick action menu set current activity + hide/unhide
  - logs filter controls and results
  - graph page filter/value/instance/search changes produce chart updates
- Add deterministic fixtures or seed setup for stable runs.

## Stage 6: Non-Functional Checks
- Performance:
  - verify task action interactions remain smooth at higher task counts
  - ensure no broad re-render regressions on single-row updates
- Accessibility:
  - keyboard reachability for menus/forms
  - focus handling in modals and popovers
  - sufficient contrast for statuses/chips/buttons

## Data Setup Strategy
- Backend factories/fixtures:
  - 2 users, multiple profiles, mixed task types
  - tags/checklist/streak rules
  - representative logs including activity durations
- Use isolated profile datasets to assert tenant boundaries.

## Suggested File Layout
- Backend tests:
  - `core/tests/test_task_actions.py`
  - `core/tests/test_api_tasks.py`
  - `core/tests/test_api_profiles_tags.py`
  - `core/tests/test_api_logs_activity.py`
- Frontend tests:
  - `frontend/src/features/tasks/__tests__/TaskBoardPage.test.tsx`
  - `frontend/src/features/logs/__tests__/LogsPage.test.tsx`
  - `frontend/src/features/graphs/__tests__/GraphsPage.test.tsx`
  - `frontend/src/features/activity/__tests__/CurrentActivity.test.tsx`
- E2E:
  - `frontend/e2e/taskboard.spec.ts`
  - `frontend/e2e/logs.spec.ts`
  - `frontend/e2e/activity.spec.ts`
  - `frontend/e2e/graphs.spec.ts`

## Definition of Done
- Automated tests cover all high-risk action flows and profile-scoping rules.
- CI runs backend + frontend + E2E smoke checks.
- No known flaky tests in core user journeys.
