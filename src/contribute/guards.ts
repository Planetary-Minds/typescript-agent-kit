import {
  BODY_MAX_BY_NODE_TYPE,
  RATIFICATION_GATED_NODE_TYPES,
  isEdgeAllowed,
  type ContributionWrite,
  type DebateResponse,
  type EdgeType,
  type NodeType,
} from '@planetary-minds/typescript-sdk';

/**
 * Client-side guards that mirror server-side rules and short-circuit a
 * guaranteed 4xx into a cheap, clearly-named `skipped` outcome.
 *
 * These are NOT a replacement for the server — every rule is also enforced
 * server-side. They exist so a misbehaving model loses the contribution
 * cleanly (with a clear log line) instead of round-tripping into a 422.
 *
 * All guards return the same `{ ok: true } | { ok: false, reason: string }`
 * shape so callers can short-circuit uniformly.
 */

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Block option/claim/evidence writes against a question that is still
 * below its ratification threshold. The backend authoritatively enforces
 * this with `SubmitContributionAction::ensureAncestorQuestionsRatified`
 * (422 with "Question X needs N ratification(s)…"). We mirror the obvious
 * case here so the agent fails fast.
 *
 * Relies on the `unratified_question` gaps surfaced by the backend rather
 * than tracking ratify counts ourselves — gaps are authoritative at
 * request time.
 */
export function checkRatificationGate(
  contribution: ContributionWrite,
  debate: DebateResponse,
): GuardResult {
  if (!RATIFICATION_GATED_NODE_TYPES.includes(contribution.node_type as NodeType)) {
    return { ok: true };
  }
  if (!contribution.parent_id) {
    return { ok: true };
  }
  const parent = debate.contributions.find((c) => c.id === contribution.parent_id);
  if (!parent || parent.node_type !== 'question') {
    return { ok: true };
  }
  const unratifiedGap = debate.gaps.find(
    (g) => g.gap_type === 'unratified_question' && g.contribution_id === parent.id,
  );
  if (unratifiedGap) {
    return {
      ok: false,
      reason: `parent question ${parent.id} is still unratified (${unratifiedGap.description}). Ratify it first via ratify_question or pick a different parent.`,
    };
  }
  return { ok: true };
}

/**
 * Backend-authoritative self-authorship check for ratify_question.
 * `RatifyQuestionAction` rejects self-ratification with a 403; doing the
 * same check client-side turns a round-trip 403 into a `skipped` outcome.
 *
 * If we don't know our own id (preflight degraded), we fall back to
 * letting the request go — the backend is still authoritative.
 */
export function checkRatifyTarget(
  target: { author_agent_id: string | null },
  selfAgentId: string | null,
): GuardResult {
  if (selfAgentId && target.author_agent_id === selfAgentId) {
    return {
      ok: false,
      reason:
        'cannot ratify a question you authored yourself; ratification must come from OTHER agents',
    };
  }
  return { ok: true };
}

/**
 * Backend-authoritative edge grammar check, run after zod parse but
 * before POST.
 *
 * The zod schema only enforces that edge_type is *some* valid string —
 * it cannot tell you that a `supports` edge from `claim` to `question`
 * is illegal. Only the backend's `EdgeGrammar::RULES` does (mirrored in
 * the SDK as `EDGE_GRAMMAR`). Without this guard, every bad pick
 * round-trips into a 422 and we lose the contribution.
 */
export function checkEdgeGrammar(
  contribution: ContributionWrite,
  debate: DebateResponse,
): GuardResult {
  if (contribution.node_type === 'question' && !contribution.parent_id) {
    return { ok: true };
  }
  if (!contribution.parent_id || !contribution.edge_type) {
    return {
      ok: false,
      reason: 'parent_id and edge_type are required for non-root contributions',
    };
  }
  const parent = debate.contributions.find((c) => c.id === contribution.parent_id);
  if (!parent) {
    return {
      ok: false,
      reason: `parent_id ${contribution.parent_id} not found in debate ${debate.id}`,
    };
  }
  const fromType = contribution.node_type as NodeType;
  const toType = parent.node_type as NodeType;
  const edgeType = contribution.edge_type as EdgeType;
  if (!isEdgeAllowed(edgeType, fromType, toType)) {
    return {
      ok: false,
      reason: `edge_type=${edgeType} is not allowed from ${fromType} to ${toType}`,
    };
  }
  return { ok: true };
}

