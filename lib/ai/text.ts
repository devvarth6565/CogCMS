/** Small text helpers shared by the editor and the AI suggestions route. */

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Case- and punctuation-insensitive form, so "What is GEO?" matches "what is geo". */
export function comparableText(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const TRUNCATION_MARKER = '\n\n[Article truncated]';

/** Cuts at a line break where possible and says so, so the model knows the text is partial. */
export function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const budget = limit - TRUNCATION_MARKER.length;
  const cut = text.lastIndexOf('\n', budget);
  return `${text.slice(0, cut > budget / 2 ? cut : budget).trimEnd()}${TRUNCATION_MARKER}`;
}
