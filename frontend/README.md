# taskweb frontend

Stage 0 React frontend scaffold for `taskweb`.

## Setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Default dev URL: `http://127.0.0.1:5173`

In dev, API requests default to same-origin `/api/...` and are proxied by Vite to `http://127.0.0.1:8000`.
You can override with:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Current scope

- React + TypeScript + Vite app shell
- React Router wiring
- React Query provider
- Profile-scoped API client
- Initial tasks board page (`/tasks`) calling `/api/tasks/?profile_id=...`
