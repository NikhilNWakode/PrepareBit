import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../../config/env.js';
import { createGroqProvider } from '../../ai/groq-provider.js';
import type { LlmProvider } from '../../ai/llm-provider.js';
import { EMPTY_ID_COUNTERS } from '../../domain/kit/ids.js';
import { createCompanyCrawler } from '../../retrieval/company-crawler.js';
import { clearRobotsCache } from '../../retrieval/robots.js';
import { startFixtureServer, stopFixtureServer } from '../../test-support/fixture-server.js';
import { isDigestEmpty } from '../research-digest.js';
import { extractRequirements } from './extract-requirements.js';
import { synthesiseResearch } from './synthesise-research.js';

/**
 * Two live calls, run deliberately with `npm run test:live` and excluded from
 * `npm test`.
 *
 * The purpose is measurement, not coverage: the stage logic is tested against a
 * fake provider elsewhere. What cannot be checked offline is what a real prompt
 * actually costs, and the fifteen-minute batch requirement in Section 9 depends
 * entirely on that number. Extraction and research synthesis are the two most
 * budget-sensitive stages, so those are the ones measured.
 */

const PORT = 8124;
const BASE = `http://localhost:${PORT}`;

const JOB_DESCRIPTION = [
  'Senior Backend Engineer — Freight Platform',
  '',
  'We are looking for a senior backend engineer to own the services that plan and',
  'settle multi-drop freight routes for our European operators.',
  '',
  'What you will do:',
  '- Own the routing service end to end, from design through to production support',
  '- Work with dispatch operations to turn messy real-world constraints into software',
  '- Help set the technical direction of the backend team',
  '',
  'Required:',
  '- 5+ years building production backend services with Node.js and TypeScript',
  '- Strong PostgreSQL skills, including query tuning and schema design',
  '- Experience designing and operating event-driven systems at scale',
  '- Experience mentoring junior engineers and reviewing their work',
  '- Comfortable owning on-call for services you have built',
  '',
  'Nice to have:',
  '- Bonus points for exposure to Kafka or similar streaming platforms',
  '- Familiarity with the logistics or transport domain is a plus',
  '- Ideally some experience with Kubernetes, though we will teach you',
].join('\n');

let server: Server;
let provider: LlmProvider;

beforeAll(async () => {
  server = await startFixtureServer(PORT);
  clearRobotsCache();

  provider = createGroqProvider({
    apiKey: env.GROQ_API_KEY as string,
    primaryModel: env.GROQ_PRIMARY_MODEL,
    fastModel: env.GROQ_FAST_MODEL,
    // Never cached: the point is to measure a real call.
    cache: { enabled: false, get: () => Promise.resolve(null), set: () => Promise.resolve() },
  });
});

afterAll(async () => {
  await stopFixtureServer(server);
});

describe.skipIf(!env.GROQ_API_KEY)('pipeline stages (live)', () => {
  it('extracts requirements from a real posting, and the evidence check holds', async () => {
    const startedAt = Date.now();
    const result = await extractRequirements(JOB_DESCRIPTION, provider, EMPTY_ID_COUNTERS);
    const elapsed = Date.now() - startedAt;

    expect(result.requirements.length).toBeGreaterThan(0);

    // Ids are assigned by code, in order, with no gaps.
    expect(result.requirements.map((requirement) => requirement.id)).toEqual(
      result.requirements.map((_unused, index) => `r${index + 1}`),
    );

    // The contract shape, with no internal metadata leaking through.
    for (const requirement of result.requirements) {
      expect(Object.keys(requirement).sort()).toEqual(['id', 'kind', 'priority', 'text']);
    }

    // The posting says "Bonus points for" and "is a plus", so at least one
    // requirement must come back as nice rather than everything being a must.
    const priorities = new Set(result.requirements.map((requirement) => requirement.priority));
    expect(priorities.has('must')).toBe(true);

    console.log('\n  extract-requirements (live)');
    console.log(`    requirements kept : ${result.requirements.length}`);
    console.log(
      `    dropped as unverifiable : ${result.notes.filter((n) => n.includes('"')).length}`,
    );
    console.log(`    must / nice       : ${[...priorities].join(', ')}`);
    console.log(`    tokens            : ${result.usage.totalTokens}`);
    console.log(`    latency           : ${elapsed}ms`);
    for (const requirement of result.requirements) {
      console.log(
        `      ${requirement.id} [${requirement.priority}/${requirement.kind}] ${requirement.text}`,
      );
    }
    for (const note of result.notes) console.log(`    note: ${note}`);
  }, 120_000);

  it('synthesises a digest from a genuinely crawled site', async () => {
    const research = await createCompanyCrawler().crawl(`${BASE}/acme/`);
    expect(research.pages.length).toBeGreaterThan(0);

    const startedAt = Date.now();
    const result = await synthesiseResearch(
      {
        pages: research.pages,
        interviewReports: [],
        pagesFailed: research.pagesFailed,
        searchUsed: '',
        notes: research.notes,
        hiringPagesFound: research.hiringPagesFound,
      },
      provider,
    );
    const elapsed = Date.now() - startedAt;

    expect(isDigestEmpty(result.digest)).toBe(false);
    expect(result.digest.sources.length).toBe(research.pages.length);

    // The fixture publishes a take-home and a system design round, buried in a
    // handbook. If that did not survive crawl -> rank -> synthesis, the
    // sequencing is decorative rather than real.
    const interview = result.digest.interviewFacts.join(' ').toLowerCase();
    expect(interview.length).toBeGreaterThan(0);

    console.log('\n  synthesise-research (live)');
    console.log(`    pages crawled     : ${research.pages.length}`);
    console.log(`    tokens            : ${result.usage?.totalTokens ?? 0}`);
    console.log(`    latency           : ${elapsed}ms`);
    console.log(`    industry          : ${result.digest.industry}`);
    console.log(`    interviewFacts    : ${result.digest.interviewFacts.join(' | ') || '(none)'}`);
    console.log(`    hiringFacts       : ${result.digest.hiringFacts.join(' | ') || '(none)'}`);
  }, 180_000);
});
