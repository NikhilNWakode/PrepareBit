import type { Kit } from '@prep/shared';

/**
 * A minimal kit that satisfies every rule in the contract. Tests clone it and
 * break exactly one thing, so a failure names the rule that broke rather than
 * a pile of unrelated issues.
 */
export function validKit(): Kit {
  return {
    source: {
      company: 'Acme',
      company_url: 'https://acme.example',
      role: 'Senior Backend Engineer',
      location: 'Remote',
      jd_chars: 1280,
      researched_at: '2026-09-24T09:12:44.000Z',
      pages_used: ['https://acme.example/about'],
    },
    company_brief: {
      summary: 'Acme builds logistics software.',
      what_they_do: 'Route planning for freight operators.',
      sources: ['https://acme.example/about'],
    },
    role: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      responsibilities: ['Own the routing service'],
      requirements: [
        { id: 'r1', text: '5+ years with Node.js', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'nice' },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'How do you avoid blocking the event loop?',
        answer_outline: 'Offload CPU-bound work; measure with clinic.',
        difficulty: 2,
      },
      {
        id: 'q2',
        requirement_ids: ['r2'],
        category: 'behavioural',
        prompt: 'Describe how you brought a junior engineer up to speed.',
        answer_outline: 'Situation, the support given, the measurable result.',
        difficulty: 1,
      },
    ],
    flashcards: [
      {
        id: 'f1',
        front: 'Event loop',
        back: 'Single-threaded task queue',
        requirement_ids: ['r1'],
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'Node.js internals', question_ids: ['q1'], minutes: 60 },
        { day: 2, focus: 'Mentoring stories', question_ids: ['q2'], minutes: 30 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}
