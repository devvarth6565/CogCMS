import { z } from 'zod';
import { countWords } from '@/lib/ai/text';

export const AI_SUGGESTION_KINDS = ['titles', 'metaDescriptions', 'faqs'] as const;
export type AiSuggestionKind = (typeof AI_SUGGESTION_KINDS)[number];

/** Article characters sent to the model (about 5k tokens); the editor truncates longer drafts. */
export const AI_DRAFT_TEXT_LIMIT = 20_000;

/** Below these lengths a model has too little to work from and starts inventing content. */
export const AI_MIN_WORDS: Record<AiSuggestionKind, number> = {
  titles: 30,
  metaDescriptions: 50,
  faqs: 150,
};

const text = (max: number) => z.string().trim().max(max);

/** The unsaved editor state the assistant works from, as plain text rather than editor HTML. */
export const aiDraftSchema = z
  .object({
    title: text(300).default(''),
    excerpt: text(1000).default(''),
    text: z.string().max(AI_DRAFT_TEXT_LIMIT),
    keywords: text(500).default(''),
    tags: z.array(text(60)).max(20).default([]),
    faqQuestions: z.array(text(500)).max(50).default([]),
  })
  .strip();

export const aiSuggestionRequestSchema = z
  .object({
    kind: z.enum(AI_SUGGESTION_KINDS),
    draft: aiDraftSchema,
  })
  .strip()
  .superRefine(({ kind, draft }, ctx) => {
    const required = AI_MIN_WORDS[kind];
    if (countWords(draft.text) < required) {
      ctx.addIssue({
        code: 'custom',
        path: ['draft'],
        message: `Write at least ${required} words before generating suggestions`,
      });
    }
  });

export type AiDraft = z.infer<typeof aiDraftSchema>;
export type AiSuggestionRequest = z.infer<typeof aiSuggestionRequestSchema>;
