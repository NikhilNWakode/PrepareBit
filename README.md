# AI Interview Prep Kit

Turns a pasted job description, a company website and a number of days before the
interview into a structured, reshapeable interview preparation kit: a company brief,
a role breakdown, a categorised question bank, flashcards and a day-by-day schedule.

> **Status: Phase 1 (foundation).** The monorepo, API skeleton, database connection,
> error model and web shell are in place. Authentication, retrieval, the generation
> pipeline and the builder UI arrive in later phases.

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router) + Tailwind CSS 4 | Preferred stack. App Router keeps data loading on the server and the client bundle small. |
| Backend | Node.js + Express 5 + TypeScript | Preferred stack. Express 5 propagates async errors to the error middleware without a wrapper. |
| Database | MongoDB + Mongoose 9 | Preferred stack. A kit is a single nested document, which suits a document store. |
| Validation | Zod 4 | One schema library for environment, request bodies and the generated kit structure. |
| Tests | Vitest | Fast, native ESM and TypeScript, no extra transform config. |

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

| Command | Does |
| --- | --- |
| `npm run dev` | Runs shared, API and web together |
| `npm run build` | Production build of all three workspaces |
| `npm start` | Runs the compiled API |
| `npm test` | Vitest |
| `npm run typecheck` | `tsc --noEmit` per workspace |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
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

## Verification

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
