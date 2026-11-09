# Deploying rscalc on a home lab

## What the server is for

rscalc used to be a static site: `web/src/*.tsx` imported `data/*.json`, Vite
compiled the snapshots into the bundle, and a price refresh meant rebuilding and
redeploying. It is now one Node process (`pnpm serve`) that does two things:

1. **Serves** the built SPA *and* the published dataset over HTTP. The browser
   fetches current prices, so a refresh reaches an open tab without a rebuild.
2. **Refreshes** every four hours **on the hour** — 00:00, 04:00, 08:00, 12:00,
   16:00 and 20:00 in the server's timezone: it runs the pipeline (`pnpm refresh`),
   which re-derives every table from the wiki and price APIs, then publishes the
   result as an atomic dataset.

It computes no numbers itself. `src/` + `scripts/` keep the maths, the zod
schemas and the 1 request/second budget, exactly as before; the server schedules
it, validates the output parses, and serves it.

There is no need for nginx or Caddy in front: the process sets the caching
headers itself. Add TLS only if you expose it beyond the LAN.

## Run it

```sh
pnpm install
pnpm build                     # the SPA bundle (no data in it any more)
RSCALC_CONTACT=you@example.com pnpm serve
```

- UI: <http://localhost:8080>
- Status: <http://localhost:8080/api/status> (includes the refresh log tail)
- Health: <http://localhost:8080/healthz>

On a fresh checkout `data/*.json` is already committed, so the first start has
something to serve. `RSCALC_REFRESH_ON_BOOT=auto` (the default) then refreshes
immediately if the published data is older than the interval, because a reboot is
exactly when a snapshot is stale.

For UI work, keep the API in one terminal and Vite in another — `pnpm dev` proxies
`/api` to `http://127.0.0.1:8080` (override with `RSCALC_API`):

```sh
RSCALC_REFRESH=off RSCALC_CONTACT=x pnpm serve   # API + last dataset, no refresh
pnpm dev                                          # hot-reloading UI on :5173
```

## Configuration

### Where the values come from

`pnpm serve` reads the **process environment**, and loads a `.env` file first if
one exists:

| where | used by | notes |
| --- | --- | --- |
| `<repo>/.env` | `pnpm serve` | convenience for a local run; gitignored |
| `RSCALC_ENV_FILE=<path>` | `pnpm serve` | put the file somewhere else (e.g. `~/.config/rscalc/env`) |
| `/etc/rscalc.env` | the systemd unit | `EnvironmentFile=` — the server-level place |
| `-e VAR=…` / `--env-file` | Docker | container config |

The precedence is `real environment > .env > built-in defaults`, so a variable
that systemd or Docker already set is **never** overridden by a stray `.env`.
Values are never logged; only the names taken from the file.

```sh
# local, at the repo root (gitignored already)
cat > .env <<'EOF'
RSCALC_CONTACT=me@example.com
RSCALC_ADDR=127.0.0.1:8080
EOF
pnpm serve
```

### The schedule

The ticks are wall-clock marks, not "one interval after the last run finished",
so they never drift: with the default `RSCALC_REFRESH_INTERVAL=4h` the pipeline
starts at **00:00, 04:00, 08:00, 12:00, 16:00 and 20:00** in the server's own
timezone, and the marks stay put when a run takes 40 minutes (an overrun skips
the mark it missed rather than firing twice). `nextRunAt` on `/api/status` answers
when the next one is.

The timezone is the process's `TZ`. A systemd host uses the host clock; a
container defaults to **UTC**, so set `TZ=Europe/Berlin` (or whatever) in
`docker run -e` if the marks should follow local midnight rather than UTC
midnight. An interval that does not divide a day (say `5h`) keeps midnight as its
zero point and may land at 01:00 the next day.

### Refreshing on boot

The unit starts at boot (`WantedBy=multi-user.target`), and the server decides on
start what to do with `RSCALC_REFRESH_ON_BOOT`:

| value | on every start | when to use |
| --- | --- | --- |
| `auto` *(default)* | refreshes if nothing is published yet, or if the served dataset is older than `RSCALC_REFRESH_INTERVAL` | normal servers: a restart inside the window keeps the data it already has |
| `always` | always refreshes | a box that is rebooted rarely, or while you are editing what the pipeline reads |
| `never` | never refreshes on start (the interval schedule still runs) | when another host owns the refresh |

"Older" is measured from the **published dataset's** `publishedAt` — when this
server last published — not from the source timestamps, so it answers "has this
server produced fresh numbers recently?".

```sh
# /etc/rscalc.env (or .env for a local run)
RSCALC_REFRESH_ON_BOOT=always
```

Verified behaviour, in the log:

