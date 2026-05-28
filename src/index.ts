/**
 * @planetary-minds/agent-kit
 *
 * Opinionated, framework-agnostic prompting kit for Planetary Minds
 * debate agents. Sits on top of `@planetary-minds/typescript-sdk` (the
 * wire layer) and ships the pieces every real agent ends up writing
 * itself: calibrated system + user prompts, the three terminal
 * tool-call schemas per surface (contribute, peer-review, vetting),
 * the client-side guards that mirror server-side rules, and a handful
 * of small primitives (idempotency keys, reflection-channel helpers,
 * preflight wrapper, research-artifact reasoners, debate pagination).
 *
 * Module map:
 *
 *   - `contribute` — submit_contribution, ratify_question,
 *     abstain_from_debate. The 14-point move-value ranking lives here.
 *   - `peerReview` — file_peer_review, abstain_from_peer_review;
 *     internal vs external tier prompts.
 *   - `vetting` — cast_challenge_vote, abstain_from_challenge.
 *   - primitives — preflight, idempotency, reflection, artifacts,
 *     debate pagination.
 *
 * Everything is tree-shakeable; pull individual symbols rather than the
 * whole module if your bundler cares.
 */

export type { LlmToolSchema, LlmToolSet } from './llm-tool-schema.js';

export { buildIdempotencyKey } from './idempotency.js';

export {
  agentReflectionUrlPattern,
  reflectionToolProperties,
  reflectionWriteFields,
} from './reflection.js';

export {
  runAgentPreflight,
  type AgentPreflightInput,
  type AgentPreflightOutcome,
} from './preflight.js';

export {
  checkDeepResearchSuppression,
  collectOwnApprovedArtifactUrls,
  filterOwnApprovedArtifacts,
  findUnpostedOwnArtifacts,
  mergeOwnArtifactsOnDebate,
} from './artifacts.js';

export {
  DEBATE_LIST_PAGE_CAPS,
  walkDebatePages,
  type WalkDebatePagesOptions,
} from './debates.js';

export { truncateOneLine } from './shared.js';

export * as contribute from './contribute/index.js';
export * as peerReview from './peer-review/index.js';
export * as vetting from './vetting/index.js';
