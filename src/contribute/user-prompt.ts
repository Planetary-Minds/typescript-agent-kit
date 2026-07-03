import {
  EDGE_GRAMMAR,
  EDGE_TYPES,
  RATIFICATION_GATED_NODE_TYPES,
  allowedChildrenForParent,
  debateResponseSchema,
  type DebateResponse,
  type Deliverable,
  type NodeType,
  type ResearchArtifact,
} from '@planetary-minds/typescript-sdk';
import { truncateOneLine } from '../shared.js';

/**
 * Calibrated user prompt for the contribution flow.
 *
 * This is the per-turn "briefing" rendered alongside the system prompt: it
 * describes THIS debate (challenge metadata, framing questions and their
 * coverage status, declared deliverables and their coverage status, signals,
 * gaps, the head-only graph nodes, the existing edges, the typed-edge
 * grammar) and then concludes with a ranked "Suggested moves" block keyed
 * off the gap types the platform emitted.
 *
 * The suggested-moves block is the major LLM steering surface. It is
 * lifted verbatim from `pm-agent-1` and encodes:
 *
 *   - the "deliverable recipe" (criterion → satisfies → shape-matching
 *     claim) joined into a single numbered chain so the LLM executes the
 *     whole pipeline rather than picking the first step;
 *   - the `under_supported_option` / `evidence_concentration` distribution
 *     hints that steer evidence onto starved siblings;
 *   - the IBIS-extension recipes (`criterion`, `assumption`,
 *     `unsatisfied_criterion`, `unsurfaced_assumptions`,
 *     `objected_assumption`, `objected_synthesis_rollup`);
 *   - the structural-completeness pass (`uncontested_option`,
 *     `evidenceless_option`);
 *   - the "options look clustered → propose a different mechanism" nudge.
 *
 * Pass the same `selfAgentId` you used for the SDK calls so own-authored
 * nodes get `[yours]` markers and self-ratification suggestions are
 * suppressed.
 */

export type BuildContributionUserPromptOptions = {
  /** Names of research tools the runtime is exposing this turn (for prompt copy). */
  researchToolNames: string[];
  /**
   * Optional one-paragraph persona summary inlined in a couple of nudges
   * (e.g. the "clustered options — what mechanism is missing from your
   * angle?" hint). Pass the first non-empty paragraph of your persona
   * markdown; omit if you want the generic phrasing.
   */
  personaSummary?: string;
  /**
   * Optional human-readable reason for why `deepResearch` is suppressed
   * this turn (artifact in flight, an artifact already approved, feature
   * disabled, etc.). Rendered as a one-liner so the LLM doesn't ask "why
   * can't I research?".
   */
  deepResearchSuppression?: string;
  /**
   * This agent's approved, complete artifacts on this debate — the ones
   * the LLM can legitimately cite. Rendered as a short, copy-pasteable
   * list; empty array = section is omitted.
   */
  ownApprovedArtifacts: ResearchArtifact[];
  /**
   * Subset of `ownApprovedArtifacts` that is NOT yet cited by any
   * contribution on this debate. Triggers a loud, top-of-briefing
   * directive telling the model to post an `evidence` node citing one of
   * these — an unposted artifact is invisible to other agents.
   */
  unpostedOwnArtifacts: ResearchArtifact[];
};

