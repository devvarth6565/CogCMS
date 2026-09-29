import { describe, expect, it } from 'vitest';
import type { ArticleAnalysis } from './article';
import { gradeFor, scoreAiReadiness, type ReadinessInput, type ReadinessReport } from './readiness';

const article = (overrides: Partial<ArticleAnalysis> = {}): ArticleAnalysis => ({
  text: '',
  wordCount: 900,
  headings: [
    { level: 2, text: 'Why' },
    { level: 2, text: 'How' },
  ],
  paragraphWords: [60, 80],
  lists: 1,
  tables: 0,
  links: 2,
  ...overrides,
});

const faq = (n: number) => ({ question: `Question ${n}?`, answer: `Answer ${n}.` });

/** A post that passes every check. */
function complete(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    title: 'How small teams plan a content calendar',
    metaTitle: '',
    metaDescription: 'm'.repeat(140),
    excerpt: 'A practical way to plan three months of posts in a single afternoon.',
    faqs: [faq(1), faq(2), faq(3)],
    keyTakeaways: ['One', 'Two', 'Three'],
    authorId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    article: article(),
    ...overrides,
  };
}

const check = (report: ReadinessReport, id: string) => {
  const found = report.checks.find((item) => item.id === id);
  if (!found) throw new Error(`No check ${id}`);
  return found;
};
const statusOf = (overrides: Partial<ReadinessInput>, id: string) =>
  check(scoreAiReadiness(complete(overrides)), id).status;

describe('scoreAiReadiness', () => {
  it('scores a complete post 100 and grades it ready', () => {
    const report = scoreAiReadiness(complete());
    expect(report.score).toBe(100);
    expect(report.grade).toBe('ready');
    expect(report.checks.every((item) => item.status === 'pass')).toBe(true);
  });

  it('uses weights that add up to 100', () => {
    const total = scoreAiReadiness(complete()).checks.reduce((sum, item) => sum + item.weight, 0);
    expect(total).toBe(100);
  });

  it('scores an empty draft 0 with every check failing', () => {
    const report = scoreAiReadiness({
      title: '',
      metaTitle: '',
      metaDescription: '',
      excerpt: '',
      faqs: [],
      keyTakeaways: [],
      authorId: null,
      article: article({ wordCount: 0, headings: [], paragraphWords: [], lists: 0, links: 0 }),
    });
    expect(report.score).toBe(0);
    expect(report.grade).toBe('not-ready');
    expect(report.checks.every((item) => item.status === 'fail')).toBe(true);
  });

  it('gives half the weight for a warning', () => {
    const report = scoreAiReadiness(complete({ metaDescription: 'm'.repeat(100) }));
    expect(check(report, 'meta-description')).toMatchObject({ status: 'warn', points: 7.5 });
    expect(report.score).toBe(93);
  });

  it('measures the meta title when set and falls back to the title', () => {
    expect(statusOf({ title: 't'.repeat(29) }, 'search-title')).toBe('warn');
    expect(statusOf({ title: 't'.repeat(30) }, 'search-title')).toBe('pass');
    expect(statusOf({ title: 't'.repeat(60) }, 'search-title')).toBe('pass');
    expect(statusOf({ title: 't'.repeat(61) }, 'search-title')).toBe('warn');
    expect(statusOf({ title: '  ' }, 'search-title')).toBe('fail');

    const withMeta = check(
      scoreAiReadiness(complete({ title: 't'.repeat(90), metaTitle: 'm'.repeat(45) })),
      'search-title',
    );
    expect(withMeta).toMatchObject({ status: 'pass', detail: 'Meta title: 45 characters.' });
  });

  it('expects a meta description of 120–160 characters', () => {
    expect(statusOf({ metaDescription: 'm'.repeat(119) }, 'meta-description')).toBe('warn');
    expect(statusOf({ metaDescription: 'm'.repeat(120) }, 'meta-description')).toBe('pass');
    expect(statusOf({ metaDescription: 'm'.repeat(160) }, 'meta-description')).toBe('pass');
    expect(statusOf({ metaDescription: 'm'.repeat(161) }, 'meta-description')).toBe('warn');
    expect(statusOf({ metaDescription: '   ' }, 'meta-description')).toBe('fail');
  });

  it('asks for a subtitle that summarises the post', () => {
    expect(statusOf({ excerpt: '' }, 'summary')).toBe('fail');
    expect(statusOf({ excerpt: 'Too short.' }, 'summary')).toBe('warn');
  });

  it('counts only complete FAQs and non-blank takeaways', () => {
    const faqs = check(
      scoreAiReadiness(complete({ faqs: [faq(1), { question: 'Blank answer?', answer: ' ' }] })),
      'faqs',
    );
    expect(faqs).toMatchObject({ status: 'warn', detail: '1 of 3 recommended.' });
    expect(statusOf({ faqs: [] }, 'faqs')).toBe('fail');
    expect(statusOf({ keyTakeaways: ['One', ' ', 'Two'] }, 'key-takeaways')).toBe('warn');
  });

  it('wants two or more section headings and no H1 in the body', () => {
    const h2 = { level: 2, text: 'Section' };
    expect(statusOf({ article: article({ headings: [h2] }) }, 'headings')).toBe('warn');
    expect(statusOf({ article: article({ headings: [] }) }, 'headings')).toBe('fail');
    const withH1 = article({ headings: [{ level: 1, text: 'Duplicate title' }, h2, h2] });
    expect(statusOf({ article: withH1 }, 'headings')).toBe('warn');
  });

  it('grades depth at 300 and 600 words', () => {
    const depth = (wordCount: number) => statusOf({ article: article({ wordCount }) }, 'depth');
    expect([299, 300, 599, 600].map(depth)).toEqual(['fail', 'warn', 'warn', 'pass']);
  });

  it('flags paragraphs over 120 words and a body without paragraphs', () => {
    const paragraphs = (paragraphWords: number[]) =>
      statusOf({ article: article({ paragraphWords }) }, 'paragraphs');
    expect(paragraphs([120, 40])).toBe('pass');
    expect(paragraphs([121])).toBe('warn');
    expect(paragraphs([])).toBe('fail');
  });

  it('accepts a table instead of a list, and needs links and an author', () => {
    const tableOnly = check(
      scoreAiReadiness(complete({ article: article({ lists: 0, tables: 1 }) })),
      'structure',
    );
    expect(tableOnly).toMatchObject({ status: 'pass', detail: '1 table.' });
    expect(statusOf({ article: article({ lists: 0 }) }, 'structure')).toBe('fail');
    expect(statusOf({ article: article({ links: 0 }) }, 'sources')).toBe('fail');
    expect(statusOf({ authorId: null }, 'author')).toBe('fail');
  });

  it('links only the checks the assistant can fix to a suggestion type', () => {
    const fixes = Object.fromEntries(
      scoreAiReadiness(complete())
        .checks.filter((item) => item.fix)
        .map((item) => [item.id, item.fix]),
    );
    expect(fixes).toEqual({
      'search-title': 'titles',
      'meta-description': 'metaDescriptions',
      faqs: 'faqs',
    });
  });
});

describe('gradeFor', () => {
  it('draws the grade boundaries at 50 and 80', () => {
    expect([49, 50, 79, 80].map(gradeFor)).toEqual([
      'not-ready',
      'needs-work',
      'needs-work',
      'ready',
    ]);
  });
});
