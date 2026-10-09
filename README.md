# WhistleDrop — Speak Without Being Seen

A confidential reporting backend. Anyone can submit a report **without an account and without giving any identity data**. They get a secret **case code** to track progress. Moderators review reports and update their status, but **cannot tell who submitted them**.

**Stack:** Node.js · Express 4 · TypeScript · PostgreSQL · Prisma · Zod · JWT · bcrypt · Helmet · CORS · express-rate-limit · Swagger UI · Jest + Supertest

---

## 1. Quick start

**Prerequisites:** Node.js 20+, PostgreSQL 14+.

```bash
# 1. install (this also runs `prisma generate` automatically)
npm install

# 2. create the databases (psql)
#    CREATE USER whistle WITH PASSWORD 'choose-a-password';
#    CREATE DATABASE whistledrop      OWNER whistle;
#    CREATE DATABASE whistledrop_test OWNER whistle;

# 3. configure
cp .env.example .env          # then edit .env (see "Environment variables")

# 4. create the tables (first time: this also creates prisma/migrations/)
npx prisma migrate dev --name init

# 5. create the first ADMIN account (see "Moderator setup")
npm run seed

# 6. run
npm run dev                   # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with auto-reload |
| `npm run build && npm start` | Compile to `dist/` and run the compiled app |
| `npm test` | Run the whole test suite (uses the **test** database) |
| `npm run typecheck` | TypeScript check without emitting files |
| `npm run seed` | Create the first admin account |
| `npm run prisma:deploy` | Apply existing migrations (production) |

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string for the app |
| `TEST_DATABASE_URL` | for tests | Separate DB used only by `npm test`. **It is wiped on every run**; its name must contain `test` (tests refuse to run otherwise) |
| `JWT_SECRET` | yes | Signs moderator JWTs. ≥ 32 chars |
| `CASE_CODE_PEPPER` | yes | Secret key used when hashing case codes. ≥ 32 chars. **Changing it invalidates all existing case codes** |
| `JWT_EXPIRES_IN` | no (`1h`) | Token lifetime |
| `PORT` | no (`3000`) | HTTP port |
| `CORS_ORIGINS` | no (empty) | Comma-separated allowed browser origins. Empty = cross-origin browser calls are refused |
| `TRUST_PROXY` | no (`0`) | Number of reverse proxies in front of the app (so rate limiting sees the real client IP) |
| `BCRYPT_ROUNDS` | no (`12`) | bcrypt cost factor |
| `*_RATE_LIMIT_MAX`, `LOOKUP_FAILED_MAX`, `LOGIN_FAILED_MAX` | no | Rate-limit thresholds (defaults in `.env.example`) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | for seed | Credentials for the first admin (password ≥ 12 chars) |

Generate strong secrets with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

The app validates all variables at startup and **refuses to start** if a secret is missing or too short.

### Database setup
The schema lives in `prisma/schema.prisma`. `npx prisma migrate dev --name init` creates the tables and a SQL migration you can commit. In production use `npm run prisma:deploy`. For tests, `npm test` automatically runs `prisma db push --force-reset` on `TEST_DATABASE_URL`.

### Moderator setup
There is **no public signup** for moderators.
1. Put `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env`, run `npm run seed` → creates one **ADMIN** (running it again is harmless).
2. Log in via `POST /api/v1/auth/login` to get a token.
3. The admin creates further moderators with `POST /api/v1/admin/moderators` (role `MODERATOR` by default).

Roles: **MODERATOR** (review reports) and **ADMIN** (everything a moderator can do + create accounts). Neither role can see reporter identity — nobody can, because it is never collected.

### API documentation (Swagger)
Start the server and open **http://localhost:3000/api/docs** (raw spec: `/api/docs.json`). To try protected endpoints: call `POST /auth/login` in Swagger UI → copy `data.token` → click **Authorize** → paste the token.

---

## 2. API design

I designed the URLs around **who is allowed to call them**, so the security boundary is visible in the path:

| Method | Path | Who | Purpose | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/reports` | anyone | Submit an anonymous report, receive case code | 201 | 400, 413, 422, 429 |
| GET | `/api/v1/cases/:caseCode` | anyone with the code | Check status + moderator updates | 200 | 400, 404, 429 |
| POST | `/api/v1/auth/login` | moderators | Get a JWT | 200 | 401, 422, 429 |
| GET | `/api/v1/moderator/reports` | moderator | List reports (`?category=&status=&page=&limit=`) | 200 | 401, 403, 422 |
| GET | `/api/v1/moderator/reports/:id` | moderator | One report + full update history | 200 | 400, 401, 403, 404 |
| PATCH | `/api/v1/moderator/reports/:id/status` | moderator | Change status (validated workflow) + required message | 200 | 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/moderator/reports/:id/updates` | moderator | Add a note without changing status | 201 | 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/admin/moderators` | admin | Create moderator account | 201 | 401, 403, 409, 422 |
| GET | `/health` | anyone | Liveness check | 200 | |

