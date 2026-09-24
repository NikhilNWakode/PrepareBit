import type { LlmProvider, LlmUsage } from '../../ai/llm-provider.js';
import { asUntrustedData } from '../../ai/untrusted.js';
import type { ResearchResult } from '../../research/research-service.js';
import { capText, INPUT_CAPS, SYSTEM_RULES } from '../prompts.js';
import {
  emptyDigest,
  normaliseDigest,
  researchDigestSchema,
  type ResearchDigest,
} from '../research-digest.js';

/**
 * The only stage that ever sees raw crawled pages.
 *
 * Everything downstream receives the small digest this produces. Sending eight
 * pages of company website to nine stages would spend an 8,000-tokens-per-minute
 * budget on repetition, so the corpus is read once and compressed here.
 */

const MAX_PAGE_CHARS = 2_500;
const MAX_SNIPPET_CHARS = 400;

const INSTRUCTIONS = [
  'Summarise what these pages say about the company, for someone preparing to interview there.',
  '',
  'Return:',
  '- industry: one short phrase, or "" if the pages do not make it clear',
  '- products: what the company actually sells or operates',
  '- companyFacts: size, location, history, customers, mission — only if stated',
  '- engineeringFacts: languages, frameworks, infrastructure, how the team works',
  '- hiringFacts: what the company says about hiring, roles or what it looks for',
  '- interviewFacts: concrete stages of its interview process, such as a take-home,',
  '  a technical screen, a system design round or a pairing exercise',
  '',
  'Keep every entry to one short sentence.',
  'Leave a list empty when the pages say nothing about it. An empty list is a useful,',
  'honest answer; a guess is not. Never infer a hiring process that is not described.',
].join('\n');

/**
 * Orders the corpus so the most valuable material survives the cap.
 *
 * Hiring pages come first because they are what actually change the kit: a
 * company publishing a take-home and a system-design round should produce a
 * different kit from one that says nothing.
 */
function buildCorpus(research: ResearchResult): string {
  const ordered = [...research.pages].sort((left, right) => right.hiringScore - left.hiringScore);

  const pageBlocks = ordered.map((page) =>
    [`## ${page.title || page.url}`, `<${page.url}>`, page.text.slice(0, MAX_PAGE_CHARS)].join(
      '\n',
    ),
  );

  const searchBlocks = research.interviewReports.map((report) =>
    [`## ${report.title} (public discussion)`, report.snippet.slice(0, MAX_SNIPPET_CHARS)].join(
      '\n',
    ),
  );

  return [...pageBlocks, ...searchBlocks].join('\n\n');
}

export interface SynthesiseResearchResult {
  digest: ResearchDigest;
  notes: string[];
  usage: LlmUsage | null;
}

export async function synthesiseResearch(
  research: ResearchResult,
  provider: LlmProvider,
): Promise<SynthesiseResearchResult> {
  const sources = research.pages.map((page) => page.url);

  // Nothing was retrieved: there is nothing to summarise, and no call worth
  // spending. An honest empty digest is the correct answer.
  if (research.pages.length === 0 && research.interviewReports.length === 0) {
    return {
      digest: emptyDigest(),
      notes: [
        'No company information could be retrieved, so the brief is left empty rather than guessed at.',
      ],
      usage: null,
    };
  }

  const corpus = capText(buildCorpus(research), INPUT_CAPS.researchCorpus);
  const notes: string[] = [];

  if (corpus.truncated) {
    notes.push(
      'The company site was large; the least relevant pages were left out of the summary.',
    );
  }

  const response = await provider.generateStructured(
    [
      { role: 'system', content: SYSTEM_RULES },
      {
        role: 'user',
        content: [INSTRUCTIONS, '', asUntrustedData('company pages', corpus.text)].join('\n'),
      },
    ],
    researchDigestSchema,
    'research_digest',
    { stage: 'synthesise-research', tier: 'primary', maxTokens: 1_800 },
  );

  return {
    digest: normaliseDigest(response.value, sources),
    notes,
    usage: response.usage,
  };
}
