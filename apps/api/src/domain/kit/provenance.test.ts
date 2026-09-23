import { describe, expect, it } from 'vitest';

import { generatedEntry, isProtected, userEntry } from './provenance.js';

describe('isProtected', () => {
  it('leaves an untouched generated item replaceable', () => {
    expect(isProtected(generatedEntry())).toBe(false);
  });

  it('protects an item the user wrote', () => {
    expect(isProtected(userEntry())).toBe(true);
  });

  it('protects a generated item the user edited', () => {
    expect(isProtected({ ...generatedEntry(), edited: true })).toBe(true);
  });

  it('protects a pinned item', () => {
    expect(isProtected({ ...generatedEntry(), pinned: true })).toBe(true);
  });

  it('treats an item with no entry as replaceable', () => {
    expect(isProtected(undefined)).toBe(false);
  });
});
