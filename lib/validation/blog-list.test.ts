import { describe, expect, it } from 'vitest';
import { parseBlogListQuery } from './blog-list';

const parse = (query: string) => parseBlogListQuery(new URLSearchParams(query));

describe('parseBlogListQuery', () => {
  it('applies defaults when nothing is given', () => {
    expect(parse('')).toEqual({
      success: true,
      data: { page: 1, limit: 20, search: '', status: 'all' },
    });
  });

  it('accepts the documented boundaries', () => {
    const result = parse('page=3&limit=100&status=draft&search=%20%20hello%20');
    expect(result).toEqual({
      success: true,
      data: { page: 3, limit: 100, search: 'hello', status: 'draft' },
    });
    expect(parse('limit=1').success).toBe(true);
    expect(parse('status=publish').success).toBe(true);
  });

  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=1e3',
    'page=%2B2',
    'page=%202',
    'page=0x10',
    'page=abc',
    'page=',
    'limit=0',
    'limit=101',
    'limit=20.0',
    'status=published',
    'status=ALL',
    'status=',
  ])('rejects %s', (query) => {
    expect(parse(query).success).toBe(false);
  });

  it('rejects pages whose offset is not a safe integer', () => {
    expect(parse(`page=${Number.MAX_SAFE_INTEGER}&limit=1`).success).toBe(true);
    expect(parse(`page=${Number.MAX_SAFE_INTEGER}&limit=2`).success).toBe(false);
    expect(parse('page=99999999999999999999').success).toBe(false);
  });

  it('limits search to 100 characters after trimming', () => {
    expect(parse(`search=${'a'.repeat(100)}`).success).toBe(true);
    expect(parse(`search=${encodeURIComponent(`  ${'a'.repeat(100)}  `)}`).success).toBe(true);
    expect(parse(`search=${'a'.repeat(101)}`).success).toBe(false);
  });

  it('treats a blank search as no search', () => {
    expect(parse('search=%20%20%20')).toMatchObject({ success: true, data: { search: '' } });
  });

  it('rejects repeated parameters instead of picking one', () => {
    const result = parse('page=1&page=2');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.fieldErrors).toHaveProperty('page');
  });

  it('ignores parameters it does not own, including siteId', () => {
    expect(parse('siteId=abc&foo=bar')).toMatchObject({ success: true });
  });
});
