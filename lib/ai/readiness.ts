import type { ArticleAnalysis } from '@/lib/ai/article';
import type { AiSuggestionKind } from '@/lib/validation/ai-suggestions';

export type ReadinessStatus = 'pass' | 'warn' | 'fail';
export type ReadinessGrade = 'ready' | 'needs-work' | 'not-ready';

export interface ReadinessInput {
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  faqs: Array<{ question: string; answer: string }>;
  keyTakeaways: string[];
  authorId: string | null;
  article: ArticleAnalysis;
}

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  /** What was measured, then what to do about it. */
  detail: string;
  weight: number;
  points: number;
  /** The assistant task that can fix this check, when there is one. */
  fix?: AiSuggestionKind;
}

export interface ReadinessReport {
  score: number;
  grade: ReadinessGrade;
  checks: ReadinessCheck[];
}

export const SEARCH_TITLE_RANGE = { min: 30, max: 60 };
export const META_DESCRIPTION_RANGE = { min: 120, max: 160 };
const SUMMARY_MIN_CHARS = 50;
const RECOMMENDED_COUNT = 3;
const DEPTH_WORDS = { warn: 300, pass: 600 };
const LONG_PARAGRAPH_WORDS = 120;

type Finding = { status: ReadinessStatus; detail: string };
type Definition = {
  id: string;
  label: string;
  weight: number;
  fix?: AiSuggestionKind;
  evaluate: (input: ReadinessInput) => Finding;
};

const pass = (detail: string): Finding => ({ status: 'pass', detail });
const warn = (detail: string): Finding => ({ status: 'warn', detail });
const fail = (detail: string): Finding => ({ status: 'fail', detail });
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function countCheck(count: number, noun: string, missing: string, passed: string): Finding {
  if (count >= RECOMMENDED_COUNT) return pass(`${plural(count, noun)}${passed}`);
  if (count > 0) return warn(`${count} of ${RECOMMENDED_COUNT} recommended.`);
  return fail(missing);
}

/**
 * Signals that help answer engines (ChatGPT, Perplexity, Gemini, Google AI Overviews)
 * understand, quote and cite a post. Every check can be fixed in the editor, and the
 * weights add up to 100.
 */
