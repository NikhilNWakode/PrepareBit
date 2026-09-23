/**
 * Models wrap JSON in markdown fences, preface it with "Here is the JSON:", or
 * append a closing remark — even when asked for JSON, and even under a
 * constrained decode, because what comes back is still a string.
 *
 * Pure, and returns a result rather than throwing: a malformed answer is a
 * reportable outcome the pipeline records honestly, not an exception.
 */

export type JsonExtraction = { ok: true; value: unknown } | { ok: false; reason: string };

const BACKSLASH = String.fromCharCode(92);
const QUOTE = '"';

/** Finds the outermost balanced {...}, ignoring braces inside string literals. */
function findBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === BACKSLASH) {
      escaped = true;
      continue;
    }

    if (character === QUOTE) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

export function extractJsonObject(raw: string): JsonExtraction {
  if (raw.trim().length === 0) {
    return { ok: false, reason: 'The model returned an empty response.' };
  }

  // ```json ... ``` or ``` ... ```
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced?.[1]?.trim() ?? raw;

  const balanced = findBalancedObject(candidate) ?? findBalancedObject(raw);
  if (!balanced) return { ok: false, reason: 'No JSON object was found in the response.' };

  try {
    return { ok: true, value: JSON.parse(balanced) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `The response was not valid JSON: ${detail}` };
  }
}
