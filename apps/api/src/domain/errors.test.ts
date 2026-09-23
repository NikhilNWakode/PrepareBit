import { describe, expect, it } from 'vitest';

import { AppError } from './errors.js';

describe('AppError', () => {
  it('carries the code and status the HTTP layer will respond with', () => {
    const error = AppError.validationFailed('days must be a positive integer');

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('days must be a positive integer');
  });

  it('defaults a not-found to 404', () => {
    expect(AppError.notFound().statusCode).toBe(404);
    expect(AppError.notFound().code).toBe('NOT_FOUND');
  });
});