const CHECKS: Definition[] = [
  {
    id: 'search-title',
    label: 'Search title',
    weight: 10,
    fix: 'titles',
    evaluate: ({ title, metaTitle }) => {
      const value = metaTitle.trim() || title.trim();
      if (!value) return fail('Add a title.');
      const source = metaTitle.trim() ? 'Meta title' : 'Title (no meta title set)';
      const { min, max } = SEARCH_TITLE_RANGE;
      if (value.length >= min && value.length <= max) {
        return pass(`${source}: ${value.length} characters.`);
      }
      return warn(
        `${source}: ${value.length} characters. Aim for ${min}–${max} so results show it in full.`,
      );
    },
  },
  {
    id: 'meta-description',
    label: 'Meta description',
    weight: 15,
    fix: 'metaDescriptions',
    evaluate: ({ metaDescription }) => {
      const length = metaDescription.trim().length;
      if (!length) return fail('Missing. Search results and answer engines use it as the summary.');
      const { min, max } = META_DESCRIPTION_RANGE;
      if (length >= min && length <= max) return pass(`${length} characters.`);
      return warn(`${length} characters. Aim for ${min}–${max}.`);
    },
  },
  {
    id: 'summary',
    label: 'Summary up front',
    weight: 10,
    evaluate: ({ excerpt }) => {
      const length = excerpt.trim().length;
      if (!length) {
        return fail('Add a subtitle that answers the main question in a sentence or two.');
      }
      if (length < SUMMARY_MIN_CHARS) {
        return warn('Expand the subtitle into a one- or two-sentence answer.');
      }
      return pass('The subtitle summarises the post.');
    },
  },
  {
    id: 'key-takeaways',
    label: 'Key takeaways',
    weight: 10,
    evaluate: ({ keyTakeaways }) =>
      countCheck(
        keyTakeaways.filter((takeaway) => takeaway.trim()).length,
        'takeaway',
        'Add 3–5 takeaways under Structured content. Answer engines often quote summary bullets.',
        '.',
      ),
  },
  {
    id: 'faqs',
    label: 'FAQs',
    weight: 15,
    fix: 'faqs',
    evaluate: ({ faqs }) =>
      countCheck(
        faqs.filter((faq) => faq.question.trim() && faq.answer.trim()).length,
        'question',
        'Add at least 3 questions with answers. They are published as FAQPage structured data.',
        ', published as FAQPage structured data.',
      ),
  },
  {
    id: 'headings',
    label: 'Section headings',
    weight: 10,
    evaluate: ({ article }) => {
      const sections = article.headings.filter((heading) => heading.level > 1).length;
      if (article.headings.some((heading) => heading.level === 1)) {
        return warn("Change H1 headings in the body to H2. The title is already the page's H1.");
      }
      if (sections >= 2) return pass(`${plural(sections, 'section heading')}.`);
      if (sections === 1) {
        return warn('1 section heading. Add H2s so each part can be quoted on its own.');
      }
      return fail('Add H2 headings to split the post into sections.');
    },
  },
  {
    id: 'depth',
    label: 'Depth',
    weight: 10,
    evaluate: ({ article: { wordCount } }) => {
      if (wordCount >= DEPTH_WORDS.pass) return pass(`${plural(wordCount, 'word')}.`);
      const advice = `Aim for ${DEPTH_WORDS.pass}+ so answer engines have more to cite.`;
      if (wordCount >= DEPTH_WORDS.warn) return warn(`${plural(wordCount, 'word')}. ${advice}`);
      return fail(`${plural(wordCount, 'word')}. ${advice}`);
    },
  },
  {
    id: 'structure',
    label: 'Lists or tables',
    weight: 5,
    evaluate: ({ article: { lists, tables } }) => {
      if (lists + tables === 0) {
        return fail(
          'Add a list, numbered steps or a table. Structured passages are easy to extract.',
        );
      }
      const parts = [lists && plural(lists, 'list'), tables && plural(tables, 'table')];
      return pass(`${parts.filter(Boolean).join(', ')}.`);
    },
  },
  {
    id: 'paragraphs',
    label: 'Short paragraphs',
    weight: 5,
    evaluate: ({ article: { paragraphWords } }) => {
      if (paragraphWords.length === 0) return fail('Write the body in paragraphs.');
      const longest = Math.max(...paragraphWords);
      if (longest <= LONG_PARAGRAPH_WORDS) {
        return pass(`Longest paragraph: ${plural(longest, 'word')}.`);
      }
      return warn(
        `Longest paragraph: ${longest} words. Split paragraphs over ${LONG_PARAGRAPH_WORDS} words.`,
      );
    },
  },
  {
    id: 'sources',
    label: 'Links to sources',
    weight: 5,
    evaluate: ({ article: { links } }) =>
      links > 0
        ? pass(`${plural(links, 'link')}.`)
        : fail('Link to at least one source that backs up your claims.'),
  },
  {
    id: 'author',
    label: 'Named author',
    weight: 5,
    evaluate: ({ authorId }) =>
      authorId ? pass('Author set.') : fail('Choose an author. A named author is a trust signal.'),
  },
];

const POINTS: Record<ReadinessStatus, number> = { pass: 1, warn: 0.5, fail: 0 };

export function gradeFor(score: number): ReadinessGrade {
  if (score >= 80) return 'ready';
  if (score >= 50) return 'needs-work';
  return 'not-ready';
}

/** Deterministic and instant: it runs as the editor types and needs no AI request. */
export function scoreAiReadiness(input: ReadinessInput): ReadinessReport {
  const checks = CHECKS.map(({ evaluate, ...definition }) => {
    const finding = evaluate(input);
    return { ...definition, ...finding, points: definition.weight * POINTS[finding.status] };
  });
  const score = Math.round(checks.reduce((total, check) => total + check.points, 0));
  return { score, grade: gradeFor(score), checks };
}
