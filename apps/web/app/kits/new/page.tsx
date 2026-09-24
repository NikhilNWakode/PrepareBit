'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Panel } from '@/components/ui/section';
import { TextareaField } from '@/components/ui/textarea';
import { PageTitle } from '@/components/ui/typography';
import { ApiError } from '@/lib/api-client';
import { createKit, createKitsFromFile, type BatchUploadResponse } from '@/lib/kits';

/**
 * Client-side validation deliberately mirrors the server's rules, so a mistake
 * is caught beside the field rather than after a round trip. The server remains
 * the authority; this is only about telling the user sooner.
 */
const MIN_JD_CHARS = 20;
const MIN_DAYS = 1;
const MAX_DAYS = 60;

interface FieldErrors {
  jd?: string;
  company_url?: string;
  days?: string;
}

function validate(jd: string, companyUrl: string, days: string): FieldErrors {
  const errors: FieldErrors = {};

  if (jd.trim().length < MIN_JD_CHARS) {
    errors.jd = 'Paste the job description — a few words is not enough to work from.';
  }

  if (companyUrl.trim().length === 0) {
    errors.company_url = 'Enter the company website address.';
  } else {
    try {
      const url = new URL(companyUrl.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      errors.company_url = 'Enter a full website address, including https://';
    }
  }

  const parsedDays = Number(days);
  if (!Number.isInteger(parsedDays)) {
    errors.days = 'Enter a whole number of days.';
  } else if (parsedDays < MIN_DAYS || parsedDays > MAX_DAYS) {
    errors.days = `Enter between ${MIN_DAYS} and ${MAX_DAYS} days.`;
  }

  return errors;
}

/** Shown before anything is submitted, so an upload is never a leap of faith. */
interface ParsedUpload {
  fileName: string;
  cases: { id: string; company_url: string; days: number; jdChars: number }[];
  problems: string[];
}

function parseUpload(fileName: string, text: string): ParsedUpload {
  const problems: string[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { fileName, cases: [], problems: ['That file is not valid JSON.'] };
  }

  if (!Array.isArray(parsed)) {
    return { fileName, cases: [], problems: ['The file must contain a list of roles.'] };
  }

  const cases: ParsedUpload['cases'] = [];

  parsed.forEach((row, index) => {
    const entry = row as Record<string, unknown>;
    const label = typeof entry?.id === 'string' ? entry.id : `row ${index + 1}`;

    if (typeof entry?.jd !== 'string' || entry.jd.trim().length === 0) {
      problems.push(`${label}: no job description`);
      return;
    }
    if (typeof entry?.company_url !== 'string' || entry.company_url.trim().length === 0) {
      problems.push(`${label}: no company website`);
      return;
    }
    if (typeof entry?.days !== 'number' || !Number.isInteger(entry.days)) {
      problems.push(`${label}: days must be a whole number`);
      return;
    }

    cases.push({
      id: label,
      company_url: entry.company_url,
      days: entry.days,
      jdChars: entry.jd.length,
    });
  });

  return { fileName, cases, problems };
}

/**
 * A numbered step.
 *
 * The three inputs are not equivalent fields on a record — they are the three
 * decisions that shape the kit, and numbering them says so. The number is
 * decoration only in the sense that it carries no data; it carries order,
 * which is the point.
 */
function Step({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-x-6 gap-y-3 sm:grid-cols-[2.5rem_1fr]">
      <p aria-hidden="true" className="font-mono text-xs text-muted">
        {number}
      </p>

      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 max-w-[60ch] text-[0.8125rem] text-muted">{description}</p>
        <div className="mt-4">{children}</div>
      </div>
    </section>
  );
}

export default function NewKitPage() {
  const router = useRouter();

  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [days, setDays] = useState('5');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [upload, setUpload] = useState<ParsedUpload | null>(null);
  const [uploadResult, setUploadResult] = useState<BatchUploadResponse | null>(null);
  const [uploadRaw, setUploadRaw] = useState<unknown[] | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const found = validate(jd, companyUrl, days);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    try {
      const created = await createKit({
        jd: jd.trim(),
        company_url: companyUrl.trim(),
        days: Number(days),
      });

      // A duplicate returns the existing kit; the kit page says so rather than
      // pretending a new one was made.
      router.push(`/kits/${created.id}${created.reused ? '?reused=1' : ''}`);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not start generating this kit.',
      );
      setPending(false);
    }
  }

  async function handleFile(file: File | undefined) {
    setUploadResult(null);
    if (!file) {
      setUpload(null);
      setUploadRaw(null);
      return;
    }

    const text = await file.text();
    setUpload(parseUpload(file.name, text));

    try {
      const parsed: unknown = JSON.parse(text);
      setUploadRaw(Array.isArray(parsed) ? parsed : null);
    } catch {
      setUploadRaw(null);
    }
  }

  async function submitUpload() {
    if (!uploadRaw || pending) return;

    setPending(true);
    setFormError(null);
    try {
      const result = await createKitsFromFile(uploadRaw);
      setUploadResult(result);
      if (result.accepted.length > 0) {
        // Several kits now exist, so the dashboard is the useful place to be.
        setTimeout(() => router.push('/dashboard'), 1200);
      }
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not upload those roles.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <Link
          href="/dashboard"
          className="inline-flex min-h-6 items-center gap-1 text-[0.8125rem] text-muted hover:text-ink"
        >
          <span aria-hidden="true">←</span> All kits
        </Link>

        <div className="mt-3 border-b border-border-strong pb-5">
          <PageTitle>New kit</PageTitle>
          <p className="mt-1.5 text-sm text-muted">
            The job description is read for its requirements. The company website is crawled for
            what they do and how they hire.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-10 flex flex-col gap-10">
          {formError ? (
            <Panel tone="danger">
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
            </Panel>
          ) : null}

          <Step
            number="01"
            title="Role"
            description="Paste the posting. Its requirements are what every question is checked against, so the more of it you include, the less the kit has to guess."
          >
            <TextareaField
              label="Job description"
              value={jd}
              onChange={(event) => setJd(event.target.value)}
              placeholder="Paste the full posting, including the requirements section."
              error={errors.jd}
              hint={`${jd.trim().length} characters`}
              disabled={pending}
              required
              autoFocus
            />
          </Step>

          <Step
            number="02"
            title="Company"
            description="Crawled for what they build and how they hire. A company that publishes its interview process produces a different kit from one that says nothing."
          >
            <Field
              label="Company website"
              type="url"
              value={companyUrl}
              onChange={(event) => setCompanyUrl(event.target.value)}
              placeholder="https://example.com"
              error={errors.company_url}
              hint="The homepage is enough — the careers or handbook page is found from there."
              disabled={pending}
              required
            />
          </Step>

          <Step
            number="03"
            title="Timeline"
            description="The study plan is spread across exactly this many days, front-loaded so the hardest material comes first."
          >
            <Field
              label="Days until the interview"
              type="number"
              min={MIN_DAYS}
              max={MAX_DAYS}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              error={errors.days}
              disabled={pending}
              required
              className="w-32"
            />
          </Step>

          <div className="border-t border-border pt-6 sm:pl-[4rem]">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              The kit will include
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-muted">
              {[
                'Company research',
                'Requirements',
                'Interview questions',
                'Flashcards',
                'Study plan',
              ].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <div className="mt-5 flex items-center gap-3">
              <Button type="submit" pending={pending}>
                {pending ? 'Starting…' : 'Build interview kit'}
              </Button>
              <span className="text-[0.8125rem] text-muted">Takes about a minute.</span>
            </div>
          </div>
        </form>

        <section className="mt-14 border-t border-border-strong pt-6">
          <h2 className="text-lg font-semibold tracking-tight">Several roles at once</h2>
          <p className="mt-1 text-sm text-muted">
            Upload a JSON file of roles — each needs an{' '}
            <code className="font-mono text-xs">id</code>,{' '}
            <code className="font-mono text-xs">jd</code>,{' '}
            <code className="font-mono text-xs">company_url</code> and{' '}
            <code className="font-mono text-xs">days</code>. One kit is created per role.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleFile(event.target.files?.[0])}
              disabled={pending}
              aria-label="JSON file of roles"
              className="text-sm file:mr-3 file:h-9 file:rounded file:border file:border-border file:bg-surface file:px-3 file:text-sm file:font-medium hover:file:bg-subtle"
            />

            {upload ? (
              <Panel>
                <p className="font-mono text-xs">{upload.fileName}</p>

                {upload.cases.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {upload.cases.map((entry) => (
                      <li key={entry.id} className="text-[0.8125rem] text-muted">
                        <span className="font-mono text-xs text-ink">{entry.id}</span>{' '}
                        {entry.company_url} · {entry.days} day{entry.days === 1 ? '' : 's'} ·{' '}
                        {entry.jdChars} characters
                      </li>
                    ))}
                  </ul>
                ) : null}

                {upload.problems.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {upload.problems.map((problem) => (
                      <li key={problem} className="text-[0.8125rem] text-danger">
                        {problem}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {upload.cases.length > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    pending={pending}
                    onClick={() => void submitUpload()}
                  >
                    Generate {upload.cases.length} kit{upload.cases.length === 1 ? '' : 's'}
                  </Button>
                ) : null}
              </Panel>
            ) : null}

            {uploadResult ? (
              <Panel>
                <p className="text-sm">
                  {uploadResult.accepted.length} queued, {uploadResult.rejected.length} rejected.
                </p>
                {uploadResult.rejected.map((entry) => (
                  <p key={`${entry.index}`} className="mt-1 text-[0.8125rem] text-danger">
                    {entry.id ?? `row ${entry.index + 1}`}: {entry.reason}
                  </p>
                ))}
              </Panel>
            ) : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
