import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_DRAFT_TEXT_LIMIT } from '@/lib/validation/ai-suggestions';
import {
  AI_SUGGESTIONS_ENDPOINT,
  AiRequestError,
  buildAiDraft,
  fetchAiStatus,
  requestAiSuggestions,
  toAiRequestError,
} from './client';

const fetchMock = vi.fn<typeof fetch>();
const post = {
  title: '  A title  ',
  excerpt: 'A subtitle',
  keywords: ' seo ',
  tags: ['Guides', ' ', 'x'.repeat(80)],
  faqs: [{ question: 'Existing?' }, { question: '   ' }],
};

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('buildAiDraft', () => {
  it('trims fields, drops blanks and clamps to the request limits', () => {
    const draft = buildAiDraft(post, 'Body text');
    expect(draft).toEqual({
      title: 'A title',
      excerpt: 'A subtitle',
      keywords: 'seo',
      tags: ['Guides', 'x'.repeat(60)],
      faqQuestions: ['Existing?'],
      text: 'Body text',
    });
  });

  it('truncates long articles to the text limit', () => {
    const draft = buildAiDraft(post, 'word '.repeat(AI_DRAFT_TEXT_LIMIT));
    expect(draft.text.length).toBeLessThanOrEqual(AI_DRAFT_TEXT_LIMIT);
    expect(draft.text.endsWith('[Article truncated]')).toBe(true);
  });
});

describe('toAiRequestError', () => {
  it('explains session and site-access failures', () => {
    expect(toAiRequestError(401, null).message).toMatch(/session has expired/);
    expect(toAiRequestError(403, { code: 'SITE_FORBIDDEN' }).message).toMatch(/no longer/);
  });

  it('prefers the specific draft validation message', () => {
    const body = {
      code: 'VALIDATION_ERROR',
      error: 'Invalid suggestion request',
      details: {
        fieldErrors: { draft: ['Write at least 150 words before generating suggestions'] },
      },
    };
    expect(toAiRequestError(400, body).message).toBe(
      'Write at least 150 words before generating suggestions.',
    );
  });

  it('passes other server messages through, with a fallback', () => {
    expect(toAiRequestError(429, { error: 'Wait a minute.' }).message).toBe('Wait a minute.');
    expect(toAiRequestError(502, null).message).toMatch(/could not answer/);
  });
});

describe('requests', () => {
  it('posts the kind and draft and returns the suggestions', async () => {
    const result = { kind: 'titles', model: 'm', suggestions: ['A'] };
    fetchMock.mockResolvedValueOnce(Response.json(result));
    const draft = buildAiDraft(post, 'Body');
    await expect(requestAiSuggestions('titles', draft)).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(AI_SUGGESTIONS_ENDPOINT);
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
    expect(JSON.parse(String(init?.body))).toEqual({ kind: 'titles', draft });
  });

  it('turns error responses and network failures into AiRequestError', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Busy.' }, { status: 429 }));
    await expect(fetchAiStatus()).rejects.toThrow(new AiRequestError('Busy.'));

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchAiStatus()).rejects.toThrow(/Could not reach the server/);
  });

  it('lets a cancelled request reject as an abort, not as an error to show', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    const error = await fetchAiStatus(controller.signal).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(AiRequestError);
    expect((error as Error).name).toBe('AbortError');
  });
});
