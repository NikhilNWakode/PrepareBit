import { QUESTION_CATEGORIES, type Kit, type KitQuestion } from '@prep/shared';

import { Card, CardBody, CardHeader, SectionTitle } from '@/components/ui/card';
import type { StoredKit } from '@/lib/kits';

/**
 * The finished kit, read-only for now.
 *
 * Split into one component per section so Phase 10 can make a section editable
 * without touching the rest of the page — the workspace layout is the thing
 * that should not need rewriting to add editing.
 */

const CATEGORY_LABELS: Record<(typeof QUESTION_CATEGORIES)[number], string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

const DIFFICULTY_LABELS: Record<number, string> = { 1: 'Easier', 2: 'Moderate', 3: 'Harder' };

/**
 * What the research could and could not find.
 *
 * Deliberately prominent rather than a debug field: someone reading a thin kit
 * needs to know it is thin because little was published, not because the tool
 * gave up. Fabricating detail to make this look fuller would be worse than
 * showing less.
 */
function ResearchNotes({ kit }: { kit: StoredKit }) {
  const notes = kit.research.notes.filter((note) => note.trim().length > 0);
  if (notes.length === 0) return null;

  return (
    <Card className="border-accent/30 bg-accent/5">
      <CardBody>
        <SectionTitle>What the research found</SectionTitle>
        <ul className="mt-2 flex flex-col gap-1.5">
          {notes.map((note) => (
            <li key={note} className="text-sm leading-relaxed text-muted">
              {note}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function CoverageNotice({ kit }: { kit: Kit }) {
  const uncovered = kit.coverage.uncovered_requirement_ids;
  if (uncovered.length === 0) return null;

  const byId = new Map(kit.role.requirements.map((requirement) => [requirement.id, requirement]));

  return (
    <Card className="border-red-200 bg-red-50">
      <CardBody>
        <SectionTitle>Not covered by a question</SectionTitle>
        <ul className="mt-2 flex flex-col gap-1">
          {uncovered.map((id) => {
            const requirement = byId.get(id);
            return (
              <li key={id} className="text-sm text-red-800">
                {requirement ? `${requirement.text} (${requirement.priority})` : id}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function CompanyBrief({ kit }: { kit: Kit }) {
  return (
    <Card>
      <CardHeader>
        <SectionTitle>Company</SectionTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed">{kit.company_brief.summary}</p>

        {kit.company_brief.what_they_do ? (
          <p className="text-sm leading-relaxed text-muted">{kit.company_brief.what_they_do}</p>
        ) : null}

        {kit.company_brief.sources.length > 0 ? (
          <div>
            <p className="text-xs font-medium text-muted">Pages read</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {kit.company_brief.sources.map((source) => (
                <li key={source} className="truncate text-xs text-muted">
                  {source}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function RoleSection({ kit }: { kit: Kit }) {
  return (
    <Card>
      <CardHeader>
        <SectionTitle count={kit.role.requirements.length}>Role and requirements</SectionTitle>
      </CardHeader>

      <CardBody className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium">{kit.role.title}</p>
          <p className="text-xs text-muted">
            {[kit.role.seniority, kit.source.location].filter(Boolean).join(' · ') ||
              'No seniority or location stated'}
          </p>
        </div>

        {kit.role.responsibilities.length > 0 ? (
          <div>
            <p className="text-xs font-medium text-muted">Responsibilities</p>
            <ul className="mt-1 flex flex-col gap-1">
              {kit.role.responsibilities.map((item) => (
                <li key={item} className="text-sm leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="text-xs font-medium text-muted">Requirements</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {kit.role.requirements.map((requirement) => (
              <li key={requirement.id} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-xs ${
                    requirement.priority === 'must'
                      ? 'border-accent/40 text-accent'
                      : 'border-border text-muted'
                  }`}
                >
                  {requirement.priority}
                </span>
                <span>
                  {requirement.text}
                  <span className="ml-1.5 text-xs text-muted">{requirement.kind}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

function QuestionItem({ question }: { question: KitQuestion }) {
  return (
    <li className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed">{question.prompt}</p>
        <span className="shrink-0 text-xs text-muted">
          {DIFFICULTY_LABELS[question.difficulty] ?? question.difficulty}
        </span>
      </div>

      {question.answer_outline ? (
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{question.answer_outline}</p>
      ) : null}

      <p className="mt-1.5 text-xs text-muted">Covers {question.requirement_ids.join(', ')}</p>
    </li>
  );
}

function QuestionsSection({ kit }: { kit: Kit }) {
  return (
    <div className="flex flex-col gap-4">
      {QUESTION_CATEGORIES.map((category) => {
        const questions = kit.questions.filter((question) => question.category === category);
        if (questions.length === 0) return null;

        return (
          <Card key={category}>
            <CardHeader>
              <SectionTitle count={questions.length}>{CATEGORY_LABELS[category]}</SectionTitle>
            </CardHeader>
            <ul>
              {questions.map((question) => (
                <QuestionItem key={question.id} question={question} />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function FlashcardsSection({ kit }: { kit: Kit }) {
  if (kit.flashcards.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <SectionTitle count={kit.flashcards.length}>Flashcards</SectionTitle>
      </CardHeader>
      <ul>
        {kit.flashcards.map((flashcard) => (
          <li key={flashcard.id} className="border-b border-border px-4 py-3 last:border-b-0">
            <p className="text-sm font-medium">{flashcard.front}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{flashcard.back}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ScheduleSection({ kit }: { kit: Kit }) {
  return (
    <Card>
      <CardHeader>
        <SectionTitle count={kit.schedule.days_available}>Study plan</SectionTitle>
      </CardHeader>
      <ul>
        {kit.schedule.days.map((day) => (
          <li key={day.day} className="border-b border-border px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm">
                <span className="font-medium">Day {day.day}</span>
                <span className="ml-2 text-muted">{day.focus}</span>
              </p>
              <span className="text-xs text-muted">
                {day.minutes} min · {day.question_ids.length} question
                {day.question_ids.length === 1 ? '' : 's'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function KitView({ stored }: { stored: StoredKit }) {
  const kit = stored.kit;
  if (!kit) return null;

  return (
    <div className="flex flex-col gap-4">
      <ResearchNotes kit={stored} />
      <CoverageNotice kit={kit} />
      <CompanyBrief kit={kit} />
      <RoleSection kit={kit} />
      <QuestionsSection kit={kit} />
      <FlashcardsSection kit={kit} />
      <ScheduleSection kit={kit} />
    </div>
  );
}
