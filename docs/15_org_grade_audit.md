# 15 — Organisation-grade audit (HEAD a1bcbed, 2026-10-11)

An independent review of the committed code at `a1bcbed` (A10 in vivo QT). The goal is to
check the system against the standard a regulated sponsor, CRO or investor's technical
diligence would apply. It also sets the hardening work that comes **before** further driver
waves. Each item has a reproduction and an acceptance test. Nothing here is a style opinion.

## What already meets the bar

Everything below was checked by running it, not by reading it:

- 373 tests pass, with no skips and no xfails. `ruff check` is clean, `mypy hos` is clean
  across 84 modules, and there are zero `type: ignore`.
- The frontend passes `npm ci`, `tsc -b` and `vite build`.
- `scripts/demo.py` runs end to end, and `hos-verify` passes on the exported Module 4
  (5 passed, 0 failed).
- Scientific discipline holds:
  - No silent numeric defaults were found in `hos/`. The `x or 0` cases are post-validation
    vehicle doses or declared simulation truths.
  - All 80 citations carry a DOI or URL.
  - Exactly one reference value is flagged `requires_verification` (human liver weight), and
    the flag propagates to outputs.
  - Simulated studies can never be approved.
  - The NOAEL is recorded only by a re-authenticated Study Director.
- Passwords use scrypt with constant-time comparison, and every signature re-authenticates
  (11.200).

## P0 — integrity and compliance blockers (fix before any customer data)

### P0.1 The audit trail is not atomic with the state it records — **fixed**
*Every writing kernel operation is a unit of work; see `docs/07` §7.6 and `backend/tests/kernel/test_atomicity.py`.*

Each state change and its ledger entry commit in **separate transactions**:
`repo.add` / `repo.update_study` / `repo.add_artifact` commit first, then `_record` → `ledger.record`.
If the ledger write fails (disk, lock, a second worker colliding on `seq`), the change persists
with no audit entry, and `verify_ledger()` still reports the chain valid.

Reproduced: patch `ledger.record` to fail on `principal.registered`, then register a Study
Director. The account exists, `history("bob") == []`, and the ledger verifies.

**Fix:**
- Unit of work. The state change, its artefacts and its ledger entry go in one DB
  transaction, and the ledger row is written in the same session.
- `seq`/`prev_hash` allocation is serialised **in the database**, not by a `threading.Lock`.
  Use a single-row head table locked with `SELECT … FOR UPDATE` (PostgreSQL), or
  `BEGIN IMMEDIATE` (SQLite).
- Apply this to every kernel and ImportService mutation, including the in-progress
  `sign_protocol`.

**Acceptance:**
- A fault-injection test for each mutating kernel method. The ledger write fails, the state
  is unchanged, and the error surfaces.
- A concurrency test of N threads (and on PostgreSQL, N processes) recording at once yields
  a gap-free chain.

### P0.2 Ledger verification does not reconcile state, and the head is not anchored — **fixed**
*`Kernel.integrity()` reconciles every stored record with its events and checks the chain against checkpoints kept outside the database (HMAC with `HOS_ANCHOR_KEY`); see `docs/07` §7.6 and `backend/tests/kernel/test_integrity.py`. An RFC 3161 timestamp is not added.*

`Ledger.verify()` only checks that the chain is internally consistent. It cannot detect:

- a state row with no ledger event (P0.1);
- a state row edited directly in the DB;
- a full chain rewrite by someone with DB write access.

**Fix:**
1. `reconcile()` — every principal, programme, compound, study state, artefact version,
   signature and determination must match the ledger event that created it (by content
   hash). Expose it in `/api/ledger/verify` and in `hos-verify`.
2. Head anchoring. Periodically write a signed checkpoint (`seq`, `head`, time) outside the
   database: an append-only object store or WORM bucket, optionally with an RFC 3161
   timestamp. Verification then checks the chain against the latest checkpoint.

**Acceptance:**
- Tests that edit a study row with raw SQL, delete a ledger tail, and rewrite the chain. Each
  must be detected.

### P0.3 No tenant isolation — **fixed**
*Programmes belong to organisations, guests are added on the record, every scoped route is checked (a test walks all of them), and Module 4 bundles redact other programmes' ledger entries with the scheme-2 hash; see `docs/07` §7.6–7.7 and `backend/tests/api/test_tenancy.py`.*

`Principal.organisation` is stored but never used for authorisation. Any authenticated user can
list and read every programme, study, artefact, file (`/api/files/{sha}`), report and ledger
history in the system. A sponsor and its CROs, or two sponsors, cannot share one deployment.

**Fix:**
- An `Organisation` (tenant) entity.
- Programmes belong to an organisation, with explicit membership for collaborators (CROs) per
  programme.
- Every repository query is scoped by the actor's memberships, and file access checks
  membership through the study that owns the file.
- Ledger reads are scoped the same way.

**Acceptance:**
- An API test suite in which a user of org B gets 404 on every read endpoint and 403/404 on
  every write endpoint for org A's objects. The test enumerates routes from `app.routes`, so
  new endpoints are covered automatically.

### P0.4 The code exists on one laptop, and CI has never run — **partly fixed**
*Pushed to github.com/pranay-interakt/HakaseBio, branch `pranay_hakase_os`; CI now runs on every branch push. Protecting `main` is the repository owner's setting.*

`git remote -v` is empty. `.github/workflows/ci.yml` has therefore never executed.

