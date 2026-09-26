import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { GET as listBlogs } from '@/app/api/admin/blogs/route';
import Blog from '@/models/Blog';
import type { ISite } from '@/models/Site';
import type { IUser } from '@/models/User';
import { authenticatedRequest, createTestSite, createTestUser } from '@/tests/setup/factories';

const rootContext = { params: Promise.resolve({}) };
const LIST_FIELDS = ['_id', 'createdAt', 'slug', 'status', 'tag', 'title'];

type Seed = {
  title: string;
  slug: string;
  status?: 'draft' | 'publish';
  tag?: string;
  createdAt?: Date;
  _id?: Types.ObjectId;
};

/** Inserts raw documents so the test controls createdAt and _id exactly. */
async function seed(site: ISite, posts: Seed[]) {
  const now = new Date('2026-01-01T00:00:00Z');
  await Blog.collection.insertMany(
    posts.map((post, index) => ({
      _id: post._id ?? new Types.ObjectId(),
      siteId: site._id,
      title: post.title,
      slug: post.slug,
      status: post.status ?? 'publish',
      tag: post.tag ?? 'Insights',
      content: `<p>Body of ${post.slug}</p>`,
      rendered: {
        html: `<p>Body of ${post.slug}</p>`,
        toc: [],
        wordCount: 3,
        readingTime: 1,
        pipelineVersion: 1,
        renderedAt: now,
      },
      createdAt: post.createdAt ?? new Date(now.getTime() + index * 1000),
      updatedAt: now,
    })),
  );
}

async function list(user: IUser, site: ISite, query = '') {
  const request = await authenticatedRequest(`http://localhost:3003/api/admin/blogs${query}`, {
    user,
    siteId: site._id.toString(),
  });
  const response = await listBlogs(request, rootContext);
  return { status: response.status, body: await response.json() };
}

const numbered = (count: number, prefix = 'post'): Seed[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `${prefix} ${i + 1}`,
    slug: `${prefix}-${i + 1}`,
  }));

