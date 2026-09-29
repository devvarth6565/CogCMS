import type { AiSuggestionResult } from '@/lib/ai/suggestions';
import { truncateText } from '@/lib/ai/text';
import {
  AI_DRAFT_TEXT_LIMIT,
  type AiDraft,
  type AiSuggestionKind,
} from '@/lib/validation/ai-suggestions';

export const AI_SUGGESTIONS_ENDPOINT = '/api/admin/ai/suggestions';

export type AiStatus = { enabled: boolean; models: string[] };
export type AiResultFor<K extends AiSuggestionKind> = Extract<AiSuggestionResult, { kind: K }>;

export class AiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiRequestError';
  }
}

type DraftSource = {
  title: string;
  excerpt: string;
  keywords: string;
  tags: string[];
  faqs: Array<{ question: string }>;
};

/** Clamps editor state to the request limits so a long field never costs the editor a 400. */
export function buildAiDraft(post: DraftSource, articleText: string): AiDraft {
  const clean = (values: string[], max: number, length: number) =>
    values
      .map((value) => value.trim().slice(0, length))
      .filter(Boolean)
      .slice(0, max);
  return {
    title: post.title.trim().slice(0, 300),
    excerpt: post.excerpt.trim().slice(0, 1000),
    keywords: post.keywords.trim().slice(0, 500),
    tags: clean(post.tags, 20, 60),
    faqQuestions: clean(
      post.faqs.map((faq) => faq.question),
      50,
      500,
    ),
    text: truncateText(articleText, AI_DRAFT_TEXT_LIMIT),
  };
}

type ErrorBody = { error?: unknown; code?: unknown; details?: unknown } | null;

/** Turns an error response into a message an editor can act on. */
export function toAiRequestError(status: number, body: ErrorBody): AiRequestError {
  if (status === 401) return new AiRequestError('Your session has expired. Sign in again.');
  if (status === 403) {
    return new AiRequestError('You no longer have access to this site. Reload the page.');
  }
  if (body?.code === 'VALIDATION_ERROR') {
    const draftErrors = (body.details as { fieldErrors?: { draft?: unknown } } | null)?.fieldErrors
      ?.draft;
    if (Array.isArray(draftErrors) && typeof draftErrors[0] === 'string') {
      return new AiRequestError(`${draftErrors[0]}.`);
    }
  }
  return new AiRequestError(
    typeof body?.error === 'string' ? body.error : 'The assistant could not answer. Try again.',
  );
}

async function send(input: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input, { ...init, cache: 'no-store' });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new AiRequestError('Could not reach the server. Check your connection and try again.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw toAiRequestError(response.status, body);
  return body;
}

export async function fetchAiStatus(signal?: AbortSignal): Promise<AiStatus> {
  return (await send(AI_SUGGESTIONS_ENDPOINT, { signal })) as AiStatus;
}

export async function requestAiSuggestions<K extends AiSuggestionKind>(
  kind: K,
  draft: AiDraft,
  signal?: AbortSignal,
): Promise<AiResultFor<K>> {
  return (await send(AI_SUGGESTIONS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, draft }),
    signal,
  })) as AiResultFor<K>;
}
