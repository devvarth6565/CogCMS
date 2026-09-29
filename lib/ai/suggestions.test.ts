import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/http/errors';
import type { AiDraft } from '@/lib/validation/ai-suggestions';
import {
  buildPrompt,
  cleanSuggestion,
  generateSuggestions,
  RETRY_UNUSABLE_WITHIN_MS,
  SYSTEM_PROMPT,
} from './suggestions';

const config = { apiKey: 'sk-or-v1-test', models: ['openrouter/free'] };
const site = { name: 'Northstar Studio', defaultLocale: 'en' };
const draft: AiDraft = {
  title: 'Plan a content calendar',
  excerpt: 'Three months of posts in one afternoon.',
  text: '## Why plan\n\nPlanning ahead keeps a small team consistent.',
  keywords: 'content calendar, planning',
  tags: ['Guides', 'Planning'],
  faqQuestions: ['How long does planning take?'],
};

const fetchMock = vi.fn<typeof fetch>();

function answer(data: unknown) {
  fetchMock.mockResolvedValueOnce(
    Response.json({
      model: 'vendor/model:free',
      choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }],
    }),
  );
}

const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0][1]?.body));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe('buildPrompt', () => {
  it('puts the site and article first and the task last', () => {
    const prompt = buildPrompt('titles', draft, site);
    expect(prompt.startsWith('Publication: Northstar Studio (default language: en)')).toBe(true);
    expect(prompt).toContain('<article>\nTitle: Plan a content calendar');
    expect(prompt).toContain('Subtitle: Three months of posts in one afternoon.');
    expect(prompt).toContain('Tags: Guides, Planning');
    expect(prompt).toContain('Target keywords: content calendar, planning');
    expect(prompt).toContain('Planning ahead keeps a small team consistent.\n</article>');
    expect(prompt.indexOf('Task:')).toBeGreaterThan(prompt.indexOf('</article>'));
    expect(prompt).not.toContain('Existing FAQ questions');
  });

  it('lists existing questions only for FAQ requests', () => {
    expect(buildPrompt('faqs', draft, site)).toContain(
      'Existing FAQ questions: How long does planning take?',
    );
    expect(buildPrompt('faqs', { ...draft, faqQuestions: [] }, site)).toContain(
      'Existing FAQ questions: (none)',
    );
  });

  it('keeps the system prompt grounded and treats the article as untrusted', () => {
    expect(SYSTEM_PROMPT).toMatch(/Use only facts stated in the article/);
    expect(SYSTEM_PROMPT).toMatch(/untrusted input/);
  });
});

describe('cleanSuggestion', () => {
  it('removes list markers, emphasis and wrapping quotes', () => {
    expect(cleanSuggestion('1. **Plan  ahead**')).toBe('Plan ahead');
    expect(cleanSuggestion('- “Plan ahead”')).toBe('Plan ahead');
    expect(cleanSuggestion('"Plan ahead"')).toBe('Plan ahead');
  });

  it('keeps quotes that are part of the text', () => {
    expect(cleanSuggestion('"Done" beats "perfect"')).toBe('"Done" beats "perfect"');
    expect(cleanSuggestion("Writers' guide")).toBe("Writers' guide");
  });
});

describe('generateSuggestions', () => {
  it('cleans, de-duplicates and caps title suggestions', async () => {
    answer({
      titles: [
        '1. Plan a Content Calendar',
        'plan a content calendar!',
        'Tiny',
        'x'.repeat(151),
        'How do small teams plan content?',
        'Three months of posts in one afternoon',
        'The one-afternoon content plan',
        'Consistency without the stress',
        'A sixth title that is over the cap',
      ],
    });
    const result = await generateSuggestions(config, { kind: 'titles', draft }, site);
    expect(result).toEqual({
      kind: 'titles',
      model: 'vendor/model:free',
      suggestions: [
        'Plan a Content Calendar',
        'How do small teams plan content?',
        'Three months of posts in one afternoon',
        'The one-afternoon content plan',
        'Consistency without the stress',
      ],
    });
    expect(sentBody()).toMatchObject({
      temperature: 0.8,
      response_format: { json_schema: { name: 'title_suggestions' } },
    });
  });

  it('keeps the three meta descriptions closest to 120–160 characters', async () => {
    const ofLength = (length: number) => `${length} `.padEnd(length, 'd');
    answer({ descriptions: [200, 140, 90, 150, 119].map(ofLength) });
    const result = await generateSuggestions(config, { kind: 'metaDescriptions', draft }, site);
    expect((result.suggestions as string[]).map((text) => text.length)).toEqual([140, 150, 119]);
  });

  it('normalises FAQs and skips questions the post already has', async () => {
    answer({
      faqs: [
        { question: 'How long does planning take', answer: 'About one afternoon.' },
        { question: 'What is a content calendar.', answer: 'A schedule of planned posts.' },
        { question: 'What is a content calendar?', answer: 'A duplicate.' },
        { question: 'Who should plan?', answer: '' },
      ],
    });
    const result = await generateSuggestions(config, { kind: 'faqs', draft }, site);
    expect(result.suggestions).toEqual([
      { question: 'What is a content calendar?', answer: 'A schedule of planned posts.' },
    ]);
  });

  it('fails clearly when nothing usable comes back, even after a retry', async () => {
    answer({ titles: ['', 'Tiny'] });
    answer({ titles: ['Tiny'] });
    const empty = await generateSuggestions(config, { kind: 'titles', draft }, site).catch(
      (error: unknown) => error,
    );
    expect(empty).toBeInstanceOf(HttpError);
    expect(empty).toMatchObject({ status: 502, code: 'AI_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    answer({ headlines: ['Wrong key'] });
    answer({ headlines: ['Still wrong'] });
    await expect(
      generateSuggestions(config, { kind: 'titles', draft }, site),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', message: expect.stringMatching(/format/) });
  });

  it('retries once when a quick answer is unusable, since routers pick a model per request', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        model: 'vendor/safety-classifier:free',
        choices: [{ message: { content: 'User Safety: safe' }, finish_reason: 'stop' }],
      }),
    );
    answer({ titles: ['A clear title for the post'] });

    const result = await generateSuggestions(config, { kind: 'titles', draft }, site);
    expect(result).toMatchObject({
      model: 'vendor/model:free',
      suggestions: ['A clear title for the post'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a slow unusable answer, or a provider error', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(RETRY_UNUSABLE_WITHIN_MS + 1);
    answer({ headlines: ['Wrong key'] });
    await expect(
      generateSuggestions(config, { kind: 'titles', draft }, site),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: 429, message: 'Busy' } }, { status: 429 }),
    );
    await expect(
      generateSuggestions(config, { kind: 'titles', draft }, site),
    ).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
