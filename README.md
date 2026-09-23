# AI Interview Prep Kit

Turns a pasted job description, a company website and a number of days before the
interview into a structured, reshapeable interview preparation kit: a company brief,
a role breakdown, a categorised question bank, flashcards and a day-by-day schedule.

> **Status: Phase 5 (LLM layer).** Foundation, authentication, the Appendix A
> schema, persistence, retrieval and the model-calling layer are in place. The
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

## Retrieval

Two independent modules behind separate interfaces, composed into one
`ResearchResult` that later pipeline stages consume. Neither knows anything about the LLM.

### Finding the hiring page

The brief is explicit that a fixed list of paths is not sufficient — companies bury this
material at `/careers`, `/jobs`, a handbook or an engineering blog. So nothing is fetched
_because of_ its path. The crawler starts at the homepage, extracts the links the site
actually publishes, scores them with a pure ranking function, and spends a small page
budget on the best candidates.

The fixture site exercises exactly this: `acme`'s hiring page sits at
`/handbook/how-we-hire.html`, and the crawler reaches it second — ahead of `/about` —
because the anchor text "How we hire" outranks everything else on the page.

**A site with no hiring page is a real answer.** When nothing scores as hiring material,
the kit records that and the run continues. The brief tests this case, and an honest
"nothing found" is worth more than an invented process.

### Crawl boundary

Scope is the **registrable domain, resolved through the Public Suffix List** (`tldts`), so
starting at `example.com` also reaches `careers.example.com` and `jobs.example.com`. A
last-two-labels heuristic gets `example.co.uk` wrong — it would treat `co.uk` as the
domain and let a crawl wander into an unrelated company. Hosts with no public suffix, such
as the `localhost` fixture server, fall back to an exact hostname match.

Crawling is bounded by page count (8), depth (2), response size (1.5MB), timeout (8s) and a
politeness delay between requests. URLs are normalised before deduplication, and relative
links are resolved against the page they came from — required, because the batch entry
point runs against a local address.

### robots.txt

Fetched once per origin and parsed with `robots-parser` rather than by hand: `Allow`
precedence, wildcards and longest-match are a known source of quiet bugs. A missing
`robots.txt` means allowed. A declared `Crawl-delay` raises the politeness delay.

### SSRF protection

Every URL is validated before it is fetched, and **every redirect hop is revalidated** —
against both the address rules and the crawl boundary. A public URL that redirects to
`169.254.169.254` would otherwise defeat a check done only on the original input.

Blocked: non-HTTP schemes, embedded credentials, and loopback, private, link-local, CGNAT,
multicast and unspecified addresses in IPv4, IPv6 and IPv4-mapped forms. `ALLOW_PRIVATE_URLS`
relaxes this outside production, because the batch runs against localhost fixtures.

Responses are restricted to `text/html`, `application/xhtml+xml` and `text/plain`, with the
byte cap enforced while reading rather than trusting `Content-Length`.

**Known limitation:** the guard resolves the hostname and then `fetch` resolves it again, so
a name that changes between the two could slip through — DNS-rebinding TOCTOU. Closing it
properly means connecting to the validated address with the hostname pinned for TLS, which
Node's `fetch` does not expose. Stated rather than papered over.

### Public interview research

`InterviewResearchProvider`, resolved in strict order:

1. **Tavily** when `TAVILY_API_KEY` is set
2. **DuckDuckGo** when Tavily is absent, rate-limited or failing — an HTML endpoint, not a
   supported API, which is why it is the fallback and not the default
3. **an explicit empty result** when both fail

Both normalise to `{ title, url, snippet, source }` and are deduplicated by normalised URL.
A search failure never fails kit generation, and when nothing useful comes back the kit says
so — interview details are never invented to fill the gap.

### Sources used

Only the company's own website, crawled from the URL the user supplies, and public search
results from Tavily or DuckDuckGo. No job boards are scraped: most block automated access,
and the job description is pasted in directly.

### Fixture sites

```bash
npm run fixtures
```

Serves on port 8099, matching the example in Appendix B:

- `/acme/` — a normal site with its hiring page buried in a handbook
- `/nohire/` — a real site with no hiring page anywhere, plus a robots-disallowed path
- `/broken/*` — 500s, a hanging route, an oversized body, a PDF, redirect loops and an
  off-domain redirect

## The LLM layer

**Provider:** Groq. **Models:** `openai/gpt-oss-120b` (primary) and
`openai/gpt-oss-20b` (fast), both on the free tier. Everything is configured through
`LLM_PROVIDER`, `GROQ_PRIMARY_MODEL` and `GROQ_FAST_MODEL`; **no model id appears in
source code**, including in the tests.