```text
# auto, dataset published 1s ago          → nothing to do
INFO serving published dataset dataset=20261107T141005Z …

# auto, dataset aged past the interval    → refresh, old data still served meanwhile
INFO published data is missing or older than the refresh interval; refreshing now
INFO refresh started: pnpm refresh phase=refresh
INFO serving published dataset dataset=20261107T141005Z …
INFO published dataset 20261107T141023Z …

# never, cold runtime                     → serves nothing, waits for the interval
INFO no dataset published yet; /api/data answers 503 until the first refresh finishes
```

The boot refresh runs in the background: HTTP is up immediately, and until the
first publish finishes `/api/data` answers 503 (the UI says so, with a link to
`/api/status`). On a cold `.cache/` a full `pnpm refresh` takes minutes because of
the 1 request/second limit.

Two things to weigh before choosing `always`: with `Restart=on-failure`, a
pipeline that keeps failing would re-run on every restart, and each start pays a
full cold-ish pipeline. `auto` exists so an ordinary restart is cheap.

`RSCALC_REFRESH_ON_BOOT=never` is not the same as `RSCALC_REFRESH=off`: the
former skips only the start-up refresh, the latter disables the pipeline entirely
and serves the last published dataset forever.

### Variables

| variable | default | meaning |
| --- | --- | --- |
| `RSCALC_CONTACT` | — | **required while refreshing**; becomes the wiki User-Agent contact |
| `RSCALC_ADDR` | `:8080` | `:8080`, `8080` or `127.0.0.1:8080` |
| `RSCALC_REPO_DIR` | cwd | root holding `package.json`, `data/`, `web/` |
| `RSCALC_DATA_DIR` | `<repo>/data` | where the pipeline writes artifacts |
| `RSCALC_WEB_DIR` | `<repo>/web/dist` | the built SPA |
| `RSCALC_RUNTIME_DIR` | `<repo>/runtime` | published datasets |
| `RSCALC_REFRESH_INTERVAL` | `4h` | `4h`, `30m`, `90s`, `1d`, or bare seconds; ticks land on the wall-clock marks of that interval (4h → 00:00, 04:00, …) |
| `RSCALC_REFRESH_TIMEOUT` | `1h` | kills a hung pipeline (SIGKILL) |
| `RSCALC_REFRESH` | `on` | `off` serves the last dataset and never runs the pipeline |
| `RSCALC_REFRESH_ON_BOOT` | `auto` | `auto` (stale only), `always`, `never` |
| `RSCALC_REFRESH_CMD` | `pnpm refresh` | split on whitespace; **no shell**, so no pipes or `&&` |
| `RSCALC_BUILD_CMD` | — | optional frontend rebuild after a publish (`pnpm build`); logs stream like the refresh |
| `RSCALC_KEEP_SNAPSHOTS` | `3` | datasets kept on disk (min 2, for rollback) |
| `RSCALC_REFRESH_TOKEN` | — | enables `POST /api/refresh` with `X-Rscalc-Token` |
| `RSCALC_ENV_FILE` | `<repo>/.env` | where the `.env` lives |
| `RSCALC_DEBUG` | — | per-request log lines |

Misconfiguration fails at startup with one sentence rather than at 03:00 on the
first refresh: a contact is required when refreshing, the interval cannot be under
a minute, and at least two snapshots must be kept.

## systemd

```sh
sudo useradd --system --create-home --shell /usr/sbin/nologin rscalc
sudo -u rscalc git clone <your-remote> /srv/rscalc
sudo -u rscalc sh -c 'cd /srv/rscalc && pnpm install --frozen-lockfile && pnpm build'

sudo install -m 600 /dev/null /etc/rscalc.env
printf 'RSCALC_CONTACT=you@example.com\n' | sudo tee /etc/rscalc.env

sudo cp /srv/rscalc/deploy/rscalc.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rscalc.service
journalctl -u rscalc.service -f
```

`Restart=on-failure` with a 15 s delay covers a crash; a *failed refresh* is not a
crash, so it is recorded in `/api/status` and the previous dataset keeps serving.

Running the server with npm instead of pnpm? Every script supports both, so the
only change is the unit's command:

```ini
ExecStart=/usr/bin/env npm start
```

The refresh chain inside it is manager-agnostic (it composes through `npm run`).
Dependency installs are the exception: `pnpm install --frozen-lockfile` is what
pins versions, and `pnpm-lock.yaml` is the lockfile of record — `npm install` has
nothing to freeze against, so prefer pnpm for that one step even if npm runs the
service.

## Docker

```sh
docker build -f deploy/Dockerfile -t rscalc .
docker run -d --name rscalc \
  -p 8080:8080 \
  -e RSCALC_CONTACT=you@example.com \
  -v rscalc-runtime:/app/runtime \
  rscalc
```

