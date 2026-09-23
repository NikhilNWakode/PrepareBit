import { describe, expect, it } from 'vitest';

import {
  HIRING_CONTENT_THRESHOLD,
  isFetchableDocument,
  rankLinks,
  scoreHiringContent,
  scoreLink,
} from './link-ranker.js';

function link(href: string, anchorText = '', depth = 1) {
  return { url: new URL(href, 'https://acme.example/'), anchorText, depth };
}

/** Ordered best-first by href, for readable assertions. */
function order(...hrefs: string[]): string[] {
  return rankLinks(hrefs.map((href) => link(href))).map((ranked) => ranked.url.pathname);
}

describe('scoreLink', () => {
  it('ranks hiring-process pages above general company pages', () => {
    expect(scoreLink(link('/handbook/how-we-hire'))).toBeGreaterThan(scoreLink(link('/about')));
    expect(scoreLink(link('/careers'))).toBeGreaterThan(scoreLink(link('/team')));
  });

  it('ranks any company page above a legal or auth page', () => {
    expect(scoreLink(link('/about'))).toBeGreaterThan(scoreLink(link('/privacy')));
    expect(scoreLink(link('/about'))).toBeGreaterThan(scoreLink(link('/login')));
    expect(scoreLink(link('/careers'))).toBeGreaterThan(scoreLink(link('/terms')));
  });

  /**
   * The case the brief cares about: a path that no fixed list would contain,
   * found because the anchor text says what it is.
   */
  it('finds a hiring page from anchor text when the path gives nothing away', () => {
    const opaque = link('/p/9f3a2', 'How we hire');
    const ordinary = link('/products', 'Products');

    expect(scoreLink(opaque)).toBeGreaterThan(scoreLink(ordinary));
  });

  it('penalises depth, so a shallow careers page wins', () => {
    expect(scoreLink(link('/careers', '', 1))).toBeGreaterThan(scoreLink(link('/careers', '', 3)));
  });

  it('penalises long query strings, which usually mean a filtered listing', () => {
    const plain = link('/jobs');
    const filtered = link('/jobs?department=eng&location=remote&page=4&sort=recent');

    expect(scoreLink(plain)).toBeGreaterThan(scoreLink(filtered));
  });
});

describe('isFetchableDocument', () => {
  it.each(['/brochure.pdf', '/logo.png', '/app.js', '/styles.css', '/deck.pptx'])(
    'excludes %s',
    (path) => {
      expect(isFetchableDocument(new URL(path, 'https://acme.example'))).toBe(false);
    },
  );

  it('keeps ordinary pages', () => {
    expect(isFetchableDocument(new URL('/careers', 'https://acme.example'))).toBe(true);
    expect(isFetchableDocument(new URL('/how-we-hire.html', 'https://acme.example'))).toBe(true);
  });
});

describe('rankLinks', () => {
  it('puts hiring material first and junk last', () => {
    const ranked = order('/privacy', '/about', '/handbook/how-we-hire', '/login', '/careers');

    expect(ranked[0]).toBe('/handbook/how-we-hire');
    expect(ranked.at(-1)).toBe('/login');
    expect(ranked.indexOf('/careers')).toBeLessThan(ranked.indexOf('/about'));
  });

  it('drops non-document targets entirely', () => {
    expect(order('/careers', '/brochure.pdf')).toEqual(['/careers']);
  });

  it('is deterministic for equally scored links', () => {
    const first = order('/b-page', '/a-page');
    const second = order('/a-page', '/b-page');

    expect(first).toEqual(second);
  });
});

describe('scoreHiringContent', () => {
  it('recognises a page describing an interview loop', () => {
    const text = [
      'Our interview process has four stages.',
      'A take-home exercise, then a technical screen, then a system design round.',
    ].join('\n');

    expect(scoreHiringContent('How we hire', text)).toBeGreaterThanOrEqual(
      HIRING_CONTENT_THRESHOLD,
    );
  });

  it('does not mistake an ordinary about page for a hiring page', () => {
    expect(scoreHiringContent('About us', 'Founded in 1974, based in Sheffield.')).toBe(0);
  });

  /**
   * An index page whose link list reads "How we hire" is not itself a hiring
   * page. Counting it as one would suppress the honest "no hiring page found",
   * which is the outcome the brief actually tests for.
   */
  it('does not count a page that merely links to a hiring page', () => {
    const score = scoreHiringContent('Team handbook', 'How we work\nHow we hire\nExpenses');

    expect(score).toBeLessThan(HIRING_CONTENT_THRESHOLD);
  });

  it('weights the title above the body, since a title is a claim about the page', () => {
    const inTitle = scoreHiringContent('Hiring process', 'Some ordinary text.');
    const inBody = scoreHiringContent('Blog', 'We mentioned our hiring process once.');

    expect(inTitle).toBeGreaterThan(inBody);
  });
});
