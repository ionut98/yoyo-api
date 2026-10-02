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
| `SUPABASE_SERVICE_ROLE_KEY` | For admin claim approve/cleanup | Service role key (server-only) |
| `GOOGLE_CALENDAR_CLIENT_ID` | Optional | Google OAuth client id (FreeBusy) |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Optional | Google OAuth client secret |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Optional | Must match Google Cloud + SPA callback route |
| `TOKEN_ENCRYPTION_KEY` | With Google | Min 16 chars; encrypts refresh tokens + signs OAuth state |
| `PORT` | No | Server port (default 3001) |
| `CORS_ORIGIN` | No | Allowed CORS origin(s), comma-separated |

\* One of `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` is required.

## SQL migrations

Apply from `scripts/sql/` on Supabase (already applied on yoyo-parties when using agent MCP):

- `add_whatsapp_opt_in.sql`
- `claim_and_google_calendar.sql` — admin-gated claims + Google Calendar connections

## Prerequisites

1. Apply Supabase SQL in `scripts/sql/` (and any historical scraper migrations)
2. Populate data via scraper: `cd yoyo-scraper && npm run scrape -- --city București --sync`
3. Promote at least one admin: `insert into account_roles ... role = 'admin'`

## Scripts

```bash
npm run dev      # Start with hot reload
npm run build    # Compile TypeScript
npm run start    # Run compiled output
npm test         # Run tests
npm run lint     # ESLint
```
