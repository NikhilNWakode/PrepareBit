import type { ErrorCode } from '@prep/shared';

/**
 * The only error type the HTTP layer treats as intentional. Anything else that
 * reaches the error handler is a bug and is reported as INTERNAL_ERROR with its
 * detail kept server-side.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static notFound(message = 'Resource not found.'): AppError {
    return new AppError('NOT_FOUND', message, 404);
  }

  static validationFailed(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_FAILED', message, 400, details);
  }
}
