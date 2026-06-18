import { describe, expect, it } from 'vitest';
import {
  buildContributionSystemPrompt,
  contributionTerminalTools,
  contributionTurnTools,
  endTurnTool,
  retractContributionTool,
} from '../src/contribute/index.js';

/**
 * The multi-move turn (maxMoves > 1) and its tools. The single-move default must
 * stay byte-identical so existing runners are unaffected; opting into maxMoves
 * switches the engagement rules to "up to N moves then end_turn", adds the
 * ≤1-option / react-don't-monologue limits, and surfaces the revision loop.
 */
describe('multi-move system prompt', () => {
  const base = { personality: 'Terse and rigorous.', hasResearchTools: false, hasUnpostedOwnArtifacts: false };

  it('defaults to the single-move turn', () => {
    const prompt = buildContributionSystemPrompt(base);
    expect(prompt).toContain('Produce exactly ONE terminal tool call');
    expect(prompt).not.toContain('end_turn');
    expect(prompt).not.toContain('addresses');
  });

  it('maxMoves: 1 is identical to the default', () => {
    expect(buildContributionSystemPrompt({ ...base, maxMoves: 1 })).toBe(buildContributionSystemPrompt(base));
  });

  it('switches to multi-move framing when maxMoves > 1', () => {
    const prompt = buildContributionSystemPrompt({ ...base, maxMoves: 5 });
    expect(prompt).not.toContain('Produce exactly ONE terminal tool call');
    expect(prompt).toContain('up to 5 moves');
    expect(prompt).toContain('end_turn');
    expect(prompt).toContain('at most ONE new option');
    // The objector-owned resolution loop is taught.
    expect(prompt).toContain('addresses');
    expect(prompt).toContain('retract_contribution');
    expect(prompt).toContain('objection_target_revised');
  });
});

describe('turn tools', () => {
  it('the multi-move set adds retract + end_turn to the single-move set', () => {
    const names = contributionTurnTools.map((t) => t.name);
    expect(names).toEqual(['submit_contribution', 'ratify_question', 'retract_contribution', 'abstain_from_debate', 'end_turn']);
    // Single-move set is unchanged.
    expect(contributionTerminalTools.map((t) => t.name)).toEqual([
      'submit_contribution',
      'ratify_question',
      'abstain_from_debate',
    ]);
  });

  it('retract_contribution requires only the target id; end_turn requires nothing', () => {
    expect(retractContributionTool.parameters.required).toEqual(['contribution_id']);
    expect(retractContributionTool.parameters.properties).toHaveProperty('contribution_id');
    expect(endTurnTool.parameters.required).toEqual([]);
  });
});
