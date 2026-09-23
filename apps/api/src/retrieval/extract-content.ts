import * as cheerio from 'cheerio';

import { isFetchableDocument } from './link-ranker.js';
import { parseFetchableUrl } from './url-guard.js';

/**
 * Turns a fetched document into clean text plus the links it offers.
 *
 * Everything produced here is untrusted: it is text we did not write, and it is
 * on its way to a model. This module's job is to strip markup and chrome, never
 * to interpret the content. The instruction boundary is enforced where the
 * prompts are built.
 */

/** Chrome, not content — and repeated on every page, which wastes the token budget. */
const STRIPPED = 'script, style, noscript, iframe, svg, nav, header, footer, aside, form, template';

export interface ExtractedPage {
  title: string;
  text: string;
  links: { href: string; anchorText: string }[];
}

export function extractContent(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim() || $('h1').first().text().trim();

  // Links are collected before stripping, because a site's primary navigation is
  // often exactly where the careers or handbook link lives.
  const links: { href: string; anchorText: string }[] = [];
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    const anchorText = $(element).text().replace(/\s+/g, ' ').trim();
    const parsed = parseFetchableUrl(href, pageUrl);
    if (!parsed.ok || !isFetchableDocument(parsed.url)) return;

    links.push({ href: parsed.url.href, anchorText });
  });

  $(STRIPPED).remove();

  // Prefer the document's own idea of its main content when it declares one.
  const main = $('main').first();
  const article = $('article').first();
  const root = main.length > 0 ? main : article.length > 0 ? article : $('body');

  const text = root
    .text()
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return { title, text, links };
}

/**
 * Drops lines that recur across most pages — cookie banners, footers that
 * survived the tag strip, repeated calls to action.
 *
 * This is not cosmetic. Phase 5 has roughly 8K tokens per minute to work with,
 * so sending the same banner eight times is budget spent on nothing.
 */
export function removeSharedBoilerplate(pages: { text: string }[]): string[] {
  if (pages.length < 3) return pages.map((page) => page.text);

  const lineCounts = new Map<string, number>();
  for (const page of pages) {
    for (const line of new Set(page.text.split('\n'))) {
      lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
    }
  }

  const threshold = Math.ceil(pages.length * 0.6);

  return pages.map((page) =>
    page.text
      .split('\n')
      .filter((line) => {
        // Long lines are prose even when they repeat; short repeated ones are chrome.
        if (line.length > 120) return true;
        return (lineCounts.get(line) ?? 0) < threshold;
      })
      .join('\n'),
  );
}