Pipeline stages ask for a `tier`, never a model. Nothing under `pipeline/` knows Groq
exists, so changing provider is a config edit.

### Why two models

Groq's free-tier limits are **8,000 tokens per minute, bucketed per model**. Section 9
of the brief requires five cases in fifteen minutes, which on a single model is
15 x 8K = 120K tokens for roughly 45 calls. Routing heavy-context work to one model and
the many small calls to the other roughly doubles the usable budget.

### Counting tokens before spending them

The brief warns that a pipeline falling over the first time a provider says "slow down"
is the commonest way to lose points here. So the budget is tracked locally and calls
**wait before being sent**, rather than backing off after a 429 — which still costs the
request, against a cap of 1,000 per model per day.

A sliding 60-second window per model tracks spend. Estimates err deliberately high
(3.5 chars/token): over-estimating costs a short wait, under-estimating costs a 429 plus
the request that provoked it. After each call the estimate is replaced with the actual
`usage`, and the `x-ratelimit-remaining-tokens` / `x-ratelimit-reset-tokens` headers
resynchronise the local view so it cannot drift over a long batch run.

Concurrency is deliberately **1**. Against an 8K/minute ceiling, parallel calls mostly
produce 429s, and the batch entry point is judged on finishing, not on speed.

### Reasoning tokens — measured, not assumed

The gpt-oss models are reasoning models: they spend hidden reasoning tokens from the same
completion budget before emitting anything. Measured against the live API, asking which
language "hola" is — a two-word answer — consumed **133 completion tokens, 111 of them
reasoning**. A 100-token cap produced an _empty_ generation and a `json_validate_failed`
400 that appeared to blame the schema.

The completion budget is therefore floored at 512 tokens regardless of what a caller asks
for, and the smallest realistic call costs ~300 tokens. That figure sizes the Phase 6
budget rather than an assumption.

### Structured output

Strict JSON Schema (`response_format: json_schema`, `strict: true`), not loose JSON mode,
so generation is constrained rather than merely requested. The schema is derived from the
caller's Zod schema with Zod 4's built-in `z.toJSONSchema()` — one definition, no second
copy to drift.

If a model cannot honour strict structured output, that is a **loud failure**. Falling
back to an unvalidated free-text call would let unchecked content reach a kit.

Because a constrained decode still returns a string, the response is then unwrapped from
any markdown fence, parsed, and validated against the Zod schema — the schema is the
authority, never the model. A validation failure gets **exactly one** repair attempt
quoting the error, then fails as `LLM_INVALID_RESPONSE`. No content is ever invented to
patch a bad response.

### What gets retried, and what does not

| Failure                            | Retried?                                                        |
| ---------------------------------- | --------------------------------------------------------------- |
| 429 rate limit                     | yes, honouring `Retry-After` in seconds or as an HTTP date      |
| 5xx, timeout, network              | yes, bounded                                                    |
| 400 / 404 / 422                    | no — the same request fails the same way                        |
| 401 / 403                          | no — a bad key will not fix itself, and each retry spends quota |
| Schema the model could not satisfy | no — one repair pass instead                                    |

Backoff is exponential with **full jitter**, so several stages do not wake in lockstep,
and a total wait ceiling stops one stalled stage eating the fifteen-minute batch budget.

### Untrusted content

Both the pasted job description and every crawled page are text we did not write, heading
for a model. `asUntrustedData()` wraps them in delimiters carrying a **random nonce per
call**, and neutralises any delimiter inside the content — a page can contain the word
`END_UNTRUSTED`, but it cannot guess the nonce needed to forge the closing marker.

The defence is layered rather than rhetorical: the prompt states the boundary, the nonce
enforces it, and every output is Zod-validated before it can enter a kit, so even a
successful injection cannot produce a malformed kit.

### Development cache

200K tokens per model per day is about eight full five-case runs. `LLM_CACHE=true` caches
responses on disk under `.llm-cache/`, keyed by provider, model and messages — never by
the API key. Disabled in production.

### Secrets

The key is read from the environment only. It never appears in source, a test fixture, a
log line, an error message or a cache key. Logs record stage, model, latency and token
usage.

## Testing

```bash
npm test        # offline, deterministic, free
npm run test:live   # two tiny real calls against Groq
```

Tests split deliberately by what they need:

- **Live provider tests** are excluded from `npm test` and run on purpose. They spend real
  free-tier tokens, so a routine run must never touch them. They verify what documentation
  cannot: that the configured model ids are real, that strict structured output is actually
  honoured, that `usage` comes back, and that the rate-limit headers carry the names the
  budgeting reads. Everything else about the LLM layer is provider-mocked, because a live
  provider cannot be made to return a 429 or malformed JSON on demand.

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
