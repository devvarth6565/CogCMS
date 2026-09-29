import { describe, it, expect } from 'vitest';
import {
  aiNotConfigured,
  aiUnavailable,
  HttpError,
  noSiteSelected,
  notFound,
  rateLimited,
  siteForbidden,
  toErrorResponse,
  unauthorized,
  validationError,
} from './errors';

async function read(res: Response) {
  return { status: res.status, json: await res.json() };
}

describe('toErrorResponse', () => {
  it('maps a validation HttpError to 400 with its details', async () => {
    const r = await read(toErrorResponse(validationError({ fieldErrors: { title: ['Required'] } })));
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('VALIDATION_ERROR');
    expect(r.json.details.fieldErrors.title).toEqual(['Required']);
  });

  it('maps unauthorized to 401 and notFound to 404 with the entity name', async () => {
    expect((await read(toErrorResponse(unauthorized()))).status).toBe(401);
    const nf = await read(toErrorResponse(notFound('Blog')));
    expect(nf.status).toBe(404);
    expect(nf.json).toEqual({ error: 'Blog not found', code: 'NOT_FOUND', details: null });
  });

  it('maps a Mongo duplicate-slug error to 409 DUPLICATE_SLUG', async () => {
    const r = await read(toErrorResponse({ code: 11000, keyPattern: { slug: 1 } }));
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('DUPLICATE_SLUG');
  });

  it('maps a Mongo duplicate on another field to 409 CONFLICT', async () => {
    const r = await read(toErrorResponse({ code: 11000, keyPattern: { email: 1 } }));
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('CONFLICT');
    expect(r.json.details).toEqual({ email: 1 });
  });

  it('maps anything else to 500 INTERNAL_ERROR with details null', async () => {
    const r = await read(toErrorResponse(new Error('boom')));
    expect(r.status).toBe(500);
    expect(r.json.code).toBe('INTERNAL_ERROR');
    expect(r.json.details).toBeNull();
  });

  it('maps site selection errors to their canonical statuses and codes', async () => {
    expect(await read(toErrorResponse(noSiteSelected()))).toEqual({
      status: 400,
      json: { error: 'No site selected', code: 'NO_SITE_SELECTED', details: null },
    });
    expect(await read(toErrorResponse(siteForbidden()))).toEqual({
      status: 403,
      json: { error: 'Site access forbidden', code: 'SITE_FORBIDDEN', details: null },
    });
  });

  it('maps rate limits to 429 with a Retry-After header', async () => {
    const response = toErrorResponse(rateLimited(61.2));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('62');
    expect(await response.json()).toEqual({
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      details: { retryAfter: 61.2 },
    });
  });

  it('maps AI assistant failures without reusing the session statuses', async () => {
    expect(await read(toErrorResponse(aiNotConfigured()))).toEqual({
      status: 503,
      json: {
        error: 'AI suggestions are not configured on this installation',
        code: 'AI_NOT_CONFIGURED',
        details: null,
      },
    });
    expect((await read(toErrorResponse(aiUnavailable('Try again.')))).status).toBe(502);
    expect(await read(toErrorResponse(aiUnavailable('Too slow.', 504)))).toEqual({
      status: 504,
      json: { error: 'Too slow.', code: 'AI_UNAVAILABLE', details: null },
    });
  });

  it('HttpError carries status, code and name', () => {
    const e = new HttpError(418, 'INTERNAL_ERROR', 'teapot');
    expect(e.status).toBe(418);
    expect(e.code).toBe('INTERNAL_ERROR');
    expect(e.name).toBe('HttpError');
    expect(e).toBeInstanceOf(Error);
  });
});