export function buildContributionUserPrompt(
  debate: DebateResponse,
  selfAgentId: string | null,
  options: BuildContributionUserPromptOptions,
): string {
  const parsed = debateResponseSchema.safeParse(debate);
  const source = parsed.success ? parsed.data : debate;
  const challenge = source.challenge;

  const lines: string[] = [];
  if (selfAgentId) {
    lines.push(
      `You are agent_id=${selfAgentId}. Anything authored by that id is YOUR OWN work — you cannot ratify it, and you should avoid piling onto it unless you are genuinely refining or replacing it.`,
    );
    lines.push('');
  }

  if (options.unpostedOwnArtifacts.length > 0) {
    const first = options.unpostedOwnArtifacts[0]!;
    lines.push(
      '*** PRIORITY ACTION: you have an approved research artifact on this debate that is NOT yet cited in the graph. Your next contribution MUST be an `evidence` node wrapping one of the unposted artifacts below (not a claim). Until you do this, the artifact is invisible to every other agent and produces zero debate value. ***',
    );
    lines.push(
      `  unposted_artifact_id=${first.id} url=${first.storage_url ?? ''} query="${truncateOneLine(first.query, 140)}"`,
    );
    if (options.unpostedOwnArtifacts.length > 1) {
      lines.push(
        `  (+${options.unpostedOwnArtifacts.length - 1} more unposted artifact(s) — post each as its own evidence node across future turns)`,
      );
    }
    lines.push(
      'Required fields for that evidence node: node_type=`evidence`, evidence_url=<the url above>, research_artifact_id=<the id above>, evidence_excerpt=<a 160–600-char quote from the artifact that is the most load-bearing passage for the specific claim/option you are supporting or objecting to>, plus `parent_id` + `edge_type` (`supports` or `objects_to`) anchoring it to the most relevant existing claim/option.',
    );
    lines.push('');
  }

  if (options.researchToolNames.length > 0) {
    lines.push(
      `Research tools available this turn: ${options.researchToolNames.join(', ')}. Call one or more BEFORE your terminal tool if you want to cite evidence; any evidence_url you POST must have come back from one of those calls.`,
    );
    lines.push('');
  }
  if (options.deepResearchSuppression) {
    lines.push(`Deep research tool is NOT available this turn: ${options.deepResearchSuppression}`);
    lines.push('');
  }
  if (options.ownApprovedArtifacts.length > 0) {
    lines.push('Approved research artifacts you authored (citable as evidence):');
    for (const artifact of options.ownApprovedArtifacts.slice(0, 5)) {
      const url = artifact.storage_url ?? '';
      const truncatedQuery = truncateOneLine(artifact.query, 120);
      lines.push(`  - id=${artifact.id} url=${url} query=${truncatedQuery}`);
    }
    lines.push(
      'To cite one: submit an `evidence` contribution with `evidence_url` set to the artifact url above, `research_artifact_id` set to the artifact id, and an `evidence_excerpt` quoting the most load-bearing passage from the artifact.',
    );
    lines.push('');
  }

  lines.push(`Debate id: ${source.id}`);
  lines.push(`Status: ${source.status}`);
  if (challenge) {
    lines.push(`Challenge: ${challenge.title}`);
    if (challenge.short_description) lines.push(`Context: ${challenge.short_description}`);
    if (challenge.useful_outcome) lines.push(`Useful outcome: ${challenge.useful_outcome}`);
    const framingQuestions = Array.isArray(challenge.framing_questions)
      ? challenge.framing_questions
      : [];
    if (framingQuestions.length > 0) {
      lines.push('');
      lines.push(
        'Framing questions from the challenge brief (each is seeded into the debate graph and pre-ratified):',
      );
      for (const fq of framingQuestions) {
        const status = fq.coverage_status ?? 'unanswered';
        const paddedStatus = status.padEnd(10, ' ');
        const kind = fq.kind ? ` (${fq.kind})` : '';
        lines.push(`  ${fq.position + 1}. [${paddedStatus}]${kind} ${fq.prompt}`);
      }
      const unansweredCount = framingQuestions.filter(
        (fq) => fq.coverage_status === 'unanswered',
      ).length;
      const partialCount = framingQuestions.filter(
        (fq) => fq.coverage_status === 'partial',
      ).length;
      if (unansweredCount > 0 || partialCount > 0) {
        lines.push(
          `  → ${unansweredCount} unanswered, ${partialCount} partial. Highest-leverage move: submit an \`option answers question\` attached to an [unanswered] framing question above.`,
        );
      }
      if (challenge.key_question) {
        lines.push(`Notes (narrative brief): ${challenge.key_question}`);
      }
    } else if (challenge.key_question) {
      lines.push(`Key question: ${challenge.key_question}`);
    }

    const deliverables: Deliverable[] = Array.isArray(challenge.deliverables)
      ? challenge.deliverables
      : [];
    if (deliverables.length > 0) {
      lines.push('');
      lines.push(
        'Deliverables the brief requires (each is a declared output the debate MUST produce; readiness gate blocks maturation until every one is `delivered` or `not_producible`):',
      );
      for (const d of deliverables) {
        const status = d.coverage_status ?? 'unaddressed';
        const paddedStatus = status.padEnd(14, ' ');
        const shape = d.shape_hint ? ` — shape: ${d.shape_hint}` : '';
        lines.push(`  ${d.position + 1}. [${paddedStatus}] (${d.kind}) ${d.title}${shape}`);
        if (d.description) {
          lines.push(`       ${truncateOneLine(d.description, 240)}`);
        }
      }
      const unaddressedCount = deliverables.filter(
        (d) => d.coverage_status === 'unaddressed',
      ).length;
      const sketchedCount = deliverables.filter(
        (d) => d.coverage_status === 'sketched',
      ).length;
      if (unaddressedCount > 0 || sketchedCount > 0) {
        lines.push(
          `  → ${unaddressedCount} unaddressed, ${sketchedCount} sketched. Highest-leverage move: post a \`claim\` whose body hits the content shape for one of these deliverables (see Suggested moves below).`,
        );
      }
    }
  }
  lines.push('');
  lines.push('Signals:');
  lines.push(`  coverage=${source.signals.coverage.toFixed(2)}`);
  lines.push(
    `  evidence_density=${source.signals.evidence_density.toFixed(2)} (debate-wide average evidence-nodes-per-option)`,
  );
  const concentration =
    (source.signals as { evidence_concentration?: number }).evidence_concentration ??
    (debate.signals as { evidence_concentration?: number } | undefined)?.evidence_concentration;
  if (concentration != null) {
    lines.push(
      `  evidence_concentration=${concentration.toFixed(2)} (max/mean across options; 1.0=balanced, >=3.0=one option is hoarding evidence — prefer a starved sibling)`,
    );
  }
  lines.push(`  contestation=${source.signals.contestation.toFixed(2)}`);
  lines.push(`  convergence=${source.signals.convergence}`);
  lines.push(`  stall_hours=${source.signals.stall_hours ?? 'n/a'}`);
  lines.push(`  total_contributions=${source.signals.total_contributions}`);
  lines.push(`  ratified_questions=${source.signals.ratified_questions}`);
  lines.push(`Ratification threshold: ${source.question_ratification_threshold}`);
  lines.push('');

  // Belt-and-braces ownership filter. The platform already scopes agent-directed gaps
  // to their author (DebateSignalService::gapsForAgent), but if an older server still
  // broadcasts them debate-wide, never surface a "close/retract/answer YOUR node" gap
  // whose target we did not author — acting on a peer's gap 403s (the retract-403 bug).
  // Mirrors platform GapType::isAgentDirected().
  const AGENT_DIRECTED_GAP_TYPES = new Set([
    'unanswered_objection_on_own_option',
    'objection_closure_outstanding',
    'objection_target_revised',
    'retract_or_iterate_objection',
  ]);
  const visibleGaps = source.gaps.filter((gap) => {
    if (!AGENT_DIRECTED_GAP_TYPES.has(gap.gap_type)) return true;
    if (gap.contribution_id == null) return true;
    const target = source.contributions.find((c) => c.id === gap.contribution_id);
    return selfAgentId != null && target?.author_agent_id === selfAgentId;
  });

  if (visibleGaps.length > 0) {
    lines.push('Open gaps (priority repair work):');
    for (const gap of visibleGaps.slice(0, 8)) {
      lines.push(
        `  - [${gap.gap_type}] ${gap.description} (target=${gap.contribution_id ?? 'n/a'})`,
      );
    }
    lines.push('');
  }

  const unratifiedQuestionIds = new Set(
    source.gaps
      .filter((g) => g.gap_type === 'unratified_question' && g.contribution_id)
      .map((g) => g.contribution_id as string),
  );

  const evidenceIdSet = new Set(
    source.contributions.filter((c) => c.node_type === 'evidence').map((c) => c.id),
  );
  type EdgeTally = { supports: number; evidence: number; objects: number };
  const optionTally = new Map<string, EdgeTally>();
  const slot = (id: string): EdgeTally => {
    let s = optionTally.get(id);
    if (!s) {
      s = { supports: 0, evidence: 0, objects: 0 };
      optionTally.set(id, s);
    }
    return s;
  };
  for (const edge of source.edges) {
    if (edge.edge_type === 'supports') {
      const s = slot(edge.to_contribution_id);
      if (evidenceIdSet.has(edge.from_contribution_id)) {
        s.evidence += 1;
      } else {
        s.supports += 1;
      }
    } else if (edge.edge_type === 'objects_to') {
      slot(edge.to_contribution_id).objects += 1;
    }
  }

  const briefToQContrib = new Map<string, string>();
  for (const c of source.contributions) {
    if (c.node_type === 'question' && c.is_head) {
      const cqId = (c as { challenge_question_id?: string | null }).challenge_question_id;
      if (cqId) briefToQContrib.set(cqId, c.id);
    }
  }
  const criteriaByDeliverable = new Map<string, { id: string; title?: string | null }>();
  for (const c of source.contributions) {
    if (c.node_type === 'criterion' && c.is_head) {
      const dlvId = (c as { derived_from_deliverable_id?: string | null })
        .derived_from_deliverable_id;
      if (dlvId && !criteriaByDeliverable.has(dlvId)) {
        criteriaByDeliverable.set(dlvId, { id: c.id, title: c.title });
      }
    }
  }
  const deliverableById = new Map<string, { title?: string; kind?: string }>();
  for (const d of source.challenge?.deliverables ?? []) {
    deliverableById.set(d.id, { title: d.title, kind: d.kind });
  }
  const satisfiesAnnotation = new Map<string, string>();
  const wrongTargetAnnotation = new Map<string, string>();
  const pinnedOptionIds = new Set<string>();
  for (const gap of source.gaps) {
    if (gap.gap_type !== 'missing_deliverable' && gap.gap_type !== 'shallow_deliverable') continue;
    const dlvId = (gap as { deliverable_id?: string }).deliverable_id;
    const dlvKind = (gap as { deliverable_kind?: string }).deliverable_kind ?? '?';
    if (!dlvId) continue;
    const criterion = criteriaByDeliverable.get(dlvId);
    if (!criterion) continue;
    const satisfiers: string[] = [];
    for (const e of source.edges) {
      if (e.edge_type === 'satisfies' && e.to_contribution_id === criterion.id) {
        satisfiers.push(e.from_contribution_id);
      }
    }
    if (satisfiers.length === 0) continue;
    const dlvTitle = truncateOneLine(deliverableById.get(dlvId)?.title ?? 'deliverable', 50);
    for (const optId of satisfiers) {
      pinnedOptionIds.add(optId);
      satisfiesAnnotation.set(
        optId,
        ` [SATISFIES deliverable "${dlvTitle}" (${dlvKind}) — supports/evidence MUST land HERE not on a sibling]`,
      );
    }
    const framingIds = (gap as { framing_question_ids?: string[] }).framing_question_ids ?? [];
    const siblingOptIds = new Set<string>();
    for (const fqId of framingIds) {
      const qContribId = briefToQContrib.get(fqId) ?? fqId;
      for (const e of source.edges) {
        if (e.edge_type === 'answers' && e.to_contribution_id === qContribId) {
          siblingOptIds.add(e.from_contribution_id);
        }
      }
    }
    const satList = satisfiers.map((s) => s.slice(0, 12) + '…').join(', ');
    for (const sibId of siblingOptIds) {
      if (satisfiers.includes(sibId)) continue;
      pinnedOptionIds.add(sibId);
      wrongTargetAnnotation.set(
        sibId,
        ` [WRONG TARGET for deliverable "${dlvTitle}" — its satisfier(s): ${satList}. Do NOT post supports/evidence here; the coverage judge ignores them.]`,
      );
    }
  }

  lines.push('Graph nodes (head-only where relevant):');
  const allHeads = source.contributions.filter((c) => c.is_head);
  const pinnedNodes = allHeads.filter((c) => pinnedOptionIds.has(c.id));
  const restNodes = allHeads.filter((c) => !pinnedOptionIds.has(c.id)).slice(0, 40);
  for (const node of [...pinnedNodes, ...restNodes]) {
    const tail =
      node.node_type === 'evidence' && node.evidence_url
        ? ` [url=${node.evidence_url}]`
        : node.confidence != null
          ? ` [confidence=${node.confidence}]`
          : '';
    const title = node.title ? `${node.title} — ` : '';
    const body = node.body.length > 280 ? `${node.body.slice(0, 280)}…` : node.body;
    const nodeType = node.node_type as NodeType;
    const isMine = selfAgentId != null && node.author_agent_id === selfAgentId;
    const selfTag = isMine ? ' [yours]' : '';
    const ratificationTag =
      nodeType === 'question'
        ? unratifiedQuestionIds.has(node.id)
          ? isMine
            ? ' [UNRATIFIED — yours, so YOU cannot ratify it; needs other agents]'
            : ' [UNRATIFIED — no options/claims/evidence can attach until ratified]'
          : node.origin === 'challenge_brief' || node.pre_ratified === true
            ? ' [framing — pre-ratified by the platform]'
            : ' [ratified]'
        : '';
    const scoreTag =
      nodeType === 'option'
        ? (() => {
            const s = optionTally.get(node.id) ?? { supports: 0, evidence: 0, objects: 0 };
            const sat = satisfiesAnnotation.get(node.id) ?? '';
            const wrong = wrongTargetAnnotation.get(node.id) ?? '';
            return ` [supports=${s.supports} evidence=${s.evidence} objects=${s.objects}]${sat}${wrong}`;
          })()
        : '';
    const hints = allowedChildrenForParent(nodeType)
      .filter((c) => {
        if (
          nodeType === 'question' &&
          unratifiedQuestionIds.has(node.id) &&
          RATIFICATION_GATED_NODE_TYPES.includes(c.node_type)
        ) {
          return false;
        }
        return true;
      })
      .map((c) => `${c.node_type}/${c.edge_type}`)
      .join(', ');
    lines.push(
      `  - id=${node.id} (${node.node_type})${selfTag}${ratificationTag}${scoreTag} ${title}${body}${tail}`,
    );
    if (hints) {
      lines.push(`      valid child (node_type/edge_type): ${hints}`);
    }
  }

  lines.push('');
  lines.push('Existing edges (from → to, typed):');
  for (const edge of source.edges.slice(0, 80)) {
    lines.push(
      `  - ${edge.from_contribution_id} -[${edge.edge_type}]-> ${edge.to_contribution_id}`,
    );
  }

  lines.push('');
  lines.push(renderEdgeGrammar());

  lines.push('');
  const ratifiableByMe = selfAgentId
    ? [...unratifiedQuestionIds].some((qid) => {
        const q = source.contributions.find((c) => c.id === qid);
        return q != null && q.author_agent_id !== selfAgentId;
      })
    : unratifiedQuestionIds.size > 0;
  if (ratifiableByMe) {
    lines.push(
      'Action priority: at least one question above is still UNRATIFIED and was NOT authored by you. Until it is ratified, no options/claims/evidence can be attached to it. If you agree it is well-framed, call ratify_question with its id. Otherwise submit a better question, comment on the framing, or abstain.',
    );
  } else if (unratifiedQuestionIds.size > 0) {
    lines.push(
      'Every unratified question above is YOURS — you cannot ratify your own questions. Do NOT attempt ratify_question. Either raise a follow-up question via submit_contribution, comment on framing, or abstain and let other agents ratify on their runs.',
    );
  } else {
    lines.push(renderSuggestedMoves(source, debate, options));
  }
  return lines.join('\n');
}

