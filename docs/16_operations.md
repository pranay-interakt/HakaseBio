# 16 — Operations: deploying and running Hakase

How to deploy, configure, upgrade and back up the system (docs/15 P2). The development setup is
in the README.

## Deploy with Docker Compose

`docker-compose.yml` runs the following services on one host:

| Service | Image | Role |
|---|---|---|
| `db` | `postgres:16-bookworm` (pinned by digest) | the database |
| `migrate` | `backend/Dockerfile` | runs `hos-db upgrade` once, then exits |
| `api` | `backend/Dockerfile` | uvicorn; starts only after `migrate` succeeds; refuses a database that is not at this release's schema |
| `web` | `frontend/Dockerfile` | unprivileged nginx serving the built app and proxying `/api` to `api` |

Only `web` is published. Every container runs as a non-root user.

```bash
cp .env.example .env        # fill in the three secrets (openssl rand -hex 32)
docker compose up -d --build
curl -fsS http://localhost:8080/api/ready
```

1. Open the web app and create the first administrator with `HOS_BOOTSTRAP_TOKEN`.
2. Put TLS in front of `web` (a load balancer or ingress). nginx listens on plain HTTP inside
   the deployment.
3. Send `X-Forwarded-For` to `web` only from that proxy. nginx replaces the header with the
   address it sees, so a client cannot choose the address the sign-in throttle counts.

CI builds both images and starts this exact stack. It then runs the following against it:
- `backend/scripts/smoke.py` through the web container, from setup to a reconciled, anchored
  ledger;
- a second migration (checks idempotence);
- a drift check;
- a non-root check;
- a check that the API is not reachable directly.

## Configuration

Every setting is an environment variable. The table lists them all, with their defaults.

| Variable | Default | Meaning |
|---|---|---|
| `HOS_DATABASE_URL` | SQLite under `HOS_DATA_DIR` | `postgresql+psycopg://user:pass@host/db` for a shared deployment |
| `HOS_DATA_DIR` | `~/.hakase_os` (image: `/var/lib/hos`) | file store (raw data, reports) and the SQLite file |
| `HOS_ANCHOR_DIR` | `$HOS_DATA_DIR/anchors` (image: `/var/lib/hos-anchors`) | ledger checkpoints; use write-once storage |
| `HOS_ANCHOR_KEY` | none | HMAC key for checkpoints; store it apart from database backups |
| `HOS_BOOTSTRAP_TOKEN` | generated and logged at start | creates the first administrator |
| `HOS_DB_AUTO_UPGRADE` | `1` | `0`: refuse an out-of-date schema; run `hos-db upgrade` as its own step |
| `HOS_WRITE_WAIT_SECONDS` | `30` | how long a write waits for another writer before answering 503 |
| `HOS_SESSION_HOURS` | `8` | absolute session lifetime |
| `HOS_SESSION_IDLE_MINUTES` | `30` | idle timeout |
| `HOS_LOCKOUT_ATTEMPTS` | `5` | consecutive failed passwords before an account locks |
| `HOS_LOGIN_ATTEMPTS_PER_MINUTE` | `10` | sign-in attempts per client address per worker |
| `HOS_AGENT_KEY_DAYS` | `90` | agent key lifetime |
| `HOS_API_DOCS` | off | `1` publishes `/docs` and `/openapi.json` |
| `HOS_CORS_ORIGINS` | the Vite dev server | browser origins allowed to call the API directly; empty behind the proxy |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | uvicorn: addresses whose `X-Forwarded-For` is trusted |

## Releases and dependencies

The dependency set is locked, with a SHA-256 for every file, in `backend/requirements.lock`
(runtime) and `backend/requirements-dev.lock` (plus test tools). The lock is resolved with
`uv pip compile --universal` for Python 3.11 and up, and the command is in each file's header.
CI and the image install with `pip install --require-hashes`, then `pip check`.

Every CI run builds what a release ships, so a release cannot fail for a reason CI has not seen:
- the wheel;
- `requirements.lock`;
- CycloneDX SBOMs for the backend (`sbom-backend.cdx.json`, from the installed runtime
  environment) and the web app (`sbom-web.cdx.json`, production dependencies);
- `software-versions.json`, the versions `hos-verify` records.

Pushing a `v*` tag publishes these as a GitHub release, only after every job has passed. To
update a dependency, re-run the lock command with `--upgrade-package NAME`, then let CI run the
suite on the new set.

## Health

- `GET /api/health` is liveness. It answers whenever the process runs and touches nothing
  else, so an orchestrator does not restart the API during a database outage.
- `GET /api/ready` is readiness. It checks that the database answers, the database is at this
  release's schema, and the file store and anchor directory are writable. It returns 503
  otherwise. It is public and names the failed checks, never their errors.

## Upgrades

```bash
git pull && docker compose build
docker compose run --rm migrate      # hos-db upgrade
docker compose up -d
```

`hos-db current` prints the database's revision and this release's. `hos-db check` exits 1 if
the database differs from the models. An upgrade of a database that already holds records is
written to the ledger as `system.schema_upgraded` (from and to revisions) and anchored.

## Backups and restore

The record is held in three places. Back up all three, and keep the anchors separate from the
other two.

1. **The database.** Use `pg_dump`, or the managed service's point-in-time recovery.
2. **The file store** (`HOS_DATA_DIR/objects`). It is content-addressed, and objects are never
   rewritten, so incremental copies are safe.
3. **The anchor log** (`HOS_ANCHOR_DIR`). Keep it on separate, write-once storage. It is how a
   rewritten or truncated ledger is detected, so it must not live with the database it checks.

After a restore, an administrator opens the integrity check (`GET /api/ledger/verify`). It
verifies the chain, every anchor and the reconciliation of stored state.
- A database restored to an earlier point than the newest anchor reports "chain reaches every
  checkpoint". That is the expected sign of lost transactions, not of tampering. Record the
  restore as a deviation.
