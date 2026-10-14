# APEX — Race Culture

APEX is a multi-page Formula 1 fan site with a resilient Node.js backend. Every
page and API is served from one origin, and the site is designed to run either
locally or as a Vercel static site plus serverless function.

The guiding rule: **no single backend**. Each capability resolves through a
provider chain, so the site keeps working when an upstream is down, rate limited
or blocked.

| Capability | Provider chain |
| --- | --- |
| Sessions / schedule | OpenF1 → Jolpica (Ergast) → saved snapshot |
| Championship standings | OpenF1 → Jolpica → saved snapshot |
| Race classification | OpenF1 → Jolpica → saved snapshot |
| Weekend podium | OpenF1 → Jolpica |
| AI race engineering | Groq → Google Gemini → OpenRouter → local model |
| Persistence | Upstash / Vercel KV → Vercel Blob → local file → memory |

## Layout

```
public/          Static site (HTML, CSS, JS, assets) — the deployed web root
api/[...path].js Vercel serverless catch-all
lib/config.js    Secrets and central configuration
lib/providers.js Multi-provider Formula 1 data layer
lib/ai.js        Multi-provider AI race engineering engine
lib/store.js     Multi-backend persistence abstraction
lib/handler.js   Shared request handler (local server + serverless)
dev-server.js    Thin local development server
data/            Circuit + paddock reference data (and site.json when local)
```

## Run locally

1. Install Node.js 20 or later.
2. Run `npm start` (or `node dev-server.js`) and open `http://localhost:3000`.
   `./run.ps1` starts the server and prompts for an admin password.
3. To enable AI features locally, put your keys in `apikey.txt` (gitignored) or
   export `GROQ_API_KEY`, `GEMINI_API_KEY` and `OPENROUTER_API_KEY`.
4. Set `APEX_ADMIN_PASSWORD` (12+ characters) for a fixed admin password, or use
   the first-run setup screen on the Admin page from localhost.

## Deploy on Vercel

The repository is Vercel-ready: `public/` is the output directory and every
`/api/*` request is handled by `api/[...path].js`.

Set these environment variables on the project:

- `APEX_ADMIN_PASSWORD` — 12+ character admin password
- `APEX_SESSION_SECRET` — random string used to sign admin sessions
- `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` — AI providers
- `BLOB_READ_WRITE_TOKEN` — private Vercel Blob store for persistence
  (or `KV_REST_API_URL` + `KV_REST_API_TOKEN` for Upstash / Vercel KV)

Admin sessions are stateless HMAC tokens, so they survive cold starts and scale
across instances without shared memory.

## Pages

- `/` — home and next race weekend
- `/live` — session countdown, circuit and visitor clocks, broadcast embed
- `/timing` — race classification and data notes
- `/standings` — driver and constructor championship standings
- `/calendar` — session-by-session season calendar in circuit local time
- `/garage` — track, strategy and engineering stories
- `/fan-zone` — five-light reaction game and leaderboard
- `/admin` — password-protected broadcast controls and newsletter list
- `/privacy`, `/terms` — privacy notice and terms of use

## Diagnostics

`GET /api/backends` (also `GET /api/health/backends`) probes every data and AI
provider and reports the active storage driver. `GET /api/health` reports basic
service health and whether admin access is configured.

## Accuracy notes

OpenF1 is an unofficial provider; historical data from 2023 onward is free, while
real-time data needs a paid subscription, so this project shows schedule
countdowns and historical classifications rather than claiming live telemetry.
Jolpica (the Ergast successor) is used as an independent fallback. Newsletter
signup stores consented addresses but does not deliver campaigns. Reaction scores
are not anti-cheat verified. This independent fan site is not affiliated with
Formula 1 or the FIA.
