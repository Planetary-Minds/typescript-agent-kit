import { describe, expect, it } from 'vitest';
import {
  buildContributionSystemPrompt,
  requestSubmitterInputTool,
  requestSubmitterInputToolCallSchema,
  submitContributionTool,
} from '../src/contribute/index.js';

describe('request_submitter_input tool (spec Phase 2)', () => {
  it('validates a well-formed tool call', () => {
    const parsed = requestSubmitterInputToolCallSchema.safeParse({
      title: 'Actual pregnant-liquor nickel assay',
      why_it_matters:
        'Recommendations 2 and 3 hinge on an assumed 2.1 g/L nickel concentration; a measured assay would replace the assumption.',
      expected_shape: 'number',
      expected_unit: 'g/L',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown shapes and too-short titles before the wire', () => {
    expect(
      requestSubmitterInputToolCallSchema.safeParse({
        title: 'x',
        why_it_matters: 'Too-short title above must fail.',
        expected_shape: 'number',
      }).success,
    ).toBe(false);
    expect(
      requestSubmitterInputToolCallSchema.safeParse({
        title: 'Feedstock volumes',
        why_it_matters: 'How many tonnes of end-of-life blades per year reach your MRO channels?',
        expected_shape: 'spreadsheet',
      }).success,
    ).toBe(false);
  });

  it('advertises the shapes enum and hard budget in the tool schema', () => {
    expect(requestSubmitterInputTool.name).toBe('request_submitter_input');
    const properties = requestSubmitterInputTool.parameters.properties as Record<string, { enum?: string[] }>;
    expect(properties.expected_shape?.enum).toEqual(['number', 'range', 'boolean', 'short_text']);
    expect(requestSubmitterInputTool.description).toContain('ONE request per debate');
  });

  it('never advertises input_request as a submit_contribution node type', () => {
    const properties = submitContributionTool.parameters.properties as Record<string, { enum?: string[] }>;
    const nodeTypeEnum = properties.node_type?.enum ?? [];
    expect(nodeTypeEnum).not.toContain('input_request');
    expect(nodeTypeEnum).not.toContain('synthesis_rollup');
    expect(nodeTypeEnum).toContain('claim');
  });
});

describe('buildContributionSystemPrompt — input-request section', () => {
  const base = {
    personality: 'A pragmatic process engineer.',
    hasResearchTools: false,
    hasUnpostedOwnArtifacts: false,
  };

  it('is byte-for-byte unchanged when the tool is not offered', () => {
    const withoutFlag = buildContributionSystemPrompt(base);
    const explicitFalse = buildContributionSystemPrompt({ ...base, hasInputRequestTool: false });
    expect(explicitFalse).toBe(withoutFlag);
    expect(withoutFlag).not.toContain('request_submitter_input');
  });

  it('teaches ask-vs-derive when the tool is offered', () => {
    const prompt = buildContributionSystemPrompt({ ...base, hasInputRequestTool: true });
    expect(prompt).toContain('request_submitter_input');
    expect(prompt).toContain('Never wait for the answer');
    expect(prompt).toContain('ONE request');
  });
});

describe('buildContributionSystemPrompt — objection-churn steer', () => {
  const base = {
    personality: 'A pragmatic process engineer.',
    hasResearchTools: false,
    hasUnpostedOwnArtifacts: false,
    maxMoves: 5,
  };

  it('is byte-for-byte unchanged when the debate is not churning', () => {
    const withoutFlag = buildContributionSystemPrompt(base);
    const explicitFalse = buildContributionSystemPrompt({ ...base, debateIsChurning: false });
    expect(explicitFalse).toBe(withoutFlag);
    expect(withoutFlag).not.toContain('THIS DEBATE IS CHURNING');
  });

  it('suspends new objections and redirects to resolution when churning', () => {
    const prompt = buildContributionSystemPrompt({ ...base, debateIsChurning: true });
    expect(prompt).toContain('THIS DEBATE IS CHURNING');
    expect(prompt).toContain('SUSPENDED');
    // steers to the three resolution avenues + abstention
    expect(prompt).toContain('CLOSE ONE OF YOUR OWN OPEN LOOPS');
    expect(prompt).toContain('abstain_from_debate');
    expect(prompt).toContain('POSITIVE act for debate health');
  });

  it('places the churn steer ahead of the value ranking so it dominates the turn', () => {
    const prompt = buildContributionSystemPrompt({ ...base, debateIsChurning: true });
    expect(prompt.indexOf('THIS DEBATE IS CHURNING')).toBeLessThan(prompt.indexOf('Value ranking of moves'));
  });
});
