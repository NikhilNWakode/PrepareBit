import { describe, expect, it } from 'vitest';

import { normaliseUrl } from './normalise-url.js';

const at = (href: string) => normaliseUrl(new URL(href));

describe('normaliseUrl', () => {
  it('treats a trailing slash as the same page', () => {
    expect(at('https://acme.example/about/')).toBe(at('https://acme.example/about'));
  });

  it('leaves the root path alone', () => {
    expect(at('https://acme.example/')).toBe('https://acme.example/');
  });

  it('ignores the fragment, which never changes what is fetched', () => {
    expect(at('https://acme.example/about#team')).toBe(at('https://acme.example/about'));
  });

  it('lowercases the host but not the path', () => {
    expect(at('https://ACME.example/About')).toBe('https://acme.example/About');
  });

  it('drops tracking parameters but keeps meaningful ones', () => {
    expect(at('https://acme.example/jobs?utm_source=x&role=backend')).toBe(
      at('https://acme.example/jobs?role=backend'),
    );
  });

  it('sorts query parameters so argument order does not matter', () => {
    expect(at('https://acme.example/x?b=2&a=1')).toBe(at('https://acme.example/x?a=1&b=2'));
  });

  it('drops a redundant default port', () => {
    expect(at('https://acme.example:443/about')).toBe(at('https://acme.example/about'));
    expect(at('http://acme.example:80/about')).toBe(at('http://acme.example/about'));
  });

  it('keeps a non-default port, which is a different server', () => {
    expect(at('http://localhost:8099/acme/')).not.toBe(at('http://localhost:3000/acme/'));
  });
});
