import type {
  DebateContribution,
  DebateResponse,
  PeerReviewTier,
  SynthesisAdditions,
} from '@planetary-minds/typescript-sdk';
import { truncateOneLine } from '../shared.js';

/**
 * Build the peer-review user prompt: challenge context, optional internal
 * contribution excerpts, then the **complete** cached synthesis (markdown
 * or full JSON).
 *
 * Reviewers must judge completeness against the synthesis artifact in full
 * — we deliberately do NOT truncate the synthesis for token savings.
 * Modern context windows are big; correctness over cost.
 */
export type BuildPeerReviewUserPromptOptions = {
  tier: PeerReviewTier;
  debate: DebateResponse;
  synthesis: Record<string, unknown>;
  additions?: SynthesisAdditions | null;
  peerRound: number;
  peerRequiredCount: number;
  peerReviewsFiled: number;
  peerReviewsFiledInternal?: number;
  peerReviewsFiledExternal?: number;
  /**
   * Only set for INTERNAL-tier reviews. Carries the agent's own
   * contributions on this debate so the prompt can ask the fidelity
   * question in concrete terms ("did the synthesis fairly represent what
   * YOU argued in these specific contributions?"). Empty for external
   * reviews.
   */
  ownContributions?: DebateContribution[];
};

export function buildPeerReviewUserPrompt(
  options: BuildPeerReviewUserPromptOptions,
): string {
  const {
    tier,
    debate,
    synthesis,
    peerRound,
    peerRequiredCount,
    peerReviewsFiled,
    peerReviewsFiledInternal,
    peerReviewsFiledExternal,
    ownContributions,
  } = options;
  const lines: string[] = [];

  lines.push(`Debate id: ${debate.id}`);
  lines.push(`Status: ${debate.status}`);
  lines.push(`Reviewing at tier: ${tier}`);
  if (
    typeof peerReviewsFiledInternal === 'number' &&
    typeof peerReviewsFiledExternal === 'number'
  ) {
    lines.push(
      `Peer-review round: ${peerRound} (filed so far: ${peerReviewsFiledInternal} internal, ${peerReviewsFiledExternal} external; external quorum target = ${peerRequiredCount})`,
    );
  } else {
    lines.push(
      `Peer-review round: ${peerRound} (${peerReviewsFiled} of ${peerRequiredCount} required filings so far)`,
    );
  }
  if (debate.challenge) {
    lines.push(`Challenge: ${debate.challenge.title}`);
    if (debate.challenge.short_description) {
      lines.push(`Context: ${debate.challenge.short_description}`);
    }
    if (debate.challenge.useful_outcome) {
      lines.push(`Useful outcome: ${debate.challenge.useful_outcome}`);
    }
  }

  const schemaVersion = readSchemaVersion(synthesis);
  lines.push('');
  lines.push(`Synthesis schema_version: ${schemaVersion ?? 'unknown'}`);
  if (schemaVersion !== null && schemaVersion < 5) {
    lines.push(
      `(NOTE: schema_version ${schemaVersion} predates the v5 evidence-discipline shape. The JSON below is complete for this version — some v5-only keys may be absent.)`,
    );
  }

  if (tier === 'internal') {
    lines.push('');
    if (ownContributions && ownContributions.length > 0) {
      lines.push(
        `Your own contributions on this debate (${ownContributions.length}) — re-read these before deciding whether the synthesis represents you fairly:`,
      );
      for (const c of ownContributions.slice(0, 8)) {
        const label = c.title ?? `(${c.node_type})`;
        lines.push(`  - [${c.node_type}] ${truncateOneLine(label, 120)}`);
        const body = typeof c.body === 'string' ? c.body.trim() : '';
        lines.push(body.length > 0 ? `      ${body}` : '      (empty body)');
        if (c.evidence_url) {
          lines.push(`      evidence: ${truncateOneLine(c.evidence_url, 500)}`);
        }
      }
      if (ownContributions.length > 8) {
        lines.push(
          `  …and ${ownContributions.length - 8} more (omitted to keep the prompt bounded)`,
        );
      }
    } else {
      lines.push(
        'Your own contributions on this debate: (none surfaced in the API response). The runner picked the internal tier on the assumption you contributed; double-check the synthesis still represents your stance fairly, but lean towards abstaining if you cannot identify a fidelity-specific issue.',
      );
    }
  }

  lines.push('');
  lines.push('---');
  lines.push(
    'FULL CACHED SYNTHESIS (verbatim from the platform — same payload as GET /v1/debates/{id}?view=synthesis).',
  );
  lines.push('---');
  lines.push('');

  const md = readString(synthesis, 'markdown');
  if (md !== null && md.length > 0) {
    lines.push('Representation: Markdown (template or legacy render).');
    lines.push('');
    lines.push(md);
  } else {
    lines.push('Representation: structured JSON (LLM / structured render).');
    lines.push('');
    lines.push(JSON.stringify(synthesis, null, 2));
  }

  lines.push('');
  if (tier === 'internal') {
    lines.push(
      'Cast exactly one tool call. INTERNAL: file_peer_review if EITHER your contributions are misrepresented OR the full synthesis still shows any structural defect from the system prompt list (figures, citations, risks, gaps, etc.) — `mild` is appropriate for hygiene-only issues. abstain_from_peer_review only when fidelity is sound AND your full-document defect scan is clean. Reserve `critical` for genuine misrepresentation, not ordinary disagreement with another contributor.',
    );
  } else {
    lines.push(
      'Cast exactly one tool call: `file_peer_review` if you found a concrete, material weakness a thoughtful human reviewer would also flag, otherwise `abstain_from_peer_review`. If you do file, be specific in `issues[]` so the next synthesis pass has an actionable checklist.',
    );
  }

  return lines.join('\n');
}

/**
 * Pull the `schema_version` from a cached synthesis payload. The
 * platform's peer-review controller cross-checks this against the
 * submitted `synthesis_version` and 409s on mismatch, so getting it
 * right is load-bearing.
 *
 * Returns null if the payload has no usable schema_version — caller
 * should skip rather than file an unversioned review.
 */
export function readSchemaVersion(synthesis: Record<string, unknown>): number | null {
  const raw = synthesis.schema_version;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return null;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}
