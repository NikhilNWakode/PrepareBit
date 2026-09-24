'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { TextareaField } from '@/components/ui/textarea';
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
        <Link href="/dashboard" className="text-xs text-muted hover:text-ink">
          ← Back to your kits
        </Link>

        <h1 className="mt-3 text-xl font-medium tracking-tight">New kit</h1>
        <p className="mt-0.5 text-sm text-muted">
          The job description is pasted in. The company website is crawled for what they do and how
          they hire.
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
          {formError ? <Alert>{formError}</Alert> : null}

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

          <Field
            label="Days until the interview"
            type="number"
            min={MIN_DAYS}
            max={MAX_DAYS}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            error={errors.days}
            hint="The study plan is spread across exactly this many days."
            disabled={pending}
            required
            className="w-32"
          />

          <div>
            <Button type="submit" pending={pending}>
              {pending ? 'Starting…' : 'Generate kit'}
            </Button>
          </div>
        </form>

        <Card className="mt-10">
          <CardHeader>
            <h2 className="text-sm font-medium">Several roles at once</h2>
            <p className="mt-0.5 text-xs text-muted">
              Upload a JSON file of roles — each needs an <code>id</code>, <code>jd</code>,{' '}
              <code>company_url</code> and <code>days</code>. One kit is created per role.
            </p>
          </CardHeader>

          <CardBody className="flex flex-col gap-3">
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleFile(event.target.files?.[0])}
              disabled={pending}
              aria-label="JSON file of roles"
              className="text-sm file:mr-3 file:rounded file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm hover:file:bg-canvas"
            />

            {upload ? (
              <div className="rounded border border-border bg-canvas px-3 py-2 text-sm">
                <p className="font-medium">{upload.fileName}</p>

                {upload.cases.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {upload.cases.map((entry) => (
                      <li key={entry.id} className="text-xs text-muted">
                        <span className="text-ink">{entry.id}</span> — {entry.company_url},{' '}
                        {entry.days} day{entry.days === 1 ? '' : 's'}, {entry.jdChars} characters
                      </li>
                    ))}
                  </ul>
                ) : null}

                {upload.problems.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {upload.problems.map((problem) => (
                      <li key={problem} className="text-xs text-red-700">
                        {problem}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {upload.cases.length > 0 ? (
                  <Button
                    variant="secondary"
                    className="mt-3"
                    pending={pending}
                    onClick={() => void submitUpload()}
                  >
                    Generate {upload.cases.length} kit{upload.cases.length === 1 ? '' : 's'}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {uploadResult ? (
              <div className="rounded border border-border bg-canvas px-3 py-2 text-sm">
                <p>
                  {uploadResult.accepted.length} queued, {uploadResult.rejected.length} rejected.
                </p>
                {uploadResult.rejected.map((entry) => (
                  <p key={`${entry.index}`} className="mt-1 text-xs text-red-700">
                    {entry.id ?? `row ${entry.index + 1}`}: {entry.reason}
                  </p>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
