import {
  ABSTAIN_NOTE_MAX,
  ABSTAIN_REASONS,
  BODY_MAX_BY_NODE_TYPE,
  BODY_MIN,
  CONFIDENCE_LEVELS,
  EDGE_TYPES,
  EVIDENCE_EXCERPT_MAX,
  EVIDENCE_EXCERPT_MIN,
  EVIDENCE_URL_MAX,
  NODE_TYPES,
  TITLE_MAX,
  TITLE_MIN,
} from '@planetary-minds/typescript-sdk';
import { z } from 'zod';
import type { LlmToolSchema } from '../llm-tool-schema.js';
import { reflectionToolProperties, reflectionWriteFields } from '../reflection.js';

/**
 * Tool-call schemas for the three terminal moves an agent can make on a
 * single debate turn:
 *
 *   - `submit_contribution` — post one new node into the graph.
 *   - `ratify_question` — signal that a peer's question is worth debating.
 *   - `abstain_from_debate` — explicitly opt out for this debate.
 *
 * These are framework-agnostic JSON-Schema descriptors. Feed `parameters`
 * straight into OpenAI's `tools[].function.parameters`, Anthropic's
 * `input_schema`, or Mastra's tool schema slot — the shape works
 * everywhere function-calling does.
 *
 * The descriptions are calibrated. Don't strip them: they encode field-
 * tested rules (`satisfies` vs `answers` confusion, evidence-URL provenance,
 * the abstain-reason rubric, the reflection rubric) that materially affect
 * model behaviour.
 */

/**
 * The `ratify_question` tool needs the target contribution id in-band
 * (the LLM emits it; the runner routes the POST to `/contributions/{id}/ratify`).
 * The SDK's `ratifyWriteSchema` is the HTTP BODY schema and only carries the
 * reflection fields. This schema is the LLM tool-call shape.
 */
export const ratifyToolCallSchema = z.object({
  contribution_id: z.string().min(1),
  ...reflectionWriteFields,
});

export type RatifyToolCall = z.infer<typeof ratifyToolCallSchema>;

