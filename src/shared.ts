/**
 * One-line truncation helper shared by the contribute and peer-review
 * user-prompt builders. Collapses whitespace and ellipsises beyond `limit`.
 * Exported in case consumers want the same behaviour for their own prompt
 * sub-renderers.
 */
export function truncateOneLine(text: string, limit: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= limit) return single;
  return `${single.slice(0, Math.max(0, limit - 1))}…`;
}
