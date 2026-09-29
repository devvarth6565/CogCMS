import { getEnv } from '@/lib/env';
import { aiUnavailable, HttpError } from '@/lib/http/errors';

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** OpenRouter's router across its free models: always available, but its picks vary widely. */
export const FREE_ROUTER_MODEL = 'openrouter/free';
/**
 * Free models that gave accurate answers in testing, in order. OpenRouter moves to the next
 * on rate limits, downtime or refusals; its free router is the last resort.
 */
export const DEFAULT_AI_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
  FREE_ROUTER_MODEL,
];
/** Free models can queue under load; this stays inside the route's 60 s budget. */
export const AI_REQUEST_TIMEOUT_MS = 55_000;

export interface AiConfig {
  apiKey: string;
  /** Tried in order; OpenRouter falls back to the next when one is unavailable. */
  models: string[];
  /**
   * Built-in list only. Free models are retired often, and OpenRouter then rejects the whole
   * list, so a retired default is retried with this model instead of failing every request.
   */
  retiredModelFallback?: string;
}

/** Null when no key is set: like S3 media, the assistant is optional. */
export function getAiConfig(): AiConfig | null {
  const { OPENROUTER_API_KEY: apiKey, OPENROUTER_MODELS: models } = getEnv();
  if (!apiKey) return null;
  if (models) return { apiKey, models };
  return { apiKey, models: DEFAULT_AI_MODELS, retiredModelFallback: FREE_ROUTER_MODEL };
}

/**
 * The provider answered, but not usably: empty, cut off, or not the requested JSON. Routers such
 * as openrouter/free pick a model per request, so another attempt may reach a better one.
 */
export class UnusableAnswerError extends HttpError {
  constructor(message: string) {
    super(502, 'AI_UNAVAILABLE', message);
    this.name = 'UnusableAnswerError';
  }
}

export interface StructuredOutputRequest {
  /** Schema name reported to the provider. */
  name: string;
  schema: Record<string, unknown>;
  system: string;
  prompt: string;
  temperature: number;
  /** Headroom for models that reason anyway; unused tokens cost nothing. */
  maxTokens: number;
}

export interface StructuredOutput {
  data: unknown;
  /** The model that answered, which may be a fallback or the free router's pick. */
  model: string;
}

type ChatCompletion = {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  error?: { code?: unknown; message?: unknown };
};

/** Models without native JSON mode may wrap the object in a code fence or a sentence. */
export function parseJsonContent(content: string): unknown {
  const candidates = [content.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  if (fenced) candidates.push(fenced[1].trim());
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(content.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next, narrower shape.
    }
  }
  return undefined;
}

function retryAfterSeconds(value: string | null): number | null {
  const seconds = value && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Maps a provider failure to this API's envelope. The provider's status is never forwarded:
 * its 401 means our key is wrong, but the admin UI would read a 401 as an expired session.
 */
function providerError(status: number, body: ChatCompletion | null, headers: Headers): HttpError {
  const code = typeof body?.error?.code === 'number' ? body.error.code : status;
  const detail = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 300) : '';
  // Status and provider message only: never the key or the article.
  console.error('[cms] AI provider error', { status: code, detail });

  if (code === 429) {
    if (/per-day/i.test(detail)) {
      return new HttpError(
        429,
        'RATE_LIMITED',
        'The daily quota for free AI models is used up. Try again tomorrow, or add OpenRouter credits to raise it.',
      );
    }
    const retryAfter = retryAfterSeconds(headers.get('retry-after'));
    return new HttpError(
      429,
      'RATE_LIMITED',
      'The AI provider is busy or rate limiting requests. Wait a minute and try again.',
      retryAfter ? { retryAfter } : null,
    );
  }
  if (code === 401) {
    return aiUnavailable(
      'The AI provider rejected the API key. Ask an administrator to check OPENROUTER_API_KEY.',
    );
  }
  if (code === 402) return aiUnavailable('The AI provider account has no credits for this model.');
  if (code === 403) {
    return aiUnavailable(
      'The AI provider declined this request, possibly under its content policy.',
    );
  }
  if (code === 404) {
    return aiUnavailable(
      'No AI model is available under the OpenRouter account’s settings. An administrator can check its privacy settings and OPENROUTER_MODELS.',
    );
  }
  if (code === 400) {
    return aiUnavailable(
      'The AI provider rejected the request. Try again; if it keeps failing, an administrator can find the reason in the server log.',
    );
  }
  if (code === 408) {
    return aiUnavailable('The AI provider did not respond in time. Try again.', 504);
  }
  return aiUnavailable('The AI provider is unavailable right now. Try again in a moment.');
}