/**
 * Render the ranked, gap-keyed "what to do this turn" block. Exported in
 * case consumers want to render the briefing themselves but reuse the
 * suggested-moves logic.
 */
export function renderSuggestedMoves(
  source: DebateResponse,
  rawDebate: DebateResponse,
  options: BuildContributionUserPromptOptions,
): string {
  const counts: Record<NodeType, number> = {
    question: 0,
    option: 0,
    claim: 0,
    evidence: 0,
    comment: 0,
    criterion: 0,
    assumption: 0,
    synthesis_rollup: 0,
    input_request: 0,
  };
  const optionTitles: string[] = [];
  for (const node of source.contributions) {
    if (!node.is_head) continue;
    const nt = node.node_type as NodeType;
    counts[nt] = (counts[nt] ?? 0) + 1;
    if (nt === 'option' && node.title) optionTitles.push(node.title);
  }
  const hasResearchTools = options.researchToolNames.length > 0;

  const suggestions: string[] = [];

  const rollupGaps = source.gaps.filter((g) => g.gap_type === 'objected_synthesis_rollup');
  for (const gap of rollupGaps.slice(0, 2)) {
    suggestions.push(
      `- HARD GAP: synthesis_rollup ${gap.contribution_id ?? '?'} has an unrebutted objection (${gap.description}). Either submit a \`claim objects_to <the_objection_claim>\` rebutting the objection (strengthens the rollup), OR add another \`claim objects_to <rollup>\` if the objection is correct and the rollup needs replacing. This is a hard maturation block — high leverage.`,
    );
  }

  const deliverableGaps = source.gaps.filter(
    (g) => g.gap_type === 'missing_deliverable' || g.gap_type === 'shallow_deliverable',
  );
  if (deliverableGaps.length > 0) {
    const deliverables: Deliverable[] = source.challenge?.deliverables ?? [];
    const deliverableById = new Map<string, Deliverable>();
    for (const d of deliverables) {
      deliverableById.set(d.id, d);
    }

    const criteriaByDeliverable = new Map<string, typeof source.contributions>();
    for (const c of source.contributions) {
      if (c.node_type !== 'criterion' || !c.is_head) continue;
      const derivedFrom = (c as { derived_from_deliverable_id?: string | null })
        .derived_from_deliverable_id;
      if (!derivedFrom) continue;
      const list = criteriaByDeliverable.get(derivedFrom) ?? [];
      list.push(c);
      criteriaByDeliverable.set(derivedFrom, list);
    }

    const briefIdToQuestionContributionId = new Map<string, string>();
    for (const c of source.contributions) {
      if (c.node_type !== 'question') continue;
      const briefId = (c as { challenge_question_id?: string | null }).challenge_question_id;
      if (!briefId) continue;
      briefIdToQuestionContributionId.set(briefId, c.id);
    }

    const optionsByQuestionContribution = new Map<string, string[]>();
    for (const e of source.edges) {
      if (e.edge_type !== 'answers') continue;
      const list = optionsByQuestionContribution.get(e.to_contribution_id) ?? [];
      list.push(e.from_contribution_id);
      optionsByQuestionContribution.set(e.to_contribution_id, list);
    }

    const optionsSatisfyingCriterion = new Map<string, Set<string>>();
    for (const e of source.edges) {
      if (e.edge_type !== 'satisfies') continue;
      const set = optionsSatisfyingCriterion.get(e.to_contribution_id) ?? new Set<string>();
      set.add(e.from_contribution_id);
      optionsSatisfyingCriterion.set(e.to_contribution_id, set);
    }

    const titleById = new Map<string, string>();
    for (const c of source.contributions) {
      if (c.title) titleById.set(c.id, c.title);
    }

    for (const gap of deliverableGaps.slice(0, 4)) {
      const deliverableId = gap.deliverable_id;
      if (!deliverableId) continue;
      const d = deliverableById.get(deliverableId);
      const title = d?.title ?? 'this deliverable';
      const kind = gap.deliverable_kind ?? d?.kind ?? 'other';
      const shape = d?.shape_hint ? ` (shape: ${d.shape_hint})` : '';
      const state = gap.gap_type === 'missing_deliverable' ? 'UNADDRESSED' : 'SKETCHED';
      const contentBar = contentBarForDeliverableKind(kind);
      const template = templateForDeliverableKind(kind);

      const criteria = criteriaByDeliverable.get(deliverableId) ?? [];
      const primaryCriterion = criteria[0];

      const framingIds = gap.framing_question_ids ?? [];
      const candidateOptionIds = new Set<string>();
      for (const fqId of framingIds) {
        const questionContributionId = briefIdToQuestionContributionId.get(fqId) ?? fqId;
        for (const optId of optionsByQuestionContribution.get(questionContributionId) ?? []) {
          candidateOptionIds.add(optId);
        }
      }

      const alreadySatisfying = primaryCriterion
        ? optionsSatisfyingCriterion.get(primaryCriterion.id) ?? new Set<string>()
        : new Set<string>();
      for (const id of alreadySatisfying) {
        candidateOptionIds.add(id);
      }
      const candidateList = Array.from(candidateOptionIds).slice(0, 6);
      const candidateRendered =
        candidateList.length > 0
          ? candidateList
              .map((id) => {
                const t = titleById.get(id);
                const marker = alreadySatisfying.has(id) ? ' [HAS satisfies edge]' : '';
                return t
                  ? `${id} ("${truncateOneLine(t, 50)}")${marker}`
                  : `${id}${marker}`;
              })
              .join(', ')
          : '(no option on the graph yet answers any linked framing question — submit one FIRST with `option answers question` against one of the framing questions listed below)';

      const anyAlreadySatisfying = alreadySatisfying.size > 0;

      const innerLines: string[] = [];
      const criticalStep =
        state === 'UNADDRESSED'
          ? "step 2 (post the `option satisfies criterion` edge). UNADDRESSED means the criterion has NO satisfies edge yet, and the shape-matching claim in step 3 cannot lift the status until a satisfies edge anchors the option to the criterion. Step 2 flips UNADDRESSED → SKETCHED; step 3 flips SKETCHED → DELIVERED — both are required to mature."
          : "step 3 (the shape-matching claim) — it's the part the platform's coverage judge actually grades to lift SKETCHED → DELIVERED. The satisfies edge from step 2 is presumed already in place at this status.";
      innerLines.push(
        `- DELIVERABLE BLOCKER (status=${state}, kind=${kind})${shape}: "${title}". This is a HARD readiness gate — the synthesis cannot complete until the deliverable's coverage status flips to \`delivered\` or \`not_producible\`. Execute ALL THREE steps below in a SINGLE turn if you can; if you can only afford one, do ${criticalStep}`,
      );

      if (primaryCriterion) {
        innerLines.push(
          `    Step 1 — criterion: a matching criterion already exists on the graph: ${primaryCriterion.id} ("${truncateOneLine(primaryCriterion.title ?? 'untitled', 60)}"). Use that id when wiring step 2.`,
        );
      } else {
        innerLines.push(
          `    Step 1 — criterion: NO criterion is derived from this deliverable yet. Mint one with \`submit_contribution\` (node_type=criterion, edge_type=raises, parent=<one of the linked framing questions>) whose body names the deliverable's bar verbatim — e.g. "${d?.shape_hint ?? title} MUST be present in a supporting claim." The criterion's title should mirror the deliverable's. NOTE that this also satisfies any \`unsatisfied_criterion\` gap that may exist later.`,
        );
      }

      if (primaryCriterion && anyAlreadySatisfying) {
        const wiredOptions = Array.from(alreadySatisfying);
        const wiredRendered = wiredOptions
          .map((id) => {
            const t = titleById.get(id);
            return t ? `${id} ("${truncateOneLine(t, 50)}")` : id;
          })
          .join(', ');
        innerLines.push(
          `    Step 2 — wire: DONE — option(s) ${wiredRendered} already satisfy criterion ${primaryCriterion.id}. Do NOT post another \`satisfies\` edge from a sibling option — the deliverable's coverage judge only counts satisfies edges, and one is enough to anchor step 3. Skip directly to step 3 and attach your claim to one of the already-satisfying options listed above.`,
        );
      } else if (primaryCriterion) {
        const unwired = candidateList.filter((id) => !alreadySatisfying.has(id));
        const target = unwired[0] ?? candidateList[0];
        innerLines.push(
          `    Step 2 — wire: pick the option that best meets the bar and post \`option satisfies criterion ${primaryCriterion.id}\` from that option. Suggested target: ${target ? `${target}${titleById.get(target) ? ` ("${truncateOneLine(titleById.get(target)!, 50)}")` : ''}` : '(no candidate yet — submit an option first)'}. All candidates answering the linked framing question(s): ${candidateRendered}.`,
        );
      } else {
        innerLines.push(
          `    Step 2 — wire: after minting the criterion in step 1, post \`option satisfies criterion <new_criterion_id>\` from the option that best meets the bar. Candidates answering the linked framing question(s): ${candidateRendered}.`,
        );
      }

      let claimAnchor: string;
      if (anyAlreadySatisfying) {
        claimAnchor = Array.from(alreadySatisfying)[0]!;
      } else if (candidateList.length > 0) {
        const unwired = candidateList.filter((id) => !alreadySatisfying.has(id));
        claimAnchor = unwired[0] ?? candidateList[0]!;
      } else {
        claimAnchor = '<the option from step 2 once it exists>';
      }
      const claimAnchorTitle =
        claimAnchor !== '<the option from step 2 once it exists>' && titleById.get(claimAnchor)
          ? ` ("${truncateOneLine(titleById.get(claimAnchor)!, 50)}")`
          : '';
      const anchorMarker = alreadySatisfying.has(claimAnchor)
        ? ' (this option already has the satisfies edge)'
        : '';
      const templateLine = template
        ? ` Template you can adapt verbatim (the wording below already passes the platform regex — swap nouns for your persona's domain, keep the structure intact): "${template}"`
        : '';
      innerLines.push(
        `    Step 3 — shape-matching claim: post \`claim supports option ${claimAnchor}\`${claimAnchorTitle}${anchorMarker} whose body is a substantive paragraph that contains the kind-specific shape. ${contentBar}${templateLine} If your research tools returned a relevant URL on this turn, post an \`evidence supports option\` with the same body shape INSTEAD — evidence with a real URL outranks a reasoned claim every time.`,
      );

      innerLines.push(
        `    Linked framing questions: ${framingIds.length > 0 ? framingIds.join(', ') : '(none recorded on the gap)'}.`,
      );

      suggestions.push(innerLines.join('\n'));
    }
    suggestions.push(
      '- if a deliverable truly cannot be produced from the available evidence, submit a `claim objects_to <option>` whose body explicitly contains "cannot be produced" or "insufficient evidence to produce" with your reasoning — that is the sanctioned `not_producible` escape hatch. Do NOT use it to duck a hard question; use it only when the brief is genuinely infeasible given the facts on hand.',
    );
  }

  const criterionLookup = new Map<
    string,
    { derivedFromDeliverableId: string | null; title: string | null }
  >();
  for (const c of source.contributions) {
    if (c.node_type !== 'criterion') continue;
    const derivedFrom =
      (c as { derived_from_deliverable_id?: string | null }).derived_from_deliverable_id ?? null;
    criterionLookup.set(c.id, { derivedFromDeliverableId: derivedFrom, title: c.title ?? null });
  }
  const deliverableTitleById = new Map<string, string>();
  for (const d of source.challenge?.deliverables ?? []) {
    deliverableTitleById.set(d.id, d.title ?? '');
  }
  const deliverableIdsWithGap = new Set(
    source.gaps
      .filter((g) => g.gap_type === 'missing_deliverable' || g.gap_type === 'shallow_deliverable')
      .map((g) => g.deliverable_id)
      .filter((id): id is string => typeof id === 'string'),
  );
  const unsatisfiedCriterionGaps = source.gaps.filter((g) => g.gap_type === 'unsatisfied_criterion');
  for (const gap of unsatisfiedCriterionGaps.slice(0, 3)) {
    const meta = gap.contribution_id ? criterionLookup.get(gap.contribution_id) : undefined;
    const derivedFrom = meta?.derivedFromDeliverableId ?? null;
    if (derivedFrom && deliverableIdsWithGap.has(derivedFrom)) {
      continue;
    }
    const deliverableRef =
      derivedFrom && deliverableTitleById.has(derivedFrom)
        ? ` (this criterion is the bar for deliverable "${deliverableTitleById.get(derivedFrom)}" — satisfying it directly advances that deliverable towards \`delivered\`)`
        : '';
    suggestions.push(
      `- unsatisfied criterion ${gap.contribution_id ?? '?'}${deliverableRef}: no option claims to satisfy it yet. Pick an existing option that meets the bar and submit \`option satisfies criterion\` from that option to this criterion, OR submit a NEW option that meets the bar with a \`satisfies\` edge. If no option can meet the bar, submit \`option violates criterion\` from the closest candidate so the gap is at least scored.`,
    );
  }

  const unsurfacedAssumptionGaps = source.gaps.filter(
    (g) => g.gap_type === 'unsurfaced_assumptions',
  );
  for (const gap of unsurfacedAssumptionGaps.slice(0, 3)) {
    suggestions.push(
      `- option ${gap.contribution_id ?? '?'} has many supporting claims but no surfaced assumption: post an \`assumption\` (titled) with \`edge_type=assumed_by\` pointing at that option. Body should name the single most load-bearing premise in one sentence — e.g. "Assumes battery costs continue to fall at >7% YoY through 2030", "Assumes regulator will accept self-attested emissions data". Making the premise explicit lets every other agent attack or defend it directly.`,
    );
  }

  const objectedAssumptionGaps = source.gaps.filter((g) => g.gap_type === 'objected_assumption');
  for (const gap of objectedAssumptionGaps.slice(0, 3)) {
    suggestions.push(
      `- assumption ${gap.contribution_id ?? '?'} has an unrebutted objection (${gap.description}). Either submit a \`claim objects_to <the_objection_claim>\` rebutting the objection (defends the assumption + the options resting on it), or \`refines\`/\`replaces\` the assumption with a tighter version the objection no longer applies to. Leaving this open quietly penalises every option built on top of the assumption.`,
    );
  }

  const underSupportedGaps = source.gaps.filter((g) => g.gap_type === 'under_supported_option');
  for (const gap of underSupportedGaps.slice(0, 4)) {
    suggestions.push(
      `- under-supported option ${gap.contribution_id ?? '?'} (${gap.description}). HIGH-LEVERAGE MOVE: call your research tool(s) for evidence relevant to THIS sibling specifically — not the leader. The synthesis values distribution as much as depth, and a single evidence node on a starved sibling moves the needle further than a fifth evidence node on an already-dominant option. If your research returns a real URL, post \`evidence supports option\` (or \`evidence objects_to option\` if the source contradicts it) pointed at ${gap.contribution_id ?? 'the starved option'}. If your tools genuinely turn up nothing for the sibling's framing, a reasoned \`claim supports option\` on the sibling is still better than another claim on the leader.`,
    );
  }

  const dataBountyGaps = source.gaps.filter((g) => g.gap_type === 'data_bounty');
  for (const gap of dataBountyGaps.slice(0, 3)) {
    suggestions.push(
      `- DATA BOUNTY (${gap.description}). The synthesis named a specific data input it is blocked on — the platform's most concrete ask. HIGHEST-LEVERAGE MOVE if you have research/data tools: fetch THAT dataset (the gap may carry a candidate source URL), then post \`evidence supports option\` with the real URL + excerpt against the relevant option. Bringing the named input upgrades a blocked deliverable toward procurement grade — and on a published gap report it is the unlock that reawakens the debate. Note: fabrication is caught at verification (coverage + peer review), not at write time, so cite a source that genuinely states the figure.`,
    );
  }

  const unsourcedFigureGaps = source.gaps.filter((g) => g.gap_type === 'unsourced_figure');
  for (const gap of unsourcedFigureGaps.slice(0, 3)) {
    suggestions.push(
      `- UNSOURCED FIGURE (${gap.description}). A number in the synthesis is a placeholder, unverified, or rests on a load-bearing assumption. Replace it with a figure backed by a primary source or a validated computational run: call your research tool(s) for the specific quantity, then post \`evidence supports option\` (or \`evidence objects_to option\` if the source contradicts the figure) carrying the real URL + the exact figure. A sourced number outranks a reasoned one at synthesis every time.`,
    );
  }

  const uncontestedGaps = source.gaps.filter((g) => g.gap_type === 'uncontested_option');
  const evidencelessGaps = source.gaps.filter((g) => g.gap_type === 'evidenceless_option');
  const optionsNeedingObjection = new Set(
    uncontestedGaps.map((g) => g.contribution_id).filter((id): id is string => !!id),
  );
  const optionsNeedingEvidence = new Set(
    evidencelessGaps.map((g) => g.contribution_id).filter((id): id is string => !!id),
  );
  const incompleteOptionIds = new Set<string>([
    ...optionsNeedingObjection,
    ...optionsNeedingEvidence,
  ]);
  const sortedIncomplete = Array.from(incompleteOptionIds)
    .sort((a, b) => {
      const aBoth = optionsNeedingObjection.has(a) && optionsNeedingEvidence.has(a) ? 0 : 1;
      const bBoth = optionsNeedingObjection.has(b) && optionsNeedingEvidence.has(b) ? 0 : 1;
      return aBoth - bBoth;
    })
    .slice(0, 4);
  for (const optionId of sortedIncomplete) {
    const node = source.contributions.find((c) => c.id === optionId);
    const titleHint = node?.title ? ` ("${truncateOneLine(node.title, 50)}")` : '';
    const needsObjection = optionsNeedingObjection.has(optionId);
    const needsEvidence = optionsNeedingEvidence.has(optionId);
    if (needsObjection && needsEvidence) {
      suggestions.push(
        `- structurally incomplete option ${optionId}${titleHint}: it has NO objections AND NO evidence. Pick whichever your persona is best placed to supply: (a) if you have a genuine concern, post a \`claim objects_to <option>\` naming the specific weakness in one sentence (mechanism failure, equity, feasibility, etc.) — disagreement is first-class content, not an attack; OR (b) call your research tool(s) for sources relevant to THIS option specifically, then post \`evidence supports option\` / \`evidence objects_to option\` with a real URL + excerpt. The synthesis cannot rank options it has never seen tested.`,
      );
    } else if (needsObjection) {
      suggestions.push(
        `- uncontested option ${optionId}${titleHint}: has no objections — every option that survives must have at least one named weakness on the graph for the synthesis to weigh trade-offs. If your persona sees a genuine flaw (cost, equity, feasibility, second-order effects, missing precondition), post a \`claim objects_to <option>\` with the weakness in one sentence. An option that nobody has ever objected to is indistinguishable from one nobody read.`,
      );
    } else if (needsEvidence) {
      suggestions.push(
        `- evidence-less option ${optionId}${titleHint}: no \`evidence\` node attached. ${hasResearchTools ? `Call ${options.researchToolNames.join(' / ')} with a query tied to THIS option's mechanism (not the framing question generically); if it returns a real URL, post \`evidence supports option\` against ${optionId}. Sourced options outrank reasoned options every time at synthesis.` : 'A `claim supports option` carrying a verbatim quoted figure from a known source you trust is the next-best move — still better than another unsourced claim.'}`,
      );
    }
  }

  if (source.signals.coverage < 0.5 && counts.question > 0) {
    suggestions.push(
      '- coverage is low: post an `option` with `edge_type=answers` on a question that has < 2 candidate answers. Options do NOT require a URL — they are reasoned proposals.',
    );
  }

  if (counts.option > 0 && counts.claim === 0) {
    suggestions.push(
      '- there are options but zero claims on the graph: pick an option you (dis)agree with and post a `claim supports <option>` or `claim objects_to <option>`. Reasoned prose, no URL required.',
    );
  }

  if (counts.option >= 2 && source.signals.contestation < 0.3) {
    suggestions.push(
      "- options exist but contestation is low: if any option has a genuine weakness from your persona's viewpoint, post a `claim objects_to <option>` rather than abstaining. Disagreement is first-class content.",
    );
  }

  if (counts.option >= 2 && optionsLookClustered(optionTitles)) {
    const personaHint = options.personaSummary
      ? ` From your persona's angle (${truncateOneLine(options.personaSummary, 200)}), what mechanism type is missing?`
      : '';
    suggestions.push(
      `- existing options share a framing (similar wording/mechanism). Propose an option that changes the MECHANISM — e.g. market pricing vs. regulation vs. voluntary standards vs. technology mandate vs. finance-side intervention — not a reworded variant.${personaHint}`,
    );
  }

  if (counts.question === 1 && counts.option >= 3) {
    suggestions.push(
      '- one root question with several competing options: the root is likely too broad. `raises` a narrow sub-question (funding model / enforcement / phasing / jurisdiction / measurement) so different personas can answer each independently. The new sub-question will need its own ratification before options can attach.',
    );
  } else if (counts.question === 1 && counts.option >= 2) {
    suggestions.push(
      '- only the root question exists: if there is a sub-issue the options gloss over, `raises` a follow-up question (no ratification needed to create it, but the new question will itself need ratifying before it can accept options).',
    );
  }

  if (counts.claim > 0 && source.signals.evidence_density < 1) {
    if (hasResearchTools) {
      suggestions.push(
        `- evidence_density is low (${source.signals.evidence_density.toFixed(2)}). PRIORITY MOVE: call ${options.researchToolNames.join(' / ')} BEFORE you decide on a node type. Open with a broad, mechanism-level query (e.g. the underlying physics/economics rather than the policy label); if the first call returns zero results, retry once or twice with different synonyms or a different tool — you have up to 3 research-tool calls this turn. If any call returns a real URL, post \`evidence supports <option|claim>\` (or \`evidence objects_to <option|claim>\`) with that URL, a short verbatim excerpt, and an \`accessed_at\` ISO date. Only after a genuine retry fails should you fall back to a reasoned \`claim\` — and even then, NEVER invent a citation.`,
      );
    } else {
      suggestions.push(
        '- evidence_density is low but you have no research tools available. Submit a reasoned `claim` — the debate still moves forward without your persona minting an `evidence` node.',
      );
    }
  }

  const concentration =
    (source.signals as { evidence_concentration?: number }).evidence_concentration ??
    (rawDebate.signals as { evidence_concentration?: number } | undefined)
      ?.evidence_concentration ??
    0;
  if (concentration >= 3 && counts.option >= 2 && hasResearchTools) {
    suggestions.push(
      `- evidence_concentration is high (${concentration.toFixed(2)}). One option has absorbed most of the evidence on the debate. Scan the [supports=… evidence=… objects=…] tags above and pick the sibling option on the SAME question with the LOWEST evidence count (zero is best, one is still good) — attach your next evidence node there. Adding a fifth evidence to an option that already has four counts for very little compared to growing a starved sibling from 0→1 or 1→2.`,
    );
  }

  if ((source.signals.stall_hours ?? 0) > 24 && counts.option >= 1) {
    suggestions.push(
      '- the debate is stalled: `refines` on an existing option with a sharper framing is a cheap unblock.',
    );
  }

  if (suggestions.length === 0) {
    suggestions.push(
      '- no obvious gap jumps out; pick the single most useful move for your persona. If you genuinely have nothing to add beyond what is already on the graph, abstain with `already_covered` or `out_of_scope`. Do NOT pick `insufficient_evidence` just because you lack a URL — claims and options never require URLs.',
    );
  }

  return [
    'Suggested moves (ranked, claims and options never require URLs):',
    ...suggestions,
  ].join('\n');
}

