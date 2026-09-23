import { describe, expect, it } from 'vitest';

import { fingerprintKitInput } from './fingerprint.js';

const JD = 'Senior Backend Engineer\n\nWe are looking for someone with 5+ years of Node.js.';
const URL_ = 'https://acme.example/careers';

describe('fingerprintKitInput', () => {
  it('is stable for identical input', () => {
    expect(fingerprintKitInput(JD, URL_, 5)).toBe(fingerprintKitInput(JD, URL_, 5));
  });

  it('ignores cosmetic whitespace in the job description', () => {
    const padded = `  ${JD.replace(/\n\n/g, '\n\n\n')}  \n`;

    expect(fingerprintKitInput(padded, URL_, 5)).toBe(fingerprintKitInput(JD, URL_, 5));
  });

  it('ignores host casing and a trailing slash in the URL', () => {
    expect(fingerprintKitInput(JD, 'https://ACME.example/careers/', 5)).toBe(
      fingerprintKitInput(JD, URL_, 5),
    );
  });

  it('ignores a URL fragment, which never changes what is fetched', () => {
    expect(fingerprintKitInput(JD, `${URL_}#open-roles`, 5)).toBe(fingerprintKitInput(JD, URL_, 5));
  });

  it('treats a different day count as a different kit, because the schedule differs', () => {
    expect(fingerprintKitInput(JD, URL_, 5)).not.toBe(fingerprintKitInput(JD, URL_, 6));
  });

  it('distinguishes different descriptions and different companies', () => {
    expect(fingerprintKitInput(JD, URL_, 5)).not.toBe(
      fingerprintKitInput(`${JD} Also Go.`, URL_, 5),
    );
    expect(fingerprintKitInput(JD, URL_, 5)).not.toBe(
      fingerprintKitInput(JD, 'https://other.example', 5),
    );
  });

  it('still produces a fingerprint for an unparseable URL rather than throwing', () => {
    expect(() => fingerprintKitInput(JD, 'not a url', 5)).not.toThrow();
    expect(fingerprintKitInput(JD, 'not a url', 5)).toMatch(/^[a-f0-9]{64}$/);
  });
});
