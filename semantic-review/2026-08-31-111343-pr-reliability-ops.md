# Reliability/ops hardening: durable Firebase outbox, API rate-limit, readiness/metrics, full backups

This PR replaces the in-RAM Firebase retry dict in `services/sync.py` with a durable SQLite `firebase_outbox` table so queued writes survive a Render restart, adds a per-IP rate-limit middleware plus `/ready` and `/metrics` endpoints to `api/server.py`, enriches the catalog snapshot (`sizes`, `car_names`, `warranty`, story `link`/`title`, `_generated_at`), moves the snapshot cron to every 2 hours, and introduces a periodic full-DB backup (`services/backup.py`) wired into `bot.py`. A new `ci.yml` runs compile/JS/JSON as blocking jobs and ruff as advisory. The outbox rewrite preserves the observable contract of `_write`/`flush_pending`/`pending_count`/`dropped_count` and never propagates DB/Firebase errors to callers.

Watch for: (1) the rate limiter trusts the *first* `X-Forwarded-For` hop, which is client-controlled behind Render/Fly — likely bypass and unbounded `_rate_hits` growth; (2) `backups/{YYYYMMDD}` daily nodes are never pruned — unbounded Firebase growth, and the full DB is held in memory and serialized twice per run; (3) the persisted "dropped" counter can regress after a restart.

**Verdict**: NEEDS_CHANGES

## High-level view

The outbox rewrite is contract-preserving. Callers in `handlers/admin.py` still read `pending_count()`/`dropped_count()` synchronously; those now return a RAM mirror that `flush_pending()` refreshes from SQLite before the admin `/firebase` command reads it, so the numbers stay accurate at the point of use. Every DB/Firebase interaction in `_write`, `flush_pending`, and the count helpers is wrapped so a missing table or a down database degrades to "queued/last-known value" rather than crashing the caller — the stated goal is met.

The rate-limit middleware is ordered correctly relative to CORS (outermost, with OPTIONS and `/health`/`/ready`/`/metrics` exempted, and CORS headers re-applied on the 429 path). The one real weakness is client identity: it keys on the first `X-Forwarded-For` value, which an attacker controls, defeating both the limit and the memory bound of the hit map.

The snapshot changes are additive and JSON-serializable; consumers in `docs/js` read the new fields defensively, so shape compatibility holds. The backup worker is correctly fail-safe for the bot process, but its retention and memory profile are unbounded by design.

CI blocking jobs (compile, `node --check`, JSON parse) pass on this branch as verified locally; only advisory lint can go red, and it is `continue-on-error`.

<details>
<summary>Issues (5)</summary>

1. **X-Forwarded-For spoofing (rate-limit bypass + memory)** — `_client_ip` takes `XFF.split(",")[0]` (`api/server.py:140-147`); behind Render/Fly the proxy appends the real client, so the first hop is attacker-supplied. Rotating it per request evades the limit and inflates `_rate_hits` without bound between prunes. Prefer `request.remote` (proxy socket) or the last XFF hop / a trusted-proxy count.
2. **Unbounded daily backups** — `backups/{YYYYMMDD}` (`services/backup.py:95`) is written forever with no pruning; each is a full DB copy, so Firebase storage grows without limit. Add retention (keep N days).
3. **Full DB dumped to memory and serialized twice** — `export_all` loads every table into RAM (`services/backup.py:61`) and `backup_to_firebase` `_write`s it to both `latest` and `{day}` (`:94-95`); memory/payload scale with DB size and, if Firebase is down, two full copies land in the outbox as large rows.
4. **Dropped-counter regression after restart** — the drop path does `_dropped_cache += 1` from the in-memory value (`services/sync.py:136-138`) without reading the DB first, so a drop occurring before any `_refresh_counts` overwrites the persisted `outbox_meta['dropped']` with a smaller number. Increment from the persisted value.
5. **Extra write transaction on every healthy sync** — `_write`'s success path always runs `outbox_delete(path)` (DELETE + commit) and `outbox_count()` (`services/sync.py:101-102`) even when nothing is queued, adding a SQLite write per Firebase write. Guard with `outbox_has(path)` or skip when the mirror is already 0.

</details>

<details>
<summary>Details</summary>

### Client identity is attacker-controlled in the rate limiter

`_client_ip` (`api/server.py:139-147`) returns `request.headers.get("X-Forwarded-For").split(",")[0].strip()` and only falls back to `request.remote` when the header is absent. On Render/Fly the platform proxy appends the real peer to any inbound `X-Forwarded-For`, so the first element is whatever the client sent. An attacker who varies that value per request is treated as a new IP each time: `count` never exceeds `limit` (bypass, **likely** — the exact exploitability depends on whether Render/Fly strips inbound XFF, which should be verified), and each fabricated IP becomes a new key in `_rate_hits`. `_prune_rate_hits` (`:149-160`) only sweeps once per 60s window, so within a window the map grows unbounded (**confirmed** from the code path). Using `request.remote`, or the last XFF hop with a known trusted-proxy hop count, fixes both.