**Why this design**
- *Nouns, not verbs*; HTTP methods carry the action. `PATCH` for status (partial update of an existing report), `POST` for creating things.
- *Two different identifiers on purpose:* reporters use the secret **case code** (`/cases/...`); moderators use the internal **UUID** (`/moderator/reports/:id`). The UUID is never shown to reporters, and moderators never see the case code (only its hash is stored), so one side cannot be used to reach the other.
- *`/moderator/*` is one router protected by one `router.use(authenticate, authorize(...))`*, so a future endpoint added there cannot accidentally be left unprotected.
- *Trade-off I accepted:* the case code is in the URL path for `GET /cases/:caseCode`. URLs can appear in browser history or proxy logs. I reduce this by (a) logging only the route *pattern* (`/cases/:caseCode`), never the real URL, and (b) sending `Cache-Control: no-store`. A `POST`-based lookup would avoid history but is less RESTful; I chose REST and documented the trade-off.

### Response format
```jsonc
// success
{ "success": true, "data": { ... }, "meta": { ... } }      // meta only for paginated lists
// error (always this shape)
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ ... ] } }
```

### Status codes used
| Code | When |
|---|---|
| 200 / 201 | OK / created |
| 400 | Malformed request: invalid JSON, malformed URL identifier (bad UUID or case-code format) |
| 401 | No/invalid/expired token, or wrong login credentials |
| 403 | Logged in but not allowed (e.g. moderator calling an admin endpoint) |
| 404 | Unknown case code / report id / route |
| 409 | **Valid request that conflicts with the current state**: invalid status transition, closed case, duplicate moderator email |
| 413 | Body larger than 10 KB |
| 422 | JSON is well-formed but values break the rules (missing field, bad category, bad URL, too long, unknown field) |
| 429 | Rate limit hit |
| 500 | Unexpected server bug only. Generic message, details only in server logs |

**Validation vs. authentication/authorization errors**
- *Validation (400/422)* = "I understood who you are, but **the data** is wrong."
- *Authentication (401)* = "**I don't know who you are**" (missing/bad credentials).
- *Authorization (403)* = "**I know who you are, and you may not do this.**"
Validation runs only after auth on protected routes, so anonymous callers cannot probe moderator input rules.

### Example requests / responses

**Submit a report**
```bash
curl -X POST http://localhost:3000/api/v1/reports \
  -H "Content-Type: application/json" \
  -d '{"category":"CORRUPTION","description":"A manager is taking kickbacks from a vendor contract.","referenceUrl":"https://example.com/doc"}'
```
```json
{ "success": true, "data": {
  "caseCode": "WD-HJBN-GY71-ENKA-YMKM-7E88-1KKX",
  "category": "CORRUPTION", "status": "SUBMITTED",
  "submittedAt": "2026-10-04T06:11:50.142Z",
  "notice": "Save this case code now. It is the ONLY way to check your report and it cannot be recovered." } }
```

**Track it**
```bash
curl http://localhost:3000/api/v1/cases/WD-HJBN-GY71-ENKA-YMKM-7E88-1KKX
```
```json
{ "success": true, "data": {
  "category": "CORRUPTION", "status": "UNDER_REVIEW",
  "submittedAt": "2026-10-04T06:11:50.142Z", "lastUpdatedAt": "2026-10-04T06:12:31.000Z",
  "updates": [ { "message": "We have started investigating.", "statusChangedTo": "UNDER_REVIEW", "createdAt": "2026-10-04T06:12:31.000Z" } ] } }
```

**Invalid / unknown case code**
```jsonc
// GET /api/v1/cases/hello                              -> 400
{ "success": false, "error": { "code": "INVALID_PARAMETER", "message": "A URL parameter is malformed", "details": [ { "field": "caseCode", "message": "Malformed case code" } ] } }
// GET /api/v1/cases/WD-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA   -> 404 (same body for every unknown code)
{ "success": false, "error": { "code": "CASE_NOT_FOUND", "message": "No case found for this case code" } }
```

