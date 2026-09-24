import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Walks up from the working directory to find the repository `.env`, so the API
 * behaves identically whether it is started from the repo root (`npm run dev`)
 * or from `apps/api`.
 */
function findEnvFile(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const envFile = findEnvFile(process.cwd());
if (envFile) loadDotenv({ path: envFile, quiet: true });

const httpUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, 'must be a valid http(s) URL');

/**
 * Not `z.coerce.boolean()`: that runs `Boolean(value)`, so the string "false"
 * parses as true and a disabled flag silently turns itself on.
 */
const envBoolean = z
  .enum(['true', 'false', '1', '0'], { message: 'must be one of: true, false, 1, 0' })
  .transform((value) => value === 'true' || value === '1')
  .optional();

const envSchema = z.object({
  // --- Required from Phase 1 -------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  WEB_ORIGIN: httpUrl.default('http://localhost:3000'),

  // Required by the HTTP server, not by the process as a whole. The batch entry
  // point touches neither a database nor a cookie, and Section 9 says it must
  // need "no setup beyond your documented install step" - so demanding a
  // MongoDB URI to run it would be a barrier for no reason. Enforced instead by
  // requireServerConfig(), at the point they are actually needed.
  MONGODB_URI: z.string().min(1).optional(),
  COOKIE_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),

  // --- Optional until the phase that uses them -------------------------------
  // Phase 5 (LLM layer). The provider is named here so no pipeline stage has to
  // know which one is behind the interface.
  LLM_PROVIDER: z.enum(['groq']).default('groq'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_PRIMARY_MODEL: z.string().default('openai/gpt-oss-120b'),
  GROQ_FAST_MODEL: z.string().default('openai/gpt-oss-20b'),
  LLM_CACHE: envBoolean,

  // Phase 4 (retrieval + public interview research)
  TAVILY_API_KEY: z.string().optional(),
  ALLOW_PRIVATE_URLS: envBoolean,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  console.error(
    `Invalid environment configuration:\n${issues}\n\nSee .env.example for the full list.`,
  );
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  llmCache: raw.LLM_CACHE ?? false,
  /**
   * The batch entry point is run against company sites served from a local
   * address (Section 9), while Section 11 requires private addresses to be
   * rejected in production. Default follows the environment; the explicit flag
   * wins when set.
   */
  allowPrivateUrls: raw.ALLOW_PRIVATE_URLS ?? raw.NODE_ENV !== 'production',
} as const;

export type Env = typeof env;

export interface ServerConfig {
  mongodbUri: string;
  cookieSecret: string;
}

/**
 * Fail-fast for the HTTP server, which genuinely cannot run without these.
 * Called at startup so a misconfiguration surfaces immediately rather than at
 * the first request.
 */
export function requireServerConfig(): ServerConfig {
  const missing: string[] = [];
  if (!env.MONGODB_URI) missing.push('  - MONGODB_URI is required to run the API server');
  if (!env.COOKIE_SECRET) {
    missing.push('  - COOKIE_SECRET is required to run the API server (at least 16 characters)');
  }

  if (missing.length > 0) {
    const detail = missing.join('\n');
    console.error(
      `Invalid environment configuration:\n${detail}\n\nSee .env.example for the full list.`,
    );
    process.exit(1);
  }

  return {
    mongodbUri: env.MONGODB_URI as string,
    cookieSecret: env.COOKIE_SECRET as string,
  };
}