The rest of the middleware is sound: it is registered outermost (`middlewares=[rate_limit_middleware, error_and_cors_middleware]`), OPTIONS and the `/health`/`/ready`/`/metrics` set are exempt (`:169`), and the 429 re-applies `_cors_headers(request)` so the browser can read it. Note the root path `/` also serves `health` but is not in the exempt set, so a self-ping to `/` (rather than `/health`) would be counted — minor (**confirmed**).

### Backups grow without bound and are memory-heavy

`export_all` (`services/backup.py:45-73`) reads `sqlite_master` and pulls `SELECT * FROM {name}` for every table into a single dict, then `backup_to_firebase` serializes it through `_write` to both `backups/latest` and `backups/{day}` (`:94-95`). Two consequences, both **likely**: memory and payload size scale linearly with the database, and there is no retention on the dated nodes, so `backups/YYYYMMDD` accumulates one full-DB copy per day in Firebase indefinitely. When Firebase is unavailable, both `_write` calls fall through to the outbox, storing two large JSON blobs as `firebase_outbox` rows (deduped by path, so bounded to two). A retention sweep and a single write (or `latest` only, with periodic dated snapshots) would contain both.

The worker itself is correctly fail-safe: `BACKUP_INTERVAL_HOURS<=0` disables it, `CancelledError` propagates, and all other exceptions are swallowed so the background task never dies.

### Dropped counter can move backwards

The persisted "lost records" tally lives in `outbox_meta['dropped']` and is mirrored into `_dropped_cache`. `_refresh_counts` (`services/sync.py:63-72`) pulls the DB value, but the drop path (`:136-138`) does `_dropped_cache += 1` and persists `str(_dropped_cache)` without first reading the DB. After a restart `_dropped_cache` is 0; if a drop happens before any `flush_pending`/`_refresh_counts` runs, the persisted value (say 50) is clobbered to 1 (**likely** — requires the outbox to already be full at 500 rows before the 60s retry cycle refreshes, an edge case). Diagnostic-only impact, but it undermines the counter that exists specifically to make data loss visible. Deriving the new value from the persisted count avoids the regression.

### Redundant write per successful sync

`_write`'s success branch (`services/sync.py:98-104`) unconditionally calls `q.outbox_delete(path)` (a DELETE followed by `commit`) and then `q.outbox_count()` on every Firebase write, even in the common healthy case where the outbox is empty. Previously this was an in-memory `_pending.pop`. Against the shared single aiosqlite connection this adds a write transaction and a count query per sync operation (`push_user`, `push_all_users`, catalog pushes), which is measurable under bulk pushes (**confirmed** from the code; performance impact **possible**). A cheap guard (skip the delete/count when the mirror is already 0, or use `outbox_has`) restores the old cost profile.

</details>

<details>
<summary>File map</summary>

- `services/sync.py` — outbox now backed by SQLite; `_write`/`flush_pending` rewritten, `pending_count`/`dropped_count` become RAM mirrors refreshed from DB.
- `database/queries.py` — new `outbox_put/delete/has/all/count` and `outbox_meta_get/set` helpers (path-keyed dedup via `ON CONFLICT`).
- `database/db.py` — `firebase_outbox` + `outbox_meta` tables in schema and `_migrate()` for existing DBs.
- `api/server.py` — `rate_limit_middleware` (per-IP fixed window) + `/ready` + `/metrics`; middleware ordered before CORS.
- `services/backup.py` (new) — full-DB dump to `backups/latest` and `backups/{YYYYMMDD}` via `sync._write`; `backup_worker` background task.
- `bot.py` — wires `backup.backup_worker()` into the Firebase-enabled background tasks.
- `config.py` / `.env.example` — `RATE_LIMIT_PER_MIN`, `BACKUP_INTERVAL_HOURS` knobs.
- `scripts/build_catalog_snapshot.py` — snapshot enrichment (`sizes`, `car_names`/`car_name`, `warranty`, `product_type`, story `title`/`link`/`createdAt`, `_generated_at`); defensive `_json_list`/`parse_sizes`/`parse_car_names`.
- `.github/workflows/snapshot.yml` — cron moved from daily to every 2 hours.
- `.github/workflows/ci.yml` (new) — blocking compile/JS/JSON jobs, advisory ruff.

Full diff: `git diff origin/main` on `feat/reliability-ops`.

</details>