**Validation error (422)** — `{"category":"GOSSIP","description":"short"}`
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [
  { "field": "category", "message": "category must be one of: SECURITY, HARASSMENT, CORRUPTION, TECHNICAL, OTHER" },
  { "field": "description", "message": "description must be at least 20 characters" } ] } }
```

**Moderator login → list → change status**
```bash
curl -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<your password>"}'
# -> { "success": true, "data": { "token": "eyJ...", "tokenType": "Bearer", "expiresIn": "1h", "moderator": { "id": "...", "email": "...", "role": "ADMIN" } } }

curl "http://localhost:3000/api/v1/moderator/reports?category=CORRUPTION&status=SUBMITTED" -H "Authorization: Bearer <token>"
# -> { "success": true, "data": [ { "id": "d594...", "category": "CORRUPTION", "status": "SUBMITTED", "descriptionPreview": "A manager is...", "createdAt": "...", "updatedAt": "..." } ],
#      "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 } }

curl -X PATCH http://localhost:3000/api/v1/moderator/reports/<id>/status -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"status":"UNDER_REVIEW","message":"We have started investigating."}'
```

**Invalid transition (409)** — trying `SUBMITTED → RESOLVED`, or `RESOLVED → SUBMITTED`:
```json
{ "success": false, "error": { "code": "INVALID_STATUS_TRANSITION",
  "message": "Cannot change status from RESOLVED to SUBMITTED: RESOLVED is a final status.",
  "details": { "currentStatus": "RESOLVED", "requestedStatus": "SUBMITTED", "allowedNextStatuses": [] } } }
```

---

## 3. Status workflow

```
SUBMITTED ──► UNDER_REVIEW ──► RESOLVED
                           └─► DISMISSED
```
Defined as one lookup table in `src/utils/statusTransitions.ts`. Everything not in the table is rejected with **409**. `RESOLVED` and `DISMISSED` are **final** ("permanently closed"): the status can't change and no more notes can be added. Moving to the same status, skipping `UNDER_REVIEW`, or going backwards are all rejected.

*Race conditions:* if two moderators close the same report simultaneously, the update is a "compare-and-set" inside a transaction (`UPDATE ... WHERE id = ? AND status = <what I read>`), so exactly one succeeds and the other gets 409. A test proves this.

Every change is recorded in `status_updates` (from, to, message, moderator, time). Messages are **visible to the reporter**, so moderators should write them for the reporter.

---

## 4. How anonymity is maintained

1. **Nothing identifying is collected.** The report has only category, description, optional URL. No name/email/phone/ID/account.
2. **Unknown fields are rejected** (Zod `strictObject`): sending `email` or `name` gives a 422 instead of being quietly stored.
3. **The database schema has no identity columns** (a test inspects `information_schema` to prove it).
4. **No IP addresses or user-agents are stored or logged.** The rate limiter holds IPs only in memory for the duration of its window.
5. **Logs contain only `METHOD route-pattern status time`** — no bodies, no query strings, no real URLs (so no case codes), no headers.
6. **Case codes are stored hashed.** A leaked database does not reveal usable codes, and moderators physically cannot map a report to its code.
7. **Reporters only see what is meant for them:** status, category, timestamps and moderator messages — no internal IDs, no moderator IDs.
8. **Moderators see only the report content** and timestamps — nothing about the submitter exists to show.
9. **`Cache-Control: no-store`** so case status is not cached in browsers/proxies.

### Privacy assumptions & limitations (honest list)
This is a student project; it **does not provide perfect anonymity**.
- **Network level:** the server (and any proxy/host in front of it) can see the connecting IP at request time. The app doesn't store it, but the hosting provider might log it. Reporters who need strong protection should use Tor/VPN. Deploy behind HTTPS (TLS isn't terminated by this app).
- **Content can identify:** the description, writing style, or details (names, places, times) may identify the reporter. The reference URL could also contain identifying parameters. The README/UI should warn reporters.
- **Timing correlation:** `created_at` timestamps exist; a moderator who knows exactly when someone submitted could guess which report is theirs. (Possible improvement: coarsen timestamps to the day.)
- **Case code = bearer secret:** anyone who has the code can read the status. If it is lost it cannot be recovered. Reporters should store it safely.
- **Insiders with database + server access** (e.g. a hosting admin) could still observe live traffic. The design protects against *moderators and database leaks*, not against a fully compromised server.
- **Rate limiter is in-memory:** resets on restart and doesn't share state between multiple instances (use Redis for a real multi-instance deployment).
- **JWTs are stateless:** a stolen token works until it expires (1 h), except that deleted accounts are rejected immediately because the DB is re-checked on every request.

---

## 5. Case codes

**Generation:** 15 bytes from `crypto.randomBytes` (the operating system's cryptographically secure random generator) → **120 bits of entropy** → Crockford Base32 (no `I L O U`, easy to read aloud) → shown as `WD-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.

