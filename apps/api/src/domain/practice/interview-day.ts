import type { Kit, KitRequirement } from '@prep/shared';

import type { ResearchDigest } from '../../pipeline/research-digest.js';

/**
 * The kit, composed into a final briefing.
 *
 * A candidate can spend a week reading preparation material and still have no
 * way to walk into the room. This is the last five minutes: who they are, what
 * the role asks, what the research actually turned up, and what to ask back.
 *
 * Everything here is selected from data the kit already holds. Nothing is
 * crawled, nothing is generated, and no model is called — which is also why it
 * is a pure function with tests rather than a prompt with hopes. If the kit
 * knows nothing about a company, this says so; it does not fill the space.
 */

/** Enough to read in a few minutes, and no more. */
const MAX_REQUIREMENTS = 6;
const MAX_FACTS = 5;
const MAX_REMINDERS = 5;
const MAX_QUESTIONS = 6;

/** Where a line came from, shown so nothing looks like it was made up. */
export type Basis = 'role requirements' | 'company research' | 'the job description';

export interface InterviewQuestion {
  /** Stable within a briefing, so the interface can key on it. */
  id: string;
  text: string;
  basis: Basis;
}

export interface Briefing {
  company: string;
  companyUrl: string;
  role: string;
  seniority: string;
  location: string;
  /** The must-haves, which are what the interview will actually probe. */
  keyRequirements: KitRequirement[];
  /** What research established about the company, verbatim. */
  companyFacts: string[];
  /** Short prompts drawn from the kit, not advice invented for the occasion. */
  reminders: string[];
  questionsToAsk: InterviewQuestion[];
  /** True when the kit simply has no company research to brief from. */
  researchIsEmpty: boolean;
}

/** Trims a requirement down to something that reads inside a sentence. */
function asSubject(text: string): string {
  const trimmed = text.trim().replace(/\.$/, '');
  if (trimmed.length <= 70) return trimmed;

  // Cut on a word boundary rather than mid-word.
  const cut = trimmed.slice(0, 70);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function lowerFirst(text: string): string {
  return text.length > 0 ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * The topic inside a requirement.
 *
 * Requirements are written as things a *candidate* has — "At least five years
 * of experience building streaming pipelines" — but a question to the
 * interviewer is about the *work*. Dropped into a template raw, that produces
 * "the biggest challenge the team is working on around at least five years of
 * experience building…", which is the kind of line that tells a reader the
 * whole feature was mail-merged.
 *
 * So the qualifier is stripped off the front until only the subject is left:
 *
 *   "At least five years of experience building data pipelines" → "data pipelines"
 *   "Strong proficiency in SQL and dimensional modeling"        → "SQL and dimensional modeling"
 *   "Comfortable mentoring analysts"                            → "mentoring analysts"
 *
 * Deterministic and conservative: a phrase that matches nothing is returned
 * unchanged, which reads a little stiffly but never reads as nonsense.
 */
const QUALIFIERS: RegExp[] = [
  /^(?:at least |over |more than |a minimum of )?(?:\d+\+?|one|two|three|four|five|six|seven|eight|nine|ten)(?:\+)? years?(?: of)?(?: (?:professional|commercial|industry|hands-on))?(?: experience)?(?: (?:with|in|of|building|using|working on|developing))?\s+/i,
  /^(?:strong|deep|solid|excellent|exceptional|extensive|demonstrable|proven|advanced|working)\s+/i,
  /^(?:proficiency|expertise|experience|knowledge|skills?|familiarity|background|fluency|competency|understanding)(?: (?:with|in|of|owning|building|using|running|leading|working on))?\s+/i,
  /^(?:comfortable|confident|competent|hands-on|adept|skilled)(?: (?:with|in|at))?\s+/i,
  /^(?:a )?(?:track record|history)(?: of| in| with)?\s+/i,
  /^(?:ability|able|willingness|willing)(?: to)?\s+/i,
  /^(?:bonus points for|nice to have|a plus:)\s+/i,
];

/**
 * Gives a noun phrase an article when it does not already have one.
 *
 * The research digest is inconsistent about this — "a route optimisation
 * platform" and "route optimisation platform" both occur, depending on how the
 * source page was worded — and only one of them reads correctly after "contribute
 * to". A proper noun keeps its bare form.
 */
function withArticle(phrase: string): string {
  const trimmed = phrase.trim();
  if (/^(a|an|the|their|its|our)\s/i.test(trimmed)) return trimmed;

  // "Kubernetes", "PostgreSQL" — a capitalised first word is a name, not a thing.
  if (/^[A-Z]/.test(trimmed)) return trimmed;

  return `the ${trimmed}`;
}

/*
 * Deliberately not lower-cased: a subject lifted from mid-sentence already
 * reads lowercase, and one that does not is nearly always a proper noun.
 * "facing with node.js" is a worse error than "make room for Mentoring".
 */
export function requirementSubject(text: string): string {
  let subject = text.trim().replace(/\.$/, '');

  // Peel qualifiers one at a time: "Strong proficiency in X" needs two passes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of QUALIFIERS) {
      const stripped = subject.replace(pattern, '');
      if (stripped !== subject && stripped.trim().length > 0) {
        subject = stripped.trim();
        changed = true;
      }
    }
  }

  return asSubject(subject);
}