describe('GET /api/admin/blogs (paginated list)', () => {
  it('returns the first page with metadata and only the list fields', async () => {
    const admin = await createTestUser();
    const site = await createTestSite();
    await seed(site, numbered(25));

    const { status, body } = await list(admin, site);
    expect(status).toBe(200);
    expect(body.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
    expect(body.data).toHaveLength(20);
    for (const row of body.data) {
      expect(Object.keys(row).sort()).toEqual(LIST_FIELDS);
      expect(row).not.toHaveProperty('content');
      expect(row).not.toHaveProperty('rendered');
    }
    // Newest first.
    expect(body.data[0].slug).toBe('post-25');

    const second = await list(admin, site, '?page=2');
    expect(second.body.data.map((row: { slug: string }) => row.slug)).toEqual([
      'post-5',
      'post-4',
      'post-3',
      'post-2',
      'post-1',
    ]);
  });

  it('breaks createdAt ties by _id descending so pages never overlap', async () => {
    const admin = await createTestUser();
    const site = await createTestSite();
    const tied = new Date('2026-02-02T00:00:00Z');
    const ids = Array.from({ length: 5 }, () => new Types.ObjectId()).sort((a, b) =>
      a.toString().localeCompare(b.toString()),
    );
    await seed(
      site,
      ids.map((_id, i) => ({ _id, title: `Tie ${i}`, slug: `tie-${i}`, createdAt: tied })),
    );

    const pages = await Promise.all(
      [1, 2, 3].map((page) => list(admin, site, `?limit=2&page=${page}`)),
    );
    const seen = pages.flatMap(({ body }) => body.data.map((row: { _id: string }) => row._id));
    expect(seen).toEqual(ids.map(String).reverse());
  });

  it('filters by status and counts only matching posts', async () => {
    const admin = await createTestUser();
    const site = await createTestSite();
    await seed(site, [
      { title: 'One', slug: 'one', status: 'draft' },
      { title: 'Two', slug: 'two', status: 'publish' },
      { title: 'Three', slug: 'three', status: 'draft' },
    ]);

    const drafts = await list(admin, site, '?status=draft');
    expect(drafts.body.meta.total).toBe(2);
    expect(drafts.body.data.every((row: { status: string }) => row.status === 'draft')).toBe(true);
    const published = await list(admin, site, '?status=publish');
    expect(published.body.meta.total).toBe(1);
    expect((await list(admin, site, '?status=all')).body.meta.total).toBe(3);
  });

  it('searches title, slug and tag as literal, case-insensitive text', async () => {
    const admin = await createTestUser();
    const site = await createTestSite();
    await seed(site, [
      { title: 'Pricing A+B explained', slug: 'pricing' },
      { title: 'Aaab is not a match', slug: 'aaab' },
      { title: 'Nothing here', slug: 'launch-notes' },
      { title: 'Tagged', slug: 'tagged', tag: 'Engineering' },
      { title: 'Dots... and (parens)', slug: 'dots' },
    ]);

    const slugs = async (query: string) =>
      (await list(admin, site, query)).body.data.map((row: { slug: string }) => row.slug).sort();

    expect(await slugs('?search=a%2Bb')).toEqual(['pricing']);
    expect(await slugs('?search=LAUNCH')).toEqual(['launch-notes']);
    expect(await slugs('?search=engineer')).toEqual(['tagged']);
    expect(await slugs('?search=(parens)')).toEqual(['dots']);
    expect(await slugs('?search=.*')).toEqual([]);
    expect((await list(admin, site, '?search=%20%20')).body.meta.total).toBe(5);
  });

  it('returns empty and out-of-range pages with accurate metadata', async () => {
    const admin = await createTestUser();
    const empty = await createTestSite();
    expect((await list(admin, empty)).body).toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const site = await createTestSite();
    await seed(site, numbered(3));
    expect((await list(admin, site, '?page=9&limit=2')).body).toEqual({
      data: [],
      meta: { page: 9, limit: 2, total: 3, totalPages: 2 },
    });
  });

  it.each([
    '?page=0',
    '?page=1.5',
    '?limit=101',
    '?limit=0',
    '?status=archived',
    `?search=${'x'.repeat(101)}`,
    `?page=${Number.MAX_SAFE_INTEGER}&limit=100`,
    '?page=1&page=2',
  ])('rejects %s with the standard validation error', async (query) => {
    const admin = await createTestUser();
    const site = await createTestSite();
    const { status, body } = await list(admin, site, query);
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('isolates both rows and counts to the active site, ignoring client overrides', async () => {
    const admin = await createTestUser();
    const [siteA, siteB] = await Promise.all([createTestSite(), createTestSite()]);
    await seed(siteA, numbered(3, 'alpha'));
    await seed(siteB, numbered(7, 'beta'));

    const a = await list(admin, siteA, `?siteId=${siteB._id}&search=a`);
    expect(a.body.meta.total).toBe(3);
    expect(a.body.data.every((row: { slug: string }) => row.slug.startsWith('alpha'))).toBe(true);

    const b = await list(admin, siteB, '?limit=100');
    expect(b.body.meta.total).toBe(7);
    expect(b.body.data.every((row: { slug: string }) => row.slug.startsWith('beta'))).toBe(true);
  });

  it('refuses a site the editor is not assigned to', async () => {
    const [allowed, other] = await Promise.all([createTestSite(), createTestSite()]);
    await seed(other, numbered(2, 'secret'));
    const editor = await createTestUser({ role: 'editor', siteIds: [allowed._id.toString()] });

    expect((await list(editor, allowed)).status).toBe(200);
    const denied = await list(editor, other);
    expect(denied.status).toBe(403);
    expect(denied.body).not.toHaveProperty('data');
  });
});