/**
 * Render the typed-edge grammar as a compact, copy-pasteable table.
 * Exported in case callers want to embed it elsewhere in their own
 * briefings.
 */
export function renderEdgeGrammar(): string {
  const lines: string[] = ['Typed-edge grammar (edge_type: allowed from → to pairs):'];
  for (const edge of EDGE_TYPES) {
    const pairs = EDGE_GRAMMAR[edge].map((r) => `${r.from}→${r.to}`).join(', ');
    lines.push(`  - ${edge}: ${pairs}`);
  }
  lines.push('Anything else is rejected. In particular:');
  lines.push(
    '  - `supports` is NEVER valid into a question; attach claims/options to a question with `raises` (claim→question) or `answers` (option→question) instead.',
  );
  lines.push(
    '  - `satisfies` / `violates` are option→CRITERION only — NEVER use them to attach an option to a question. For an option that resolves a question, use `answers` (option→question). Use `satisfies` only when there is an explicit `criterion` node in the graph and you want to claim this option meets that criterion (or `violates` if it clearly fails it).',
  );
  return lines.join('\n');
}

/**
 * Concrete example claim-body for each deliverable kind. The string returned
 * here is crafted to pass the matching `bodyMatchesKind` regex on the server,
 * so an LLM can copy-paste it, swap nouns, and be confident the result will
 * still match.
 */
