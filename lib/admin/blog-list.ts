import type { QueryFilter, Types } from 'mongoose';
import Blog, { type IBlog, type PublicationStatus } from '@/models/Blog';
import type { BlogListQuery } from '@/lib/validation/blog-list';

export interface BlogListRow {
  _id: string;
  title: string;
  slug: string;
  status: PublicationStatus;
  tag: string;
  createdAt: string;
}

export interface BlogListPage {
  data: BlogListRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * The only fields the list screen needs. Passing this projection to MongoDB means the
 * article body, rendered HTML snapshot, FAQs and SEO fields never leave the database.
 */
export const BLOG_LIST_PROJECTION = {
  _id: 1,
  title: 1,
  slug: 1,
  status: 1,
  tag: 1,
  createdAt: 1,
} as const;

/** Escapes every regular-expression metacharacter so user input matches as literal text. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the MongoDB filter. `siteId` always comes from the server-resolved site and
 * is applied last, so no query parameter can widen or replace it.
 */
export function buildBlogListFilter(
  siteId: string | Types.ObjectId,
  { search, status }: Pick<BlogListQuery, 'search' | 'status'>,
): QueryFilter<IBlog> {
  const filter: QueryFilter<IBlog> = {};
  if (status !== 'all') filter.status = status;
  if (search) {
    const pattern = { $regex: escapeRegExp(search), $options: 'i' };
    filter.$or = [{ title: pattern }, { slug: pattern }, { tag: pattern }];
  }
  filter.siteId = siteId;
  return filter;
}

export async function listBlogsPage(
  siteId: string | Types.ObjectId,
  query: BlogListQuery,
): Promise<BlogListPage> {
  const { page, limit } = query;
  const filter = buildBlogListFilter(siteId, query);
  const [rows, total] = await Promise.all([
    Blog.find(filter, BLOG_LIST_PROJECTION)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<Pick<IBlog, '_id' | 'title' | 'slug' | 'status' | 'tag' | 'createdAt'>[]>()
      .exec(),
    Blog.countDocuments(filter).exec(),
  ]);
  return {
    data: rows.map((row) => ({
      _id: row._id.toString(),
      title: row.title,
      slug: row.slug,
      status: row.status,
      tag: row.tag ?? '',
      createdAt: new Date(row.createdAt).toISOString(),
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
