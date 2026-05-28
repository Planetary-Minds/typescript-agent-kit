import { describe, expect, it } from 'vitest';
import type { DebateResponse, SynthesisAdditions } from '@planetary-minds/typescript-sdk';
import {
  authoredAnyContribution,
  buildPeerReviewSystemPrompt,
  buildPeerReviewUserPrompt,
  readSchemaVersion,
  selectPeerReviewTier,
} from '../src/peer-review/index.js';

const SELF_AGENT_ID = 'agt_self';
const OTHER_AGENT_ID = 'agt_other';
const DEBATE_ID = 'dbt_pr_1';

function makeDebate(overrides: Partial<DebateResponse> = {}): DebateResponse {
  return {
    id: DEBATE_ID,
    status: 'peer_review',
    question_ratification_threshold: 2,
    challenge: {
      id: 'chl_1',
      title: 'Bogotá BRT diesel transition',
      short_description: 'How to decarbonise the BRT fleet by 2035.',
      key_question: null,
      useful_outcome: 'A defensible 10-year rollout plan.',
    },
    signals: {
      coverage: 0.9,
      evidence_density: 1.5,
      contestation: 0.4,
      convergence: 'stable',
      stall_hours: 0,
      total_contributions: 18,
      ratified_questions: 2,
    },
    needs_attention: false,
    contributions: [
      {
        id: 'q1',
        node_type: 'question',
        author_agent_id: OTHER_AGENT_ID,
        title: 'How should the fleet transition?',
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
    ...overrides,
  } as unknown as DebateResponse;
}

function syntheticV5Synthesis(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 5,
    title: 'Bogotá BRT diesel transition — synthesis',
    executive_summary:
      'The recommendation is a phased BEV-first rollout with FCEV trial. Estimated unit cost £0.473/km is illustrative.',
    proposed_resolutions: [
      {
        recommendation:
          'Adopt a BEV-first plan from 2026 with 300 buses by 2028 and 600 by 2031, gated on substation upgrades.',
      },
    ],
    deliverables: [
      {
        id: 'dlv_1',
        title: 'Cost table',
        kind: 'cost_table',
        status: 'produced',
        body: '£0.473/km BEV, £1.2M/bus, £850k/depot retrofit.',
      },
    ],
    references: [{ url: 'https://example.test/brt-2024.pdf', support_level: 'background_only' }],
    figure_citations: [
      {
        id: 'fc_1',
        figure: '£0.473/km',
        evidence_label: 'derived',
        justification: 'Computed from total cost over kilometres.',
      },
    ],
    core_assumptions: [],
    options_considered: [],
    risks_and_safeguards: [],
    ...overrides,
  };
}

describe('readSchemaVersion', () => {
  it('returns the integer schema version when present', () => {
    expect(readSchemaVersion({ schema_version: 5 })).toBe(5);
  });

  it('returns null when missing', () => {
    expect(readSchemaVersion({})).toBeNull();
  });

  it('returns null for non-positive or non-numeric values', () => {
    expect(readSchemaVersion({ schema_version: 0 })).toBeNull();
    expect(readSchemaVersion({ schema_version: '5' })).toBeNull();
    expect(readSchemaVersion({ schema_version: NaN })).toBeNull();
  });
});

describe('authoredAnyContribution', () => {
  it('detects when self has any contribution', () => {
    const base = makeDebate();
    const debate = makeDebate({
      contributions: [
        ...base.contributions,
        {
          id: 'c_self',
          node_type: 'claim',
          author_agent_id: SELF_AGENT_ID,
          title: null,
          body: 'My own claim.',
          confidence: 60,
          evidence_url: null,
          evidence_excerpt: null,
          evidence_accessed_at: null,
          research_artifact_id: null,
          moderation_status: 'accepted',
          replaces_contribution_id: null,
          is_head: true,
          created_at: null,
        },
      ] as DebateResponse['contributions'],
    });
    expect(authoredAnyContribution(debate, SELF_AGENT_ID)).toBe(true);
  });

  it('returns false when no contributions are self-authored', () => {
    expect(authoredAnyContribution(makeDebate(), SELF_AGENT_ID)).toBe(false);
  });

  it('returns false when self id is unknown', () => {
    expect(authoredAnyContribution(makeDebate(), null)).toBe(false);
  });
});

describe('selectPeerReviewTier', () => {
  it('returns internal when the agent has contributed', () => {
    const base = makeDebate();
    const debate = makeDebate({
      contributions: [
        ...base.contributions,
        {
          id: 'c_self',
          node_type: 'claim',
          author_agent_id: SELF_AGENT_ID,
          title: null,
          body: 'mine',
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
      ] as DebateResponse['contributions'],
    });
    expect(selectPeerReviewTier(debate, SELF_AGENT_ID)).toBe('internal');
  });

  it('returns external when the agent has not contributed', () => {
    expect(selectPeerReviewTier(makeDebate(), SELF_AGENT_ID)).toBe('external');
  });

  it('returns null when self id is unknown', () => {
    expect(selectPeerReviewTier(makeDebate(), null)).toBeNull();
  });
});

describe('buildPeerReviewSystemPrompt', () => {
  it('does not nudge external reviewers to default to filing', () => {
    const prompt = buildPeerReviewSystemPrompt('You are a methodology auditor.', 'external');
    expect(prompt).not.toContain('Default to filing');
    expect(prompt).not.toContain('default to filing');
    expect(prompt).not.toMatch(
      /even a `mild` review with one concrete issue is more valuable than abstaining/i,
    );
  });

  it('explicitly permits abstention as valuable signal for external reviewers', () => {
    const prompt = buildPeerReviewSystemPrompt('You are a methodology auditor.', 'external');
    expect(prompt).toMatch(/Abstain when the synthesis is defensible/i);
    expect(prompt).toMatch(/abstaining IS valuable signal/i);
  });

  it('sharpens the moderate-severity bar away from "I would have phrased this differently"', () => {
    const externalPrompt = buildPeerReviewSystemPrompt('persona', 'external');
    expect(externalPrompt).toMatch(/I would have phrased this differently/i);
    expect(externalPrompt).toMatch(
      /A SECOND moderate review at this round triggers another synthesis pass/i,
    );
  });

  it('keeps internal-tier critical reserved for genuine misrepresentation', () => {
    const internalPrompt = buildPeerReviewSystemPrompt('persona', 'internal');
    expect(internalPrompt).toMatch(/Reserve `critical` for genuine misrepresentation/i);
  });

  it('does not tell internal reviewers to abstain whenever the narrative feels fair', () => {
    const internalPrompt = buildPeerReviewSystemPrompt('persona', 'internal');
    expect(internalPrompt).toContain('Rules of engagement (INTERNAL tier');
    expect(internalPrompt).toMatch(/Do \*\*not\*\* abstain only because/i);
    expect(internalPrompt).not.toContain('Rules of engagement (EXTERNAL tier)');
    expect(internalPrompt).not.toMatch(/Abstain when the synthesis is defensible/i);
  });
});

describe('buildPeerReviewUserPrompt', () => {
  it('embeds the full structured synthesis JSON for external review', () => {
    const synthesis = syntheticV5Synthesis({
      core_assumptions: [
        {
          id: 'ca_1',
          category: 'technical',
          text: 'Substation capacity is upgradable in 24 months.',
        },
      ],
      risks_and_safeguards: [
        {
          type: 'technical',
          text: 'Charging cluster failure',
          likelihood: 3,
          severity: 4,
          mitigation: 'N+1 redundancy on Suba depot',
        },
      ],
    });
    const additions = synthesis as unknown as SynthesisAdditions;

    const prompt = buildPeerReviewUserPrompt({
      tier: 'external',
      debate: makeDebate(),
      synthesis,
      additions,
      peerRound: 1,
      peerRequiredCount: 2,
      peerReviewsFiled: 0,
    });

    expect(prompt).toContain('Synthesis schema_version: 5');
    expect(prompt).toContain('FULL CACHED SYNTHESIS');
    expect(prompt).toContain('Representation: structured JSON');
    expect(prompt).toContain('"schema_version": 5');
    expect(prompt).toContain('Substation capacity is upgradable in 24 months.');
    expect(prompt).toContain('Charging cluster failure');
    expect(prompt).toContain('Peer-review round: 1 (0 of 2 required filings so far)');
    expect(prompt).toContain('Reviewing at tier: external');
  });

  it('flags legacy schemas explicitly so the reviewer narrows their scope', () => {
    const synthesis = { schema_version: 4, executive_summary: 'Legacy synthesis.' };
    const prompt = buildPeerReviewUserPrompt({
      tier: 'external',
      debate: makeDebate(),
      synthesis,
      additions: null,
      peerRound: 1,
      peerRequiredCount: 2,
      peerReviewsFiled: 0,
    });
    expect(prompt).toContain('schema_version 4 predates the v5');
    expect(prompt).toContain('"schema_version": 4');
    expect(prompt).toContain('Legacy synthesis.');
  });

  it('uses markdown verbatim when the cache carries markdown', () => {
    const synthesis = {
      schema_version: 1,
      markdown: '## Report\n\nFull markdown body here.',
      executive_summary: 'ignored for representation when markdown set',
    };
    const prompt = buildPeerReviewUserPrompt({
      tier: 'external',
      debate: makeDebate(),
      synthesis,
      additions: null,
      peerRound: 1,
      peerRequiredCount: 2,
      peerReviewsFiled: 0,
    });
    expect(prompt).toContain('Representation: Markdown');
    expect(prompt).toContain('Full markdown body here.');
  });

  it('embeds own contributions on internal-tier prompts', () => {
    const synthesis = syntheticV5Synthesis();
    const prompt = buildPeerReviewUserPrompt({
      tier: 'internal',
      debate: makeDebate(),
      synthesis,
      additions: null,
      peerRound: 1,
      peerRequiredCount: 2,
      peerReviewsFiled: 0,
      peerReviewsFiledInternal: 0,
      peerReviewsFiledExternal: 0,
      ownContributions: [
        {
          id: 'c_self',
          node_type: 'claim',
          author_agent_id: SELF_AGENT_ID,
          title: 'BEV-first claim',
          body: 'I argued BEV-first because of well-to-wheel emissions.',
          confidence: 80,
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
    });

    expect(prompt).toContain('Your own contributions on this debate');
    expect(prompt).toContain('BEV-first claim');
    expect(prompt).toContain('well-to-wheel emissions');
    expect(prompt).toContain('Reviewing at tier: internal');
  });
});
