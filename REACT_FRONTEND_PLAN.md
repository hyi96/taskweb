# React Frontend Implementation Plan for `taskweb`

## Summary
This plan maps the existing Avalonia TaskApp frontend patterns to a staged React implementation for the Django backend in this repository.

Primary goals:
- Deliver a usable web UI quickly (board + actions).
- Preserve task invariants and profile ownership rules from backend services.
- Expand API only where needed to reach parity with desktop features.

References reviewed:
- `TaskApp/TaskApp/Views/MainWindow.axaml`
- `TaskApp/TaskApp/ViewModels/MainWindowViewModel.cs`
- `TaskApp/TaskApp/ViewModels/HabitFormViewModel.cs`
- `TaskApp/TaskApp/ViewModels/DailyFormViewModel.cs`
- `TaskApp/TaskApp/ViewModels/TodoFormViewModel.cs`
- `TaskApp/TaskApp/ViewModels/RewardFormViewModel.cs`
- `TaskApp/TaskApp/ViewModels/LogsViewModel.cs`
- `TaskApp/TaskApp/ViewModels/GraphViewModel.cs`
- `core/api/views.py`
- `core/api/serializers.py`
- `core/models.py`

---

## Stage 0: Frontend Foundation (1-2 days)
### Objective
Create a stable React app skeleton with routing, API client, and profile-aware request plumbing.

### Deliverables
- New `frontend/` app scaffold (Vite + React + TypeScript).
- Core dependencies:
  - `react-router-dom`
  - `@tanstack/react-query`
  - `zod`
  - UI stack (pick one and keep consistent): `tailwindcss` + headless components or Mantine.
- Base app layout and routes.
- Shared API client module with:
  - auth/session handling (cookie/session-based if Django session auth is used)
  - standardized error handling
  - profile-aware query helpers (`profile_id` inclusion)

### Suggested structure
- `frontend/src/app` (providers, router, shell)
- `frontend/src/features/tasks`
- `frontend/src/features/profiles`
- `frontend/src/features/tags`
- `frontend/src/features/logs`
- `frontend/src/features/graphs`
- `frontend/src/shared/api`
- `frontend/src/shared/types`
- `frontend/src/shared/ui`

### Exit criteria
- App starts and can fetch task list for selected profile.

---

## Stage 1: Main Board MVP (2-4 days)
### Objective
Ship a usable 4-column task board aligned to the desktop main window.

### Scope
- 4 columns: habits, dailies, todos, rewards.
- Global search (title match).
- Per-column filter tabs:
  - Habits: `all`, `hidden`
  - Dailies: `all`, `due`, `not due`, `hidden`
  - Todos: `active`, `scheduled`, `completed`, `hidden`
  - Rewards: `all`, `one-time`, `repeatable`, `hidden`
- Per-column sort modes matching desktop intent.
- Quick add per column.
- Inline action buttons:
  - habit increment -> `POST /api/tasks/{id}/habit-increment/`
  - daily complete -> `POST /api/tasks/{id}/daily-complete/`
  - todo complete -> `POST /api/tasks/{id}/todo-complete/`
  - reward claim -> `POST /api/tasks/{id}/reward-claim/`

### Data strategy
- Query tasks once per profile and derive client-side grouped views by `task_type`.
- Use React Query mutations with optimistic updates + rollback.
- Refetch task list after action success to maintain server truth.

### Exit criteria
- User can perform daily workflow from browser without admin.

---

## Stage 2: Task Create/Edit Forms (2-3 days)
### Objective
Port the core task form behavior from Avalonia viewmodels.

### Scope
- Modal or side-panel editor for create/update.
- Shared fields:
  - `title`, `notes`, `gold_delta`, `is_hidden`, `last_action_at`(presented as last incremented for habits, last completed for dailies and todos, and last claimed for rewards)
- Habit fields:
  - `count_increment`, `count_reset_cadence`
- Daily fields:
  - `repeat_cadence`, `repeat_every`, `streak_goal`, `autocomplete_time_threshold`
- Todo fields:
  - `due_at`
- Reward fields:
  - `is_repeatable`

### Validation
- Client-side guardrails mirror backend constraints where possible.
- Backend errors rendered clearly (field + non-field).

### Exit criteria
- CRUD works cleanly for all 4 task types.

---

## Stage 3: API Expansion for Parity (2-4 days, backend + frontend)
### Objective
Add missing endpoints required for desktop feature parity.

### Backend additions
- Profiles endpoints:
  - `GET /api/profiles/`
  - `POST /api/profiles/`
- Tags CRUD, profile-scoped.
- Checklist items CRUD (todo-only).
- Streak bonus rule CRUD (daily-only).
- Logs endpoint:
  - `GET /api/logs/?profile_id=...&limit=...`

### Frontend additions
- Profile switcher in header.
- Tags manager.
- Checklist editor in todo form.
- Streak bonus rule editor in daily form.
- Logs page.

### Exit criteria
- Day-to-day operations no longer require admin for core entities.

---

## Stage 4: Current Activity Timer + Duration Logging (2-3 days)
### Objective
Port current activity timer flow and duration logging.

### Scope
- Start / Pause / Reset / Remove current activity.
- Track elapsed time client-side.
- Write activity duration logs to backend with profile ownership enforcement.

### Backend addition
- Endpoint/service for `activity_duration` log creation (or equivalent action route).

### Exit criteria
- Activity sessions are recorded and visible in logs.

---

## Stage 5: Graphs / Analytics (3-5 days)
### Objective
Replicate meaningful analytics from desktop `GraphViewModel`.

### Scope
- Filters:
  - time resolution: hour/day/week/month/year
  - target type: gold/habit/daily/todo/reward/activity
  - target value + target instance selectors
  - search-assisted target selection
- Chart rendering via `recharts` or `chart.js`.

### Data options
- Preferred: backend aggregated metrics endpoint.
- Alternative: client-side aggregation from logs for small datasets.

### Exit criteria
- Users can answer core trend questions (frequency, gold deltas, durations).