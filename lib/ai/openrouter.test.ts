import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { HttpError } from '@/lib/http/errors';
import {
  DEFAULT_AI_MODELS,
  FREE_ROUTER_MODEL,
  getAiConfig,
  OPENROUTER_CHAT_URL,
  parseJsonContent,
  requestStructuredOutput,
} from './openrouter';

const API_KEY = 'sk-or-v1-test-secret';
const config = { apiKey: API_KEY, models: ['vendor/primary:free', 'openrouter/free'] };
const request = {
  name: 'title_suggestions',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  system: 'System prompt',
  prompt: 'User prompt',
  temperature: 0.5,
  maxTokens: 4000,
};

const fetchMock = vi.fn<typeof fetch>();
const errorLog = vi.fn();

function completion(content: unknown, finishReason = 'stop') {
  return Response.json({
    model: 'vendor/answering-model:free',
    choices: [{ message: { content }, finish_reason: finishReason }],
  });
}

function providerFailure(status: number, message = 'Provider message', headers = {}) {
  return Response.json({ error: { code: status, message } }, { status, headers });
}

async function failureFor(response: Response | Error): Promise<HttpError> {
  if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
  else fetchMock.mockResolvedValueOnce(response);
  const error = await requestStructuredOutput(config, request).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(errorLog);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  errorLog.mockReset();
  resetEnvCache();
});

describe('getAiConfig', () => {
  beforeEach(() => {
    vi.stubEnv('MONGODB_URI', 'mongodb://localhost/test');
    vi.stubEnv('CMS_JWT_SECRET', 'x'.repeat(32));
  });

  it('is null without a key, so the assistant stays off', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '  ');
    resetEnvCache();
    expect(getAiConfig()).toBeNull();
  });

  it('defaults to tested free models that end with the free router', () => {
    vi.stubEnv('OPENROUTER_API_KEY', API_KEY);
    resetEnvCache();
    expect(getAiConfig()).toEqual({
      apiKey: API_KEY,
      models: DEFAULT_AI_MODELS,
      retiredModelFallback: FREE_ROUTER_MODEL,
    });
    expect(DEFAULT_AI_MODELS.at(-1)).toBe(FREE_ROUTER_MODEL);
  });

  it('uses the configured models as given, without the retired-model fallback', () => {
    vi.stubEnv('OPENROUTER_API_KEY', API_KEY);
    vi.stubEnv('OPENROUTER_MODELS', 'openai/gpt-5-mini, google/gemma-4-31b-it:free');
    resetEnvCache();
    expect(getAiConfig()).toEqual({
      apiKey: API_KEY,
      models: ['openai/gpt-5-mini', 'google/gemma-4-31b-it:free'],
    });
  });
});

