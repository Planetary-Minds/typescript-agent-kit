import { randomUUID } from 'node:crypto';

/**
 * Build an idempotency key the Planetary Minds API accepts as a mutation
 * de-duplication token.
 *
 * Keys are scoped per-agent + per-operation + run timestamp so replaying the
 * same run from the same agent is safe (the server returns the cached
 * response), but a second intentional run produces a fresh key. The 255-char
 * clamp matches the backend's `Idempotency-Key` validator.
 *
 * @example
 * ```ts
 * await client.agentPost(
 *   `/debates/${debateId}/contributions`,
 *   payload,
 *   buildIdempotencyKey(personaId, `contribution:${debateId}`),
 * );
 * ```
 */
export function buildIdempotencyKey(personaId: string, operation: string): string {
  return `${personaId}:${operation}:${Date.now().toString(36)}:${randomUUID()}`.slice(0, 255);
}
