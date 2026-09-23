# AI Interview Prep Kit

Turns a pasted job description, a company website and a number of days before the
interview into a structured, reshapeable interview preparation kit: a company brief,
a role breakdown, a categorised question bank, flashcards and a day-by-day schedule.

> **Status: Phase 2 (authentication).** The monorepo, API skeleton, database
> connection, error model, web shell and the auth layer are in place. Retrieval, the
> generation pipeline and the builder UI arrive in later phases.

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

## Testing

```bash
npm test
```

Tests split deliberately by what they need:

- **Pure suites** — password hashing, session-token generation, rate limiting — never touch
  a database and always run.
- **Integration suites** run against a real MongoDB from `MONGODB_TEST_URI` and **skip with a
  visible notice** when none is reachable, so `npm test` passes from a clean clone either way.

`mongodb-memory-server` was rejected for this: it downloads a ~100MB server binary on
install, which stalls or fails outright on a restricted network — as it did here, hanging
at zero bytes. A test dependency that can break `npm install` is a bad trade for a project
whose whole deterministic core is testable without a database.

## Verification

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
