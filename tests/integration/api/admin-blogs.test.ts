import { describe, expect, it } from 'vitest';
import { GET as listBlogs, POST as createBlog } from '@/app/api/admin/blogs/route';
import { GET as getBlog, PUT as updateBlog } from '@/app/api/admin/blogs/[slug]/route';
import Author from '@/models/Author';
import Blog from '@/models/Blog';
import { authenticatedRequest, createTestSite, createTestUser } from '@/tests/setup/factories';

const rootContext = { params: Promise.resolve({}) };
const slugContext = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe('tenant-safe blog admin API', () => {
  it('isolates slugs and lists while rejecting cross-site access', async () => {
    const admin = await createTestUser();
    const [siteA, siteB] = await Promise.all([createTestSite(), createTestSite()]);
    for (const site of [siteA, siteB]) {
      const request = await authenticatedRequest('http://localhost:3003/api/admin/blogs', {
        user: admin,
        siteId: site._id.toString(),
        method: 'POST',
        json: { title: `Post for ${site.slug}`, slug: 'shared', content: '<p>Hello world</p>' },
      });
      expect((await createBlog(request, rootContext)).status).toBe(201);
    }

    const duplicate = await authenticatedRequest('http://localhost:3003/api/admin/blogs', {
      user: admin,
      siteId: siteA._id.toString(),
      method: 'POST',
      json: { title: 'Duplicate', slug: 'shared', content: '<p>No</p>' },
    });
    const duplicateResponse = await createBlog(duplicate, rootContext);
    expect(duplicateResponse.status).toBe(409);
    expect((await duplicateResponse.json()).code).toBe('DUPLICATE_SLUG');

    const list = await authenticatedRequest('http://localhost:3003/api/admin/blogs', {
      user: admin,
      siteId: siteA._id.toString(),
    });
    const listed = await (await listBlogs(list, rootContext)).json();
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0].title).toContain(siteA.slug);
    expect(listed.meta.total).toBe(1);

    await Blog.deleteOne({ siteId: siteA._id, slug: 'shared' });
    const crossSite = await authenticatedRequest('http://localhost:3003/api/admin/blogs/shared', {
      user: admin,
      siteId: siteA._id.toString(),
    });
    expect((await getBlog(crossSite, slugContext('shared'))).status).toBe(404);
  });

  it('renders on content writes, preserves snapshots on metadata writes, and keeps first publish time', async () => {
    const admin = await createTestUser();
    const site = await createTestSite();
    const create = await authenticatedRequest('http://localhost:3003/api/admin/blogs', {
      user: admin,
      siteId: site._id.toString(),
      method: 'POST',
      json: {
        title: 'Draft',
        slug: 'snapshot',
        content: '<script>bad()</script><h2>Opening</h2><p>First version</p>',
        status: 'draft',
        siteId: new (await import('mongoose')).Types.ObjectId().toString(),
        createdBy: new (await import('mongoose')).Types.ObjectId().toString(),
      },
    });
    const createdResponse = await createBlog(create, rootContext);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.siteId).toBe(site._id.toString());
    expect(created.createdBy).toBe(admin._id.toString());
    expect(created.content).not.toContain('bad()');
    expect(created.rendered.html).toContain('Opening');
    expect(created.publishedAt).toBeNull();

    const contentEdit = await authenticatedRequest(
      'http://localhost:3003/api/admin/blogs/snapshot',
      {
        user: admin,
        siteId: site._id.toString(),
        method: 'PUT',
        json: { content: '<h2>Changed</h2><p>Second version</p>' },
      },
    );
    const contentBody = await (await updateBlog(contentEdit, slugContext('snapshot'))).json();
    expect(contentBody.rendered.html).toContain('Changed');
    const renderedAfterContent = contentBody.rendered;

    const metadataEdit = await authenticatedRequest(
      'http://localhost:3003/api/admin/blogs/snapshot',
      {
        user: admin,
        siteId: site._id.toString(),
        method: 'PUT',
        json: { title: 'Renamed' },
      },
    );
    const metadataBody = await (await updateBlog(metadataEdit, slugContext('snapshot'))).json();
    expect(metadataBody.rendered).toEqual(renderedAfterContent);

    const publish = await authenticatedRequest('http://localhost:3003/api/admin/blogs/snapshot', {
      user: admin,
      siteId: site._id.toString(),
      method: 'PUT',
      json: { status: 'publish' },
    });
    const firstPublished = (await (await updateBlog(publish, slugContext('snapshot'))).json())
      .publishedAt;
    expect(firstPublished).toBeTruthy();

    for (const status of ['draft', 'publish'] as const) {
      const request = await authenticatedRequest('http://localhost:3003/api/admin/blogs/snapshot', {
        user: admin,
        siteId: site._id.toString(),
        method: 'PUT',
        json: { status },
      });
      const body = await (await updateBlog(request, slugContext('snapshot'))).json();
      expect(body.publishedAt).toBe(firstPublished);
    }
  });

  it('rejects cross-origin mutations before authentication or writes', async () => {
    const admin = await createTestUser();
    const site = await createTestSite();
    const request = await authenticatedRequest('http://localhost:3003/api/admin/blogs', {
      user: admin,
      siteId: site._id.toString(),
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      json: { title: 'Blocked', slug: 'blocked', content: '<p>No</p>' },
    });
    expect((await createBlog(request, rootContext)).status).toBe(403);
    expect(await Blog.countDocuments()).toBe(0);
  });

  it('rejects authors outside the selected site', async () => {
    const admin = await createTestUser();
    const [siteA, siteB] = await Promise.all([createTestSite(), createTestSite()]);
    const foreignAuthor = await Author.create({
      siteId: siteB._id,
      name: 'Foreign author',
      slug: 'foreign-author',
      status: 'publish',
    });
    const request = await authenticatedRequest('http://localhost:3003/api/admin/blogs', {
      user: admin,
      siteId: siteA._id.toString(),
      method: 'POST',
      json: {
        title: 'Cross-site reference',
        slug: 'cross-site-reference',
        content: '<p>No</p>',
        authorId: foreignAuthor._id.toString(),
      },
    });

    const response = await createBlog(request, rootContext);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('VALIDATION_ERROR');
    expect(await Blog.countDocuments()).toBe(0);
  });

  it('only publishes a blog when its selected-site author is published', async () => {
    const admin = await createTestUser();
    const site = await createTestSite();
    const draftAuthor = await Author.create({
      siteId: site._id,
      name: 'Draft author',
      slug: 'draft-author',
      status: 'draft',
    });
    const create = await authenticatedRequest('http://localhost:3003/api/admin/blogs', {
      user: admin,
      siteId: site._id.toString(),
      method: 'POST',
      json: {
        title: 'Draft with author',
        slug: 'draft-with-author',
        content: '<p>Draft</p>',
        status: 'draft',
        authorId: draftAuthor._id.toString(),
      },
    });
    expect((await createBlog(create, rootContext)).status).toBe(201);

    const publish = await authenticatedRequest(
      'http://localhost:3003/api/admin/blogs/draft-with-author',
      {
        user: admin,
        siteId: site._id.toString(),
        method: 'PUT',
        json: { status: 'publish' },
      },
    );
    const response = await updateBlog(publish, slugContext('draft-with-author'));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('VALIDATION_ERROR');
    expect((await Blog.findOne({ slug: 'draft-with-author' }))?.status).toBe('draft');
  });
});
