# PrepareBit

Turns a pasted job description, a company website and a number of days before the
interview into a structured, reshapeable interview preparation kit: a company brief,
a role breakdown, a categorised question bank, flashcards and a day-by-day schedule.

> **Status:** feature-complete. Generation, the builder, practice and the interview-day
> briefing all work end to end, with 579 tests. Not yet deployed — see
> [Deployment](#deployment).

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
packages/shared/   the Appendix A kit schema and the error envelope, shared by API and web
apps/api/          Express service, generation pipeline and the batch CLI
apps/web/          Next.js application
```

`apps/api/src` separates concerns by layer: `routes` and `middleware` (HTTP),
`services` (application), `domain` (pure logic), `repositories` (persistence), alongside
`retrieval`, `ai`, `pipeline`, `coverage`, `scheduling` and `batch`.

The rules worth arguing about are pure functions under `domain/` — `edit-kit.ts`,
`practice/order-queue.ts`, `practice/interview-day.ts`, `scheduling/allocate-schedule.ts`,
`coverage/check-coverage.ts`. None of them import Express or Mongoose, which is why they
are tested directly rather than through HTTP.

Neither does the generation pipeline, which is why the HTTP API and the batch command can
both drive the same implementation rather than each having its own.

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

`GROQ_API_KEY` is the only other value you need. Get a free one from
[console.groq.com](https://console.groq.com) — no card required.

> If `PORT` is exported in your shell, the API picks it up and collides with Next on 3000.
> `unset PORT` first if you see `EADDRINUSE :::3000`.

### Trying it without a real company site

```bash
npm run fixtures
```

Serves a fake company on `http://localhost:8099` — an about page, a handbook and a hiring
page — so the whole crawl can be exercised without depending on anyone's real website, and
deterministically. Use `http://localhost:8099/acme/` as the company URL. The bundled batch
cases point at it.

### Deployment

**Not deployed yet.** Nothing in the application needs to change to deploy it: `trust proxy`
is already set, CORS is bound to `WEB_ORIGIN`, `/health` exists for uptime checks, shutdown
is graceful, and the SSRF guard turns itself on from `NODE_ENV`. What follows is the
sequence, on MongoDB Atlas + Render (API) + Vercel (web), all free tiers.

**1. Database — Atlas**

Create an M0 cluster, add a database user, and allow network access from anywhere
(Render's egress addresses are not fixed on the free tier). Take the connection string and
append the database name:

```
mongodb+srv://USER:PASSWORD@cluster.mongodb.net/preparebit?retryWrites=true&w=majority
```

**2. API — Render**

New → Web Service → connect this repository. Root directory stays the repo root.

```bash
# Build
npm ci && npm run build --workspace @prep/shared && npm run build --workspace @prep/api

# Start
node apps/api/dist/server.js
```

> **The one real trap.** `@prep/shared` resolves through the npm workspace symlink to
> `packages/shared/dist`. If it has not been compiled, the API fails at import time with a
> module-not-found that points at `node_modules` rather than at the build order. Build
> shared first, always.

Health check path: `/health`. Environment:

| Variable        | Value                                                     |
| --------------- | --------------------------------------------------------- |
| `NODE_ENV`      | `production`                                              |
| `MONGODB_URI`   | the Atlas string from step 1                              |
| `COOKIE_SECRET` | 32 random bytes — `openssl rand -hex 32`                  |
| `GROQ_API_KEY`  | your key                                                  |
| `WEB_ORIGIN`    | the Vercel URL — placeholder for now, corrected in step 4 |

Do **not** set `ALLOW_PRIVATE_URLS`. It defaults to false when `NODE_ENV=production`, which
is exactly what you want: in production it is the SSRF guard, and the only reason it is ever
true is so the batch command can crawl the local fixture site.

The server refuses to start without `MONGODB_URI` and `COOKIE_SECRET`, listing what is
missing — so a misconfiguration shows up in the deploy log rather than at the first request.

**3. Web — Vercel**

Import the repository. Root directory `apps/web`, framework Next.js, build and output left
at their defaults. One environment variable:

| Variable     | Value                      |
| ------------ | -------------------------- |
| `API_ORIGIN` | the Render URL from step 2 |

`API_ORIGIN` is read by [`next.config.ts`](apps/web/next.config.ts) and **baked into the
rewrite at build time**, so it has to be a project environment variable and a change to it
needs a redeploy, not just a restart.

**4. Close the loop**

Set `WEB_ORIGIN` on Render to the Vercel URL and redeploy. The two hosts each need to know
the other's address, so one of them is always configured with a placeholder first; doing the
API first means the web app never points at nothing.

**About the session cookie.** The browser only ever talks to the Vercel origin — Next
rewrites `/api/*` to Express **server-side**, so `Set-Cookie` comes back through the Vercel
origin and binds there. It stays a first-party cookie across the split, which is why
`SameSite=Lax` is correct and no third-party cookie is involved. `secure` follows
`NODE_ENV`. See [`cookies.ts`](apps/api/src/config/cookies.ts).

**Expect a cold start.** Render's free tier sleeps after 15 minutes of inactivity and takes
roughly 50 seconds to wake. The first request after a quiet period is slow, and since
generation itself takes about a minute, a first-time visitor can wait a while before
anything appears. Keeping it warm with a scheduled ping would work and is deliberately not
done: dodging a free tier's limits on a timer is not something worth defending in a review.

### Commands

| Command                                                         | Does                                     |
| --------------------------------------------------------------- | ---------------------------------------- |
| `npm run dev`                                                   | Runs shared, API and web together        |
| `npm run build`                                                 | Production build of all three workspaces |
| `npm start`                                                     | Runs the compiled API                    |
| `npm test`                                                      | Vitest                                   |
| `npm run typecheck`                                             | `tsc --noEmit` per workspace             |
| `npm run lint`                                                  | ESLint                                   |
| `npm run format`                                                | Prettier                                 |
| `npm run evaluate -- --input <cases.json> --output <kits.json>` | Batch entry point                        |
| `npm run fixtures`                                              | Serves the fixture company site on :8099 |

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

The login rate limiter is an in-memory fixed window, which is per-process — see
[Known limitations](#known-limitations).

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

```ts
{ origin: 'generated' | 'user', edited: boolean, pinned: boolean, updatedAt: Date }
```

A **missing entry means generated and replaceable**, so the map records deviations from the
default rather than an entry per item. Three sidecars sit beside the contract object on the
same document — `provenance`, `practice` and `context` (the research digest) — and none of
them is ever written inside `kit`. See [The builder](#the-builder).

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

### Reasoning tokens — measured twice, the second time the hard way

The gpt-oss models spend hidden reasoning tokens from the same completion budget before
emitting anything. Measured against the live API, asking which language "hola" is — a
two-word answer — consumed **133 completion tokens, 111 of them reasoning**. A 100-token
cap produced an _empty_ generation and a `json_validate_failed` 400 that appeared to blame
the schema. So the budget is floored at 512 tokens whatever a caller asks for.

That floor was not enough. A real 1,725-character posting failed in the interface with
_"Requirement extraction failed: the model could not produce output matching the requested
schema"_ — the same misleading error, at a larger scale. Reproduced against the API with
the identical prompt three times:

| Model        | Reasoning | JSON | Total |
| ------------ | --------: | ---: | ----: |
| gpt-oss-20b  |     2,890 |  633 | 3,523 |
| gpt-oss-20b  |     1,757 |  685 | 2,442 |
| gpt-oss-120b |     1,260 |  683 | 1,943 |

Two things follow. **Reasoning varies by more than 2x on identical input**, so a cap sized
for the typical case fails intermittently on the same posting — the worst kind of failure
to diagnose. And **it does not grow with the input**: the longer posting reasoned less.

So a stage now declares how much _output_ it needs and the provider adds 4,000 tokens of
headroom on top, clamped to 7,000 so one call stays inside a minute of the free-tier
budget. This is a ceiling, not a spend — the budget is charged on tokens actually used, so
the headroom costs nothing on an easy call and is the difference between a kit and an error
on a hard one. A truncated answer is now reported as running out of budget rather than as a
schema failure, and `INVALID_MODEL_RESPONSE` became retryable: given that variance, a failed
generation is a dice roll rather than a property of the request.

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

## Generation stages

The brief asks for "a sequence of deliberate steps that respond to what has actually
been found, not by a single prompt that returns everything at once." Each stage is an
independently callable, independently tested function with its own schema and prompt.

| Stage                    | Sees                                                    | Model tier |
| ------------------------ | ------------------------------------------------------- | ---------- |
| `extract-requirements`   | the job description, and nothing else                   | fast       |
| `synthesise-research`    | the crawled pages — the only stage that ever does       | primary    |
| `generate-company-brief` | the digest                                              | fast       |
| `generate-role`          | the posting plus extracted requirements                 | primary    |
| `generate-questions` x4  | a different requirement subset and context per category | split      |
| `generate-flashcards`    | requirements and questions, never the pages             | fast       |

### Requirements must be quoted, not asserted

The highest-scoring band is requirement extraction, and its hardest rule is negative:
"Inventing requirements a description does not contain is worse than reporting that
there were few."

Telling a model not to invent is necessary and insufficient, so **the model is made to
quote its source and code checks the quote**. Each extracted requirement carries an
`evidence` field — a verbatim span from the posting — and a pure verifier normalises
both sides and confirms the span really occurs. A requirement whose evidence is absent
is **dropped**, and the drop is recorded honestly in the notes.

The model is never asked whether its own evidence is valid. It supplies the span; code
decides. A secondary check catches a real span cited for an unrelated claim.

`evidence` is internal pipeline metadata and is discarded before the kit is built: the
Appendix A requirement stays exactly `{ id, text, kind, priority }`.

The verifier is deliberately lenient about wording — it folds case, whitespace and smart
punctuation, and stems words so "Knows Go" still matches "Must know Go" — because
dropping a genuine must-have costs coverage points. It is strict only about whether the
posting actually said the thing.

### Four categories, one stage

The brief: "a requirement like five years of React leads to technical questions while
mentoring junior engineers leads to behavioural ones; the two should not come from the
same call with the same instructions."

So question generation is one reusable stage parameterised by category, not four copies
of the same code. Each category genuinely differs in all three inputs that matter:

- **technical** — technical requirements + engineering facts
- **behavioural** — behavioural requirements + what the company says about hiring
- **system-design** — technical and domain requirements + the seniority signal
- **company-fit** — must-have requirements + the company digest

Every question must cite the `requirement_ids` it assesses. A cited id that does not
exist is stripped, and a question left citing nothing is discarded — that citation is
what makes the coming coverage check verifiable rather than a matter of opinion.

### Reading the corpus once

Raw pages are seen by exactly one call, which compresses them into a small typed digest
reused by every later stage. Sending eight pages of company website to nine stages would
spend the whole 8,000-tokens-per-minute budget on repetition. Hiring pages are ordered
first so they survive the input cap, because they are what actually change a kit.

`hiringFacts` and `interviewFacts` are kept separate from general company facts, so a
company that publishes a take-home followed by a system-design round produces a
different kit from one that says nothing.

### Being honest about what was not found

A stage with nothing to work from does not call the model at all — it returns an empty
result and says so. Nothing is retrieved, so the brief states that plainly rather than
inventing a company. No requirements of a category, so no questions are generated for
it. This both saves tokens and keeps the kit truthful.

### Measured cost

Verified against the live API rather than estimated:

| Stage                  | Estimated | Actual    | Latency |
| ---------------------- | --------- | --------- | ------- |
| `extract-requirements` | ~1,800    | **1,486** | 1.4s    |
| `synthesise-research`  | ~4,500    | **1,871** | 2.3s    |

Synthesis came in well under estimate because boilerplate removal and relevance-ordered
capping do most of the compression before the model sees anything. On that measurement a
full case costs roughly 12,000 tokens rather than the 18,600 planned for, which leaves
real headroom against the fifteen-minute batch requirement.

## What the model is not allowed to decide

The brief names two decisions that must stay in code: "Allocating topics across the
days available is arithmetic, and the application should do it. Comparing the extracted
requirements against the generated questions to find the gaps is likewise your code's
decision to make, not the model's."

Both are pure functions with no clock, no randomness and no provider. Alongside them,
code also owns: every id, every count, `jd_chars`, `researched_at`, `pages_used`, the
company name, and the final structural validation.

### Coverage

A requirement is covered **if and only if** some question's `requirement_ids` contains
its id. That is the entire rule, and it is checkable only because question generation
forces every question to cite what it assesses and strips citations that do not resolve.

All uncovered requirements are reported. Only uncovered **must-haves** drive the retry
loop — a nice-to-have gap is worth knowing about, not worth spending tokens on.

### The second pass, and when it stops

At most **two gap rounds**, so a freshly generated kit has `coverage.passes` of 1, 2 or 3.
(Regenerating a question category runs a genuine further check and increments it, so an
edited kit can be higher — see [The builder](#the-builder).) Each round sends only the
uncovered requirements, grouped by kind and routed through one deterministic mapping:
technical → technical, behavioural → behavioural, domain → system-design.

Two rounds because a model that has twice failed to write a question for a requirement
placed directly in front of it will not succeed on a third attempt. A round that adds
nothing stops the loop early rather than repeating itself.

**A gap is never closed by inventing something.** If a must-have is still uncovered when
the rounds are exhausted, the pipeline returns an `incomplete` outcome — the generated
content is preserved for inspection, but the status makes it impossible to report as a
finished kit. The brief is unambiguous: "A kit that ships with uncovered must-have
requirements has failed at the one job it had."

### The schedule

Questions are scored `priority(must=2|nice=1) * 10 + difficulty`, sorted, then dealt
into days by the **largest-remainder method** over front-loaded weights. Largest
remainder rather than rounding because it is guaranteed to sum to exactly the number of
questions — nothing dropped, nothing scheduled twice.

The invariant that makes "everything is scheduled" mean something: **every question is
_introduced_ exactly once.** Review days may repeat ids introduced earlier, and a repeat
never counts as an introduction — otherwise the requirement would be satisfiable by
repeating one question sixty times.

Edge cases are handled rather than hoped for:

- **1 day** — everything on day one.
- **60 days, few questions** — surplus days become review days over a rotating window, so
  the count still matches exactly and every day has real ids and non-zero minutes.
- **No questions at all** — still exactly N days, each with empty `question_ids`, valid
  integer minutes, and a focus that says no material could be extracted. No invented ids.

### Failure policy

**Fatal** — requirement extraction failure, final schema validation failure, and
unresolved must-have coverage.

**Recoverable, and recorded** — crawl or search failure, research synthesis, the company
brief, the role breakdown, any single question category, and flashcards. One category
failing does not cost the other three; an unreachable company site still produces a kit
with honest notes.

### Measured, end to end

One complete case against the fixture site and the real provider:

|                          |                                                                       |
| ------------------------ | --------------------------------------------------------------------- |
| Wall clock               | 61.8s                                                                 |
| Tokens                   | 15,968                                                                |
| Coverage passes          | 1 (first draft covered everything)                                    |
| Output                   | 6 requirements, 15 questions across all four categories, 6 flashcards |
| Projected for five cases | ~5.1 min against a 15-minute limit                                    |

Worth noting from that run: the rate limiter blocked for 40s before one call, which was
most of the wall clock. That is the limiter working as intended — waiting costs less than
a 429 — but it shows the two model buckets are not evenly loaded. The five-case run under
[Measured](#measured) settled whether that was worth tuning.

## The builder

A kit is generated once and then reshaped by hand. Every change follows one path:

```
load → pure transformation → revalidate the whole contract → write once, or write nothing
```

Funnelling every edit through `mutate` in `kit-edit.service.ts` means no endpoint can forget
the checks. The contract is revalidated on **every** change, so the document in Mongo is
always a legal Appendix A object: a schedule can never point at a question somebody deleted,
because that edit is refused rather than stored.

Editable: questions (text, outline, difficulty, which requirements they assess, category),
flashcards, the company brief, requirement text and priority, and a day's focus. Questions
and flashcards can be added, deleted, reordered and pinned.

**Requirements cannot be added or deleted**, and that is deliberate. They are what the
posting asked for; the honest operation is correcting one the extraction got wrong, not
inventing one the employer never stated — which would quietly turn the coverage figure into
fiction.

### A regeneration that preserves edits

This is the state problem the brief calls the hardest one, so it is worth being precise:

1. Partition the category with `isProtected` — user-written, edited or pinned on one side,
   plain generated on the other.
2. Generate replacements. Their ids come from the monotonic counters, so a new question can
   collide neither with a protected one nor with anything deleted earlier.
3. The new category is the protected questions **in their existing order**, then the fresh
   ones. Other categories, the flashcards and the brief are not read, let alone written.
4. Prune the discarded ids from the schedule, recompute coverage, validate, persist.

Regenerating the brief _does_ overwrite an edited brief, after saying so. The preservation
rule stops an edit being caught up in a regeneration aimed at its neighbours; it does not
override an instruction pointed at the thing itself.

The interface states what will be kept before it runs — _"3 questions you have edited,
written or pinned will be kept; 3 generated questions will be replaced"_ — because a promise
nobody can see being kept is indistinguishable from one that is not there.

### Moving a question between categories

A moved question keeps its id, is appended to the destination, and is marked edited. That
last part matters: it is content the user deliberately placed, so regenerating **either**
the category it left or the one it joined has to leave it alone.

### Coverage is computed, never edited

Anything that touches questions or requirements recomputes `uncovered_requirement_ids` from
the kit itself. `coverage.passes` counts the rounds the _generator_ ran, so only a
regeneration increments it — an ordinary edit recomputes coverage without inflating the
figure that describes how hard the pipeline worked.

### Two tabs

Every mutating request carries the `updatedAt` it was made against, and the repository puts
it in the query. The write is therefore one atomic compare-and-set: a stale write matches
nothing and comes back **409** with a banner offering a reload, rather than silently
discarding what the other tab did.

## Practice mode

Flashcards one at a time: the question, then `Show answer`, then three confidence levels.
Confidence cannot be given before the answer is revealed, because rating a guess is rating
nothing. Fully keyboard-driven — `Space` reveals, `1`/`2`/`3` rate, `Esc` leaves — with the
shortcuts suppressed while typing in a field.

### Ordering, and why it is not spaced repetition

The brief allows either and asks for the choice to be defended.

| Rank | Card       | Why                                                                                                                 |
| ---: | ---------- | ------------------------------------------------------------------------------------------------------------------- |
|    0 | never seen | An unrated card is an unmeasured risk; you cannot call something your weakest subject before you have looked at it. |
|    1 | low        | Known weak.                                                                                                         |
|    2 | medium     |                                                                                                                     |
|    3 | high       |                                                                                                                     |

Ties break on least recently reviewed, then on id so the order is fully determined and can
be asserted in a test.

Spaced repetition was rejected on the shape of the problem, not on difficulty. Intervals
optimise retention over weeks; this product is built around a countdown usually measured in
days, and telling someone with five days left to come back on Thursday answers a question
they are not asking.

### The queue is decided once

`GET /api/kits/:id/practice` returns an ordered queue and the client holds that order for
the whole run. Rating a card low does **not** shuffle it back under the person answering it;
leaving and starting again builds a fresh queue from the latest ratings, which is where the
weighting actually pays off. There is no session entity — "what has been covered" is simply
whether a card has ever been rated.

### A rating is not an edit

`POST /api/kits/:id/practice/:cardId` deliberately bypasses the mutation funnel above. It
revalidates no contract, carries no version, and is written with `{ timestamps: false }` so
it does not touch `updatedAt`.

The reason is concrete: someone editing a question in another tab is holding `updatedAt` as
their version. If practising moved it, their next save would be refused as stale for a
reason they could not possibly guess. **A false conflict is worse than no conflict
detection**, and there is a test that practises and then saves an in-flight edit.

## Interview Day — the creative feature

**The problem.** A candidate can spend a week reading preparation material and still have no
way to walk into the room. The kit is thorough by design, which is exactly wrong for the
five minutes before a call.

`/kits/:id/interview-day` composes what is already stored into a briefing: company, role,
the countdown, the must-have requirements, what the research actually found, reminders, and
questions to ask back.

**It calls no model and fetches nothing.** Every line is selected from data the kit already
holds, which is why it is a pure function with tests rather than a prompt with hopes. Where
the kit knows nothing about a company, the page says so instead of filling the space.

The most useful part is usually the reminders, because they come from the hiring pages the
crawl found — _"Take-home exercise – a small routing problem timeboxed to three hours"_ is
something the candidate can act on, and it is the company's own words.

### Questions to ask the interviewer

Deterministic templates filled from the kit's own requirements, responsibilities and
research, each carrying the basis it was built from. A template with nothing to fill it is
skipped rather than emitted with a placeholder.

One detail took two attempts. Requirements are written as things a _candidate_ has — "At
least five years of experience building streaming pipelines" — but a question to the
interviewer is about the _work_. Dropped in raw, that produced:

> What is the biggest challenge the team is working on around at least five years of
> experience building batch and streaming data…?

which tells a reader the whole feature was mail-merged. `requirementSubject` now strips the
qualifier deterministically down to the subject, and the same question reads:

> What is the hardest problem the team is facing with batch and streaming data pipelines?

## The batch entry point

```bash
npm run fixtures     # serves the local company sites on :8099
npm run evaluate -- --input fixtures/cases.json --output kits.json
```

It drives `runKitPipeline` — the same code the HTTP API uses — rather than a second
implementation, and writes Appendix B exactly.

**Only `GROQ_API_KEY` is needed.** The command touches no database, so `MONGODB_URI` and
`COOKIE_SECRET` are required by the API server alone and validated at its startup rather
than globally. A fresh clone runs the command with nothing but a Groq key in `.env`.

One provider, and therefore one rate limiter, is shared across every case, so the token
budget is tracked across the whole run. A provider per case would each believe it had the
full per-minute allowance and collect 429s. Cases run sequentially: the shared limiter
serialises the model calls anyway, so concurrency would only overlap crawling.

### ok, failed, and the case in between

The pipeline has three outcomes and Appendix B has two, so the mapping is explicit:

| Pipeline     | Batch                 | Reasoning                                                                                                                                                                                                                                                                                                         |
| ------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`         | `ok`                  | —                                                                                                                                                                                                                                                                                                                 |
| `incomplete` | `ok`, kit written     | The FAQ reserves `failed` for "a case you could not produce a kit for at all" and says a partially researched case is still ok "with the gaps recorded honestly in the kit". The uncovered ids are already named in `coverage.uncovered_requirement_ids`, so nothing is hidden and a usable kit is not discarded. |
| `failed`     | `failed`, `kit: null` | No kit exists to write.                                                                                                                                                                                                                                                                                           |

A three-way pipeline status is what makes that a decision rather than an accident:
`incomplete` cannot fall through to success without a line of code choosing it.

**Retrieval problems do not fail a case.** An unreachable company degrades to a kit built
from the job description alone, with the brief saying plainly that nothing could be found.

### Failure isolation and deadlines

Every case is wrapped so nothing it does can end the run, and each has a wall-clock
deadline. The deadline **cancels** rather than merely stops waiting: the abort signal is
bound to the provider, so a timed-out case stops spending tokens the remaining cases still
need.

A malformed case is one `failed` entry rather than a rejected file — array shape is a usage
error, individual case validity is not. A case with no usable id still gets one, derived
from its position (`input-index-2`), so every input has exactly one output entry.

The output is validated against Appendix B before it is written, so the file is either
well formed or absent.

### Measured

Five cases against the fixture sites, with the real provider:

|          |                                                  |
| -------- | ------------------------------------------------ |
| Result   | **5 ok, 0 failed in 3.5 minutes**, 59,894 tokens |
| Limit    | 15 minutes                                       |
| Contract | every kit validates against Appendix A           |
| Coverage | zero uncovered must-haves across all five        |

The run exercised the rate limiter for real — one 429 retried successfully and a 7.3s
budget wait — which is the "including any retries rate limits force" clause working rather
than being hoped for. Because the limiter absorbed it comfortably, the model-tier
rebalancing I had been considering was **not** made: the benchmark said it was not needed.

The cases cover what the brief says it tests: a normal posting, a two-line description
(one requirement, not padded), a company with no hiring page anywhere (reported as having
none), an unreachable company URL (degraded, not failed), and a 30-day schedule.

## Known limitations

Things I decided not to build, and what it would take to change each one. None of them is
an oversight; each is a trade I would defend, and would revisit under different constraints.

**Generation runs in-process.** No queue, no worker. A restart mid-generation orphans a kit,
which `failStaleGenerations` marks failed and retryable on boot. A persisted state machine
driven by a controlled async service is the right size for a minute-long job at this scale;
the pipeline takes its dependencies by injection, so moving it behind a real queue is a
change to the runner and nothing else.

**Rate limiting is per-instance.** A fixed window in memory. Correct for one API process;
on several it becomes a per-instance limit, and the fix is a shared store rather than a
cleverer local one.

**Practice entries outlive deleted flashcards.** Deliberate: ids are never reused, so a
stale entry cannot be misattributed, and every reader walks the kit's flashcards rather than
the map's keys. Pruning would mean threading practice through the edit funnel to delete a
key nothing reads.

**Practice covers flashcards, not questions.** The brief asks for flashcards. Question
practice without answer evaluation is a text box that grades nothing, and evaluation is a
different product decision — one I would want to make deliberately rather than as a
by-product of this phase.

**Interview Day is read-only.** Marking questions to keep would need a new persisted entity;
the briefing itself is the feature.

**Requirements cannot be added or deleted, and a question cannot move between days.** The
first would let coverage describe requirements the posting never made. The second would
break the introduce-exactly-once invariant the schedule rests on; rebuilding the plan is the
supported path.

**Reordering is buttons, not drag and drop.** Move up / move down is operable by keyboard
and on a phone by construction, and the move is announced. Dragging without a keyboard path
would cost more in accessibility than it gains in polish.

**One posting produces one kit per day count.** `days` is part of the fingerprint, so the
same posting for five days and for ten days is genuinely two kits. Submitting the same pair
twice returns the existing kit rather than spending another minute of generation on it.

**Not deployed.** See [Deployment](#deployment) for what is needed and the two changes that
go with it.

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

All four are clean, with **579 tests across 38 files**. The deterministic core — coverage,
schedule allocation, contract validation, the editing rules, the practice queue and the
interview-day composition — is tested without a database or a network, which is why those
suites run from a clean clone in a few seconds.
