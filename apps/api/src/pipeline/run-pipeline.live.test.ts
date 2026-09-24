import type { Server } from 'node:http';

import { validateKit } from '@prep/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGroqProvider } from '../ai/groq-provider.js';
import type { LlmProvider } from '../ai/llm-provider.js';
import { env } from '../config/env.js';
import type { InterviewResearchProvider } from '../research/interview-research-provider.js';
import { clearRobotsCache } from '../retrieval/robots.js';
import { startFixtureServer, stopFixtureServer } from '../test-support/fixture-server.js';
import { runKitPipeline } from './run-pipeline.js';

/**
 * One complete case, end to end, against the real provider and the real
 * fixture site. Excluded from `npm test`; run with `npm run test:live`.
 *
 * This is the number Phase 8 depends on: five of these must finish inside
 * fifteen minutes, so knowing what one actually costs in tokens and wall-clock
 * matters more than any estimate.
 */

const PORT = 8125;

const JOB_DESCRIPTION = [
  'Senior Backend Engineer - Freight Platform',
  '',
  'We are looking for a senior backend engineer to own the services that plan and',
  'settle multi-drop freight routes for our European operators.',
  '',
  'What you will do:',
  '- Own the routing service end to end, from design through to production support',
  '- Work with dispatch operations to turn real-world constraints into software',
  '',
  'Required:',
  '- 5+ years building production backend services with Node.js and TypeScript',
  '- Strong PostgreSQL skills, including query tuning and schema design',
  '- Experience designing and operating event-driven systems at scale',
  '- Experience mentoring junior engineers and reviewing their work',
  '',
  'Nice to have:',
  '- Bonus points for exposure to Kafka or similar streaming platforms',
  '- Familiarity with the logistics or transport domain is a plus',
].join('\n');

/** Search is stubbed out: the point here is the pipeline, not a third party. */
const NO_SEARCH: InterviewResearchProvider[] = [
  { name: 'none', search: () => Promise.resolve([]) },
];

let server: Server;
let provider: LlmProvider;

beforeAll(async () => {
  server = await startFixtureServer(PORT);
  clearRobotsCache();

  provider = createGroqProvider({
    apiKey: env.GROQ_API_KEY as string,
    primaryModel: env.GROQ_PRIMARY_MODEL,
    fastModel: env.GROQ_FAST_MODEL,
    cache: { enabled: false, get: () => Promise.resolve(null), set: () => Promise.resolve() },
  });
});

afterAll(async () => {
  await stopFixtureServer(server);
});

describe.skipIf(!env.GROQ_API_KEY)('runKitPipeline (live)', () => {
  it('produces a complete, contract-valid kit for one real case', async () => {
    const steps: string[] = [];
    const startedAt = Date.now();

    const outcome = await runKitPipeline(
      {
        jobDescription: JOB_DESCRIPTION,
        companyUrl: `http://localhost:${PORT}/acme/`,
        days: 5,
      },
      {
        provider,
        searchProviders: NO_SEARCH,
        onProgress: (step) => {
          if (steps.at(-1) !== step) steps.push(step);
        },
      },
    );

    const elapsedMs = Date.now() - startedAt;

    if (outcome.status === 'failed') {
      console.error('pipeline failed:', outcome.error, outcome.notes);
    }
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    // The thing the automated pass actually checks.
    const validation = validateKit(outcome.kit);
    if (!validation.ok) console.error(validation.issues);
    expect(validation.ok).toBe(true);

    const kit = outcome.kit;

    expect(kit.source.company).toBe('Acme');
    expect(kit.role.requirements.length).toBeGreaterThan(0);
    expect(kit.questions.length).toBeGreaterThan(0);
    expect(kit.schedule.days).toHaveLength(5);

    // Every must-have covered is the one job the kit has.
    const covered = new Set(kit.questions.flatMap((question) => question.requirement_ids));
    for (const requirement of kit.role.requirements.filter((r) => r.priority === 'must')) {
      expect(covered.has(requirement.id)).toBe(true);
    }

    const byCategory = kit.questions.reduce<Record<string, number>>((counts, question) => {
      counts[question.category] = (counts[question.category] ?? 0) + 1;
      return counts;
    }, {});

    console.log('\n  full pipeline (live)');
    console.log(`    wall clock      : ${(elapsedMs / 1000).toFixed(1)}s`);
    console.log(`    tokens          : ${outcome.usage.totalTokens}`);
    console.log(`    coverage passes : ${kit.coverage.passes}`);
    console.log(`    requirements    : ${kit.role.requirements.length}`);
    console.log(`    questions       : ${kit.questions.length} ${JSON.stringify(byCategory)}`);
    console.log(`    flashcards      : ${kit.flashcards.length}`);
    console.log(`    uncovered       : ${kit.coverage.uncovered_requirement_ids.join(', ') || 'none'}`);
    console.log(`    pages used      : ${kit.source.pages_used.length}`);
    console.log(`    steps           : ${steps.length}`);
    console.log(`    day 1 focus     : ${kit.schedule.days[0]?.focus ?? ''}`);
    console.log(
      `    projected 5 cases: ${((elapsedMs * 5) / 1000 / 60).toFixed(1)} min, ${outcome.usage.totalTokens * 5} tokens`,
    );
  }, 600_000);
});