**Fix:**
- Push to a private GitHub repo and protect `main`.
- Require CI to pass before merge.

**Acceptance:**
- A green CI run on `main`, linked from the README.

## P1 — Part 11 access control and identity

### P1.1 No lockout or throttling on login and signature re-authentication — **fixed**
*Lockout after `HOS_LOCKOUT_ATTEMPTS` failures at sign-in or signature, administrator unlock (ledgered), per-address throttling; `backend/tests/api/test_identity.py`.*

Failures are ledgered, but nothing limits them (21 CFR 11.300(d)).

**Fix:**
- Lock the account after a configurable number of failures, with administrator unlock
  (ledgered).
- Rate-limit per principal and per IP.

**Acceptance:**
- A lockout test covering login and every signing endpoint.

### P1.2 No user lifecycle — **fixed**
*Deactivate/reactivate, roles, unlock, password reset with forced change, self-service change; all ledgered with reasons; Users page in the UI.*

There are no endpoints or kernel methods to deactivate a principal, change roles, change or
reset a password, or force a password change (11.300(b)). A departed Study Director cannot be
removed.

**Fix:**
- Add all of the above, ledgered with reason.
- A deactivated principal can neither sign nor log in, while their historical signatures
  stay valid.

**Acceptance:**
- Tests for each operation, plus a test that a deactivated signer's existing signatures
  still verify.

### P1.3 Unauthenticated bootstrap — **fixed**
*Setup needs a one-time token printed in the server log at start-up, or `HOS_BOOTSTRAP_TOKEN`.*

`POST /api/setup` makes the first caller administrator. On a freshly deployed server that is a
race.

**Fix:**
- Require a one-time bootstrap token from the environment (`HOS_BOOTSTRAP_TOKEN`), disabled
  once used.

**Acceptance:**
- The test without the token returns 403.

### P1.4 Sessions are process memory — **fixed**
*Database sessions (token hashes) with absolute and idle timeouts and revocation; revocable agent keys; sign-in and sign-out ledgered.*

Tokens are lost on restart and are not shared between workers (`uvicorn --workers 2` breaks
auth). There is no idle timeout, and agent tokens expire after 8 h and vanish on restart.

**Fix:**
- DB-backed sessions storing token hashes, with absolute and idle timeouts and server-side
  revocation.
- Agents get long-lived, hashed, scoped API keys that can be revoked (ledgered).
- Ledger successful logins and logouts.

**Acceptance:**
- A multi-worker test, a restart test, and an idle-expiry test.

## P2 — Deployability and operations

1. **Migrations.** `create_all()` plus `_add_missing_columns()` is not a migration system.
   - Adopt Alembic with a baseline revision matching the current models.
   - CI checks `alembic upgrade head` on an empty DB and that autogenerate produces no diff.
2. **PostgreSQL is untested.** Every test runs on SQLite. Add a CI job that runs the suite on
   PostgreSQL 16 through a service container, including the P0.1 concurrency test across
   processes.
3. **Packaging.**
   - A `Dockerfile` (non-root, pinned base) and a `docker-compose.yml` (API, PostgreSQL,
     frontend static).
   - Documented environment configuration.
   - `/api/health` (liveness) and `/api/ready` (DB and file store reachable).
4. **Reproducible, validated builds.** Dependencies are `>=` ranges, but a validated system
   (CSA, GAMP 5) needs a locked state.
   - A hash-pinned lockfile (`uv lock` or `pip-compile --generate-hashes`) used by CI and the
     image.
   - An SBOM (CycloneDX) per release.
   - `hos-verify` already records versions, so make releases produce them.
5. **Request limits.**
   - Maximum body size on upload and import endpoints (configurable).
   - Pagination on `/api/programs`, `/api/studies`, artefacts and ledger history.
6. **Lost updates.** `signatures` and similar JSON lists are read-modify-written without row
   locking, so two concurrent signatures can lose one.
   - Use `SELECT … FOR UPDATE` or an optimistic `version` column.
   - Fold this into the P0.1 unit of work.
7. **Observability.**
   - Structured JSON logs with request ID and principal ID (never passwords or tokens).
   - Error responses carry the request ID.
   - Ledger errors page someone rather than returning a bare 500.

## P3 — Hygiene

- `ruff format --check` fails on 90 files. Format once, then enforce it in CI.
- The DOIs were spot-checked and are correct. Add a `live`-marked test that resolves every DOI
  and URL in `CITATIONS` against Crossref and checks year and first author.
- Deprecations:
  - `starlette.testclient` with `httpx` (move to the replacement client);
  - `Column.copy()` in `tests/kernel/test_imports.py`.
- Python version: CLAUDE.md says 3.11+, `requires-python` says >=3.10, and CI tests 3.11/3.12.
  Settle on one stated floor.
- `Content-Disposition` filenames come from user input. Sanitise them, and emit RFC 6266
  `filename*=`.

## Order of work

1. Finish and commit the in-progress SEND work, green.
2. P0.4, so CI starts running.
3. P0.1 → P0.2 → P0.3.
4. P1.1–P1.4.
5. P2.1–P2.7.
6. P3.
7. Then resume driver waves (P, C) from `14_master_build_plan.md`.

No new driver merges until P0 and P1 are done. A driver that writes to a non-atomic audit trail
in a single-tenant system cannot be sold to a regulated customer, however good its science is.
