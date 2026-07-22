# yoyo-api

Hono API server for **YOYO** — serves provider data from Supabase.

Provider endpoints require a Supabase Auth access token
(`Authorization: Bearer <token>`). Health remains public.

## Setup

```bash
cp .env.example .env
# Fill in SUPABASE_URL and SUPABASE_ANON_KEY

npm install
```

## Development

```bash
npm run dev
```

Server starts on `http://localhost:3001` by default.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (public) |
| GET | `/api/providers` | List providers (auth required) |
| GET | `/api/providers/:id` | Provider detail with photos (auth required) |

### Query parameters (`GET /api/providers`)

| Param | Description |
|-------|-------------|
| `city` | City name (e.g. `București`) |
| `category` | `venue`, `entertainment`, `balloons`, `cakes` |
| `minRating` | Minimum rating (0–5) |
| `sort` | `rating` (default), `name`, `review_count` |
| `order` | `desc` (default), `asc` |
| `page` | Page number (default 1) |
| `limit` | Items per page (default 20, max 50) |

### Examples

```bash
curl http://localhost:3001/health
curl -H "Authorization: Bearer <access_token>" \
  "http://localhost:3001/api/providers?city=București&category=venue"
curl -H "Authorization: Bearer <access_token>" \
  http://localhost:3001/api/providers/<uuid>
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes* | Supabase publishable key (public reads via RLS) |
| `SUPABASE_ANON_KEY` | Yes* | Legacy alias for publishable key |
| `PORT` | No | Server port (default 3001) |
| `CORS_ORIGIN` | No | Allowed CORS origin (default `http://localhost:5173`) |

\* One of `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` is required.

## Prerequisites

1. Apply Supabase migrations in `yoyo-scraper/supabase/migrations/` (including `002_rls_and_profiles.sql`)
2. Populate data via scraper: `cd yoyo-scraper && npm run scrape -- --city București --sync`

## Scripts

```bash
npm run dev      # Start with hot reload
npm run build    # Compile TypeScript
npm run start    # Run compiled output
npm test         # Run tests
npm run lint     # ESLint
```
