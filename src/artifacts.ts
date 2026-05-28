import type { DebateResponse, ResearchArtifact } from '@planetary-minds/typescript-sdk';

/**
 * Merge an agent's research artifacts on a single debate, dedup by id.
 *
 * Two input sources, both authoritative:
 *
 *   1. `debate.research_artifacts` — approved-only, any-author (from the
 *      public debate payload). We filter to rows authored by this agent.
 *   2. `ownArtifactsOnDebate` — pending / flagged / approved artifacts
 *      authored by THIS agent on this debate, from the author-scoped
 *      `GET /v1/agent/research-artifacts` listing. The only client-side
 *      view of in-flight jobs — the public debate payload deliberately
 *      omits unapproved rows.
 *
 * Returns an empty list if `selfAgentId` is null (we cannot identify
 * "own" rows without it).
 */
export function mergeOwnArtifactsOnDebate(
  debate: DebateResponse,
  ownArtifactsOnDebate: ResearchArtifact[] | undefined,
  selfAgentId: string | null,
): ResearchArtifact[] {
  if (!selfAgentId) return [];
  const byId = new Map<string, ResearchArtifact>();
  for (const a of ownArtifactsOnDebate ?? []) {
    if (a.author_agent_id === selfAgentId && (a.debate_id ?? null) === debate.id) {
      byId.set(a.id, a);
    }
  }
  for (const a of debate.research_artifacts ?? []) {
    if (a.author_agent_id === selfAgentId && !byId.has(a.id)) {
      byId.set(a.id, a);
    }
  }
  return Array.from(byId.values());
}

/**
 * Collect public URLs of the agent's approved, complete artifacts on this
 * debate so the provenance guardrail treats them as trusted alongside URLs
 * returned by in-turn research-tool calls.
 */
export function collectOwnApprovedArtifactUrls(
  ownOnDebate: readonly ResearchArtifact[],
): Set<string> {
  const urls = new Set<string>();
  for (const artifact of ownOnDebate) {
    if (
      artifact.storage_url &&
      artifact.generation_status === 'complete' &&
      artifact.moderation_status === 'approved'
    ) {
      urls.add(artifact.storage_url);
    }
  }
  return urls;
}

/**
 * Filter to the approved, complete artifacts the agent can legitimately cite
 * via `research_artifact_id`.
 */
export function filterOwnApprovedArtifacts(
  ownOnDebate: readonly ResearchArtifact[],
): ResearchArtifact[] {
  return ownOnDebate.filter(
    (a) => a.generation_status === 'complete' && a.moderation_status === 'approved',
  );
}

/**
 * Of the agent's own approved artifacts on this debate, which ones have NOT
 * yet been cited by any contribution (via `research_artifact_id`)?
 *
 * These are the artifacts the persona should be actively pushed toward
 * posting as an `evidence` node on this turn — the artifact is invisible in
 * the graph until a contribution attaches it.
 */
export function findUnpostedOwnArtifacts(
  ownApproved: readonly ResearchArtifact[],
  debate: DebateResponse,
): ResearchArtifact[] {
  if (ownApproved.length === 0) return [];
  const citedIds = new Set<string>();
  for (const c of debate.contributions) {
    if (c.research_artifact_id) {
      citedIds.add(c.research_artifact_id);
    }
  }
  return ownApproved.filter((a) => !citedIds.has(a.id));
}

/**
 * Decide whether `deepResearch` should be exposed as a tool on this turn.
 *
 * Suppression rules (any match hides the tool):
 *   - an approved artifact authored by this agent already exists on the
 *     debate — cite it via `research_artifact_id` instead of dispatching a
 *     fresh job.
 *   - a pending (provider still running) or flagged artifact from this
 *     agent exists — waiting on reconciliation is cheaper than dispatching
 *     again.
 *
 * Explicitly NOT suppressed by:
 *   - rejected or failed artifacts — the agent is free to retry with a
 *     different query.
 */
export function checkDeepResearchSuppression(
  ownOnDebate: readonly ResearchArtifact[],
): { suppress: false } | { suppress: true; reason: string } {
  if (ownOnDebate.length === 0) return { suppress: false };

  const hasApproved = ownOnDebate.some(
    (a) => a.generation_status === 'complete' && a.moderation_status === 'approved',
  );
  if (hasApproved) {
    return {
      suppress: true,
      reason:
        'you already have an approved research artifact on this debate — cite it via research_artifact_id + matching evidence_url instead of dispatching another job.',
    };
  }

  const hasPendingOrFlagged = ownOnDebate.some(
    (a) =>
      a.generation_status === 'pending' ||
      (a.generation_status === 'complete' &&
        (a.moderation_status === null ||
          a.moderation_status === undefined ||
          a.moderation_status === 'pending' ||
          a.moderation_status === 'flagged')),
  );
  if (hasPendingOrFlagged) {
    return {
      suppress: true,
      reason:
        'you already have a deep-research job in flight (or held for moderation) on this debate — wait for reconciliation rather than dispatching another one.',
    };
  }

  return { suppress: false };
}
