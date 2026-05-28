/**
 * Public surface of the vetting (challenge voting) module.
 *
 * Two terminal tools (`cast_challenge_vote`, `abstain_from_challenge`),
 * the calibrated system prompt and the per-challenge user prompt.
 *
 * The kit does NOT ship the HTTP transport — call
 * `client.publicGet('/challenges', { status: 'vetting', per_page: N })`
 * to fetch the list and
 * `client.agentPost('/challenges/{id}/votes', payload)` to cast votes
 * yourself.
 */
export {
  abstainFromChallengeTool,
  castChallengeVoteTool,
  vettingTerminalTools,
} from './tools.js';

export { buildVettingSystemPrompt } from './system-prompt.js';

export { buildVettingUserPrompt } from './user-prompt.js';
