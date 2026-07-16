import { describe, expect, it } from 'vitest';
import type { ContributionWrite } from '@planetary-minds/typescript-sdk';
import { checkPhaseRules } from '../src/contribute/guards.js';
import { buildContributionSystemPrompt } from '../src/contribute/system-prompt.js';

/**
 * Phase model (platform docs/PHASE-MODEL-SPEC.md): the client-side mirror of
 * the two phase 409s, and the phase-aware system-prompt blocks.
 */

const objection: ContributionWrite = {
  node_type: 'claim',
  body: 'The leach kinetics assumption fails at the stated fluoride level.',
  parent_id: 'opt_1',
  edge_type: 'objects_to',
};

const concern: ContributionWrite = {
  ...objection,
  edge_type: 'concerns',
};

const newOption: ContributionWrite = {
  node_type: 'option',
  title: 'A brand-new route',
  body: 'A latecomer option.',
  parent_id: 'q_1',
  edge_type: 'answers',
};

describe('checkPhaseRules', () => {
  it('passes everything through when the debate carries no phase', () => {
    expect(checkPhaseRules(objection, { phase: null }).ok).toBe(true);
    expect(checkPhaseRules(newOption, {} as { phase?: string | null }).ok).toBe(true);
  });

  it('defers objections during exploration and points at the concerns edge', () => {
    const result = checkPhaseRules(objection, { phase: 'exploration' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('concerns');
      expect(result.reason).toContain('OBJECTION_DEFERRED_EXPLORATION');
    }
  });

  it('allows the concerns substitute and new options during exploration', () => {
    expect(checkPhaseRules(concern, { phase: 'exploration' }).ok).toBe(true);
    expect(checkPhaseRules(newOption, { phase: 'exploration' }).ok).toBe(true);
  });

  it('freezes new options after exploration but allows supersession', () => {
    const blocked = checkPhaseRules(newOption, { phase: 'deliberation' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toContain('OPTION_SET_FROZEN');

    const revision = { ...newOption, replaces_contribution_id: 'opt_1' };
    expect(checkPhaseRules(revision, { phase: 'deliberation' }).ok).toBe(true);
    expect(checkPhaseRules(objection, { phase: 'deliberation' }).ok).toBe(true);
  });
});

describe('buildContributionSystemPrompt phase blocks', () => {
  const base = {
    personality: 'You are a metallurgist.',
    hasResearchTools: false,
    hasUnpostedOwnArtifacts: false,
  };

  it('is byte-for-byte unchanged when no phase is passed', () => {
    expect(buildContributionSystemPrompt(base)).toBe(
      buildContributionSystemPrompt({ ...base, debatePhase: null }),
    );
  });

  it('teaches breadth and the concerns substitute during exploration', () => {
    const prompt = buildContributionSystemPrompt({ ...base, debatePhase: 'exploration' });
    expect(prompt).toContain('THIS DEBATE IS EXPLORING');
    expect(prompt).toContain('edge_type=concerns');
    expect(prompt).toContain('OBJECTION_DEFERRED_EXPLORATION');
    expect(prompt).not.toContain('OPTION_SET_FROZEN');
  });

  it('announces the freeze and deferred-concern prosecution during deliberation', () => {
    const prompt = buildContributionSystemPrompt({ ...base, debatePhase: 'deliberation' });
    expect(prompt).toContain('THIS DEBATE IS DELIBERATING');
    expect(prompt).toContain('OPTION_SET_FROZEN');
    expect(prompt).toContain('prosecute_deferred_concern');
  });

  it('raises the objection bar during convergence', () => {
    const prompt = buildContributionSystemPrompt({ ...base, debatePhase: 'convergence' });
    expect(prompt).toContain('THIS DEBATE IS CONVERGING');
    expect(prompt).toContain('abstain_from_debate');
  });
});
