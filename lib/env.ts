import { z } from 'zod';

/** Optional string; empty or whitespace-only values count as unset. */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalPassword = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .min(12, { error: 'CMS_SEED_ADMIN_PASSWORD must be at least 12 characters' })
    .refine((value) => new TextEncoder().encode(value).byteLength <= 72, {
      error: 'CMS_SEED_ADMIN_PASSWORD must be at most 72 UTF-8 bytes',
    })
    .optional(),
);

const optionalEmail = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .pipe(z.email({ error: 'CMS_SEED_ADMIN_EMAIL must be an email address' }))
    .transform((value) => value.toLowerCase())
    .optional(),
);

const optionalHttpOrigin = z.preprocess(
  emptyToUndefined,
  z
    .url({ error: 'NEXT_PUBLIC_CMS_URL must be an absolute URL' })
    .transform((value, ctx) => {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', message: 'NEXT_PUBLIC_CMS_URL must use http or https' });
        return z.NEVER;
      }
      return url.origin;
    })
    .optional(),
);

const optionalS3PublicUrl = z.preprocess(
  emptyToUndefined,
  z
    .url({ error: 'S3_PUBLIC_URL must be an absolute URL' })
    .transform((value, ctx) => {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        (url.pathname !== '/' && url.pathname !== '') ||
        url.search ||
        url.hash
      ) {
        ctx.addIssue({ code: 'custom', message: 'S3_PUBLIC_URL must be an HTTP(S) origin' });
        return z.NEVER;
      }
      return url.origin;
    })
    .optional(),
);

function normalizeTrustedOrigin(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error('empty origin');

  if (candidate.includes('://')) {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('origin must use http or https');
    }
    if (
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      throw new Error('origin must not include credentials, a path, a query, or a fragment');
    }
    return url.host.toLowerCase();
  }

  if (
    candidate.includes('/') ||
    candidate.includes('@') ||
    candidate.includes('?') ||
    candidate.includes('#') ||
    candidate.includes('..')
  ) {
    throw new Error('origin must be a hostname with an optional port');
  }
  const hostname = candidate.toLowerCase();
  const hostnamePattern = /^(?:\*\.)?[a-z0-9.-]+(?::\d{1,5})?$/;
  const ipv6Pattern = /^\[[0-9a-f:]+\](?::\d{1,5})?$/;
  if (!hostnamePattern.test(hostname) && !ipv6Pattern.test(hostname)) {
    throw new Error('origin must be a hostname with an optional port');
  }
  return hostname;
}

/**
 * Next server actions expect hostnames (optionally with a port), not URL paths.
 * Accept URL-shaped values for operator convenience and normalise them here.
 */
export function parseTrustedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const origins = value.split(',').map((entry) => {
    try {
      return normalizeTrustedOrigin(entry);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid origin';
      throw new Error(`Invalid CMS_TRUSTED_ORIGINS entry "${entry.trim()}": ${reason}`);
    }
  });
  return [...new Set(origins)];
}

const trustedOrigins = z
  .string()
  .optional()
  .transform((value, ctx) => {
    try {
      return parseTrustedOrigins(value);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid CMS_TRUSTED_ORIGINS',
      });
      return z.NEVER;
    }
  });

const OPENROUTER_MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i;

/** Comma-separated OpenRouter model ids, tried in order; empty means the built-in default. */
const optionalOpenRouterModels = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(
          z.string().regex(OPENROUTER_MODEL_ID, {
            error: 'OPENROUTER_MODELS must list OpenRouter model ids, for example openrouter/free',
          }),
        )
        .min(1)
        .max(3, { error: 'OPENROUTER_MODELS accepts at most 3 model ids' }),
    )
    .optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3003),
  MONGODB_URI: z.string().trim().min(1, { error: 'MONGODB_URI is required' }),
  MONGODB_DB_NAME: z.string().trim().min(1).default('cognerd_cms'),
  CMS_JWT_SECRET: z.string().min(32, { error: 'CMS_JWT_SECRET must be at least 32 characters' }),
  CMS_SESSION_HOURS: z.coerce.number().int().positive().default(12),
  CMS_SESSION_REMEMBER_DAYS: z.coerce.number().int().positive().default(30),
  CMS_SEED_ADMIN_EMAIL: optionalEmail,
  CMS_SEED_ADMIN_PASSWORD: optionalPassword,
  CMS_SEED_ADMIN_NAME: optionalString,
  CMS_TRUSTED_ORIGINS: trustedOrigins,
  NEXT_PUBLIC_CMS_URL: optionalHttpOrigin,
  S3_REGION: optionalString,
  S3_BUCKET_NAME: optionalString,
  S3_PUBLIC_URL: optionalS3PublicUrl,
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_MODELS: optionalOpenRouterModels,
  SOURCE_MONGODB_URI: optionalString,
  RELEASE_NOTES_DIR: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}

let cached: Env | null = null;

/**
 * Validated environment, parsed once per process. Call it inside handlers and
 * connection code — never at module top level — so `next build` needs no secrets.
 */
export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Test hook: forget the cached environment. */
export function resetEnvCache(): void {
  cached = null;
}