export function templateForDeliverableKind(kind: string): string {
  switch (kind) {
    case 'quantitative_split':
      return 'Uproot failures: 64% (812 of 1,250 sampled), stem-snap: 36% (450 of 1,250). Axes logged against gust speed and antecedent VWC.';
    case 'cost_table':
      return 'Estimated USD 480/ha cost for tiered storm response vs USD 1,200/ha avoided damage by archetype, net USD 720/ha across the recommended bundle.';
    case 'rollout_schedule':
      return 'Phase 1 (2026): pilot threshold protocol on 3 sites. Phase 2 (2028): roll to 12 sites with quarterly calibration. Phase 3 (2030): full management-unit deployment.';
    case 'power_model':
      return 'Suba depot peaks at 14 MW coincident charging during shoulder-evening; Fontibón substation has 4 MW reserve before the next feeder upgrade.';
    case 'threshold_test':
      return 'If antecedent volumetric water content exceeds 35% AND forecast gusts exceed 25 m/s within 12 hours, trigger a Tier 2 storm response within 6 hours; if VWC exceeds 45%, drop to drainage-first Tier 3.';
    case 'allocation_table':
      return 'Santa Catarina: USD 1.2M, Paraná: USD 850k, Rio Grande do Sul: USD 720k across the regional bundle.';
    case 'minimum_viable_design':
      return 'Stage 1: pilot LiDAR + SAR backscatter calibration on 3 plots; then full raster validation across the management unit; followed by quarterly recalibration of the failure-mode surfaces.';
    case 'other':
    default:
      return '';
  }
}

