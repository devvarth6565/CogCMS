import { HTMLElement, parse, type Node } from 'node-html-parser';
import { formatBlogHTML } from '@/lib/blog-content/format-blog-html';
import { getReadingStats } from '@/lib/render/reading-time';
import { sanitizeBlogHtml } from '@/lib/sanitize-blog-html';

export interface ArticleAnalysis {
  /** Plain-text outline for the model: "## " headings, "- " list items, blank lines between blocks. */
  text: string;
  /** Same count as the stored rendered snapshot. */
  wordCount: number;
  headings: Array<{ level: number; text: string }>;
  /** Word count of each body paragraph, in document order. */
  paragraphWords: number[];
  lists: number;
  tables: number;
  /** Absolute http(s) links, the kind that cites a source. */
  links: number;
}

const BLOCK_TAGS = new Set(
  'blockquote div figure h1 h2 h3 h4 h5 h6 hr iframe ol p pre table ul'.split(' '),
);
const isBlock = (node: Node) =>
  node instanceof HTMLElement && BLOCK_TAGS.has(node.rawTagName?.toLowerCase() ?? '');
const inline = (node: Node) => node.text.replace(/\s+/g, ' ').trim();
const words = (text: string) => (text ? text.split(' ').length : 0);

/**
 * Reads the editor HTML the way the published page will see it (sanitized and formatted),
 * so the score and the prompt reflect what readers and crawlers actually get.
 */
export function analyzeArticle(html: string): ArticleAnalysis {
  const formatted = formatBlogHTML(sanitizeBlogHtml(html));
  const root = parse(formatted);
  const blocks: string[] = [];
  const analysis: ArticleAnalysis = {
    text: '',
    wordCount: getReadingStats(formatted).wordCount,
    headings: [],
    paragraphWords: [],
    lists: 0,
    tables: 0,
    links: root
      .querySelectorAll('a')
      .filter((link) => /^https?:\/\//i.test(link.getAttribute('href') ?? '')).length,
  };

  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        const text = inline(node);
        if (text) blocks.push(text);
        continue;
      }
      const tag = node.rawTagName?.toLowerCase() ?? '';
      const heading = /^h([1-6])$/.exec(tag);
      if (heading) {
        const text = inline(node);
        if (!text) continue;
        analysis.headings.push({ level: Number(heading[1]), text });
        blocks.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
      } else if (tag === 'p') {
        const text = inline(node);
        if (!text) continue;
        analysis.paragraphWords.push(words(text));
        blocks.push(text);
      } else if (tag === 'ul' || tag === 'ol') {
        analysis.lists++;
        const items = node.querySelectorAll('li').map(inline).filter(Boolean);
        if (items.length) blocks.push(items.map((item) => `- ${item}`).join('\n'));
      } else if (tag === 'table') {
        analysis.tables++;
        const rows = node
          .querySelectorAll('tr')
          .map((row) => row.querySelectorAll('th, td').map(inline).join(' | '))
          .filter((row) => row.replace(/[|\s]/g, ''));
        if (rows.length) blocks.push(rows.join('\n'));
      } else if (tag === 'pre') {
        const code = node.text.trim();
        if (code) blocks.push(code);
      } else if (tag === 'blockquote') {
        const text = inline(node);
        if (text) blocks.push(`> ${text}`);
      } else if (node.childNodes.some(isBlock)) {
        // Wrappers such as graphic blocks: walk their blocks.
        visit(node.childNodes);
      } else if (!['hr', 'br', 'img', 'iframe'].includes(tag)) {
        // An inline run, such as "<strong>Tip:</strong> Start small.", is one block.
        const text = inline(node);
        if (text) blocks.push(text);
      }
    }
  };

  visit(root.childNodes);
  analysis.text = blocks.join('\n\n');
  return analysis;
}
