import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

import { createConfiguredProvider } from '../ai/groq-provider.js';
import { batchInputShapeSchema, batchOutputSchema } from './batch-contract.js';
import { runBatch } from './run-batch.js';

/**
 * The batch entry point:
 *
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * It is a thin shell. The work is done by `runKitPipeline`, the same code the
 * HTTP API uses, so there is no second implementation to drift.
 *
 * Progress goes to stderr so stdout stays clean and the command stays pipeable.
 */

const USAGE = 'Usage: npm run evaluate -- --input <cases.json> --output <kits.json>';

/** A usage problem: nothing can run, so this is not a per-case failure. */
class UsageError extends Error {}

function report(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function readCases(inputPath: string): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await readFile(inputPath, 'utf8');
  } catch {
    throw new UsageError(`Could not read the input file: ${inputPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(
      `The input file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Array-level only. Whether each case is well formed is decided per case, so
  // one malformed entry does not cost the others.
  const shape = batchInputShapeSchema.safeParse(parsed);
  if (!shape.success) throw new UsageError('The input file must contain a JSON array of cases.');

  return shape.data;
}

async function main(): Promise<number> {
  let values: { input?: string; output?: string };

  try {
    ({ values } = parseArgs({
      options: { input: { type: 'string' }, output: { type: 'string' } },
      allowPositionals: false,
    }));
  } catch {
    report(USAGE);
    return 1;
  }

  if (!values.input || !values.output) {
    report(USAGE);
    return 1;
  }

  // npm runs a workspace script with the workspace as its working directory, so
  // a relative path would resolve against apps/api rather than wherever the
  // command was actually typed. INIT_CWD is the directory npm was invoked from,
  // which is what the caller means. Absolute paths are unaffected.
  const invokedFrom = process.env['INIT_CWD'] ?? process.cwd();

  const inputPath = resolve(invokedFrom, values.input);
  const outputPath = resolve(invokedFrom, values.output);

  const cases = await readCases(inputPath);
  if (cases.length === 0) {
    throw new UsageError('The input file contains no cases.');
  }

  // Built once and shared, so the rate limiter sees the whole run's spend.
  const provider = createConfiguredProvider();

  report(`Running ${cases.length} case(s) from ${inputPath}`);
  const startedAt = Date.now();

  const result = await runBatch(cases, {
    provider,
    onCaseStart: (index, total, id) => report(`  [${index + 1}/${total}] ${id} ...`),
    onCaseFinish: (entry, elapsedMs, usage) =>
      report(
        `  [${entry.id}] ${entry.status}` +
          ` (${(elapsedMs / 1000).toFixed(1)}s, ${usage.totalTokens} tokens)` +
          (entry.error ? ` - ${entry.error.code}: ${entry.error.message}` : ''),
      ),
  });

  // Validated before it is written, so the file is either well formed or absent
  // — never half a document the assessment then has to interpret.
  const validated = batchOutputSchema.safeParse(result.output);
  if (!validated.success) {
    report('The generated output did not match the required structure:');
    for (const issue of validated.error.issues.slice(0, 10)) {
      report(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    return 1;
  }

  await writeFile(outputPath, `${JSON.stringify(validated.data, null, 2)}\n`, 'utf8');

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  report(
    `\nWrote ${outputPath}\n` +
      `  ${result.okCount} ok, ${result.failedCount} failed` +
      ` in ${elapsed} min, ${result.totalTokens} tokens`,
  );

  // A completed run is a success even when individual cases failed: the brief
  // asks the command to continue past a failure and record it, which it did.
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      report(error.message);
      report(USAGE);
    } else {
      report(
        `The batch run could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    process.exitCode = 1;
  });
