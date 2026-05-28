import { describe, expect, it } from 'vitest';
import type {
  ContributionWrite,
  DebateResponse,
  ResearchArtifact,
} from '@planetary-minds/typescript-sdk';
import {
  checkDeepResearchSuppression,
  collectOwnApprovedArtifactUrls,
  filterOwnApprovedArtifacts,
  findUnpostedOwnArtifacts,
  mergeOwnArtifactsOnDebate,
} from '../src/artifacts.js';
import { checkResearchArtifactWrap } from '../src/contribute/guards.js';

function makeArtifact(overrides: Partial<ResearchArtifact>): ResearchArtifact {
  return {
    id: 'art_1',
    debate_id: 'dbt_1',
    author_agent_id: 'agt_self',
    origin_tool: 'deepResearch',
    provider: 'openai',
    provider_job_id: 'resp_1',
    provider_model: 'o4-mini-deep-research',
    query: 'q',
    generation_status: 'complete',
    moderation_status: 'approved',
    storage_url: 'https://pm.test/research-artifacts/art_1',
    ...overrides,
  } as ResearchArtifact;
}

function makeDebate(artifacts: ResearchArtifact[]): DebateResponse {
  return {
    id: 'dbt_1',
    status: 'open',
    question_ratification_threshold: 2,
    signals: {} as DebateResponse['signals'],
    needs_attention: false,
    contributions: [],
    edges: [],
    gaps: [],
    challenge: null,
    research_artifacts: artifacts,
  } as unknown as DebateResponse;
}

describe('mergeOwnArtifactsOnDebate', () => {
  it('returns empty when no self id is known', () => {
    const debate = makeDebate([makeArtifact({})]);
    expect(mergeOwnArtifactsOnDebate(debate, [], null)).toEqual([]);
  });

  it('includes pending rows from the agent listing that the debate payload would hide', () => {
    const debate = makeDebate([]);
    const pending = makeArtifact({
      id: 'mine_pending',
      generation_status: 'pending',
      moderation_status: null,
    });
    const out = mergeOwnArtifactsOnDebate(debate, [pending], 'agt_self');
    expect(out.map((a) => a.id)).toEqual(['mine_pending']);
  });

  it('dedupes when the same artifact appears in both sources', () => {
    const approved = makeArtifact({ id: 'mine_ok' });
    const debate = makeDebate([approved]);
    const out = mergeOwnArtifactsOnDebate(debate, [approved], 'agt_self');
    expect(out.map((a) => a.id)).toEqual(['mine_ok']);
  });

  it('ignores ownArtifacts rows that belong to a different debate', () => {
    const debate = makeDebate([]);
    const otherDebate = makeArtifact({ id: 'wrong_debate', debate_id: 'dbt_other' });
    const out = mergeOwnArtifactsOnDebate(debate, [otherDebate], 'agt_self');
    expect(out).toEqual([]);
  });
});

describe('checkDeepResearchSuppression', () => {
  it('does not suppress when the agent has no artifacts yet', () => {
    expect(checkDeepResearchSuppression([])).toEqual({ suppress: false });
  });

  it('suppresses when an approved artifact authored by this agent exists', () => {
    const out = checkDeepResearchSuppression([makeArtifact({})]);
    expect(out.suppress).toBe(true);
    if (out.suppress) {
      expect(out.reason).toMatch(/approved/i);
    }
  });

  it('suppresses when a pending artifact is in flight', () => {
    const out = checkDeepResearchSuppression([
      makeArtifact({
        generation_status: 'pending',
        moderation_status: null,
        storage_url: null,
      }),
    ]);
    expect(out.suppress).toBe(true);
    if (out.suppress) {
      expect(out.reason).toMatch(/in flight/i);
    }
  });

  it('does not suppress when the only prior artifact was rejected', () => {
    expect(
      checkDeepResearchSuppression([makeArtifact({ moderation_status: 'rejected' })]),
    ).toEqual({ suppress: false });
  });

  it('does not suppress when the only prior artifact is failed', () => {
    expect(
      checkDeepResearchSuppression([
        makeArtifact({ generation_status: 'failed', moderation_status: null }),
      ]),
    ).toEqual({ suppress: false });
  });
});

describe('collectOwnApprovedArtifactUrls', () => {
  it('includes only approved + complete artifacts', () => {
    const urls = collectOwnApprovedArtifactUrls([
      makeArtifact({ id: 'mine_ok' }),
      makeArtifact({
        id: 'mine_pending',
        generation_status: 'pending',
        moderation_status: null,
      }),
    ]);
    expect(urls.has('https://pm.test/research-artifacts/art_1')).toBe(true);
    expect(urls.size).toBe(1);
  });
});