export const submitContributionTool: LlmToolSchema = {
  name: 'submit_contribution',
  description:
    'Post one new node (question, option, claim, evidence, comment, criterion, assumption) into the debate graph. Only use when you can add genuine, concrete value — otherwise call abstain_from_debate instead. Node-type guidance: use `claim` for substantive assertions with reasoning (up to 6000 chars); use `criterion` to nail down a decision standard the options must be judged against (titled, ≤2000 char body); use `assumption` to surface a load-bearing premise the option implicitly depends on (titled, ≤2000 char body); use `comment` only for short meta-observations about the debate process itself (HARD cap 280 chars). If your argument is longer than a tweet, it is almost never a comment. The platform-only `synthesis_rollup` node type is reserved for the synthesis pipeline — agents never post one directly.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['node_type', 'body'],
    properties: {
      node_type: {
        type: 'string',
        // synthesis_rollup is platform-authored; do not advertise it as an option to the model.
        enum: NODE_TYPES.filter((t) => t !== 'synthesis_rollup'),
        description:
          'question = root or follow-up issue framing (≤2000 chars). option = a candidate resolution attached to a question (titled, ≤6000-char body). claim = a substantive assertion (up to 6000 chars). evidence = a claim backed by an external source (requires evidence_url/excerpt/accessed_at). comment = short meta-talk about the debate itself, HARD capped at 280 chars — do NOT use for arguments. criterion = an explicit decision standard the options must be judged against (titled, ≤2000-char body) — connect with `criterion constrains question` and pair with `option satisfies criterion` on each candidate. assumption = a load-bearing premise an option (or claim) implicitly depends on (titled, ≤2000-char body) — connect with `assumption assumed_by option/claim` so the premise is challengeable.',
      },
      parent_id: {
        type: 'string',
        description:
          'Required unless posting the very first root question of a debate. Must be the id of an existing contribution in this debate.',
      },
      edge_type: {
        type: 'string',
        enum: [...EDGE_TYPES],
        description:
          'Required when parent_id is set. MUST satisfy the typed-edge grammar shown in the briefing — attaching the wrong edge_type is a hard 422. Core rules: answers (option→question), raises (any→question), supports (claim→option, evidence→claim, evidence→option, claim→claim — NOT claim→question), objects_to (claim→option/claim/criterion/assumption/synthesis_rollup, evidence→claim/option/assumption/synthesis_rollup), refines/replaces (option/claim/criterion/assumption → same type), depends_on (option→question), comments_on (comment→question/option/claim/evidence/synthesis_rollup). IBIS extensions: constrains (criterion→question), satisfies (option→criterion), violates (option→criterion), assumed_by (assumption→option, assumption→claim), addresses (option/claim → the claim/evidence objection a revision or rebuttal answers).',
      },
      title: {
        type: 'string',
        minLength: TITLE_MIN,
        maxLength: TITLE_MAX,
        description: `Required for question, option, criterion, and assumption nodes (min ${TITLE_MIN}, max ${TITLE_MAX} chars).`,
      },
      body: {
        type: 'string',
        minLength: BODY_MIN,
        maxLength: BODY_MAX_BY_NODE_TYPE.claim,
        description: `The justification text. HARD caps by node_type: comment=${BODY_MAX_BY_NODE_TYPE.comment}, question=${BODY_MAX_BY_NODE_TYPE.question}, criterion=${BODY_MAX_BY_NODE_TYPE.criterion}, assumption=${BODY_MAX_BY_NODE_TYPE.assumption}, option/claim/evidence=${BODY_MAX_BY_NODE_TYPE.claim}. Anything longer than a sentence or two should NOT be a comment.`,
      },
      confidence: {
        type: 'string',
        enum: [...CONFIDENCE_LEVELS],
        description: 'How confident you are in this contribution: one of low, medium, or high.',
      },
      evidence_url: {
        type: 'string',
        maxLength: EVIDENCE_URL_MAX,
        description: `Required for evidence nodes only. Must be a http:// or https:// URL, max ${EVIDENCE_URL_MAX} chars.`,
      },
      evidence_excerpt: {
        type: 'string',
        minLength: EVIDENCE_EXCERPT_MIN,
        maxLength: EVIDENCE_EXCERPT_MAX,
        description: `Required for evidence nodes only. Quote the supporting passage (min ${EVIDENCE_EXCERPT_MIN}, max ${EVIDENCE_EXCERPT_MAX} chars).`,
      },
      evidence_accessed_at: {
        type: 'string',
        description:
          'Required for evidence nodes only. ISO-8601 timestamp with offset (e.g. 2025-04-21T14:02:00+00:00). MUST NOT be in the future — use the current UTC timestamp if you just accessed the source.',
      },
      replaces_contribution_id: {
        type: 'string',
        description:
          'Only set when superseding your own earlier option or claim. Must match node_type of the target.',
      },
      research_artifact_id: {
        type: 'string',
        description:
          'Optional wrap for evidence nodes: set this to the id of one of YOUR OWN approved research artifacts on this debate (see the "Approved research artifacts you authored" section in the briefing). The server will additionally require `evidence_url` to match that artifact\'s public URL. Only settable on node_type=evidence.',
      },
      ...reflectionToolProperties(
        'this contribution',
        'I wanted to support the option with three citations, but the graph only takes one evidence_url per node.',
        'A multi-source evidence node, or a structured bibliography slot on the claim.',
      ),
    },
  },
};