/**
 * Things worth having in mind, taken from what the kit recorded.
 *
 * The interview process facts are the most valuable of these — a company that
 * publishes "take-home, timeboxed to three hours" has told the candidate
 * something concrete — so they come first.
 */
function buildReminders(kit: Kit, digest: ResearchDigest | null): string[] {
  const reminders: string[] = [];

  for (const fact of digest?.interviewFacts ?? []) {
    reminders.push(fact);
  }

  for (const fact of digest?.hiringFacts ?? []) {
    reminders.push(fact);
  }

  // A gap the user chose to leave is worth knowing about on the day.
  const uncovered = kit.coverage.uncovered_requirement_ids
    .map((id) => kit.role.requirements.find((requirement) => requirement.id === id))
    .filter((requirement): requirement is KitRequirement => requirement?.priority === 'must');

  if (uncovered.length > 0) {
    reminders.push(
      `No question in this kit covers ${uncovered.map((r) => asSubject(r.text)).join('; ')} — expect it to come up anyway.`,
    );
  }

  for (const responsibility of kit.role.responsibilities) {
    reminders.push(`You would be expected to ${lowerFirst(asSubject(responsibility))}.`);
  }

  return [...new Set(reminders)].slice(0, MAX_REMINDERS);
}

/**
 * Questions to ask the interviewer.
 *
 * Templates filled from the kit's own requirements, responsibilities and
 * research, so each one is about this role at this company rather than a line
 * lifted from a careers blog. Every question carries the basis it was built
 * from, and a template with nothing to fill it is skipped rather than emitted
 * with a placeholder.
 */
function buildQuestions(kit: Kit, digest: ResearchDigest | null): InterviewQuestion[] {
  const questions: InterviewQuestion[] = [];
  const seen = new Set<string>();

  const add = (text: string, basis: Basis): void => {
    const key = text.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    questions.push({ id: `ask${questions.length + 1}`, text, basis });
  };

  // Always answerable, and the one question that reliably tells a candidate
  // what the job is actually measured on.
  add('What does success look like for this role in the first 90 days?', 'role requirements');

  const musts = kit.role.requirements.filter((requirement) => requirement.priority === 'must');

  const leadTechnical = musts.find((requirement) => requirement.kind === 'technical');
  if (leadTechnical) {
    add(
      `What is the hardest problem the team is facing with ${requirementSubject(leadTechnical.text)}?`,
      'role requirements',
    );
  }

  const [responsibility] = kit.role.responsibilities;
  if (responsibility) {
    add(
      `How does the team approach ${lowerFirst(asSubject(responsibility))} today?`,
      'the job description',
    );
  }

  const [product] = digest?.products ?? [];
  if (product) {
    add(`How does this role contribute to ${withArticle(asSubject(product))}?`, 'company research');
  }

  const [engineering] = digest?.engineeringFacts ?? [];
  if (engineering) {
    add(
      `The team's engineering is described as: ${asSubject(engineering)}. How has that shaped the way you work day to day?`,
      'company research',
    );
  }

  const leadBehavioural = musts.find((requirement) => requirement.kind === 'behavioural');
  if (leadBehavioural) {
    add(
      `How does the team make room for ${requirementSubject(leadBehavioural.text)}?`,
      'role requirements',
    );
  }

  add('What would make you glad you hired for this role a year from now?', 'role requirements');

  return questions.slice(0, MAX_QUESTIONS);
}

export function buildBriefing(kit: Kit, digest: ResearchDigest | null): Briefing {
  const musts = kit.role.requirements.filter((requirement) => requirement.priority === 'must');

  // Must-haves first, then nice-to-haves if there is room; an interview probes
  // what the posting insisted on.
  const keyRequirements = [
    ...musts,
    ...kit.role.requirements.filter((requirement) => requirement.priority !== 'must'),
  ].slice(0, MAX_REQUIREMENTS);

  const companyFacts = [...(digest?.companyFacts ?? []), ...(digest?.products ?? [])].slice(
    0,
    MAX_FACTS,
  );

  return {
    company: kit.source.company,
    companyUrl: kit.source.company_url,
    role: kit.role.title,
    seniority: kit.role.seniority,
    location: kit.source.location,
    keyRequirements,
    companyFacts,
    reminders: buildReminders(kit, digest),
    questionsToAsk: buildQuestions(kit, digest),
    researchIsEmpty: companyFacts.length === 0,
  };
}
