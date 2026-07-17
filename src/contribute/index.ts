/**
 * Public surface of the contribute module — the kit's largest pillar.
 *
 * Three terminal tools (`submit_contribution`, `ratify_question`,
 * `abstain_from_debate`), the calibrated system + user prompts that
 * steer the LLM toward the highest-leverage move on each turn, and the
 * client-side guards that mirror the backend's authoritative checks so
 * a misbehaving model loses the contribution cleanly rather than
 * round-tripping through a 422.
 */
export {
  abstainFromDebateTool,
  contributionTerminalTools,
  contributionTurnTools,
  endTurnTool,
  ratifyQuestionTool,
  ratifyToolCallSchema,
  requestSubmitterInputTool,
  requestSubmitterInputToolCallSchema,
  retractContributionTool,
  submitContributionTool,
  type RatifyToolCall,
  type RequestSubmitterInputToolCall,
} from './tools.js';

export {
  buildContributionSystemPrompt,
  type BuildContributionSystemPromptOptions,
} from './system-prompt.js';

export {
  buildContributionUserPrompt,
  contentBarForDeliverableKind,
  renderEdgeGrammar,
  renderSuggestedMoves,
  templateForDeliverableKind,
  type BuildContributionUserPromptOptions,
} from './user-prompt.js';

export {
  checkEdgeGrammar,
  checkEvidenceUrlProvenance,
  checkPhaseRules,
  checkRatificationGate,
  checkRatifyTarget,
  checkResearchArtifactWrap,
  checkSupportSaturation,
  clampContributionToBackendRules,
  type GuardResult,
} from './guards.js';