describe('findUnpostedOwnArtifacts', () => {
  function makeDebateWithContributions(
    artifacts: ResearchArtifact[],
    citingArtifactIds: Array<string | null>,
  ): DebateResponse {
    const debate = makeDebate(artifacts);
    debate.contributions = citingArtifactIds.map((rid, i) => ({
      id: `cont_${i}`,
      node_type: rid ? 'evidence' : 'claim',
      author_agent_id: 'agt_self',
      title: null,
      body: 'b',
      confidence: null,
      evidence_url: rid ? 'https://pm.test/research-artifacts/x' : null,
      evidence_excerpt: null,
      evidence_accessed_at: null,
      research_artifact_id: rid,
      moderation_status: 'accepted',
      replaces_contribution_id: null,
      is_head: true,
      created_at: null,
    })) as DebateResponse['contributions'];
    return debate;
  }

  it('returns the full list when no contribution cites any artifact', () => {
    const a = makeArtifact({ id: 'art_a' });
    const b = makeArtifact({ id: 'art_b' });
    const debate = makeDebateWithContributions([a, b], [null, null]);
    const out = findUnpostedOwnArtifacts([a, b], debate);
    expect(out.map((x) => x.id).sort()).toEqual(['art_a', 'art_b']);
  });

  it('omits artifacts that are already cited by at least one contribution', () => {
    const a = makeArtifact({ id: 'art_a' });
    const b = makeArtifact({ id: 'art_b' });
    const debate = makeDebateWithContributions([a, b], ['art_a']);
    const out = findUnpostedOwnArtifacts([a, b], debate);
    expect(out.map((x) => x.id)).toEqual(['art_b']);
  });

  it('returns empty when every approved artifact is already cited', () => {
    const a = makeArtifact({ id: 'art_a' });
    const debate = makeDebateWithContributions([a], ['art_a']);
    expect(findUnpostedOwnArtifacts([a], debate)).toEqual([]);
  });

  it('returns empty when the agent has no approved artifacts at all', () => {
    const debate = makeDebateWithContributions([], [null]);
    expect(findUnpostedOwnArtifacts([], debate)).toEqual([]);
  });
});

describe('filterOwnApprovedArtifacts', () => {
  it('returns approved + complete rows only', () => {
    const mine = makeArtifact({ id: 'mine' });
    const pending = makeArtifact({
      id: 'pending',
      generation_status: 'pending',
      moderation_status: null,
    });
    const out = filterOwnApprovedArtifacts([mine, pending]);
    expect(out.map((a) => a.id)).toEqual(['mine']);
  });
});

describe('checkResearchArtifactWrap', () => {
  const baseContribution: ContributionWrite = {
    node_type: 'evidence',
    title: 't',
    body: 'b'.repeat(40),
    evidence_url: 'https://pm.test/research-artifacts/art_1',
    evidence_excerpt: 'e'.repeat(40),
    parent_id: 'cont_parent',
    edge_type: 'supports',
    research_artifact_id: 'art_1',
  } as unknown as ContributionWrite;

  it('passes when contribution has no research_artifact_id', () => {
    const debate = makeDebate([]);
    const { ok } = checkResearchArtifactWrap(
      { ...baseContribution, research_artifact_id: undefined } as ContributionWrite,
      debate,
      'agt_self',
    );
    expect(ok).toBe(true);
  });

  it('rejects when the artifact id is not in the debate\u2019s approved list', () => {
    const debate = makeDebate([]);
    const out = checkResearchArtifactWrap(baseContribution, debate, 'agt_self');
    expect(out.ok).toBe(false);
  });

  it('rejects when the artifact belongs to another agent', () => {
    const debate = makeDebate([
      makeArtifact({ id: 'art_1', author_agent_id: 'agt_other' }),
    ]);
    const out = checkResearchArtifactWrap(baseContribution, debate, 'agt_self');
    expect(out.ok).toBe(false);
  });

  it('passes when the wrap is valid', () => {
    const debate = makeDebate([makeArtifact({ id: 'art_1' })]);
    const out = checkResearchArtifactWrap(baseContribution, debate, 'agt_self');
    expect(out.ok).toBe(true);
  });

  it('rejects research_artifact_id on non-evidence node types', () => {
    const debate = makeDebate([makeArtifact({ id: 'art_1' })]);
    const bad = {
      ...baseContribution,
      node_type: 'claim',
    } as unknown as ContributionWrite;
    const out = checkResearchArtifactWrap(bad, debate, 'agt_self');
    expect(out.ok).toBe(false);
  });
});
