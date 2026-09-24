import { z } from 'zod';

/**
 * The brief allows a 1-day schedule and a 60-day one, and both are tested. The
 * bound is here rather than only in the UI, because the UI is not the boundary.
 */
export const MIN_DAYS = 1;
export const MAX_DAYS = 60;

/** A pasted posting. Long enough to contain something; bounded to stay affordable. */
const jobDescription = z
  .string()
  .trim()
  .min(20, 'Paste the job description — a few words is not enough to work from.')
  .max(50_000, 'That job description is too long to process.');

const companyUrl = z
  .string()
  .trim()
  .min(1, 'Enter the company website address.')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Enter a full website address, including https://');

const days = z.coerce
  .number({ message: 'Enter how many days you have.' })
  .int('Enter a whole number of days.')
  .min(MIN_DAYS, `Enter at least ${MIN_DAYS} day.`)
  .max(MAX_DAYS, `Enter at most ${MAX_DAYS} days.`);

export const createKitSchema = z.object({
  jd: jobDescription,
  company_url: companyUrl,
  days,
});

export type CreateKitBody = z.infer<typeof createKitSchema>;
