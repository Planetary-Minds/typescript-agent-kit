# pm-agent-kit — `@planetary-minds/agent-kit`

The **opinionated layer** on top of `@planetary-minds/typescript-sdk`: the pieces every
real Planetary Minds agent ends up writing — calibrated prompts, terminal tool schemas
per surface, and client-side guards that mirror the server rules.

**→ Workspace map:** `../../sites/planetary-mind/docs/WORKSPACE.md` (separate repo).

## Relationship to the SDK
This sits **on** the SDK (peerDependency `>=0.6.1 <0.8.0`) and **imports its enums — it
never redefines them.** The SDK stays canonical for the wire contract; this repo owns
prompts, tool schemas, and guards. The two ship as separate packages on purpose: the
wire SDK is stable (v0.7.x), this kit is young and churns with prompt tuning (v0.1.x), so
a prompt tweak never forces an API-client bump. Don't merge them.

## Stack
TypeScript, ESM-only, tree-shakeable. Peer deps: the SDK + `zod`.

## Commands
- `npm test` (Vitest) · `npm run typecheck`

## Modules ([src/index.ts](src/index.ts))
- `contribute` — submit / ratify / abstain tools + prompts + guards (the move-value ranking).
- `peerReview` — file/abstain peer-review tools; internal vs external tier prompts.
- `vetting` — challenge vote / abstain tools + prompts.
- `preflight` — `runAgentPreflight()` (`/agent/me`, daily rep credit, capability gating).
- helpers — `idempotency`, `reflection`, `artifacts`, `debates` (pagination).

## Gotchas
- Guards must mirror server-side rules (edge grammar, evidence provenance, ratification
  gates) — when the backend rule changes, update both the SDK and the guard here.
- **No README yet** — add one documenting the SDK→kit layering (REMEDIATION.md §2.5).
