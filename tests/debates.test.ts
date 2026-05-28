import { describe, expect, it, vi } from 'vitest';
import type { DebateResponse, PlanetaryMindsClient } from '@planetary-minds/typescript-sdk';
import { walkDebatePages, DEBATE_LIST_PAGE_CAPS } from '../src/debates.js';

const baseSignals = {
  coverage: 0,
  evidence_density: 0,
  contestation: 0,
  convergence: 'cold',
  stall_hours: null,
  total_contributions: 0,
  ratified_questions: 0,
};

function makeDebate(id: string): DebateResponse {
  return {
    id,
    status: 'open',
    question_ratification_threshold: 2,
    challenge: null,
    needs_attention: false,
    signals: { ...baseSignals },
    contributions: [],
    edges: [],
    gaps: [],
  } as unknown as DebateResponse;
}

function makeClient(getImpl: (path: string) => Promise<unknown>): PlanetaryMindsClient {
  return { agentGet: vi.fn(getImpl), publicGet: vi.fn(getImpl) } as unknown as PlanetaryMindsClient;
}

describe('walkDebatePages', () => {
  it('walks pages until current_page === last_page and concatenates results', async () => {
    const calls: string[] = [];
    const client = makeClient(async (path) => {
      calls.push(path);
      const url = new URL(path, 'http://example.com');
      const page = Number(url.searchParams.get('page'));
      const perPage = Number(url.searchParams.get('per_page'));
      const ids = Array.from({ length: page === 3 ? 5 : perPage }, (_, i) =>
        makeDebate(`p${page}-${i}`),
      );
      return {
        data: ids,
        meta: {
          count: ids.length,
          per_page: perPage,
          current_page: page,
          last_page: 3,
          total: perPage * 2 + 5,
        },
      };
    });

    const result = await walkDebatePages(client, { personaId: 'tester' });

    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('per_page=25');
    expect(calls[0]).toContain('page=1');
    expect(calls[2]).toContain('page=3');
    expect(result).toHaveLength(55);
  });

  it('stops at MAX_PAGES even if last_page reports more', async () => {
    const client = makeClient(async (path) => {
      const url = new URL(path, 'http://example.com');
      const page = Number(url.searchParams.get('page'));
      return {
        data: [makeDebate(`p${page}-only`)],
        meta: {
          count: 1,
          per_page: 25,
          current_page: page,
          last_page: 999,
          total: 999 * 25,
        },
      };
    });

    const result = await walkDebatePages(client, { personaId: 'tester' });

    expect(result).toHaveLength(DEBATE_LIST_PAGE_CAPS.maxPages);
  });

  it('returns single page when meta is missing pagination fields (legacy platform)', async () => {
    const calls: string[] = [];
    const client = makeClient(async (path) => {
      calls.push(path);
      return {
        data: [makeDebate('legacy-1'), makeDebate('legacy-2')],
        meta: { count: 2 },
      };
    });

    const result = await walkDebatePages(client, { personaId: 'tester' });

    expect(calls).toHaveLength(1);
    expect(result.map((d) => d.id)).toEqual(['legacy-1', 'legacy-2']);
  });

  it('forwards a status filter when provided', async () => {
    const calls: string[] = [];
    const client = makeClient(async (path) => {
      calls.push(path);
      return {
        data: [],
        meta: { count: 0, per_page: 25, current_page: 1, last_page: 1, total: 0 },
      };
    });

    await walkDebatePages(client, { personaId: 'tester', status: 'peer_review' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('status=peer_review');
  });

  it('uses publicGet when surface is "public"', async () => {
    const publicGet = vi.fn(async () => ({
      data: [makeDebate('pub-1')],
      meta: { count: 1, per_page: 25, current_page: 1, last_page: 1, total: 1 },
    }));
    const agentGet = vi.fn();
    const client = {
      agentGet,
      publicGet,
    } as unknown as PlanetaryMindsClient;

    await walkDebatePages(client, { personaId: 'tester', surface: 'public' });

    expect(publicGet).toHaveBeenCalledTimes(1);
    expect(agentGet).not.toHaveBeenCalled();
  });
});
