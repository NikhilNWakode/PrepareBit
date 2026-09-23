import { describe, expect, it } from 'vitest';

import { createSessionId, hashSessionId } from './session-token.js';

describe('session tokens', () => {
  it('issues a distinct high-entropy id every time', () => {
    const ids = new Set(Array.from({ length: 200 }, createSessionId));

    expect(ids.size).toBe(200);
    // 32 bytes as base64url.
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes deterministically, and the hash does not reveal the id', () => {
    const id = createSessionId();
    const hash = hashSessionId(id);

    expect(hashSessionId(id)).toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(id);
  });

  it('gives different ids different hashes', () => {
    expect(hashSessionId(createSessionId())).not.toBe(hashSessionId(createSessionId()));
  });
});
