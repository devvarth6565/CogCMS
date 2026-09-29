import { NextResponse } from 'next/server';

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'FORBIDDEN_SCOPE'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'DUPLICATE_SLUG'
  | 'CONFLICT'
  | 'NO_SITE_SELECTED'
  | 'SITE_FORBIDDEN'
  | 'RATE_LIMITED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export type ErrorBody = { error: string; code: ErrorCode; details: unknown };

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');
export const forbidden = () => new HttpError(403, 'FORBIDDEN', 'Forbidden');
export const forbiddenScope = () =>
  new HttpError(403, 'FORBIDDEN_SCOPE', 'API key lacks the required scope');
export const noSiteSelected = () => new HttpError(400, 'NO_SITE_SELECTED', 'No site selected');
export const siteForbidden = () => new HttpError(403, 'SITE_FORBIDDEN', 'Site access forbidden');
export const rateLimited = (retryAfter: number) =>
  new HttpError(429, 'RATE_LIMITED', 'Too many requests', { retryAfter });
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const validationError = (details: unknown, message = 'Invalid payload') =>
  new HttpError(400, 'VALIDATION_ERROR', message, details);
export const aiNotConfigured = () =>
  new HttpError(503, 'AI_NOT_CONFIGURED', 'AI suggestions are not configured on this installation');
/** The AI provider failed; never forwards the provider's own status (a 401 would end the session). */
export const aiUnavailable = (message: string, status: 502 | 504 = 502) =>
  new HttpError(status, 'AI_UNAVAILABLE', message);

type MongoDuplicateKey = { code: 11000; keyPattern?: Record<string, unknown> };

function isDuplicateKey(err: unknown): err is MongoDuplicateKey {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function json(status: number, body: ErrorBody): NextResponse<ErrorBody> {
  return NextResponse.json(body, { status });
}

function retryAfter(details: unknown): number | null {
  if (typeof details !== 'object' || details === null || !('retryAfter' in details)) return null;
  const value = (details as { retryAfter?: unknown }).retryAfter;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

/** Maps anything thrown inside a handler to the {error, code, details} envelope. */
export function toErrorResponse(err: unknown): NextResponse<ErrorBody> {
  if (err instanceof HttpError) {
    const response = json(err.status, {
      error: err.message,
      code: err.code,
      details: err.details ?? null,
    });
    if (err.code === 'RATE_LIMITED') {
      const seconds = retryAfter(err.details);
      if (seconds) response.headers.set('Retry-After', String(seconds));
    }
    return response;
  }
  if (isDuplicateKey(err)) {
    const keyPattern = err.keyPattern ?? {};
    if ('slug' in keyPattern) {
      return json(409, {
        error: 'A document with this slug already exists.',
        code: 'DUPLICATE_SLUG',
        details: null,
      });
    }
    return json(409, { error: 'Duplicate value.', code: 'CONFLICT', details: keyPattern });
  }
  console.error('[cms] unhandled error', err);
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal error'
      : err instanceof Error
        ? err.message
        : String(err);
  return json(500, { error: message, code: 'INTERNAL_ERROR', details: null });
}
