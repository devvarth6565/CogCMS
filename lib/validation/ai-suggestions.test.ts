import { describe, expect, it } from 'vitest';
import { AI_DRAFT_TEXT_LIMIT, AI_MIN_WORDS, aiSuggestionRequestSchema } from './ai-suggestions';

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
const parse = (body: unknown) => aiSuggestionRequestSchema.safeParse(body);

describe('aiSuggestionRequestSchema', () => {
  it('accepts a minimal request and fills optional fields', () => {
    const result = parse({ kind: 'titles', draft: { text: words(AI_MIN_WORDS.titles) } });
    expect(result.success).toBe(true);
    expect(result.data?.draft).toEqual({
      title: '',
      excerpt: '',
      text: words(AI_MIN_WORDS.titles),
      keywords: '',
      tags: [],
      faqQuestions: [],
    });
  });

  it('ignores fields it does not know, including a client-chosen site', () => {
    const result = parse({
      kind: 'titles',
      siteId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      draft: { text: words(40), siteId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('siteId');
    expect(result.data?.draft).not.toHaveProperty('siteId');
  });

  it('rejects unknown kinds', () => {
    expect(parse({ kind: 'keywords', draft: { text: words(200) } }).success).toBe(false);
  });

  it('requires enough article text for each kind', () => {
    for (const [kind, minimum] of Object.entries(AI_MIN_WORDS)) {
      expect(parse({ kind, draft: { text: words(minimum) } }).success).toBe(true);
      const short = parse({ kind, draft: { text: words(minimum - 1) } });
      expect(short.success).toBe(false);
      expect(short.error?.flatten().fieldErrors).toEqual({
        draft: [`Write at least ${minimum} words before generating suggestions`],
      });
    }
  });

  it('bounds the size of every field', () => {
    const base = { kind: 'titles', draft: { text: words(40) } };
    const withDraft = (draft: object) => parse({ ...base, draft: { ...base.draft, ...draft } });
    expect(withDraft({ text: 'a'.repeat(AI_DRAFT_TEXT_LIMIT + 1) }).success).toBe(false);
    expect(withDraft({ title: 't'.repeat(301) }).success).toBe(false);
    expect(withDraft({ tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) }).success).toBe(
      false,
    );
    expect(withDraft({ faqQuestions: ['q'.repeat(501)] }).success).toBe(false);
  });
});
