import { describe, expect, it } from 'vitest';

import { extractJsonObject } from './parse-json-response.js';

function parsed(raw: string): unknown {
  const result = extractJsonObject(raw);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('extractJsonObject', () => {
  it('reads plain JSON', () => {
    expect(parsed('{"ok":true}')).toEqual({ ok: true });
  });

  it('unwraps a fenced json block', () => {
    expect(parsed('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('unwraps an unlabelled fence', () => {
    expect(parsed('```\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('ignores a preamble the model added', () => {
    expect(parsed('Here is the JSON you asked for:\n{"ok":true}')).toEqual({ ok: true });
  });

  it('ignores trailing commentary', () => {
    expect(parsed('{"ok":true}\n\nLet me know if you need anything else!')).toEqual({ ok: true });
  });

  it('keeps nested objects intact', () => {
    expect(parsed('{"a":{"b":{"c":1}},"d":[{"e":2}]}')).toEqual({
      a: { b: { c: 1 } },
      d: [{ e: 2 }],
    });
  });

  /** A brace inside a string must not be mistaken for structure. */
  it('is not confused by braces inside string values', () => {
    expect(parsed('{"prompt":"What does {} mean in Go?"}')).toEqual({
      prompt: 'What does {} mean in Go?',
    });
  });

  it('is not confused by an escaped quote inside a string', () => {
    const raw = String.raw`{"prompt":"He said \"hello\" and left"}`;

    expect(parsed(raw)).toEqual({ prompt: 'He said "hello" and left' });
  });

  it('reports an empty response rather than throwing', () => {
    const result = extractJsonObject('   ');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/empty/i);
  });

  it('reports a response with no JSON in it', () => {
    const result = extractJsonObject('I am afraid I cannot help with that.');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no json object/i);
  });

  it('reports malformed JSON', () => {
    const result = extractJsonObject('{"ok": tru}');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not valid json/i);
  });

  it('reports an unterminated object', () => {
    const result = extractJsonObject('{"ok": true');

    expect(result.ok).toBe(false);
  });
});
