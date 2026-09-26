import { z } from 'zod';

export const BLOG_LIST_DEFAULT_LIMIT = 20;
export const BLOG_LIST_MAX_LIMIT = 100;
export const BLOG_LIST_MAX_SEARCH = 100;

export const blogListStatusSchema = z.enum(['all', 'draft', 'publish']);
export type BlogListStatus = z.infer<typeof blogListStatusSchema>;

/**
 * Only plain decimal digits are accepted, so "1.5", "1e3", "+2", " 3" and "0x10"
 * are rejected instead of being silently coerced by Number().
 */
const positiveIntegerParam = (fallback: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .regex(/^\d+$/, 'Must be a positive whole number')
    .transform(Number)
    .pipe(z.number().int().safe().min(1).max(max))
    .optional()
    .transform((value) => value ?? fallback);

export const blogListQuerySchema = z
  .object({
    page: positiveIntegerParam(1),
    limit: positiveIntegerParam(BLOG_LIST_DEFAULT_LIMIT, BLOG_LIST_MAX_LIMIT),
    search: z
      .string()
      .trim()
      .max(BLOG_LIST_MAX_SEARCH, `Must be at most ${BLOG_LIST_MAX_SEARCH} characters`)
      .optional()
      .transform((value) => value ?? ''),
    status: blogListStatusSchema.optional().transform((value) => value ?? 'all'),
  })
  .refine(({ page, limit }) => Number.isSafeInteger((page - 1) * limit), {
    path: ['page'],
    message: 'Page is too large',
  });

export type BlogListQuery = z.output<typeof blogListQuerySchema>;

const QUERY_KEYS = ['page', 'limit', 'search', 'status'] as const;

/**
 * Reads the list parameters from a URL. A repeated parameter is rejected rather than
 * silently picking one value, so the server never answers a different question
 * from the one the caller thinks it asked.
 */
export function parseBlogListQuery(params: URLSearchParams) {
  const raw: Record<string, string | undefined> = {};
  const repeated: string[] = [];
  for (const key of QUERY_KEYS) {
    const values = params.getAll(key);
    if (values.length > 1) repeated.push(key);
    raw[key] = values[0];
  }
  if (repeated.length > 0) {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: Object.fromEntries(repeated.map((key) => [key, ['Must be given once']])),
      },
    };
  }
  const parsed = blogListQuerySchema.safeParse(raw);
  if (!parsed.success) return { success: false as const, error: parsed.error.flatten() };
  return { success: true as const, data: parsed.data };
}