Mount `/app/runtime` or every restart re-publishes from scratch. The image
contains the TypeScript tooling on purpose: the process runs the pipeline, so tsx
and the scripts must be there too.

## Logs

Everything the refresh job does is written to the server's own log — the same
stream `journalctl`/`docker logs` reads — not just to the in-memory tail behind
`/api/status`:

```text
2026-11-07T14:06:04.884Z INFO  refresh started: pnpm refresh phase=refresh
2026-11-07T14:06:04.899Z INFO  reading shop catalogue... phase=refresh stream=stdout
2026-11-07T14:06:05.120Z INFO   593 distinct items to price phase=refresh stream=stdout
2026-11-07T14:06:05.241Z INFO  published dataset 20261107T140604Z (prices as of …) in 47s dataset=… pricesAsOf=…
```

- `phase=refresh` / `phase=build` says which command produced the line.
- `stream=stdout` is `INFO`, `stream=stderr` is `WARN`, so a pipeline warning keeps
  its weight.
- Lines with spaces are JSON-quoted as one field, so every event stays one line.
- `/api/status` keeps the last 400 lines for the browser; the server log is the
  complete record (`pnpm refresh` prints a few hundred lines per run).

```sh
journalctl -u rscalc -f            # follow a refresh
journalctl -u rscalc -g phase=refresh -n 50
docker logs -f rscalc
```

A frontend rebuild is **not** required for new prices: the served bundle carries
only code. Set `RSCALC_BUILD_CMD="pnpm build"` if the box also builds the UI (for
instance after pulling your own changes) and those logs will stream the same way.
A failed rebuild is reported as an error but does not unpublish the dataset that
was just published — the old bundle keeps serving.

## What the server exposes

| endpoint | caching | notes |
| --- | --- | --- |
| `GET /healthz` | `no-store` | ok + dataset id + `pricesAsOf` |
| `GET /api/status` | `no-store` | refresh state, next run, log tail, config |
| `GET /api/data/manifest` | `no-store`, ETag | dataset id + one pinned URL per artifact |
| `GET /api/data/<dataset>/<name>.json` | `immutable` | precompressed, ETag |
| `POST /api/refresh` | — | 202 started, 409 already running, 403 no/bad token |
| everything else | `index.html` (`no-cache`), `assets/*` (`immutable`) | hash routing, so no per-route logic |

Caching is the part worth understanding:

- **The manifest is the only thing that changes** when a new dataset lands, so it
  is `no-store`; the shell polls it every five minutes (and on window focus) to
  offer a reload, and never swaps the numbers under a table being read.
- **Artifact URLs contain the dataset id**, so their bytes can never change:
  `immutable`, cached for a year. Two page loads of the same dataset cost one
  manifest request.
- **`index.html` must revalidate** (`no-cache`) because it is the only thing
  naming the content-hashed assets; `assets/*` are immutable.
- A missing hashed asset is a 404, never `index.html`.

## Datasets on disk

```text
runtime/datasets/
  current                    # the served dataset id (atomic rename)
  20260102T000000Z/
    opportunities.json       # copies of data/*.json at publish time
    opportunities.json.gz    # precompressed at publish, so no request pays for it
    …                        # process, shop-sinks, skilling, shop-access
    meta.json                # timestamps read from the artifacts
```

A refresh copies all five artifacts, validates each parses as JSON, writes the
compressed copies, renames the directory into place, and only then rewrites
`current`. A pipeline that dies halfway — or a truncated 8 MB `skilling.json` —
never becomes the served set.

Older datasets stay for two reasons: a tab that loaded the previous manifest holds
pinned URLs, and a bad refresh can be rolled back.

```sh
cd /srv/rscalc/runtime/datasets
ls                                    # retained datasets, newest first
printf '%s\n' 20260101T000000Z > .current.tmp && mv -f .current.tmp current
sudo systemctl restart rscalc          # the pointer is read at startup
```

Space: about one `data/` tree per retained dataset (~20 MB) plus the HTTP cache in
`.cache/` (~40 MB). **Keep `.cache/`**: the mapping (24h), storeline (24h) and the
recipe bucket (7d) live there, so a routine run mostly re-reads the two price
endpoints. Delete it and every run pays for the full wiki read at 1 req/s.

## Notes

- The checkout shows `data/*.json` as modified after a refresh — that is the
  pipeline's output in place, and the input to the next publish. Use a dedicated
  clone for the server, and do not auto-commit it: 20 MB every four hours is not a
  useful history.
- One refresh at a time, enforced in-process. Do not add a second server pointed
  at the same `data/` or `runtime/`.
- The page's own `StaleWarning` (`web/src/ui.tsx`, 24 h) is the user-facing
  backstop if the scheduler ever dies: the numbers say how old they are.
