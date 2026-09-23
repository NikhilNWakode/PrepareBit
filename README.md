# AI Interview Prep Kit

Turns a pasted job description, a company website and a number of days before the
interview into a structured, reshapeable interview preparation kit: a company brief,
a role breakdown, a categorised question bank, flashcards and a day-by-day schedule.

> **Status: Phase 3 (kit contract and persistence).** Foundation, authentication,
> the Appendix A schema, kit persistence and owner-scoped reads are in place.
> Retrieval, the generation pipeline and the builder UI arrive in later phases.

## Tech stack

| Layer      | Choice                                   | Why                                                                                           |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Frontend   | Next.js 16 (App Router) + Tailwind CSS 4 | Preferred stack. App Router keeps data loading on the server and the client bundle small.     |
| Backend    | Node.js + Express 5 + TypeScript         | Preferred stack. Express 5 propagates async errors to the error middleware without a wrapper. |
| Database   | MongoDB + Mongoose 9                     | Preferred stack. A kit is a single nested document, which suits a document store.             |
| Validation | Zod 4                                    | One schema library for environment, request bodies and the generated kit structure.           |
| Tests      | Vitest                                   | Fast, native ESM and TypeScript, no extra transform config.                                   |

**TypeScript is pinned to 5.9** rather than the current 7.x. `typescript-eslint` still
declares a `<6.1.0` peer range, and lint running is worth more here than being on the
newest compiler. Revisit once the plugin ships support.

## Layout

```
packages/shared/   contract shared by API and web (error envelope now, kit schema in Phase 3)
apps/api/          Express service, generation pipeline and the batch CLI
apps/web/          Next.js application
```

`apps/api/src` separates concerns by layer: `routes` and `middleware` (HTTP),
`services` (application), `domain` (pure logic), `repositories` (persistence), with
`retrieval`, `ai`, `pipeline`, `coverage` and `scheduling` added as their phases land.
The generation pipeline never imports Express or Mongoose, so the HTTP API and the
batch CLI can both drive the same implementation.

## Running locally

Requires Node 20.11+ and a MongoDB instance (local or a free Atlas cluster).

```bash
npm install
cp .env.example .env    # then set MONGODB_URI and COOKIE_SECRET
npm run dev
```

`npm run dev` starts the shared type build, the API on `http://localhost:4000` and the
web app on `http://localhost:3000`. The browser only ever talks to port 3000: Next.js
rewrites `/api/*` to Express, which keeps the session cookie same-origin in both local
development and the deployed split.

### Commands

| Command                                                         | Does                                       |
| --------------------------------------------------------------- | ------------------------------------------ |
| `npm run dev`                                                   | Runs shared, API and web together          |
| `npm run build`                                                 | Production build of all three workspaces   |
| `npm start`                                                     | Runs the compiled API                      |
| `npm test`                                                      | Vitest                                     |
| `npm run typecheck`                                             | `tsc --noEmit` per workspace               |
| `npm run lint`                                                  | ESLint                                     |
| `npm run format`                                                | Prettier                                   |
| `npm run evaluate -- --input <cases.json> --output <kits.json>` | Batch entry point (implemented in Phase 8) |

## Environment

Every variable is documented in [`.env.example`](.env.example). Only `MONGODB_URI` and
`COOKIE_SECRET` have no usable default. The API validates its environment with Zod at
startup and exits with a readable list of problems rather than failing later at the
first use.

One flag is worth calling out: `ALLOW_PRIVATE_URLS` permits crawling loopback and
private addresses. It defaults to on outside production, because the batch entry point
is run against company sites served from a local address, and off in production, where
fetching private addresses would be an SSRF hole.

## Authentication

Registration, login, logout and current-user. No email verification, password reset,
roles or OAuth — the brief puts those out of scope.

**Sessions are server-side, in MongoDB.** The browser holds a 32-byte random id from
`crypto.randomBytes` in a signed, HttpOnly cookie; MongoDB stores only **SHA-256 of
that id**. The raw id exists in exactly two places — the `Set-Cookie` header going out
and the `Cookie` header coming in. It is never logged, never written to the database
and never placed in a response body, so a dump of the sessions collection yields
nothing replayable.

The cookie is signed with `COOKIE_SECRET` for integrity, not confidentiality: the id is
already high-entropy, so signing exists to reject a tampered cookie before it costs a
database lookup.

