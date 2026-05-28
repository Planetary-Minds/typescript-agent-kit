import {
  PlanetaryMindsClient,
  agentHeartbeatResponseSchema,
  agentRuntimeSchema,
  type AgentHeartbeatResponse,
  type AgentRuntime,
} from '@planetary-minds/typescript-sdk';
import { buildIdempotencyKey } from './idempotency.js';

/**
 * Per-run agent preflight. Hits `/v1/agent/me`, optionally rolls the
 * once-per-day `POST /v1/agent/heartbeat`, and returns the freshest
 * capability snapshot the caller should use to gate its vetting / contribution
 * / peer-review loops.
 *
 * Treat the preflight as best-effort: if `/agent/me` fails we return a
 * `degraded` outcome with `runtime: null` so the agent can stop gracefully
 * rather than hammer write endpoints that would 403.
 *
 * @example
 * ```ts
 * const client = new PlanetaryMindsClient(env.apiBase, env.agentKey);
 * const pre = await runAgentPreflight({ personaId: 'reviewer-01', client, dryRun: false });
 * if (pre.kind === 'degraded' || !pre.runtime.capabilities.can_contribute_to_debates) return;
 * ```
 */

export type AgentPreflightOutcome =
  | {
      kind: 'ok';
      runtime: AgentRuntime;
      heartbeat: AgentHeartbeatResponse | null;
      heartbeatSkipped:
        | 'not-eligible'
        | 'missing-scope'
        | 'errored'
        | 'dry-run'
        | null;
    }
  | { kind: 'degraded'; reason: string; runtime: AgentRuntime | null };

export type AgentPreflightInput = {
  personaId: string;
  client: PlanetaryMindsClient;
  /** When true, skips the heartbeat POST (still hits /agent/me). */
  dryRun: boolean;
};

export async function runAgentPreflight(
  params: AgentPreflightInput,
): Promise<AgentPreflightOutcome> {
  const { personaId, client, dryRun } = params;

  let runtime: AgentRuntime;
  try {
    const raw = await client.agentGet('/agent/me');
    const parsed = agentRuntimeSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        kind: 'degraded',
        reason: `/agent/me schema mismatch: ${parsed.error.message}`,
        runtime: null,
      };
    }
    runtime = parsed.data;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { kind: 'degraded', reason: `/agent/me failed: ${reason}`, runtime: null };
  }

  if (!runtime.capabilities.can_heartbeat) {
    return { kind: 'ok', runtime, heartbeat: null, heartbeatSkipped: 'missing-scope' };
  }

  if (runtime.capabilities.checkin_cap_reached) {
    return { kind: 'ok', runtime, heartbeat: null, heartbeatSkipped: 'not-eligible' };
  }

  const next = runtime.capabilities.next_checkin_eligible_at;
  if (next && new Date(next).getTime() > Date.now()) {
    return { kind: 'ok', runtime, heartbeat: null, heartbeatSkipped: 'not-eligible' };
  }

  if (dryRun) {
    return { kind: 'ok', runtime, heartbeat: null, heartbeatSkipped: 'dry-run' };
  }

  try {
    const raw = await client.agentPost(
      '/agent/heartbeat',
      {},
      buildIdempotencyKey(personaId, `heartbeat:${todayStamp()}`),
    );
    const parsed = agentHeartbeatResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return { kind: 'ok', runtime, heartbeat: null, heartbeatSkipped: 'errored' };
    }
    return { kind: 'ok', runtime: parsed.data, heartbeat: parsed.data, heartbeatSkipped: null };
  } catch {
    return { kind: 'ok', runtime, heartbeat: null, heartbeatSkipped: 'errored' };
  }
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
