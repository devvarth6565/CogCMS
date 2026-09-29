import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/admin/ai/suggestions/route';
import { DEFAULT_AI_MODELS, OPENROUTER_CHAT_URL } from '@/lib/ai/openrouter';
import { resetEnvCache } from '@/lib/env';
import type { ISite } from '@/models/Site';
import type { IUser } from '@/models/User';
import { authenticatedRequest, createTestSite, createTestUser } from '@/tests/setup/factories';

const URL = 'http://localhost:3003/api/admin/ai/suggestions';
const API_KEY = 'sk-or-v1-integration-secret';
const rootContext = { params: Promise.resolve({}) };
const fetchMock = vi.fn<typeof fetch>();

const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
const titlesRequest = { kind: 'titles', draft: { title: 'Draft title', text } };

function providerAnswers(data: unknown) {
  fetchMock.mockResolvedValueOnce(
    Response.json({
      model: 'vendor/model:free',
      choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }],
    }),
  );
}

async function post(user: IUser, site: ISite, json: unknown, headers?: Record<string, string>) {
  const request = await authenticatedRequest(URL, {
    user,
    method: 'POST',
    siteId: site._id.toString(),
    json,
    headers,
  });
  const response = await POST(request, rootContext);
  return { response, body: await response.json() };
}

const sentPrompt = () =>
  JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[1].content as string;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = API_KEY;
  delete process.env.OPENROUTER_MODELS;
  resetEnvCache();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  resetEnvCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe('GET /api/admin/ai/suggestions', () => {
  it('tells the editor whether suggestions are available without calling the provider', async () => {
    const user = await createTestUser();
    const status = async () => {
      const response = await GET(await authenticatedRequest(URL, { user }), rootContext);
      return response.json();
    };
    expect(await status()).toEqual({ enabled: true, models: DEFAULT_AI_MODELS });

    delete process.env.OPENROUTER_API_KEY;
    resetEnvCache();
    expect(await status()).toEqual({ enabled: false, models: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/ai/suggestions', () => {
  it('returns suggestions written for the server-resolved site', async () => {
    const site = await createTestSite({ name: 'Northstar Test' });
    const editor = await createTestUser({ role: 'editor', siteIds: [site._id.toString()] });
    providerAnswers({ titles: ['A clear title for the post'] });

    const { response, body } = await post(editor, site, {
      ...titlesRequest,
      // Client-supplied site hints are ignored; the session's site is used.
      siteId: '0123456789abcdef01234567',
      site: { name: 'Someone else' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      kind: 'titles',
      model: 'vendor/model:free',
      suggestions: ['A clear title for the post'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(OPENROUTER_CHAT_URL);
    expect(sentPrompt()).toContain('Publication: Northstar Test');
    expect(sentPrompt()).toContain(text);
    expect(sentPrompt()).not.toContain('Someone else');
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });

  it('refuses another site before contacting the provider', async () => {
    const own = await createTestSite();
    const other = await createTestSite();
    const editor = await createTestUser({ role: 'editor', siteIds: [own._id.toString()] });

    const { response, body } = await post(editor, other, titlesRequest);
    expect(response.status).toBe(403);
    expect(body.code).toBe('SITE_FORBIDDEN');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-origin posts before contacting the provider', async () => {
    const site = await createTestSite();
    const admin = await createTestUser();
    const { response } = await post(admin, site, titlesRequest, {
      origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing key as AI_NOT_CONFIGURED', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvCache();
    const site = await createTestSite();
    const { response, body } = await post(await createTestUser(), site, titlesRequest);
    expect(response.status).toBe(503);
    expect(body.code).toBe('AI_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates the request before contacting the provider', async () => {
    const site = await createTestSite();
    const admin = await createTestUser();

    const unknownKind = await post(admin, site, { kind: 'keywords', draft: { text } });
    expect(unknownKind.response.status).toBe(400);
    expect(unknownKind.body.code).toBe('VALIDATION_ERROR');

    const tooShort = await post(admin, site, { kind: 'faqs', draft: { text } });
    expect(tooShort.response.status).toBe(400);
    expect(tooShort.body.details.fieldErrors.draft[0]).toMatch(/at least 150 words/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes provider rate limits on, but never a provider 401', async () => {
    const site = await createTestSite();
    const admin = await createTestUser();

    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: { code: 429, message: 'Rate limited' } },
        { status: 429, headers: { 'Retry-After': '20' } },
      ),
    );
    const limited = await post(admin, site, titlesRequest);
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get('retry-after')).toBe('20');
    expect(limited.body.code).toBe('RATE_LIMITED');

    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: 401, message: 'Invalid key' } }, { status: 401 }),
    );
    const badKey = await post(admin, site, titlesRequest);
    expect(badKey.response.status).toBe(502);
    expect(badKey.body.code).toBe('AI_UNAVAILABLE');
  });
});