**Why it's secure enough:** 2¹²⁰ ≈ 1.3 × 10³⁶ possibilities. Guessing a valid code is infeasible even at billions of tries per second, *and* the API allows only a few wrong guesses per IP per 15 minutes. It's not sequential, not time-based, and not derived from anything else, so knowing one code tells you nothing about another. (Not used: sequential IDs, timestamps, `Math.random()`.)

**Storage:** only `HMAC-SHA256(code, CASE_CODE_PEPPER)` is stored (64 hex chars, `UNIQUE` index).
- *Why hash at all?* A database leak or a curious DBA gets no usable codes. Moderators can't see codes.
- *Why not bcrypt?* We need to **find** the row from the code, so the hash must be deterministic (bcrypt is salted → different every time). bcrypt's slowness helps only with low-entropy human passwords; a 120-bit random value doesn't need it.
- *Why HMAC with a pepper (and not plain SHA-256)?* The secret key lives in `.env`, not in the DB, so a DB-only leak can't even be used to test guesses.
- *Trade-off:* a lost code is unrecoverable, and changing the pepper invalidates all codes.

**Validation / lookup:** the code is trimmed and upper-cased, checked against a strict regex (malformed → **400**, never touches the DB), hashed, and looked up by the unique index. **Unknown → 404** with the same body every time (doesn't say whether "close" codes exist and doesn't echo the code).

**Rate limiting on lookup:** yes. Only **failed** lookups count (10 per 15 min per IP, then **429**), so people with the right code are never slowed down.

---

## 6. Database design (PostgreSQL via Prisma)

```
moderators 1 ───< status_updates >─── 1 reports
```

| Table | Key columns | Notes |
|---|---|---|
| `reports` | `id` UUID PK, `case_code_hash` CHAR(64) **UNIQUE**, `category` enum, `description` VARCHAR(5000), `reference_url` VARCHAR(2048) null, `status` enum default `SUBMITTED`, `created_at`, `updated_at` | **No identity columns.** Indexes on `status`, `category`, `created_at` for the moderator filters/sorting |
| `status_updates` | `id` UUID PK, `report_id` FK → reports **ON DELETE CASCADE**, `moderator_id` FK → moderators **ON DELETE RESTRICT**, `from_status` / `to_status` (both null = plain note), `message` VARCHAR(500), `created_at` | Index `(report_id, created_at)` for fast timeline reads. Doubles as an **audit trail** |
| `moderators` | `id` UUID PK, `email` **UNIQUE**, `password_hash`, `role` enum, `created_at` | Only bcrypt hashes, never passwords |

Decisions:
- **UUID primary keys**, not auto-increment: sequential IDs would leak how many reports exist. (Reporters never see them anyway.)
- **Enums** (`Category`, `ReportStatus`, `Role`) so the database itself rejects invalid values, not just my code.
- **Length limits in the DB** (VARCHAR) mirror Zod's limits — defence in depth.
- **Cascade vs restrict:** deleting a report removes its updates; deleting a moderator who wrote updates is blocked (keeps the audit trail intact).
- **Separate `status_updates` table** (not a text column) because a report has many updates, and we want history with who/when/from/to.
- Prisma uses **parameterized queries**, so SQL injection through inputs isn't possible.

---

## 7. Architecture (and why each layer exists)

```
src/
  server.ts          starts the HTTP server, graceful shutdown
  app.ts             builds the Express app: security middleware order, routes, error handler
  config/env.ts      reads + validates environment variables (fail fast)
  routes/            URL -> middleware chain -> controller. No logic.
  controllers/       HTTP in/out: read validated input, call a service, send response. Thin.
  services/          Business rules + DB access (status workflow, case-code lookup, login)
  middleware/        Cross-cutting: auth, validation, rate limits, error handling, logging
  schemas/           Zod schemas = the contract for every user-controlled input
  utils/             Small pure helpers: case codes, passwords, status transitions, errors
  lib/prisma.ts      One shared database client
  docs/openapi.ts    Swagger/OpenAPI description
  generated/         Prisma client (auto-generated, git-ignored)
prisma/schema.prisma, prisma/seed.ts
tests/               Jest + Supertest
```
- **Routes → controllers → services** keeps each file doing one job: routes say *where*, controllers handle *HTTP*, services hold the *rules*. The status-transition logic can be tested and changed without touching HTTP code.
- No repository layer / DI container / classes — Prisma already is the data layer, and extra layers would add files without adding clarity.