The trade-off: **Mongo-backed sessions introduce one session lookup per authenticated
request, but this is acceptable at the assessment's scale and provides simple, genuinely
revocable sessions without additional infrastructure.** A JWT would avoid the lookup but
could not be revoked on logout, which is the property that matters more here.

Other decisions in this layer:

- **Expiry is absolute at 7 days, not sliding.** A rolling window would mean a database
  write on every request to save someone from signing in once a week.
- `expiresAt` carries a TTL index, but `requireAuth` judges expiry on the timestamp
  itself. MongoDB's TTL monitor only sweeps about once a minute, and an expired session
  must not authenticate inside that window. There is a test for exactly this.
- **Login does the same work whether or not the account exists**, comparing against a
  fixed dummy hash when it does not, and returns an identical response for a wrong
  password and an unknown email. Neither timing nor body reveals whether an address is
  registered.
- Passwords are bcrypt at cost 12, capped at 72 characters because bcrypt ignores
  anything beyond that and would otherwise truncate silently.
- `passwordHash` is `select: false`, so it cannot reach a response through a careless query.
- **The acting user is always derived from the validated session**, never accepted from a
  request body, query string or path parameter.
- The API is the only security boundary. `apps/web/proxy.ts` redirects on a missing
  session cookie, but that is routing convenience — it cannot validate the cookie and is
  not relied on.

### Known limitation

The login rate limiter is an in-memory fixed window, so its budget is per-process. On more
than one instance the correct fix is a shared store, not a cleverer local one.

## The kit contract

The Appendix A structure is defined once, as a Zod schema, in
[`packages/shared/src/kit.schema.ts`](packages/shared/src/kit.schema.ts). It lives in the
shared package because the API validates against it, the batch entry point validates
against it, and the builder UI edits against it — one definition, so the two copies
cannot drift. Field names are copied verbatim and are not open to improvement.

A shape check alone is not enough: a kit can have every field correctly typed and still
be incoherent. So the schema also enforces referential integrity — every
`question_ids` entry in the schedule names a question that exists (called out by name in
the brief), every `requirement_ids` names a real requirement, ids are unique, and
`schedule.days` matches `days_available` with day numbers running `1..N`.

### Identifiers

`r1..rn`, `q1..qn`, `f1..fn`, assigned by code and never by the model — they are what
make coverage checkable rather than a matter of opinion.

Counters are monotonic and stored outside the contract object, next to provenance.
**Deleting an item never decrements its counter**, so an id is never reissued and a stale
reference can never silently re-attach to a different item.

### Generated / edited / pinned

Provenance is a sidecar map keyed by item id, not extra fields on each question, so the
object handed to the grader stays exactly the shape the brief specifies and the batch
command can emit it untouched. One predicate, `isProtected`, decides what a regeneration
may replace: generated and untouched, and nothing else.

### Storage

The kit is persisted as a Mongoose `Mixed` field. Mirroring the contract in a second
schema would invite the two copies to drift, and the contract is the thing being graded —
so Zod owns it and Mongo just holds the document. The cost is that Mongoose cannot detect
mutations inside a `Mixed` field, so every write goes through the repository, which calls
`markModified`. There is a test for that specific trap.

### Ownership

```
authenticated session userId -> Kit.userId -> repository query
```

`userId` is never read from a request body, query string or path parameter. The repository
has no unscoped `findById`, so there is no call site at which ownership can be forgotten.

Requesting a kit that belongs to someone else returns **404, not 403** — a 403 would
confirm the id exists, which is precisely what someone probing for other people's kits
wants to learn.

## Testing

```bash
npm test
```

Tests split deliberately by what they need:

- **Pure suites** — password hashing, session-token generation, rate limiting — never touch
  a database and always run.
- **Integration suites** run against a real MongoDB from `MONGODB_TEST_URI` and **skip with a
  visible notice** when none is reachable, so `npm test` passes from a clean clone either way.
  Each test file gets its own database, named from its module URL: Vitest runs files in
  parallel and these suites clear collections between tests, so on a shared database one file
  wipes another's fixtures mid-test — a failure that only ever appears in a full run.

`mongodb-memory-server` was rejected for this: it downloads a ~100MB server binary on
install, which stalls or fails outright on a restricted network — as it did here, hanging
at zero bytes. A test dependency that can break `npm install` is a bad trade for a project
whose whole deterministic core is testable without a database.

## Verification

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
