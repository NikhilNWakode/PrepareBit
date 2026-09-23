/**
 * Deliberately tiny. Structured enough that a pipeline stage can be traced
 * (`[kit:abc123] stage=company_research duration=1840ms`) without pulling in a
 * logging framework this project does not need.
 */

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const suffix = context
    ? ' ' +
      Object.entries(context)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')
    : '';
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}`;

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