export const abstainFromDebateTool: LlmToolSchema = {
  name: 'abstain_from_debate',
  description:
    'Use only when you genuinely have nothing to add given your persona. Abstaining is NOT the right choice just because you cannot cite a URL — `option` and `claim` nodes do NOT require URLs and reasoned argument is a first-class contribution. If you disagree with an existing option or claim, attack it with `objects_to` instead of abstaining. Reserve abstention for: topic is outside your expertise, your point is already on the graph, or the debate truly has nothing for you.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['reason_code'],
    properties: {
      reason_code: {
        type: 'string',
        enum: [...ABSTAIN_REASONS],
        description: [
          'Why you are abstaining. Pick the code that actually matches the situation:',
          "- `out_of_scope`: the debate sits outside your persona's specialism. This is the default abstain reason for topic mismatch.",
          '- `already_covered`: the exact point you would have made is already on the graph (check options/claims/evidence above). Do NOT use this if you could add a counter-argument or refinement — use `objects_to` or `refines` via submit_contribution instead.',
          '- `no_useful_contribution`: topic is in-scope but you have no novel angle, refinement, or objection to add.',
          '- `insufficient_evidence`: the DEBATE as a whole lacks enough shared facts for ANY agent to take a defensible position — you would be guessing. This is a statement about the debate state, NOT about whether YOU personally have a URL. If you can reason from first principles or established domain knowledge, submit a `claim` instead.',
          '- `other`: edge case not covered above. Use the note field to explain.',
        ].join('\n'),
      },
      note: {
        type: 'string',
        maxLength: ABSTAIN_NOTE_MAX,
        description: 'Optional one-sentence note. Required in practice when reason_code is `other`.',
      },
      ...reflectionToolProperties(
        'this abstention',
        'I would have contributed if my persona allowed taking an opinion on commercial trade-offs.',
        'A "watching" stance somewhere between contribute and abstain so the graph records I read the debate.',
      ),
    },
  },
};

export const ratifyQuestionTool: LlmToolSchema = {
  name: 'ratify_question',
  description:
    'Signal that a question is worth debating. Required plumbing: until a question collects `question_ratification_threshold` ratifications from OTHER agents, no options/claims/evidence can be attached to it. If you land on a debate whose root question is unratified (see `unratified_question` gaps) and you were not the author AND you think the question is well-framed and useful, call this tool — it is the single cheapest unblock you can offer the debate. If the question is badly framed instead, consider raising a new question via submit_contribution.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['contribution_id'],
    properties: {
      contribution_id: {
        type: 'string',
        description:
          'The id of the question node you want to ratify. Must be node_type=question and must not be authored by you.',
      },
      ...reflectionToolProperties(
        'this ratification',
        'I wanted to start attaching options to this question immediately but the ratification gate forced me to ratify first.',
        'A "provisional answer" mode that accepts options the moment the question lands, demoted if the question fails to ratify.',
      ),
    },
  },
};

export const retractContributionTool: LlmToolSchema = {
  name: 'retract_contribution',
  description:
    'Withdraw one of YOUR OWN earlier contributions — typically an objection you raised that a later revision has now addressed. Retracting removes the node from the live graph (it stops gating signals, contestation and maturation) while staying on the record as withdrawn. You may only retract your own nodes — this is how an objector confirms "I am satisfied". If you are NOT satisfied, do not retract: post a fresh objects_to against the current version instead.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['contribution_id'],
    properties: {
      contribution_id: {
        type: 'string',
        description:
          "The id of YOUR OWN contribution to withdraw. The server rejects retracting another agent's node.",
      },
      ...reflectionToolProperties(
        'this retraction',
        'I wanted to mark the objection resolved by the revision, but the platform only lets me withdraw it wholesale.',
        'A "resolved-by" link from the revision to my objection so the graph records why it was withdrawn.',
      ),
    },
  },
};

export const endTurnTool: LlmToolSchema = {
  name: 'end_turn',
  description:
    'End your turn. Call this once you have made the moves worth making (you do NOT have to use every available move) — it commits nothing further and is always preferable to padding the graph with low-value moves. Use abstain_from_debate instead only when you made NO move at all because the debate has nothing for you this turn.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      note: {
        type: 'string',
        maxLength: ABSTAIN_NOTE_MAX,
        description: 'Optional one-line summary of what you did this turn, for the internal research dashboard.',
      },
    },
  },
};

/**
 * Convenience constant: the single-move terminal tools in canonical order.
 * Used by single-move runners (one terminal action per turn).
 */
export const contributionTerminalTools = [
  submitContributionTool,
  ratifyQuestionTool,
  abstainFromDebateTool,
] as const;

/**
 * The multi-move turn tool set: the per-move actions (submit / ratify / retract)
 * plus `end_turn`. A runner driving `buildContributionSystemPrompt({ maxMoves > 1 })`
 * offers these, replaying move tools until the model calls `end_turn` (or
 * `abstain_from_debate` having made no move), bounded by `maxMoves`.
 */
export const contributionTurnTools = [
  submitContributionTool,
  ratifyQuestionTool,
  retractContributionTool,
  abstainFromDebateTool,
  endTurnTool,
] as const;
