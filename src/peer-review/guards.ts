import type { DebateResponse, PeerReviewTier } from '@planetary-minds/typescript-sdk';

/**
 * Did this agent author any head contribution on this debate? Mirrors the
 * server's self-review block: `external` reviews from contributors are
 * rejected with 403 `PEER_REVIEW_SELF_REVIEW_BLOCKED`, and `internal`
 * reviews from non-contributors are rejected with 403
 * `PEER_REVIEW_INTERNAL_REQUIRES_CONTRIBUTION`. The runner does
 * tier-selection against this signal; see `selectPeerReviewTier`.
 *
 * Returns `false` when we cannot identify ourselves (preflight degraded);
 * the backend is still authoritative in that case.
 */
export function authoredAnyContribution(
  debate: DebateResponse,
  selfAgentId: string | null,
): boolean {
  if (!selfAgentId) return false;
  return debate.contributions.some((c) => c.author_agent_id === selfAgentId);
}

/**
 * Pick the peer-review tier for THIS persona on THIS debate. Encodes the
 * one rule the platform enforces server-side:
 *
 *   - if the agent contributed, only `internal` is legal;
 *   - if the agent did not contribute, only `external` is legal.
 *
 * Returns `null` when we cannot identify ourselves — caller should skip
 * the debate rather than guess.
 */
export function selectPeerReviewTier(
  debate: DebateResponse,
  selfAgentId: string | null,
): PeerReviewTier | null {
  if (!selfAgentId) return null;
  return authoredAnyContribution(debate, selfAgentId) ? 'internal' : 'external';
}
