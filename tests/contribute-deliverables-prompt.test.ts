import { describe, expect, it } from 'vitest';
import {
  buildContributionUserPrompt as buildUserPrompt,
  type BuildContributionUserPromptOptions as BuildUserPromptOptions,
} from '../src/contribute/index.js';
import type { DebateResponse } from '@planetary-minds/typescript-sdk';

/**
 * Snapshot-style assertions on the user-prompt builder. The prompt is how agents learn
 * what the brief actually requires, so the deliverables block and the suggested-moves
 * ordering are product-critical: agents that don't see them won't produce procurement-
 * grade output, and the debate will stall at the readiness gate forever.
 *
 * We don't take a literal snapshot because the prompt is long and noisy; we only assert
 * the invariants that matter for the deliverables-first behaviour.
 */

function buildDebate(overrides: Partial<DebateResponse> = {}): DebateResponse {
  return {
    id: 'dbt_1',
    status: 'open',
    question_ratification_threshold: 2,
    signals: {
      coverage: 0.8,
      evidence_density: 1.5,
      contestation: 0.5,
      convergence: 'stable',
      stall_hours: 0,
      total_contributions: 12,
      ratified_questions: 1,
    },
    needs_attention: false,
    contributions: [
      {
        id: 'q1',
        node_type: 'question',
        author_agent_id: 'agt_a',
        title: 'How should the Bogotá BRT fleet transition away from diesel?',
        body: '',
        confidence: null,
        evidence_url: null,
        evidence_excerpt: null,
        evidence_accessed_at: null,
        research_artifact_id: null,
        moderation_status: 'accepted',
        replaces_contribution_id: null,
        is_head: true,
        created_at: null,
      },
      {
        id: 'o1',
        node_type: 'option',
        author_agent_id: 'agt_a',
        title: 'BEV-first with minimal FCEV pilot',
        body: '',
        confidence: null,
        evidence_url: null,
        evidence_excerpt: null,
        evidence_accessed_at: null,
        research_artifact_id: null,
        moderation_status: 'accepted',
        replaces_contribution_id: null,
        is_head: true,
        created_at: null,
      },
    ],
    edges: [],
    gaps: [],
    challenge: null,
    research_artifacts: [],
    ...overrides,
  } as unknown as DebateResponse;
}

function buildChallengeWithDeliverables() {
  return {
    id: 'ch_1',
    title: 'Bogotá BRT fleet transition',
    short_description: 'Transition plan for the Transmilenio fleet.',
    key_question: 'How should the fleet transition?',
    useful_outcome: 'A procurement-grade answer.',
    framing_questions: [
      {
        id: 'fq1',
        position: 0,
        prompt: 'What fleet split between BEV and FCEV is optimal?',
        kind: 'quantitative',
        coverage_status: 'partial',
      },
      {
        id: 'fq2',
        position: 1,
        prompt: 'What is the hydrogen threshold for deployment?',
        kind: 'scoping',
        coverage_status: 'unanswered',
      },
    ],
    deliverables: [
      {
        id: 'd1',
        position: 0,
        title: 'Per-km cost table',
        description: 'Per-technology landed cost.',
        kind: 'cost_table',
        shape_hint: '£/km by technology',
        coverage_status: 'unaddressed',
        linked_framing_question_ids: ['fq1'],
      },
      {
        id: 'd2',
        position: 1,
        title: 'Hydrogen threshold',
        description: 'When (if ever) to deploy FCEV.',
        kind: 'threshold_test',
        shape_hint: '$/kg trigger',
        coverage_status: 'sketched',
        linked_framing_question_ids: ['fq2'],
      },
    ],
  };
}

const BUILD_OPTIONS: BuildUserPromptOptions = {
  researchToolNames: [],
  personaSummary: undefined,
  ownApprovedArtifacts: [],
  unpostedOwnArtifacts: [],
};

describe('buildUserPrompt — full challenge brief', () => {
  it('renders full_description and why_it_matters when the platform sends them', () => {
    const challenge = {
      ...buildChallengeWithDeliverables(),
      full_description:
        'The cake has a known nominal composition (dry basis): nickel 20%, fluorine 13%.',
      why_it_matters: 'Disposal is a six-figure annual cost.',
    } as unknown as DebateResponse['challenge'];
    const prompt = buildUserPrompt(buildDebate({ challenge }), 'ag_self', BUILD_OPTIONS);

    expect(prompt).toContain('Full challenge brief from the submitter');
    expect(prompt).toContain('nickel 20%, fluorine 13%');
    expect(prompt).toContain('do NOT raise an input request for anything already answered below');
    expect(prompt).toContain('Why it matters (submitter): Disposal is a six-figure annual cost.');
  });

  it('omits the brief section entirely on older platforms that do not send it', () => {
    const prompt = buildUserPrompt(
      buildDebate({
        challenge: buildChallengeWithDeliverables() as unknown as DebateResponse['challenge'],
      }),
      'ag_self',
      BUILD_OPTIONS,
    );

    expect(prompt).not.toContain('Full challenge brief from the submitter');
    expect(prompt).not.toContain('Why it matters (submitter):');
  });
});

