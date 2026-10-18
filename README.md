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
| Live timing tower | F1 live timing feed (signalR hub, pushed) → OpenF1 archive → saved classification |
| Session state (is anything on air?) | F1 live timing feed → published schedule (OpenF1 → Jolpica) |
| Team radio | F1 live timing feed captures → OpenF1 recordings → Groq Whisper → call list without transcripts |
| Paddock news | RSS multi-source (Motorsport, Autosport, Crash, BBC, ESPN, RaceFans) → memory cache → saved snapshot |
| Persistence | Upstash / Vercel KV → Vercel Blob → local file → memory |

When a live provider answers, the saved fallback snapshot is refreshed in the
store (throttled), so even a total upstream outage still serves recent real data.

## Layout

```
public/          Static site (HTML, CSS, JS, assets) — the deployed web root
server.js        Vercel function entrypoint and local development server
api/[...path].js Optional serverless route that re-exports the same handler
lib/config.js    Secrets and central configuration
lib/operators.js Operator accounts, roles, invitations and recovery codes
lib/totp.js      RFC 6238 one-time passwords (no dependencies)
lib/providers.js Multi-provider Formula 1 data layer
lib/ai.js        Multi-provider AI race engineering engine
lib/store.js     Multi-backend persistence abstraction
lib/handler.js   Shared request handler (local server + serverless)
lib/news.js      Multi-source news tunnel (background RSS poll + image relay)
lib/openf1.js    Throttled OpenF1 client (3 requests/second ceiling, shared cache)
lib/livesignal.js F1 live timing connector (negotiate + WebSocket, snapshot merge, keepalive)
lib/sessionstate.js The one answer to "is a broadcast session on air?" (feed, then schedule)
lib/livetiming.js Live timing tower aggregation (laps, sectors, stints, pit stops)
lib/radio.js     Team radio call list and Whisper transcription (one call at a time)
data/            Circuit + paddock reference data (and site.json when local)
```

## Run locally

1. Install Node.js 20 or later.
2. Run `npm start` (or `node server.js`) and open `http://localhost:3000`.
   `./run.ps1` starts the server and prompts for an admin password.
3. To enable AI features locally, put your keys in `apikey.txt` (gitignored) or
   export `GROQ_API_KEY`, `GEMINI_API_KEY` and `OPENROUTER_API_KEY`.
4. Open the Admin page on localhost and use first-run setup: it creates the first
   owner account and shows the authenticator key to add to your app. Set
   `APEX_ADMIN_PASSWORD` (12+ characters) instead only if you want a
   break-glass credential that skips the second factor.

## Deploy on Vercel

The repository is Vercel-ready: `public/` is the output directory and requests
are handled by the Node function in `server.js` (which exports the shared
handler).

Set these environment variables on the project:

- `APEX_SESSION_SECRET` — random string used to sign admin sessions (set this;
  operator accounts are the primary way in)
- `APEX_ADMIN_PASSWORD` — optional break-glass password: owner rights without a
  second factor, one-hour sessions, every action logged as “server password”. Use
  it to create the first owner account on a fresh deployment, then leave it set
  only if you want an emergency way in.
- `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` — AI providers
- `BLOB_READ_WRITE_TOKEN` — private Vercel Blob store for persistence
  (or `KV_REST_API_URL` + `KV_REST_API_TOKEN` for Upstash / Vercel KV)

Admin sessions are stateless HMAC tokens, so they survive cold starts and scale
across instances without shared memory. A token carries the account id, its role,
whether a second factor was used and the account's token version; role changes,
password changes, two-factor resets and switch-offs are checked against the store
on every request, so revocation is immediate. Sign-in is rate limited per address
and per account (five failures in fifteen minutes), and a TOTP code is refused if
it has already been used in its 30-second window.

Storing accounts needs somewhere durable: `BLOB_READ_WRITE_TOKEN` or KV
(Upstash / Vercel KV) in production, or `data/site.json` locally. Without a store
or an `APEX_ADMIN_PASSWORD`, a deployment has no way to sign in at all.

## Pages

- `/` — home and next race weekend
- `/live` — session countdown, circuit and visitor clocks, broadcast embed, live
  timing tower and the team radio panel
- `/timing` — race classification and data notes
- `/standings` — driver and constructor championship standings
- `/calendar` — session-by-session season calendar in circuit local time
- `/news-garage` — latest F1 headlines aggregated live from multiple publishers
- `/fan-zone` — five-light reaction game and leaderboard
- `/admin` — password-protected control room (see below)
- `/privacy`, `/terms` — privacy notice and terms of use

## Control room (`/admin`)

One signed-in page drives everything the public site shows. Each operator signs in
personally, so the log can name who did what:

- **Operator accounts instead of one password** — an owner issues a one-time
  invitation link; the operator sets their own password and enrols their own
  authenticator. Nobody is ever handed a credential, links expire in 30 minutes
  and work once, and an account with no confirmed authenticator cannot sign in at
  all. Every action in the log is attributed to the operator who took it.