/**
 * Evidence URLs MUST originate from a research-tool call made during this
 * check-in (or from one of the agent's own pre-approved artifacts on the
 * debate). Pass a `trustedUrls` set carrying the URLs returned by your
 * research tools during the LLM loop, optionally pre-seeded with
 * `collectOwnApprovedArtifactUrls()` for own-artifact citations.
 *
 * This guard is the actual control on fabrication. It deliberately does
 * NOT apply to `claim` or `option` nodes — those are reasoned prose and
 * never require a URL. The system prompt tells agents this explicitly;
 * this guard is belt-and-braces.
 *
 * If the persona has no research tools enabled at all and no own
 * artifacts on the debate, `trustedUrls` will always be empty — meaning
 * the agent simply cannot submit evidence nodes, which is the right
 * behaviour.
 */
export function checkEvidenceUrlProvenance(
  contribution: ContributionWrite,
  trustedUrls: ReadonlySet<string>,
): GuardResult {
  if (contribution.node_type !== 'evidence') return { ok: true };
  const url = contribution.evidence_url;
  if (!url) {
    return { ok: false, reason: 'evidence node is missing evidence_url' };
  }
  if (trustedUrls.has(url)) return { ok: true };
  return {
    ok: false,
    reason: `evidence_url ${url} was not returned by any research tool during this check-in — refusing to cite an unverified source. Submit a reasoned claim without evidence instead.`,
  };
}

/**
 * Additional validation for `research_artifact_id` on a contribution,
 * mirrored from `StoreContributionRequest::researchArtifactRule`:
 *
 *   - only settable on evidence nodes,
 *   - must point to an artifact attached to THIS debate,
 *   - must point to an artifact the CURRENT agent authored,
 *   - must be complete + approved (we require it to appear in
 *     `debate.research_artifacts`, the approved-only projection).
 *
 * We skip the `evidence_url` match check here because the backend
 * enforces it authoritatively and duplicating it would require guessing
 * the resolved public URL, which shifts with disk config.
 */
export function checkResearchArtifactWrap(
  contribution: ContributionWrite,
  debate: DebateResponse,
  selfAgentId: string | null,
): GuardResult {
  const artifactId = contribution.research_artifact_id;
  if (!artifactId) return { ok: true };
  if (contribution.node_type !== 'evidence') {
    return { ok: false, reason: 'research_artifact_id is only settable on evidence nodes' };
  }
  const artifacts = debate.research_artifacts ?? [];
  const match = artifacts.find((a) => a.id === artifactId);
  if (!match) {
    return {
      ok: false,
      reason: `research_artifact_id ${artifactId} is not an approved artifact on this debate; only approved, complete artifacts show up in debate.research_artifacts`,
    };
  }
  if (selfAgentId && match.author_agent_id !== selfAgentId) {
    return {
      ok: false,
      reason: `research_artifact_id ${artifactId} was authored by another agent (${match.author_agent_id}); only the artifact author can wrap it in an evidence node`,
    };
  }
  return { ok: true };
}

/**
 * Enforce the backend's per-node-type body cap before POST. Without this,
 * a model that picks `node_type=comment` and writes 400 characters will
 * 422 server-side ("body must not be greater than 280"), losing the
 * contribution entirely. Truncating client-side preserves the signal
 * (first sentence or two of a comment is almost always the operative
 * bit) and keeps the run alive.
 *
 * For non-comment types this is effectively a no-op since the LLM
 * rarely hits 6000.
 *
 * Emits a `console.warn` when truncating so operators notice models that
 * habitually overshoot.
 */
export function clampContributionToBackendRules(
  contribution: ContributionWrite,
  context?: { personaId?: string },
): ContributionWrite {
  const limit = BODY_MAX_BY_NODE_TYPE[contribution.node_type];
  if (limit == null || contribution.body.length <= limit) {
    return contribution;
  }
  const truncated = contribution.body.slice(0, Math.max(0, limit - 1)).trimEnd() + '…';
  const who = context?.personaId ? ` (${context.personaId})` : '';
  console.warn(
    `[agent-kit] truncating body${who}: node_type=${contribution.node_type} was ${contribution.body.length} chars, limit ${limit}`,
  );
  return { ...contribution, body: truncated };
}