describe('buildUserPrompt — deliverables block', () => {
  it('renders a Deliverables section listing each declared deliverable with its status', () => {
    const debate = buildDebate({
      challenge: buildChallengeWithDeliverables() as unknown as DebateResponse['challenge'],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', BUILD_OPTIONS);

    expect(prompt).toContain('Deliverables the brief requires');
    expect(prompt).toContain('Per-km cost table');
    expect(prompt).toContain('cost_table');
    expect(prompt).toContain('£/km by technology');
    expect(prompt).toContain('Hydrogen threshold');
    expect(prompt).toContain('threshold_test');
    expect(prompt).toContain('unaddressed');
    expect(prompt).toContain('sketched');
  });

  it('omits the Deliverables section when the challenge has no deliverables', () => {
    const debate = buildDebate({
      challenge: {
        id: 'ch_1',
        title: 't',
        short_description: null,
        framing_questions: [],
        deliverables: [],
      } as unknown as DebateResponse['challenge'],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', BUILD_OPTIONS);

    expect(prompt).not.toContain('Deliverables the brief requires');
  });
});

describe('buildUserPrompt — suggested-moves ordering', () => {
  it('ranks deliverable-gap moves above shape-based moves when deliverable gaps exist', () => {
    const debate = buildDebate({
      challenge: buildChallengeWithDeliverables() as unknown as DebateResponse['challenge'],
      signals: {
        coverage: 0.2, // would normally surface a "coverage is low" suggestion
        evidence_density: 0.0,
        contestation: 0.0,
        convergence: 'diverging',
        stall_hours: 0,
        total_contributions: 5,
        ratified_questions: 1,
      } as unknown as DebateResponse['signals'],
      gaps: [
        {
          contribution_id: null,
          gap_type: 'missing_deliverable',
          description: 'Cost table deliverable unaddressed.',
          suggested_action: 'claim supports option',
          deliverable_id: 'd1',
          deliverable_kind: 'cost_table',
          framing_question_ids: ['fq1'],
        },
        {
          contribution_id: null,
          gap_type: 'shallow_deliverable',
          description: 'Hydrogen threshold sketched only.',
          suggested_action: 'claim supports option',
          deliverable_id: 'd2',
          deliverable_kind: 'threshold_test',
          framing_question_ids: ['fq2'],
        },
      ],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', BUILD_OPTIONS);

    // The deliverable-driven recipe must be the first item in the suggested-moves
    // list. Format updated May 2026 (rec 4): `DELIVERABLE BLOCKER (status=…, kind=…)`
    // replaces the old `deliverable UNADDRESSED` bullet.
    const deliverableIdx = prompt.indexOf('DELIVERABLE BLOCKER');
    const coverageLowIdx = prompt.indexOf('coverage is low');
    expect(deliverableIdx).toBeGreaterThan(-1);
    expect(coverageLowIdx).toBeGreaterThan(-1);
    expect(deliverableIdx).toBeLessThan(coverageLowIdx);

    // Both gap kinds (missing_deliverable + shallow_deliverable) collapse into the
    // same recipe shape — just the status label changes.
    expect(prompt).toContain('status=UNADDRESSED');
    expect(prompt).toContain('status=SKETCHED');

    // The content-bar recipe for cost_table must be embedded so the model knows what
    // "delivered" looks like.
    expect(prompt).toContain('currency-per-unit');

    // And the not_producible escape hatch must be surfaced alongside the deliverable
    // prompts — agents need to know it exists and that it requires a specific phrasing.
    expect(prompt).toContain('cannot be produced');
  });

  it('does not inject deliverable-specific suggestions when no deliverable gaps are present', () => {
    const debate = buildDebate({
      challenge: buildChallengeWithDeliverables() as unknown as DebateResponse['challenge'],
      gaps: [],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', BUILD_OPTIONS);

    expect(prompt).not.toContain('DELIVERABLE BLOCKER');
  });
});

describe('buildUserPrompt — deliverable chain-join recipe (rec 4)', () => {
  // The chain-join rewrite (May 2026) collapses three separate menu items
  // (deliverable, criterion, shape-matching claim) into a single numbered recipe
  // per open deliverable gap. These tests pin the three steps so a future
  // refactor cannot silently revert to disconnected bullets — that was the
  // failure mode that left 96 claims on the testbed graph and zero of them
  // matching any deliverable shape.

  // The fixture mirrors the real shape we observed in the May 2026 testbed:
  // - The challenge `framing_questions[].id` and `deliverables[].linked_framing_question_ids[]`
  //   are BRIEF-side ids ('brief_fq_cost').
  // - The corresponding debate question contribution has a DIFFERENT id
  //   ('q_contrib_cost') and references the brief id via `challenge_question_id`.
  // - `answers` edges target the debate contribution id, NOT the brief id.
  // Without the brief-id → contribution-id translation in renderSuggestedMoves,
  // the candidate-option list would come out empty. This test pins the join.
  function buildChainJoinFixture(overrides: Partial<DebateResponse> = {}): DebateResponse {
    return buildDebate({
      challenge: {
        id: 'ch_1',
        title: 'Cost-bench',
        short_description: 'Test',
        framing_questions: [
          {
            id: 'brief_fq_cost',
            position: 0,
            prompt: 'What is the cost?',
            kind: 'quantitative',
            coverage_status: 'unanswered',
          },
        ],
        deliverables: [
          {
            id: 'dlv_cost',
            position: 0,
            title: 'Cost-benefit table',
            description: 'Per-archetype landed cost vs damage avoided.',
            kind: 'cost_table',
            shape_hint: 'USD/ha cost and USD/ha damage avoided, by archetype',
            coverage_status: 'unaddressed',
            linked_framing_question_ids: ['brief_fq_cost'],
          },
        ],
      } as unknown as DebateResponse['challenge'],
      contributions: [
        {
          id: 'q_contrib_cost',
          node_type: 'question',
          author_agent_id: 'agt_a',
          title: 'What is the cost?',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
          pre_ratified: true,
          challenge_question_id: 'brief_fq_cost',
        },
        {
          id: 'opt_a',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Tiered storm response',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
        {
          id: 'opt_b',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Drainage-first response',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
      ] as unknown as DebateResponse['contributions'],
      edges: [
        { from_contribution_id: 'opt_a', to_contribution_id: 'q_contrib_cost', edge_type: 'answers' },
        { from_contribution_id: 'opt_b', to_contribution_id: 'q_contrib_cost', edge_type: 'answers' },
      ] as unknown as DebateResponse['edges'],
      gaps: [
        {
          contribution_id: null,
          gap_type: 'missing_deliverable',
          description: 'Cost-benefit table unaddressed.',
          suggested_action: 'claim supports option',
          deliverable_id: 'dlv_cost',
          deliverable_kind: 'cost_table',
          // Brief-side id, matching what the platform actually emits.
          framing_question_ids: ['brief_fq_cost'],
        },
      ] as unknown as DebateResponse['gaps'],
      ...overrides,
    });
  }

  it('renders a 3-step recipe naming the criterion id when one is already derived from the deliverable', () => {
    const fixture = buildChainJoinFixture();
    // Inject a criterion node derived from the deliverable.
    fixture.contributions = [
      ...fixture.contributions,
      {
        id: 'crt_cost',
        node_type: 'criterion',
        author_agent_id: 'agt_platform',
        title: 'Cost-benefit table criterion',
        body: 'USD/ha cost and USD/ha damage avoided must be present.',
        confidence: null,
        evidence_url: null,
        evidence_excerpt: null,
        evidence_accessed_at: null,
        research_artifact_id: null,
        moderation_status: 'accepted',
        replaces_contribution_id: null,
        is_head: true,
        created_at: null,
        derived_from_deliverable_id: 'dlv_cost',
      } as unknown as DebateResponse['contributions'][number],
    ];

    const prompt = buildUserPrompt(fixture, 'agt_self', BUILD_OPTIONS);

    expect(prompt).toContain('DELIVERABLE BLOCKER');
    // Step 1 should reference the existing criterion id directly.
    expect(prompt).toMatch(/Step 1 — criterion:.*crt_cost/);
    // Step 2 should pick one of the candidate options as the suggested satisfy-target.
    expect(prompt).toMatch(/Step 2 — wire:.*opt_(a|b)/);
    expect(prompt).toContain('option satisfies criterion crt_cost');
    // Step 3 should anchor the claim to the same option AND embed the literal
    // cost_table template so the LLM can copy-edit it.
    expect(prompt).toMatch(/Step 3 — shape-matching claim:.*claim supports option opt_(a|b)/);
    expect(prompt).toContain('USD 480/ha');
  });

  it('tells the agent to mint a criterion when none exists for the deliverable', () => {
    const prompt = buildUserPrompt(buildChainJoinFixture(), 'agt_self', BUILD_OPTIONS);

    expect(prompt).toContain('DELIVERABLE BLOCKER');
    expect(prompt).toMatch(/Step 1 — criterion: NO criterion is derived/);
    expect(prompt).toContain('node_type=criterion');
    expect(prompt).toContain('edge_type=raises');
    // The candidate option list in step 2 must still surface the two options that
    // answer the linked framing question.
    expect(prompt).toContain('opt_a');
    expect(prompt).toContain('opt_b');
  });

  it('resolves candidate options by translating brief-side framing-question ids to debate-side contribution ids', () => {
    // Regression for the May 2026 live-data bug: the gap's `framing_question_ids` are
    // BRIEF ids, but `answers` edges target the question CONTRIBUTION id. Earlier
    // code keyed the option lookup off the raw `framing_question_ids` and produced
    // an empty candidate list on every well-formed brief-driven debate.
    const prompt = buildUserPrompt(buildChainJoinFixture(), 'agt_self', BUILD_OPTIONS);

    // Both options (opt_a, opt_b) answer the brief framing question, transitively
    // through q_contrib_cost. They must both appear in the step 2 candidate list.
    expect(prompt).toContain('opt_a');
    expect(prompt).toContain('opt_b');
    expect(prompt).not.toMatch(/no option on the graph yet answers any linked framing question/);
  });

  it('anchors step 3 on an option that already satisfies the criterion, even when that option has no answers-edge', () => {
    // Regression for the May 2026 fire-risk debate (01krbnq9hsqa6s7jz6fexb7kqj):
    // an agent minted a NEW option carrying ONLY a satisfies edge (no answers
    // edge to the framing question), so the original option remained the sole
    // entry in `candidateList`. The old recipe used `candidateList[0]` as
    // `claimAnchor`, which pointed step 3 at the wrong option — 15 of the
    // next 18 contributions piled claims onto the unsatisfying old option
    // while both deliverables stayed SKETCHED.  The recipe must now prefer
    // an already-satisfying option, mark it explicitly, and tell the agent
    // not to wire a redundant satisfies edge from a sibling.
    const fixture = buildChainJoinFixture();
    fixture.contributions = [
      ...fixture.contributions,
      // A criterion derived from the deliverable so the "criterion exists"
      // branch fires (mirrors the platform's auto-seed on debate promotion).
      {
        id: 'crt_cost',
        node_type: 'criterion',
        author_agent_id: 'agt_platform',
        title: 'Cost criterion',
        body: 'currency-per-unit tokens required',
        confidence: null,
        evidence_url: null,
        evidence_excerpt: null,
        evidence_accessed_at: null,
        research_artifact_id: null,
        moderation_status: 'accepted',
        replaces_contribution_id: null,
        is_head: true,
        created_at: null,
        derived_from_deliverable_id: 'dlv_cost',
      } as unknown as DebateResponse['contributions'][number],
      // A new option that ONLY satisfies the criterion (no answers edge yet).
      // This is the same shape the LLM produced in the live debate.
      {
        id: 'opt_satisfier',
        node_type: 'option',
        author_agent_id: 'agt_b',
        title: 'Fresh option that satisfies the criterion',
        body: '',
        confidence: null,
        evidence_url: null,
        evidence_excerpt: null,
        evidence_accessed_at: null,
        research_artifact_id: null,
        moderation_status: 'accepted',
        replaces_contribution_id: null,
        is_head: true,
        created_at: null,
      } as unknown as DebateResponse['contributions'][number],
    ];
    fixture.edges = [
      ...fixture.edges,
      // The satisfying option has NO `answers` edge — only the satisfies edge.
      {
        from_contribution_id: 'opt_satisfier',
        to_contribution_id: 'crt_cost',
        edge_type: 'satisfies',
      } as unknown as DebateResponse['edges'][number],
    ];

    const prompt = buildUserPrompt(fixture, 'agt_self', BUILD_OPTIONS);

    // Step 2 must NOT tell the agent to wire another satisfies edge — one is
    // enough for the graph-aware coverage judge. It must also name the
    // already-satisfying option so the agent knows where the wiring landed.
    expect(prompt).toMatch(/Step 2 — wire: DONE/);
    expect(prompt).toContain('opt_satisfier');
    expect(prompt).toMatch(/Do NOT post another `satisfies` edge/);

    // Step 3 must anchor on the satisfying option, not on the answers-edge
    // candidates opt_a / opt_b. The "(this option already has the satisfies
    // edge)" marker is the agent-visible cue that this is the right anchor.
    expect(prompt).toMatch(/Step 3 — shape-matching claim: post `claim supports option opt_satisfier`/);
    expect(prompt).toContain('this option already has the satisfies edge');

    // The candidate-list rendering must flag the satisfying option clearly.
    expect(prompt).toContain('opt_satisfier');
  });

  it('warns when no option answers the linked framing question yet', () => {
    const fixture = buildChainJoinFixture();
    // Strip the answers edges so neither option resolves to the framing question.
    fixture.edges = [];

    const prompt = buildUserPrompt(fixture, 'agt_self', BUILD_OPTIONS);

    expect(prompt).toContain('DELIVERABLE BLOCKER');
    expect(prompt).toMatch(/no option on the graph yet answers any linked framing question/);
  });

  it('suppresses the standalone unsatisfied_criterion bullet when the deliverable gap already covers the same criterion', () => {
    const fixture = buildChainJoinFixture();
    fixture.contributions = [
      ...fixture.contributions,
      {
        id: 'crt_cost',
        node_type: 'criterion',
        author_agent_id: 'agt_platform',
        title: 'Cost criterion',
        body: '',
        confidence: null,
        evidence_url: null,
        evidence_excerpt: null,
        evidence_accessed_at: null,
        research_artifact_id: null,
        moderation_status: 'accepted',
        replaces_contribution_id: null,
        is_head: true,
        created_at: null,
        derived_from_deliverable_id: 'dlv_cost',
      } as unknown as DebateResponse['contributions'][number],
    ];
    fixture.gaps = [
      ...fixture.gaps,
      {
        contribution_id: 'crt_cost',
        gap_type: 'unsatisfied_criterion',
        description: 'Criterion has no satisfier.',
        suggested_action: 'option satisfies criterion',
      } as unknown as DebateResponse['gaps'][number],
    ];

    const prompt = buildUserPrompt(fixture, 'agt_self', BUILD_OPTIONS);

    // The criterion shows up inside the joined recipe (step 1)…
    expect(prompt).toMatch(/Step 1 — criterion:.*crt_cost/);
    // …but NOT as its own standalone bullet (which would be a duplicate).
    expect(prompt).not.toMatch(/^\s*-\s*unsatisfied criterion crt_cost/m);
  });

  it('keeps the standalone unsatisfied_criterion bullet when the criterion is not derived from any deliverable', () => {
    const fixture = buildDebate({
      contributions: [
        {
          id: 'crt_orphan',
          node_type: 'criterion',
          author_agent_id: 'agt_a',
          title: 'Free-standing criterion',
          body: 'Persona-minted bar.',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
          // Deliberately no derived_from_deliverable_id.
        },
      ] as unknown as DebateResponse['contributions'],
      gaps: [
        {
          contribution_id: 'crt_orphan',
          gap_type: 'unsatisfied_criterion',
          description: 'no option satisfies this criterion',
          suggested_action: 'option satisfies criterion',
        },
      ] as unknown as DebateResponse['gaps'],
    });

    const prompt = buildUserPrompt(fixture, 'agt_self', BUILD_OPTIONS);

    expect(prompt).toContain('unsatisfied criterion crt_orphan');
  });

  it('targets step 2 (wire satisfies) as the critical move when the deliverable is UNADDRESSED', () => {
    // Regression for the May 2026 fire-risk debate (01krbnq9hsqa6s7jz6fexb7kqj):
    // 168 contributions, 13 options answering 5 framing questions, every criterion
    // auto-seeded on the graph — and yet zero `option satisfies criterion` edges.
    // The recipe used to tell agents "if you can only afford one move, do step 3
    // (shape-matching claim)". For UNADDRESSED that's wrong: without the satisfies
    // edge from step 2, no amount of shape-matching claims will lift the status.
    const prompt = buildUserPrompt(buildChainJoinFixture(), 'agt_self', BUILD_OPTIONS);

    expect(prompt).toContain('status=UNADDRESSED');
    // The header must explicitly point at step 2 (the satisfies edge) as the
    // critical fallback for UNADDRESSED, NOT step 3.
    expect(prompt).toMatch(/if you can only afford one, do step 2/);
    expect(prompt).toContain('flips UNADDRESSED → SKETCHED');
    // And it must NOT contain the SKETCHED-only fallback language for this fixture.
    expect(prompt).not.toMatch(/if you can only afford one, do step 3/);
  });

  it('targets step 3 (shape-matching claim) as the critical move when the deliverable is SKETCHED', () => {
    // SKETCHED implies the satisfies edge from step 2 is already in place; the
    // platform's coverage judge is grading the claim body against the kind regex
    // and waiting for it to match. The recipe should keep telling agents step 3
    // is the critical move here.
    const fixture = buildChainJoinFixture();
    fixture.gaps = [
      {
        contribution_id: null,
        gap_type: 'shallow_deliverable',
        description: 'sketched',
        suggested_action: 'claim supports option',
        deliverable_id: 'dlv_cost',
        deliverable_kind: 'cost_table',
        framing_question_ids: ['brief_fq_cost'],
      },
    ] as unknown as DebateResponse['gaps'];

    const prompt = buildUserPrompt(fixture, 'agt_self', BUILD_OPTIONS);

    expect(prompt).toContain('status=SKETCHED');
    expect(prompt).toMatch(/if you can only afford one, do step 3/);
    expect(prompt).toContain('SKETCHED → DELIVERED');
  });

  it('embeds the kind-specific template verbatim so the body will pass the platform regex', () => {
    // Spot-check three kinds where the template is non-trivial.
    const kinds: Array<{ kind: string; needle: string }> = [
      { kind: 'cost_table', needle: 'USD 480/ha' },
      { kind: 'threshold_test', needle: 'volumetric water content exceeds 35%' },
      { kind: 'minimum_viable_design', needle: 'Stage 1: pilot LiDAR' },
    ];
    for (const { kind, needle } of kinds) {
      const fixture = buildChainJoinFixture({
        challenge: {
          id: 'ch_1',
          title: 't',
          short_description: null,
          framing_questions: [
            {
              id: 'brief_fq_cost',
              position: 0,
              prompt: 'What is the cost?',
              kind: 'quantitative',
              coverage_status: 'unanswered',
            },
          ],
          deliverables: [
            {
              id: 'dlv_cost',
              position: 0,
              title: 'A deliverable',
              description: 'desc',
              kind,
              shape_hint: 'hint',
              coverage_status: 'unaddressed',
              linked_framing_question_ids: ['brief_fq_cost'],
            },
          ],
        } as unknown as DebateResponse['challenge'],
        gaps: [
          {
            contribution_id: null,
            gap_type: 'missing_deliverable',
            description: 'unaddressed',
            suggested_action: 'claim supports option',
            deliverable_id: 'dlv_cost',
            deliverable_kind: kind,
            framing_question_ids: ['brief_fq_cost'],
          },
        ] as unknown as DebateResponse['gaps'],
      });
      const prompt = buildUserPrompt(fixture, 'agt_self', BUILD_OPTIONS);
      expect(prompt, `template for kind=${kind}`).toContain(needle);
    }
  });
});

describe('buildUserPrompt — per-option scoring in graph dump', () => {
  it('annotates option lines with [supports=N evidence=N objects=N]', () => {
    // Distribution-visibility patch (May 2026): the graph dump must surface a
    // per-option edge tally next to each option so the LLM can see at a glance
    // which option is over-supported and which is starved. Without this the model
    // would have to derive the same counts from the raw edge dump, which it does
    // unreliably — hence the runaway "42-support attractor" we saw in testbed runs.
    const debate = buildDebate({
      contributions: [
        {
          id: 'q1',
          node_type: 'question',
          author_agent_id: 'agt_a',
          title: 'Q',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
          pre_ratified: true,
          origin: 'challenge_brief',
        },
        {
          id: 'o-leader',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Leader option',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
        {
          id: 'o-starved',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Starved sibling',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
        {
          id: 'c-support',
          node_type: 'claim',
          author_agent_id: 'agt_b',
          title: '',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
        {
          id: 'c-object',
          node_type: 'claim',
          author_agent_id: 'agt_c',
          title: '',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
        {
          id: 'e1',
          node_type: 'evidence',
          author_agent_id: 'agt_d',
          title: '',
          body: '',
          confidence: null,
          evidence_url: 'https://example.org/paper',
          evidence_excerpt: 'short excerpt',
          evidence_accessed_at: '2026-01-01',
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
      ] as unknown as DebateResponse['contributions'],
      edges: [
        { from_contribution_id: 'o-leader', to_contribution_id: 'q1', edge_type: 'answers' },
        { from_contribution_id: 'o-starved', to_contribution_id: 'q1', edge_type: 'answers' },
        { from_contribution_id: 'c-support', to_contribution_id: 'o-leader', edge_type: 'supports' },
        { from_contribution_id: 'c-object', to_contribution_id: 'o-leader', edge_type: 'objects_to' },
        { from_contribution_id: 'e1', to_contribution_id: 'o-leader', edge_type: 'supports' },
      ] as unknown as DebateResponse['edges'],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', BUILD_OPTIONS);

    expect(prompt).toContain('id=o-leader (option)');
    expect(prompt).toContain('[supports=1 evidence=1 objects=1]');
    expect(prompt).toContain('id=o-starved (option)');
    expect(prompt).toContain('[supports=0 evidence=0 objects=0]');
    // The annotation must NOT appear on the question line.
    const qLineIdx = prompt.indexOf('id=q1 (question)');
    const nextNewline = prompt.indexOf('\n', qLineIdx);
    const qLine = prompt.slice(qLineIdx, nextNewline);
    expect(qLine).not.toMatch(/\[supports=\d+ evidence=\d+ objects=\d+\]/);
  });

  it('pins the deliverable-satisfying option to Graph nodes and annotates it + its non-satisfying sibling', () => {
    // Regression for the May 2026 fire-risk debate (01krbnq9hsqa6s7jz6fexb7kqj):
    // the satisfying option lived at index 168 of 221 head contributions, was
    // outside the 40-node slice, and was therefore INVISIBLE in the Graph nodes
    // section. Meanwhile the popular non-satisfying sibling dominated the dump
    // with `[supports=74 evidence=3 objects=1]`. The deliverable recipe at the
    // bottom of the prompt was outshouted and agents piled 19 of the next 25
    // supports edges onto the wrong option. Two graph-dump fixes:
    //   1. Satisfier + popular sibling are pinned to the front of the section.
    //   2. Satisfier gets a [SATISFIES …] tail tag; sibling gets [WRONG TARGET …].
    const filler: DebateResponse['contributions'] = [];
    for (let i = 0; i < 45; i++) {
      filler.push({
        id: `filler-${i}`,
        node_type: 'claim',
        author_agent_id: 'agt_filler',
        title: '',
        body: `Filler ${i}`,
        confidence: null,
        evidence_url: null,
        evidence_excerpt: null,
        evidence_accessed_at: null,
        research_artifact_id: null,
        moderation_status: 'accepted',
        replaces_contribution_id: null,
        is_head: true,
        created_at: null,
      } as unknown as DebateResponse['contributions'][number]);
    }
    const debate = buildDebate({
      challenge: {
        id: 'ch_1',
        slug: 'ch-1',
        title: 'Test',
        summary: '',
        notes: '',
        framing_questions: [],
        deliverables: [
          {
            id: 'dlv_landscape',
            position: 0,
            kind: 'minimum_viable_design',
            title: 'Landscape prioritisation rule',
            description: '',
            shape_hint: '',
            coverage_status: 'sketched',
          },
        ],
      } as unknown as DebateResponse['challenge'],
      contributions: [
        // Brief-anchored framing question (challenge_question_id wires the
        // deliverable's framing list to this contribution).
        {
          id: 'q_landscape',
          node_type: 'question',
          author_agent_id: 'agt_platform',
          title: 'How should the landscape be prioritised?',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
          pre_ratified: true,
          origin: 'challenge_brief',
          challenge_question_id: 'cq_landscape',
        } as unknown as DebateResponse['contributions'][number],
        {
          id: 'crt_landscape',
          node_type: 'criterion',
          author_agent_id: 'agt_platform',
          title: 'Landscape rule criterion',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
          derived_from_deliverable_id: 'dlv_landscape',
        } as unknown as DebateResponse['contributions'][number],
        // Popular non-satisfying sibling — appears EARLY in the list (top of
        // the slice on its own) but the deliverable judge doesn't count it.
        {
          id: 'opt_popular',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Popular non-satisfying option',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        } as unknown as DebateResponse['contributions'][number],
        // Filler heads pushed AHEAD of the satisfier so the satisfier falls
        // outside the slice(0, 40) cutoff for the rest-of-graph render.
        ...filler,
        // Late-minted satisfier — at idx > 40.
        {
          id: 'opt_satisfier',
          node_type: 'option',
          author_agent_id: 'agt_b',
          title: 'Quietly satisfying option',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        } as unknown as DebateResponse['contributions'][number],
      ],
      edges: [
        { from_contribution_id: 'opt_popular', to_contribution_id: 'q_landscape', edge_type: 'answers' },
        { from_contribution_id: 'opt_satisfier', to_contribution_id: 'q_landscape', edge_type: 'answers' },
        { from_contribution_id: 'opt_satisfier', to_contribution_id: 'crt_landscape', edge_type: 'satisfies' },
      ] as unknown as DebateResponse['edges'],
      gaps: [
        {
          contribution_id: null,
          gap_type: 'shallow_deliverable',
          description: 'Deliverable has options but no supporting claim contains the expected content.',
          suggested_action: 'claim supports option',
          deliverable_id: 'dlv_landscape',
          deliverable_kind: 'minimum_viable_design',
          framing_question_ids: ['cq_landscape'],
        } as unknown as DebateResponse['gaps'][number],
      ],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', BUILD_OPTIONS);

    const graphStart = prompt.indexOf('Graph nodes (head-only where relevant):');
    const graphEnd = prompt.indexOf('Existing edges (from → to, typed):');
    expect(graphStart).toBeGreaterThan(-1);
    expect(graphEnd).toBeGreaterThan(graphStart);
    const graphBlock = prompt.slice(graphStart, graphEnd);

    // Both must be present in the Graph nodes block, despite the slice(0, 40)
    // boundary. (Without pinning, opt_satisfier would be missing.)
    expect(graphBlock).toContain('id=opt_satisfier');
    expect(graphBlock).toContain('id=opt_popular');

    // The satisfier carries the SATISFIES tail tag.
    const satLineIdx = graphBlock.indexOf('id=opt_satisfier');
    const satLine = graphBlock.slice(satLineIdx, graphBlock.indexOf('\n', satLineIdx));
    expect(satLine).toMatch(/SATISFIES deliverable "Landscape prioritisation rule" \(minimum_viable_design\)/);
    expect(satLine).toContain('supports/evidence MUST land HERE');

    // The popular sibling carries the WRONG TARGET tail tag, naming the satisfier.
    const popLineIdx = graphBlock.indexOf('id=opt_popular');
    const popLine = graphBlock.slice(popLineIdx, graphBlock.indexOf('\n', popLineIdx));
    expect(popLine).toMatch(/WRONG TARGET for deliverable "Landscape prioritisation rule"/);
    // ID is truncated to a 12-char prefix in the annotation to keep the line readable.
    expect(popLine).toContain('opt_satisfie');
    expect(popLine).toContain('Do NOT post supports/evidence here');

    // Pinning order: the satisfier and the popular sibling must appear BEFORE
    // most of the filler so the LLM sees them on its first scan of the section.
    expect(satLineIdx).toBeLessThan(graphBlock.indexOf('id=filler-30'));
    expect(popLineIdx).toBeLessThan(graphBlock.indexOf('id=filler-30'));
  });
});

describe('buildUserPrompt — per-option completeness gaps', () => {
  it('surfaces actionable bullets for uncontested_option AND evidenceless_option gaps', () => {
    // Once the deliverable backlog clears, the next leverage tier is "every
    // option must carry at least one objection and at least one piece of
    // evidence". Before this fix the platform emitted those gaps but the
    // suggested-moves section had no handler, so they only appeared in the
    // truncated "Open gaps" preview at the top of the prompt — and even then,
    // the cap of 8 entries meant most of them fell off when deliverables were
    // unfinished (the deliverable gaps consumed the budget). Live debate
    // 01krbnq9hsqa6s7jz6fexb7kqj exposed this once 3 of 5 deliverables flipped
    // to DELIVERED and 9 uncontested + 7 evidenceless gaps became the dominant
    // unfilled work.
    const debate = buildDebate({
      gaps: [
        {
          contribution_id: 'opt_both',
          gap_type: 'uncontested_option',
          description: 'Option "Both gaps option" has no objections — consider whether it has weaknesses worth naming.',
          suggested_action: 'claim objects_to option',
        },
        {
          contribution_id: 'opt_both',
          gap_type: 'evidenceless_option',
          description: 'Option "Both gaps option" is not backed by evidence; add a source-backed excerpt.',
          suggested_action: 'evidence supports option',
        },
        {
          contribution_id: 'opt_uncontested_only',
          gap_type: 'uncontested_option',
          description: 'Option "Uncontested-only option" has no objections.',
          suggested_action: 'claim objects_to option',
        },
        {
          contribution_id: 'opt_evidenceless_only',
          gap_type: 'evidenceless_option',
          description: 'Option "Evidenceless-only option" is not backed by evidence.',
          suggested_action: 'evidence supports option',
        },
      ] as unknown as DebateResponse['gaps'],
      contributions: [
        {
          id: 'opt_both',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Both gaps option',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
        {
          id: 'opt_uncontested_only',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Uncontested-only option',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
        {
          id: 'opt_evidenceless_only',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Evidenceless-only option',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
      ] as unknown as DebateResponse['contributions'],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', BUILD_OPTIONS);
    const start = prompt.indexOf('Suggested moves (ranked');
    expect(start).toBeGreaterThan(-1);
    const block = prompt.slice(start);

    // Combined-gap option gets a "structurally incomplete option" bullet (the
    // most actionable framing — agent picks whichever lever they're best at).
    expect(block).toMatch(/structurally incomplete option opt_both/);
    expect(block).toMatch(/NO objections AND NO evidence/);
    expect(block).toContain('Both gaps option');

    // Single-gap options get their specific bullets.
    expect(block).toMatch(/uncontested option opt_uncontested_only/);
    expect(block).toContain('Uncontested-only option');
    expect(block).toMatch(/evidence-less option opt_evidenceless_only/);
    expect(block).toContain('Evidenceless-only option');

    // Combined-gap bullets sort BEFORE single-gap ones so the LLM tackles the
    // highest-leverage targets first (an option with neither evidence nor an
    // objection contributes nothing to synthesis).
    const idxBoth = block.indexOf('structurally incomplete option opt_both');
    const idxUncOnly = block.indexOf('uncontested option opt_uncontested_only');
    const idxEvOnly = block.indexOf('evidence-less option opt_evidenceless_only');
    expect(idxBoth).toBeLessThan(idxUncOnly);
    expect(idxBoth).toBeLessThan(idxEvOnly);
  });
});

describe('buildUserPrompt — distribution signals', () => {
  it('translates an under_supported_option gap into a HIGH-LEVERAGE move pointed at the starved option', () => {
    const debate = buildDebate({
      gaps: [
        {
          contribution_id: 'o-starved',
          gap_type: 'under_supported_option',
          description:
            'Option "Starved sibling" on "Q" has zero evidence, while the leading option on the same question has 4.',
          suggested_action: 'evidence supports option',
        },
      ] as unknown as DebateResponse['gaps'],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', BUILD_OPTIONS);

    expect(prompt).toContain('under-supported option o-starved');
    expect(prompt).toContain('HIGH-LEVERAGE MOVE');
    expect(prompt).toContain('not the leader');
    expect(prompt).toContain('evidence supports option');
  });

  it('emits an evidence_concentration nudge when concentration >= 3 and research tools are available', () => {
    const debate = buildDebate({
      contributions: [
        {
          id: 'o1',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Leader',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
        {
          id: 'o2',
          node_type: 'option',
          author_agent_id: 'agt_a',
          title: 'Sibling',
          body: '',
          confidence: null,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
      ] as unknown as DebateResponse['contributions'],
      signals: {
        coverage: 1.0,
        evidence_density: 2.0,
        evidence_concentration: 4.0,
        contestation: 0.5,
        convergence: 'stable',
        stall_hours: 0,
        total_contributions: 20,
        ratified_questions: 1,
      } as unknown as DebateResponse['signals'],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', {
      ...BUILD_OPTIONS,
      researchToolNames: ['semanticScholarSearch'],
    });

    // Both the raw signal line and the suggested move should surface the concentration.
    expect(prompt).toContain('evidence_concentration=4.00');
    expect(prompt).toContain('evidence_concentration is high (4.00)');
    expect(prompt).toContain('starved sibling');
  });

  it('omits the concentration nudge when concentration is low', () => {
    const debate = buildDebate({
      signals: {
        coverage: 1.0,
        evidence_density: 2.0,
        evidence_concentration: 1.2,
        contestation: 0.5,
        convergence: 'stable',
        stall_hours: 0,
        total_contributions: 20,
        ratified_questions: 1,
      } as unknown as DebateResponse['signals'],
    });

    const prompt = buildUserPrompt(debate, 'agt_self', {
      ...BUILD_OPTIONS,
      researchToolNames: ['semanticScholarSearch'],
    });

    expect(prompt).toContain('evidence_concentration=1.20');
    expect(prompt).not.toContain('evidence_concentration is high');
  });
});
