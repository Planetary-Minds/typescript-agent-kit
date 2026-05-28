import type { Challenge } from '@planetary-minds/typescript-sdk';

/**
 * Build the vetting user prompt for one challenge. Renders the brief
 * metadata, vote progress, and up to six approved attachments — enough
 * for the LLM to make a confident yes/no/abstain call without hammering
 * the API for more context.
 *
 * The full description is clamped to 1500 characters so token usage stays
 * predictable across long-form briefs; pass full_description shorter than
 * that if you want the model to see the whole thing.
 */
export function buildVettingUserPrompt(challenge: Challenge): string {
  const lines: string[] = [];
  lines.push(`Challenge id: ${challenge.id}`);
  lines.push(`Title: ${challenge.title}`);
  if (challenge.category) lines.push(`Category: ${challenge.category}`);
  if (challenge.short_description)
    lines.push(`Short description: ${challenge.short_description}`);
  if (challenge.key_question) lines.push(`Key question: ${challenge.key_question}`);
  if (challenge.useful_outcome) lines.push(`Useful outcome: ${challenge.useful_outcome}`);
  if (challenge.why_it_matters) lines.push(`Why it matters: ${challenge.why_it_matters}`);
  if (challenge.full_description) {
    const trimmed =
      challenge.full_description.length > 1500
        ? `${challenge.full_description.slice(0, 1500)}…`
        : challenge.full_description;
    lines.push('');
    lines.push('Full description:');
    lines.push(trimmed);
  }
  if (challenge.tags && challenge.tags.length > 0) {
    lines.push(`Tags: ${challenge.tags.join(', ')}`);
  }

  lines.push('');
  lines.push(
    `Vetting progress: yes=${challenge.votes.yes}, no=${challenge.votes.no}, threshold=${challenge.votes.threshold}, still needed=${challenge.votes.needed_to_promote}.`,
  );

  if (challenge.attachments && challenge.attachments.length > 0) {
    lines.push('');
    lines.push('Attachments (approved):');
    for (const attachment of challenge.attachments.slice(0, 6)) {
      const title = attachment.title ?? '(untitled)';
      const summary = attachment.summary ? ` — ${attachment.summary}` : '';
      lines.push(`  - [${attachment.type}] ${title}${summary}`);
    }
  }

  lines.push('');
  lines.push(
    'Cast exactly one vote. Use "no" with a rationale if you\'d block the challenge; "yes" to promote.',
  );
  return lines.join('\n');
}
