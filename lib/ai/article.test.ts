import { describe, expect, it } from 'vitest';
import { formatBlogHTML } from '@/lib/blog-content/format-blog-html';
import { getReadingStats } from '@/lib/render/reading-time';
import { sanitizeBlogHtml } from '@/lib/sanitize-blog-html';
import { analyzeArticle } from './article';

// Quill 2 writes bullet lists as <ol> with data-list attributes.
const QUILL_POST = [
  '<p>Plan your week in &lt;30&gt; minutes &amp; stay&nbsp;calm.</p>',
  '<p><br></p>',
  '<h2>Why it works</h2>',
  '<p>See <a href="https://example.com/study">the study</a> and <a href="/blogs/other">our post</a>.</p>',
  '<ol><li data-list="bullet">Pick three goals</li><li data-list="bullet">Block time</li></ol>',
  '<h3>Tools</h3>',
  '<table><tbody><tr><td>Tool</td><td>Cost</td></tr><tr><td>Paper</td><td>Free</td></tr></tbody></table>',
  '<pre data-language="plain">npm run plan</pre>',
  '<blockquote>Less is more.</blockquote>',
  '<p><img src="https://example.com/a.png"></p>',
  '<script>alert(1)</script>',
].join('');

describe('analyzeArticle', () => {
  it('builds a plain-text outline in document order', () => {
    expect(analyzeArticle(QUILL_POST).text).toBe(
      [
        'Plan your week in <30> minutes & stay calm.',
        '## Why it works',
        'See the study and our post.',
        '- Pick three goals\n- Block time',
        '### Tools',
        'Tool | Cost\nPaper | Free',
        'npm run plan',
        '> Less is more.',
      ].join('\n\n'),
    );
  });

  it('reports the structure the readiness score uses', () => {
    const analysis = analyzeArticle(QUILL_POST);
    expect(analysis.headings).toEqual([
      { level: 2, text: 'Why it works' },
      { level: 3, text: 'Tools' },
    ]);
    expect(analysis.paragraphWords).toEqual([9, 6]);
    expect(analysis).toMatchObject({ lists: 1, tables: 1, links: 1 });
  });

  it('counts words exactly like the stored rendered snapshot', () => {
    const expected = getReadingStats(formatBlogHTML(sanitizeBlogHtml(QUILL_POST))).wordCount;
    expect(analyzeArticle(QUILL_POST).wordCount).toBe(expected);
  });

  it('keeps the text of wrapper blocks such as graphics', () => {
    const html =
      '<div class="blog-graphic" data-graphic="callout"><div><strong>Tip:</strong> Start small.</div></div>';
    expect(analyzeArticle(html).text).toBe('Tip: Start small.');
  });

  it('treats an empty editor as an empty article', () => {
    expect(analyzeArticle('<p><br></p>')).toEqual({
      text: '',
      wordCount: 0,
      headings: [],
      paragraphWords: [],
      lists: 0,
      tables: 0,
      links: 0,
    });
  });
});