- **Roles** — `owner` (everything, including accounts, exports and clearing the
  log), `operator` (broadcast, banner, chat rules, news, radio, diagnostics) and
  `moderator` (live chat moderation only). The server enforces the role on every
  `POST`, `PUT`, `PATCH` and `DELETE`; the panel only hides what it must not show.
- **Second factor** — TOTP from any authenticator app (see `lib/totp.js`), plus
  ten single-use recovery codes issued at enrolment. Changing a role, switching an
  account off, resetting a password or withdrawing the authenticator invalidates
  every session that account had open, because sessions carry the account's token
  version rather than living in a server-side table.
- **Lost phone** — the owner resets the authenticator, which hands back a fresh
  invitation; the operator re-enrols without anyone learning their password.

The roles card in the panel lists the exact permissions behind each role.

- **Broadcast** — session label, embed code (a provider's whole `<iframe …>`
  snippet or a bare `https://` URL; only the address is kept) and status. Going
  live requires an embed. A live preview frame sits under the form, and
  *Fill from next session* names the label from the schedule.
- **Announcement banner** — plain text shown as a strip above the header on every
  public page, in an info or alert tone. Visitors dismiss it for their session.
- **Chat rules** — slow mode (off / 5 / 15 / 30 seconds) is enforced server-side
  and mirrored in the composer, which counts down before you can post again.
- **Moderation** — the live chat log with per-line delete and clear-all.
- **News tunnel** — per-source health, story count and a manual *Poll feeds now*.
- **System** — storage driver, runtime, provider health, store counts, live
  diagnostics refresh and a JSON export of the store (never the admin credential).
- **Operator log** — every action taken here (broadcast changes, moderation,
  manual polls, exports, sign-ins), newest first, clearable.
- **Team radio** — switch AI transcription on or off, pick the Whisper model,
  transcribe the next queued call by hand, and read what is on file per call.
- **Subscribers** — consented newsletter addresses with CSV export.
- **Operators** — invite people, change roles, switch accounts off, reset a lost
  authenticator, revoke a pending invitation, and see who signed in last.
- **My account** — role and permissions, change password, replace the
  authenticator, reissue recovery codes, sign out everywhere else.

Settings are saved field by field onto one config object, so saving the banner
cannot wipe the broadcast. `GET /api/admin/diagnostics`, `/api/admin/audit`,
`/api/admin/export` and `POST /api/admin/news/refresh` back the new cards and all
require an operator session.

## Live timing and team radio

Below the broadcast, `/live` shows a timing tower rebuilt from OpenF1's timing
loop for the latest session: position, gap to leader, interval, last lap, the
three sector times (purple for a session best, green for a personal best), speed
trap, the tyre fitted with its compound, age and stint, every pit stop with its
box time, and lap count. When OpenF1 cannot be reached the endpoint answers with
the saved classification, clearly labelled as such, instead of an error.

Nothing on the page is behind a refresh button. The tower keeps itself current:
every second the page asks `GET /api/live/timing?probe=1`, which returns only the
reading's fingerprint and how fresh it is (around 250 bytes), and the full tower
is fetched only when that fingerprint has moved — so the panel is never more than
a second behind a reading without re-sending 16 KB every second. The server holds
the assembled tower for 45 seconds (`APEX_TIMING_TTL_MS`) and for 5 seconds while
a session is actually on track (`APEX_TIMING_LIVE_TTL_MS`), which keeps OpenF1
well inside its rate limits while a live race still moves.

The panel is explicit about the state of play. During a broadcast session the
tower is the real running order pushed straight from F1's own live timing hub:
`lib/livesignal.js` negotiates with `livetiming.formula1.com/signalrcore`, keeps
one WebSocket open, merges the deltas (position, laps, sectors, stints, pit
stops, team radio captures) onto the session snapshot, and drops the connection
the moment the feed says the session has finished. The tower re-renders from that
in-memory state once a second. Between sessions the hub is not contacted at all:
the tower below a countdown is the last completed session, read from OpenF1 and
labelled `LAST SESSION · FINAL`, with the feed's own final classification kept on
the panel until the archive is published.

### When the site is live

One answer decides every live surface on the site — the timing tower, the team
radio panel, the countdown gate and the paddock chat — and it lives in
`lib/sessionstate.js`:

1. **The feed, when it is attached to the session in question.** F1's live
timing publishes `Started` / `Finished` for itself, and that outranks any
timetable: a race that runs long stays live, and a session that ends early stops
the site the moment the flag drops. A feed still holding the previous round
cannot keep the site live, and it cannot cancel a session the schedule says is
on.
2. **The published schedule otherwise.** A session is on air only when it is a
free practice, a sprint qualifying, a qualifying, a sprint or the race, and only
inside its window — opened five minutes before the start and held twenty minutes
past the scheduled end, because sessions routinely start late and run over.

