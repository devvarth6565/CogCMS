import { describe, expect, it } from 'vitest';
import { comparableText, countWords, truncateText } from './text';

describe('countWords', () => {
  it('counts whitespace-separated words and treats blank text as zero', () => {
    expect(countWords('  one two\n\nthree\tfour ')).toBe(4);
    expect(countWords('   ')).toBe(0);
  });
});

describe('comparableText', () => {
  it('ignores case, punctuation and spacing but keeps letters from any script', () => {
    expect(comparableText('What is GEO?')).toBe(comparableText('what is  geo'));
    expect(comparableText('¿Qué es GEO?')).toBe('qué es geo');
  });
});

describe('truncateText', () => {
  it('returns text within the limit unchanged', () => {
    expect(truncateText('short', 10)).toBe('short');
  });

  it('cuts at a line break, marks the cut and stays within the limit', () => {
    const text = `${'a'.repeat(60)}\n${'b'.repeat(60)}\n${'c'.repeat(60)}`;
    const result = truncateText(text, 150);
    expect(result.length).toBeLessThanOrEqual(150);
    expect(result).toBe(`${'a'.repeat(60)}\n${'b'.repeat(60)}\n\n[Article truncated]`);
  });

  it('falls back to a hard cut when there is no useful line break', () => {
    const result = truncateText('x'.repeat(500), 100);
    expect(result).toHaveLength(100);
    expect(result.endsWith('[Article truncated]')).toBe(true);
  });
});
