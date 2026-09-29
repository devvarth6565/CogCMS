import { NextResponse } from 'next/server';
import { getAiConfig } from '@/lib/ai/openrouter';
import { generateSuggestions } from '@/lib/ai/suggestions';
import { readJson, withAdmin } from '@/lib/http/admin-handler';
import { aiNotConfigured, validationError } from '@/lib/http/errors';
import { aiSuggestionRequestSchema } from '@/lib/validation/ai-suggestions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Free models can queue; the provider call itself is capped at 55 s.
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Lets the editor explain setup up front instead of failing on the first click. */
export const GET = withAdmin(
  async () => {
    const config = getAiConfig();
    return NextResponse.json(
      { enabled: config !== null, models: config?.models ?? [] },
      { headers: NO_STORE },
    );
  },
  { site: false },
);

/**
 * Suggests titles, meta descriptions or FAQs for the posted draft. Nothing is stored:
 * the editor applies a suggestion to the form and the normal save path validates it.
 */
export const POST = withAdmin(async (req, { site }) => {
  const config = getAiConfig();
  if (!config) throw aiNotConfigured();

  const parsed = aiSuggestionRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError(parsed.error.flatten(), 'Invalid suggestion request');

  const result = await generateSuggestions(config, parsed.data, site, req.signal);
  return NextResponse.json(result, { headers: NO_STORE });
});
