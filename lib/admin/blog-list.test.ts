import { describe, expect, it } from 'vitest';
import { BLOG_LIST_PROJECTION, buildBlogListFilter, escapeRegExp } from './blog-list';

const SITE = '64b000000000000000000001';

describe('escapeRegExp', () => {
  it.each(['a+b', '.*', 'c++ (draft)?', '[x]', 'a|b', '^start$', 'back\\slash', '{1,2}'])(
    'makes %s match only itself',
    (text) => {
      const pattern = new RegExp(escapeRegExp(text), 'i');
      expect(pattern.test(`before ${text} after`)).toBe(true);
    },
  );

  it('does not let metacharacters widen the match', () => {
    expect(new RegExp(escapeRegExp('a+b'), 'i').test('aaab')).toBe(false);
    expect(new RegExp(escapeRegExp('.*'), 'i').test('anything')).toBe(false);
    expect(new RegExp(escapeRegExp('a|b'), 'i').test('b')).toBe(false);
  });
});

describe('buildBlogListFilter', () => {
  it('only scopes to the site when there is no search or status', () => {
    expect(buildBlogListFilter(SITE, { search: '', status: 'all' })).toEqual({ siteId: SITE });
  });

  it('adds status and a literal, case-insensitive search on title, slug and tag', () => {
    const pattern = { $regex: 'a\\+b', $options: 'i' };
    expect(buildBlogListFilter(SITE, { search: 'a+b', status: 'draft' })).toEqual({
      siteId: SITE,
      status: 'draft',
      $or: [{ title: pattern }, { slug: pattern }, { tag: pattern }],
    });
  });
});

describe('BLOG_LIST_PROJECTION', () => {
  it('selects only the list fields and never the article body or snapshot', () => {
    expect(Object.keys(BLOG_LIST_PROJECTION).sort()).toEqual(
      ['_id', 'createdAt', 'slug', 'status', 'tag', 'title'].sort(),
    );
  });
});
