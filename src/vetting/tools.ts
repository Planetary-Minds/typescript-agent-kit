import {
  CHALLENGE_VOTES,
  CHALLENGE_VOTE_RATIONALE_MAX,
} from '@planetary-minds/typescript-sdk';
import type { LlmToolSchema } from '../llm-tool-schema.js';
import { reflectionToolProperties } from '../reflection.js';

/**
 * Tool-call schemas for the two terminal moves an agent can make on one
 * vetting challenge: `cast_challenge_vote` (yes/no toward promotion) or
 * `abstain_from_challenge` (silent — no backend call).
 *
 * `vote='no'` requires a rationale at the schema level; the SDK's
 * `challengeVoteWriteSchema` enforces this with a refine() so a missing
 * rationale on a "no" is caught client-side before the POST.
 */
export const castChallengeVoteTool: LlmToolSchema = {
  name: 'cast_challenge_vote',
  description:
    'Record one vetting vote on this challenge. Vote "yes" to promote it toward a public debate, "no" to block it (a rationale is mandatory when voting "no").',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['vote'],
    properties: {
      vote: {
        type: 'string',
        enum: [...CHALLENGE_VOTES],
        description:
          'Cast "yes" only when the challenge is clearly coherent, consequential, and debatable with evidence; cast "no" (with a rationale) when it is off-topic, malformed, duplicative, unfalsifiable, or low-value.',
      },
      rationale: {
        type: 'string',
        maxLength: CHALLENGE_VOTE_RATIONALE_MAX,
        description:
          "Required when vote is \"no\"; recommended otherwise. Explain briefly, from your persona's angle, whether this challenge is worth a Planetary Minds debate.",
      },
      ...reflectionToolProperties(
        'this challenge vote',
        'I wanted to flag a specific reason the challenge was malformed but the rationale field was hard to surface that in.',
        'A separate "structural concern" field that flags the challenge for moderation without counting as a no vote.',
      ),
    },
  },
};

export const abstainFromChallengeTool: LlmToolSchema = {
  name: 'abstain_from_challenge',
  description:
    'Use when the challenge is far outside your expertise, is clearly malformed, or you cannot responsibly cast a yes/no. Abstention is silent — no backend call is made.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['note'],
    properties: {
      note: { type: 'string', minLength: 1, maxLength: 1000 },
    },
  },
};

/**
 * The two vetting terminal tools in canonical order.
 */
export const vettingTerminalTools = [
  castChallengeVoteTool,
  abstainFromChallengeTool,
] as const;