describe('requestStructuredOutput', () => {
  it('sends one JSON-schema chat completion with the key only in the Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(completion('{"titles":["A"]}'));
    await requestStructuredOutput(config, request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OPENROUTER_CHAT_URL);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      models: ['vendor/primary:free', 'openrouter/free'],
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User prompt' },
      ],
      temperature: 0.5,
      max_tokens: 4000,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'title_suggestions', strict: true, schema: request.schema },
      },
      reasoning: { enabled: false },
      plugins: [{ id: 'response-healing' }],
    });
    expect(JSON.stringify(body)).not.toContain(API_KEY);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns the parsed object and the model that answered', async () => {
    fetchMock.mockResolvedValueOnce(completion('{"titles":["A","B"]}'));
    await expect(requestStructuredOutput(config, request)).resolves.toEqual({
      data: { titles: ['A', 'B'] },
      model: 'vendor/answering-model:free',
    });
  });

  it('retries a retired built-in model once with the free router', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(providerFailure(400, 'vendor/primary:free is not a valid model ID'))
      .mockResolvedValueOnce(completion('{"titles":["A"]}'));
    const result = await requestStructuredOutput(
      { ...config, retiredModelFallback: FREE_ROUTER_MODEL },
      request,
    );

    expect(result.data).toEqual({ titles: ['A'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).models).toEqual([
      FREE_ROUTER_MODEL,
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/retired/));
  });

  it('does not second-guess models an operator configured', async () => {
    const error = await failureFor(
      providerFailure(400, 'vendor/primary:free is not a valid model ID'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ status: 502, code: 'AI_UNAVAILABLE' });
    expect(error.message).toMatch(/rejected the request/);
  });

  it('asks again with reasoning allowed when an endpoint must reason', async () => {
    fetchMock
      .mockResolvedValueOnce(
        providerFailure(400, 'Reasoning is mandatory for this endpoint and cannot be disabled.'),
      )
      .mockResolvedValueOnce(completion('{"titles":["A"]}'));
    const result = await requestStructuredOutput(config, request);

    expect(result.data).toEqual({ titles: ['A'] });
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0].reasoning).toEqual({ enabled: false });
    expect(bodies[1]).not.toHaveProperty('reasoning');
    expect(bodies[1].models).toEqual(config.models);
  });

  it('handles a retired built-in model and then an endpoint that must reason', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(providerFailure(400, 'vendor/primary:free is not a valid model ID'))
      .mockResolvedValueOnce(
        providerFailure(400, 'Reasoning is mandatory for this endpoint and cannot be disabled.'),
      )
      .mockResolvedValueOnce(completion('{"titles":["A"]}'));
    await requestStructuredOutput({ ...config, retiredModelFallback: FREE_ROUTER_MODEL }, request);

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.map((body) => [body.models, body.reasoning ?? null])).toEqual([
      [config.models, { enabled: false }],
      [[FREE_ROUTER_MODEL], { enabled: false }],
      [[FREE_ROUTER_MODEL], null],
    ]);
  });

  it('maps rate limits to 429 with the provider Retry-After', async () => {
    const error = await failureFor(providerFailure(429, 'Slow down', { 'Retry-After': '30' }));
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', details: { retryAfter: 30 } });
  });

  it('explains that the free daily quota is spent', async () => {
    const error = await failureFor(
      providerFailure(429, 'Rate limit exceeded: free-models-per-day'),
    );
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/daily quota/);
    expect(error.details).toBeUndefined();
  });

  it('never forwards a provider 401, which the admin UI would read as a lost session', async () => {
    const error = await failureFor(providerFailure(401, 'No auth credentials found'));
    expect(error).toMatchObject({ status: 502, code: 'AI_UNAVAILABLE' });
    expect(error.message).toMatch(/OPENROUTER_API_KEY/);
  });

  it.each([
    [402, 502, /no credits/],
    [403, 502, /declined/],
    [404, 502, /privacy settings/],
    [400, 502, /rejected the request/],
    [408, 504, /in time/],
    [500, 502, /unavailable/],
    [503, 502, /unavailable/],
  ])('maps provider %i to AI_UNAVAILABLE %i', async (status, expected, message) => {
    const error = await failureFor(providerFailure(status));
    expect(error).toMatchObject({ status: expected, code: 'AI_UNAVAILABLE' });
    expect(error.message).toMatch(message);
  });

  it('treats an error object in an HTTP 200 body as a failure', async () => {
    const error = await failureFor(
      Response.json({ error: { code: 502, message: 'Upstream died' } }),
    );
    expect(error).toMatchObject({ status: 502, code: 'AI_UNAVAILABLE' });
  });

  it('explains empty answers, including a budget spent on reasoning', async () => {
    expect((await failureFor(completion('', 'length'))).message).toMatch(/ran out of room/);
    expect((await failureFor(completion(null))).message).toMatch(/empty answer/);
  });

  it('rejects content that is not JSON', async () => {
    const error = await failureFor(completion('Here are some ideas: A, B and C.'));
    expect(error).toMatchObject({ status: 502, code: 'AI_UNAVAILABLE' });
    expect(error.message).toMatch(/unexpected format/);
  });

  it('maps network failures, timeouts and cancellation', async () => {
    expect(await failureFor(new TypeError('fetch failed'))).toMatchObject({
      status: 502,
      message: expect.stringMatching(/Could not reach/),
    });
    expect(await failureFor(new DOMException('Timed out', 'TimeoutError'))).toMatchObject({
      status: 504,
      code: 'AI_UNAVAILABLE',
    });
    expect((await failureFor(new DOMException('Aborted', 'AbortError'))).message).toMatch(
      /cancelled/,
    );
  });

  it('aborts the provider call when the caller goes away', async () => {
    const caller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const pending = requestStructuredOutput(config, request, caller.signal);
    caller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });

  it('never logs the API key', async () => {
    await failureFor(providerFailure(401, 'Invalid key'));
    await failureFor(new TypeError('fetch failed'));
    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(API_KEY);
  });
});

describe('parseJsonContent', () => {
  it('reads plain, fenced and embedded JSON objects', () => {
    expect(parseJsonContent('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonContent('Sure! Here it is: {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  it('returns undefined when there is no JSON object', () => {
    expect(parseJsonContent('no json here')).toBeUndefined();
    expect(parseJsonContent('{broken')).toBeUndefined();
  });
});
