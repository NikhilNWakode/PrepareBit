/**
 * Entry point for `npm run evaluate -- --input <cases.json> --output <kits.json>`.
 *
 * Argument handling is wired up now so the command exists from a clean clone and
 * the workspace owns it; the pipeline it drives arrives in Phase 8. It will call
 * the same generation pipeline the HTTP API uses, never a parallel copy.
 */
import { parseArgs } from 'node:util';

function main(): void {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
    },
    allowPositionals: false,
  });

  if (!values.input || !values.output) {
    console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
    process.exit(1);
  }

  console.error('The batch pipeline is not implemented yet (arrives in Phase 8).');
  process.exit(1);
}

main();
