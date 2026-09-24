import type { SVGProps } from 'react';

/**
 * The PrepareBit mark: a P whose counter is missing one unit.
 *
 * The product's whole job is breaking an interview into units you can actually
 * work through — requirements, questions, days — and showing which of them are
 * still open. The square sitting outside the letterform is that: one bit not
 * yet in place. It is the same idea the coverage figure reports, drawn once.
 *
 * Geometric, monochrome, and built from four shapes so it survives being
 * rendered at 18 pixels in a header. It takes its colour from `currentColor`,
 * so it belongs to whatever it sits in rather than carrying a palette of its
 * own.
 */
export function Logo({ className = '', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      {/* The stem. */}
      <rect x="3" y="3" width="3.4" height="18" rx="1.5" fill="currentColor" />

      {/*
        The bowl, stroked so its weight matches the stem exactly: half of 3.4
        either side of the path puts its outer edge on the stem's top.
      */}
      <path
        d="M6.4 4.7h6.9a4.3 4.3 0 0 1 0 8.6H6.4"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="square"
      />

      {/*
        The bit that is not in place yet — drawn open rather than solid, which
        is the whole point of it. Filled, it reads as a full stop; hollow, and
        lighter than the stem, it reads as a unit still to be filled.
      */}
      <rect
        x="10.2"
        y="16.7"
        width="4.6"
        height="4.6"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="2.2"
      />
    </svg>
  );
}

/**
 * The mark with the name beside it. One component so the two never drift apart
 * in spacing or weight between the header and the sign-in page.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo className="size-[18px] text-accent" />
      <span className="text-[0.9375rem] font-semibold tracking-tight">PrepareBit</span>
    </span>
  );
}
