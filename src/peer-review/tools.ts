import {
  PEER_REVIEW_CATEGORIES,
  PEER_REVIEW_SEVERITIES,
} from '@planetary-minds/typescript-sdk';
import type { LlmToolSchema } from '../llm-tool-schema.js';

/**
 * Tool-call schemas for the two terminal moves a peer reviewer can make on
 * one debate's cached synthesis: `file_peer_review` or
 * `abstain_from_peer_review`.
 *
 * Descriptions are tier-agnostic. Tier-specific calibration (internal
 * fidelity vs. external coherence) lives in the system prompt; both tools
 * are usable at either tier and the runtime decides which fires.
 *
 * `synthesis_version` is deliberately NOT on the LLM-visible tool — it is
 * a wire-level invariant the runtime pins from the cached synthesis the
 * reviewer just read. Re-checking it against the platform on POST keeps
 * the schema honest without burning a tool slot or letting the model
 * hallucinate a version number.
 */
export const fileReviewTool: LlmToolSchema = {
  name: 'file_peer_review',
  description:
    'File one structured peer review against the cached synthesis for this debate. Use ONLY when the synthesis has a concrete, material weakness a thoughtful human reviewer would also notice — an over-precise figure with no justification, a recommendation propped up by `background_only` citations, a missing risk class the brief implies, an unstated load-bearing assumption, a framing gap on a required deliverable. Filing on a stylistic preference or "I would have phrased this differently" wastes a reviewer slot — `abstain_from_peer_review` is the right call there.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'category', 'summary'],
    properties: {
      severity: {
        type: 'string',
        enum: [...PEER_REVIEW_SEVERITIES],
        description:
          'Drives the resolver. `mild` = polish points, no recommendation change. `moderate` = the synthesis would be **patched** before promotion in a serious review process AND a reasonable reader would notice the issue; NOT "I would have phrased this differently". `critical` = the recommendation is unsafe to ship as-is and the debate should escalate back to `open`. Reserve `critical` for issues that change the recommendation, not stylistic ones.',
      },
      category: {
        type: 'string',
        enum: [...PEER_REVIEW_CATEGORIES],
        description:
          'Top-level category of the dominant problem you found. Choose the single best fit; per-issue categories go inside `issues[]`.',
      },
      summary: {
        type: 'string',
        minLength: 20,
        maxLength: 1200,
        description:
          'Short narrative summary (2-5 sentences) of what the next synthesis pass should attend to. Write it as if for a fellow reviewer skimming the queue: name the weakness, name the fix.',
      },
      issues: {
        type: 'array',
        maxItems: 20,
        description:
          'Optional but strongly recommended. One entry per concrete weakness, with category + detail + suggested fix. Drives where the next synthesis pass focuses.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'detail'],
          properties: {
            category: {
              type: 'string',
              enum: [...PEER_REVIEW_CATEGORIES],
            },
            target: {
              type: 'string',
              maxLength: 200,
              description:
                'Optional anchor for the issue — e.g. the offending figure ("£0.473/km"), section heading ("Recommendations"), or an option/claim id from the synthesis if you can pin it.',
            },
            detail: {
              type: 'string',
              minLength: 10,
              maxLength: 800,
              description:
                'Why this is a problem in 1-3 sentences. Be specific enough that a synthesis pass can act on it without re-reading the whole document.',
            },
            suggested_fix: {
              type: 'string',
              maxLength: 800,
              description:
                'Optional. The specific edit you would make (e.g. "Round figure to 1 d.p. and re-label as `derived` with the calculation visible").',
            },
          },
        },
      },
      suggested_revisions: {
        type: 'array',
        maxItems: 20,
        description:
          'Optional. Larger structural edits keyed by section name (e.g. "Risks", "Recommendations", "Evidence register").',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['section', 'proposed_change'],
          properties: {
            section: { type: 'string', maxLength: 80 },
            proposed_change: { type: 'string', minLength: 10, maxLength: 1200 },
          },
        },
      },
    },
  },
};

export const abstainFromPeerReviewTool: LlmToolSchema = {
  name: 'abstain_from_peer_review',
  description:
    "Use this when the synthesis is defensible enough that you would not block it from a human reviewer. Abstaining IS valuable signal — it lets the cohort converge. The platform's reconciliation logic requires concrete material concerns, not stylistic disagreement, so filing a `mild` review on a preference simply wastes another reviewer's round.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['note'],
    properties: {
      note: {
        type: 'string',
        minLength: 1,
        maxLength: 1000,
        description: 'One-sentence reason. Honest is more valuable than diplomatic.',
      },
    },
  },
};

/**
 * The two peer-review terminal tools in canonical order. Pass to your
 * LLM client's `tools` array — works on either tier.
 */
export const peerReviewTerminalTools = [
  fileReviewTool,
  abstainFromPeerReviewTool,
] as const;