Everything else is off air, and nothing polls: testing, shakedowns and `Day 2`
sessions never count, so an idle week costs no requests and no connections. Set
`APEX_LIVE_KINDS` (for example `race,sprint`) to narrow which sessions go live,
`APEX_LIVE_LEAD_MS` / `APEX_LIVE_GRACE_MS` to widen the window,
`APEX_STATE_LIVE_TTL_MS` / `APEX_STATE_TTL_MS` to change how often the answer is
recomputed on air and off it (default 5 s / 5 min), and `APEX_SIGNAL_URL` /
`APEX_SIGNAL_STATIC` if F1 ever moves the hub.

The page follows the same answer: the countdown ticks in the circuit's own time
while the session is off air (the tower below is the last completed session),
the gate and countdown are replaced by the live tower the second the session goes
on air, and the panel comes back when the flag drops — no reload, nothing to
press. The broadcast window follows it too: an operator-approved embed is the
picture, not the proof, so the stream is mounted only while the session is live,
and the paddock chat is locked the rest of the week.

### Verify the live path

`.verify/` holds a harness that drives that gate end to end against a mock of
both upstreams: one server answers as OpenF1 (schedule plus archive), the other
as F1's live timing hub (negotiate + WebSocket, replaying a real captured
session) and counts connections, so “nothing connects while nothing is on air”
is asserted rather than assumed. It walks no session → testing → race → flag →
qualifying → sprint qualifying in one run.

```bash
node .verify/mock-live-stack.cjs &        # :4010 OpenF1 stand-in, :4011 live hub
OPENF1_API_URL=http://127.0.0.1:4010/v1 \
APEX_SIGNAL_URL=http://127.0.0.1:4011 \
APEX_SIGNAL_STATIC=http://127.0.0.1:4011/static/ \
APEX_SCHEDULE_TTL_MS=2000 APEX_STATE_TTL_MS=2000 APEX_STATE_LIVE_TTL_MS=1000 \
PORT=3100 node server.js &
node .verify/live-checks.cjs               # 41 checks, 0 expected failures
```

Start a fresh site process for every run: one check is that the feed's
“finished” verdict is remembered, which only holds within a process.

Beside it, the team radio panel lists the session's driver-to-pit-wall
recordings, newest first, each with a play button that streams the clip in place
(one call at a time — pressing another takes over, and a clip that cannot be
played says so instead of pretending) and a link to the source. While the
session is on air the calls come from the live feed as they are published (the
clip addresses are built from the session path the hub announces); afterwards
the panel falls back to OpenF1's archive for the same session. Transcription
runs through Groq Whisper (`whisper-large-v3-turbo` by default): the page asks
`POST /api/live/radio/transcribe` for the next untranscribed call, the server
answers one clip at a time with a 6 second floor between calls, and every
transcript is stored by recording URL so a clip is never transcribed twice.
Clips that hold no speech are recorded as silent rather than as punctuation.

Two things to know before switching it on. The recordings are Formula 1's
copyright and F1's terms restrict copying them, so publishing transcripts may
need a licence — the panel repeats that notice and Race Control can turn the
feature off, in which case the panel lists recordings without text. And OpenF1
publishes radio for only some sessions, so an empty panel is normal.

Set `RADIO_TRANSCRIBE_GAP_MS` to change the pacing floor (default 6000 ms).
`APEX_DATA_DIR` points an instance at a different store, which is useful for
running a throwaway copy without touching live data.

## Diagnostics

`GET /api/backends` (also `GET /api/health/backends`) probes every data and AI
provider and reports the active storage driver. `GET /api/health` reports basic
service health and whether admin access is configured. `GET /api/news` serves
the aggregated news stream (append `?refresh=1` to force a poll, throttled to
one per 30 seconds) and `GET /api/news/image?src=…` relays article images so
the content security policy can stay locked to same-origin media.

## Accuracy notes

OpenF1 is an unofficial provider; historical data from 2023 onward is free, while
its real-time endpoints need a paid subscription. The live tower does not depend
on that plan: it is pushed from F1's own live timing hub, and OpenF1 is used for
the archive between sessions (`OPENF1_API_KEY` is optional and only widens the
archive reads). If the feed cannot be reached while a session is on air, the
panel says so in as many words instead of showing that session's stale data as
current. Nothing of the site's own second-by-second updating depends on either:
the countdown, the freshness stamps and the tower's polling all run regardless. Team radio transcripts are machine generated and can mis-hear names, tyre
calls and radio traffic; treat them as a reading aid, not a record.
Jolpica (the Ergast successor) is used as an independent fallback. Newsletter
signup stores consented addresses but does not deliver campaigns. Reaction scores
are not anti-cheat verified. This independent fan site is not affiliated with
Formula 1 or the FIA.
