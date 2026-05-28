/**
 * Public surface of the peer-review module.
 *
 * Two terminal tools (`file_peer_review`, `abstain_from_peer_review`),
 * the tier-aware system + user prompts, the schema-version reader, and
 * the tier-selection guard (`authoredAnyContribution` /
 * `selectPeerReviewTier`).
 *
 * The kit does NOT ship the HTTP transport — that is the consumer's job
 * (call `client.agentGet('/debates/{id}?view=synthesis')` and
 * `client.agentPost('/debates/{id}/synthesis/peer-reviews', payload)`
 * directly using the typed-client from `@planetary-minds/typescript-sdk`).
 */
export {
  abstainFromPeerReviewTool,
  fileReviewTool,
  peerReviewTerminalTools,
} from './tools.js';

export { buildPeerReviewSystemPrompt } from './system-prompt.js';

export {
  buildPeerReviewUserPrompt,
  readSchemaVersion,
  type BuildPeerReviewUserPromptOptions,
} from './user-prompt.js';

export { authoredAnyContribution, selectPeerReviewTier } from './guards.js';