/**
 * Translate a deliverable `kind` into a concrete content-shape recipe for
 * the LLM's claim body. Mirrors the server-side `bodyMatchesKind`
 * heuristics — if the prose the agent writes does not satisfy this recipe,
 * the coverage service leaves the deliverable in `sketched` and the
 * readiness gate keeps the debate open.
 */
export function contentBarForDeliverableKind(kind: string): string {
  switch (kind) {
    case 'quantitative_split':
      return 'The claim body MUST contain at least two percentage or absolute-count figures for a split (e.g. "70% BEV / 30% FCEV across 1,200 buses").';
    case 'cost_table':
      return 'The claim body MUST contain at least three currency-per-unit figures in a common pattern (e.g. "£0.32/km", "$1.4M/bus", "€850k capex per depot"). A prose summary of a table is fine; a real structured table in the synthesis is even better.';
    case 'rollout_schedule':
      return 'The claim body MUST contain at least two distinct four-digit years within the brief window (next ~10 years) and describe what changes in each (e.g. "2027: 300 BEVs at Depot A; 2029: interconnect upgrade; 2031: 600 additional BEVs phased").';
    case 'power_model':
      return 'The claim body MUST contain at least one MW/kW/GWh/kWh token plus at least one named depot/substation/facility (e.g. "Suba depot peaks at 14 MW coincident charging; Fontibón substation has 4 MW reserve").';
    case 'threshold_test':
      return 'The claim body MUST contain a conditional phrase (if / when / unless / only if) attached to a numeric trigger (e.g. "deploy FCEV only if hydrogen landed cost falls below $4/kg by 2028").';
    case 'allocation_table':
      return 'The claim body MUST contain currency tokens plus at least two named sub-regions or entities (e.g. "£12M to upper catchment farms, £8M to sewage works operator in the middle reach").';
    case 'minimum_viable_design':
      return 'The claim body MUST contain a named mechanism (pilot / protocol / scheme / contract / interconnect / framework) plus a sequencing clause (first / then / followed by / phase 1 / stage 2 / before / after).';
    case 'other':
    default:
      return 'The claim body MUST be substantive reasoned prose that directly addresses the deliverable title — not a one-line assertion.';
  }
}

function optionsLookClustered(titles: string[]): boolean {
  if (titles.length < 2) return false;
  const stopwords = new Set([
    'a', 'an', 'and', 'or', 'but', 'the', 'to', 'of', 'for', 'in', 'on', 'by', 'with',
    'at', 'as', 'is', 'be', 'are', 'via', 'use', 'using', 'that', 'this', 'these', 'those',
  ]);
  const tokenSets = titles.map(
    (t) =>
      new Set(
        t
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 2 && !stopwords.has(w)),
      ),
  );
  let maxPair = 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const jac = jaccard(tokenSets[i]!, tokenSets[j]!);
      total += jac;
      pairs++;
      if (jac > maxPair) maxPair = jac;
    }
  }
  const mean = pairs > 0 ? total / pairs : 0;
  return maxPair >= 0.5 || mean >= 0.35;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}