**Request pipeline** (order matters, see `app.ts`): Helmet → CORS → request logger → global rate limit → JSON parser (10 KB limit) → no-store header → route → *(route-level: rate limiter → auth → validation → controller)* → 404 handler → central error handler.

**Security checklist**
| Concern | How it's handled |
|---|---|
| Password storage | bcrypt (cost 12), 12+ char minimum, 72-byte cap (bcrypt's real limit) |
| Authentication | JWT (HS256 pinned, 1 h expiry, subject = moderator id); account re-checked in DB on each request |
| Authorization | `authorize('MODERATOR','ADMIN')` / `authorize('ADMIN')`; role comes from the **database**, not the token |
| Brute force | Failed-only rate limits on login and case lookup; per-IP limit on report creation; global limit |
| Login enumeration | Same message for unknown email vs wrong password + dummy bcrypt run (equal timing) |
| Input validation | Zod on body, query and params; length limits; `strictObject` rejects extra fields; http(s)-only URLs |
| Headers | Helmet (CSP, HSTS, nosniff, …), `X-Powered-By` removed, `no-store` caching |
| CORS | Allow-list from env; none by default |
| Error safety | Central handler; unexpected errors → generic 500; production logs only the error *type* |
| Logging | Route patterns only; no bodies, URLs with codes, IPs, or tokens |
| Secrets | Only in `.env` (git-ignored); min length enforced; app won't start without them |
| SQL injection | Prisma parameterized queries; no raw SQL with user input |

---

## 8. Tests (`npm test`)

57 tests across 7 files, run against a real PostgreSQL test database.

| File | What it proves |
|---|---|
| `reports.test.ts` | Anonymous creation works with no auth (201); missing fields / bad category / bad URL (incl. `javascript:`) / over-long text → 422; **identity fields are refused**; the table has **no identity columns**; only the **hash** of the code is stored |
| `caseCode.test.ts` | Format is correct, 5000 codes all distinct, all 32 symbols appear, hash is deterministic and unreadable, malformed codes are rejected |
| `cases.test.ts` | Valid code → status + updates; **only safe fields exposed**; case-insensitive; reporters see only their own report; malformed → 400; unknown → 404 with an **identical body** for any unknown code; moderator messages visible, moderator identity not |
| `auth.test.ts` | Login returns a token and never a hash; unknown email ≡ wrong password; passwords bcrypt-hashed; no/garbage/forged/expired token → 401; deleted moderator's token dies instantly; **anonymous reporter (even holding a case code) gets 401 on every moderator endpoint and nothing changes**; moderator → admin endpoint = 403; admin can create moderators |
| `moderator.test.ts` | List, filter by category, by status, combined, pagination, invalid filters; detail 200/404/400; valid transitions recorded; **RESOLVED→SUBMITTED = 409** with explanation; skipping/no-op rejected; **two simultaneous closes → exactly one wins**; notes added and visible to reporter; notes on closed cases refused |
| `security.test.ts` | Helmet headers, no `X-Powered-By`, `no-store`; invalid JSON → 400; oversize → 413; unknown route → JSON 404; **a simulated database error returns a generic 500 with no leaked details**; OpenAPI document served |
| `rateLimit.test.ts` | Report creation limited; **successful lookups/logins are free, repeated failures → 429** |

---

## 9. Demo script for the interview (≈ 5 min)
1. Open `/api/docs`. Show the endpoint groups (Public / Auth / Moderator / Admin).
2. `POST /reports` → copy the case code. Point out: no identity fields, 201, code shown once.
3. Try `POST /reports` with `"email": "a@b.com"` → 422 (identity data refused).
4. `GET /cases/{code}` → status `SUBMITTED`. Then a wrong code → 404; a nonsense code → 400.
5. `GET /moderator/reports` without a token → 401.
6. Login as admin → **Authorize** → list reports, filter by category/status.
7. `PATCH .../status` to `UNDER_REVIEW` with a message → refresh the case-code lookup and show the reporter sees the message.
8. Move to `RESOLVED`, then try `RESOLVED → SUBMITTED` → 409 with the explanation.
9. Open the database (`psql`) and show `reports` has no identity columns and `case_code_hash` is not the code.
10. Run `npm test`.

## 10. Possible future improvements
Evidence file upload (with virus scanning), Redis-backed rate limiting, token refresh/revocation, coarser timestamps, moderator-internal notes (hidden from reporters), moderator dashboard, deployment with HTTPS.
