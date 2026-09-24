/**
 * Dates as a person would say them.
 *
 * All derived from what the kit already records — when it was made and how
 * many days the user said they had — so nothing here invents a fact about the
 * interview that was not given.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "4 min ago", "yesterday". Used for when a kit last changed. */
export function timeAgo(value: string, now: Date = new Date()): string {
  const elapsed = now.getTime() - new Date(value).getTime();

  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} min ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(elapsed / DAY);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  return formatDate(value);
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Just the day and month, for a column where the year is noise. */
export function formatShortDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The interview date, taken from when the kit was made plus the number of days
 * the user said they had. It is the only date in the system, so the schedule
 * and the countdown cannot disagree.
 */
export function interviewDate(createdAt: string, days: number): Date {
  const date = new Date(createdAt);
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * How long is left, counted in whole days from the start of today so that the
 * number changes at midnight rather than at the hour the kit happened to be
 * created.
 */
export function daysUntil(date: Date, now: Date = new Date()): number {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  return Math.round((startOfTarget.getTime() - startOfToday.getTime()) / DAY);
}

/** The countdown as a phrase, including the cases where it has run out. */
export function countdown(createdAt: string, days: number, now: Date = new Date()): string {
  const remaining = daysUntil(interviewDate(createdAt, days), now);

  if (remaining < 0) return 'Interview date has passed';
  if (remaining === 0) return 'Interview today';
  if (remaining === 1) return 'Interview tomorrow';

  return `${remaining} days until interview`;
}

/** "45 min", "1 hr 15 min" — study durations, which are always whole minutes. */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