function transportError(error: unknown): HttpError {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return aiUnavailable('The AI provider did not respond in time. Try again.', 504);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return aiUnavailable('The AI request was cancelled.');
  }
  console.error('[cms] AI provider unreachable', error instanceof Error ? error.message : error);
  return aiUnavailable('Could not reach the AI provider. Try again in a moment.');
}

type ProviderReply = { response: Response; body: ChatCompletion | null };

async function complete(
  apiKey: string,
  models: string[],
  reasoningOff: boolean,
  request: StructuredOutputRequest,
  signal: AbortSignal,
): Promise<ProviderReply> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      // No HTTP-Referer: attribution would list a private CMS origin in OpenRouter's public rankings.
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.name, strict: true, schema: request.schema },
        },
        // Short suggestions need no deliberate reasoning: free models that reason by default
        // then answer in seconds instead of half a minute.
        ...(reasoningOff ? { reasoning: { enabled: false } } : {}),
        // Repairs near-miss JSON (code fences, trailing commas) from models without a strict mode.
        plugins: [{ id: 'response-healing' }],
      }),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    throw transportError(error);
  }

  try {
    return { response, body: (await response.json()) as ChatCompletion };
  } catch (error) {
    if (response.ok) throw transportError(error);
    return { response, body: null };
  }
}

const rejectedFor = ({ response, body }: ProviderReply, reason: RegExp) =>
  response.status === 400 &&
  typeof body?.error?.message === 'string' &&
  reason.test(body.error.message);

/** One chat completion constrained to a JSON Schema. The key never leaves the server. */
export async function requestStructuredOutput(
  config: AiConfig,
  request: StructuredOutputRequest,
  signal?: AbortSignal,
): Promise<StructuredOutput> {
  // One deadline covers the whole call, including the retries below.
  const timeout = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let models = config.models;
  let reasoningOff = true;
  const send = () => complete(config.apiKey, models, reasoningOff, request, deadline);

  let reply = await send();
  if (config.retiredModelFallback && rejectedFor(reply, /not a valid model/i)) {
    console.warn(
      `[cms] A built-in AI model was retired; using ${config.retiredModelFallback}. Set OPENROUTER_MODELS to choose models.`,
    );
    models = [config.retiredModelFallback];
    reply = await send();
  }
  // An endpoint that must reason rejects "reasoning off" outright; OpenRouter does not fall
  // back to the next model for this, so ask again and let it reason.
  if (rejectedFor(reply, /reasoning is mandatory/i)) {
    reasoningOff = false;
    reply = await send();
  }

  const { response, body } = reply;
  // Errors after generation starts arrive as HTTP 200 with an error object.
  if (!response.ok || body?.error) throw providerError(response.status, body, response.headers);

  const choice = body?.choices?.[0];
  const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  if (!content.trim()) {
    throw new UnusableAnswerError(
      choice?.finish_reason === 'length'
        ? 'The AI model ran out of room before answering. Try again.'
        : 'The AI provider returned an empty answer. Try again.',
    );
  }
  const data = parseJsonContent(content);
  if (data === undefined) {
    throw new UnusableAnswerError(
      'The AI provider returned an answer in an unexpected format. Try again.',
    );
  }
  return { data, model: typeof body?.model === 'string' ? body.model : config.models[0] };
}
