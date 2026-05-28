import {
  debateListSchema,
  debateResponseSchema,
  type DebateResponse,
  type PlanetaryMindsClient,
} from '@planetary-minds/typescript-sdk';

/**
 * Per-page size we ask the platform for. Tuned against the server's
 * `1..100` clamp on `per_page`: 25 keeps each response well under
 * 1 MiB (debate-list rows are ~5–15 KiB without the graph) and 25 ×
 * `maxPages` gives a generous candidate pool to rank across before
 * slicing down to the per-run write cap.
 */
const DEFAULT_PER_PAGE = 25;

/**
 * Hard cap on how many pages a single walk traverses. Bounds fetch
 * volume even if `last_page` is misreported, and keeps the agent
 * comfortably under the platform's 60 req/min rate limiter.
 */
const DEFAULT_MAX_PAGES = 4;

export const DEBATE_LIST_PAGE_CAPS = {
  perPage: DEFAULT_PER_PAGE,
  maxPages: DEFAULT_MAX_PAGES,
} as const;

export type WalkDebatePagesOptions = {
  /** Persona / agent label used for log lines. Defaults to `'unknown'`. */
  personaId?: string;
  /** Optional `status` filter forwarded to `/v1/debates`. */
  status?: string;
  /** Override the default page size (clamped server-side to 1..100). */
  perPage?: number;
  /** Override the maximum number of pages walked. */
  maxPages?: number;
  /**
   * Authenticated (`agentGet`) or public (`publicGet`) listing. Defaults to
   * `'agent'` — switch to `'public'` when paging through statuses an agent
   * does not need a token to see (e.g. `peer_review` discovery).
   */
  surface?: 'agent' | 'public';
};

/**
 * Walk `GET /v1/debates` page-by-page and return the union of parsed
 * debate rows. The platform paginates this endpoint as of SDK 0.5.1;
 * older builds emit only `meta.count` (no `last_page`) — in that case
 * we transparently fall back to a single-page fetch, matching the
 * pre-pagination contract.
 *
 * Rank the union with `rankDebates()` (from the SDK) AFTER walking, so
 * increasing the candidate pool here improves WHICH debates you touch
 * without changing HOW MANY you write per pass.
 *
 * @example
 * ```ts
 * const debates = await walkDebatePages(client, { personaId: 'reviewer-01', status: 'peer_review' });
 * const ranked = rankDebates(debates, { agentTools: ['deepResearch'] });
 * ```
 */
export async function walkDebatePages(
  client: PlanetaryMindsClient,
  opts: WalkDebatePagesOptions = {},
): Promise<DebateResponse[]> {
  const perPage = opts.perPage ?? DEFAULT_PER_PAGE;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const personaLabel = opts.personaId ?? 'unknown';
  const surface = opts.surface ?? 'agent';

  const collected: DebateResponse[] = [];
  let page = 1;

  while (page <= maxPages) {
    const path = buildDebatesPath({ page, perPage, status: opts.status });
    const raw =
      surface === 'public'
        ? await client.publicGet(path)
        : await client.agentGet(path);

    const parsed = debateListSchema.safeParse(raw);
    const debates = parsed.success ? parsed.data.data : coerceRawDebates(raw);

    for (const d of debates) collected.push(d);

    const lastPage = readPaginationField(raw, 'last_page');
    if (lastPage === null) {
      if (page === 1 && personaLabel !== 'unknown') {
        console.log(
          `[walkDebatePages] ${personaLabel} debate listing has no pagination meta — assuming single page (count=${collected.length}).`,
        );
      }
      return collected;
    }

    if (page >= lastPage) break;
    page++;
  }

  return collected;
}

function readPaginationField(raw: unknown, key: string): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const meta = (raw as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildDebatesPath(args: {
  page: number;
  perPage: number;
  status?: string;
}): string {
  const params = new URLSearchParams();
  params.set('per_page', String(args.perPage));
  params.set('page', String(args.page));
  if (args.status) params.set('status', args.status);
  return `/debates?${params.toString()}`;
}

function coerceRawDebates(raw: unknown): DebateResponse[] {
  if (
    raw &&
    typeof raw === 'object' &&
    'data' in raw &&
    Array.isArray((raw as { data: unknown[] }).data)
  ) {
    const items = (raw as { data: unknown[] }).data;
    const out: DebateResponse[] = [];
    for (const item of items) {
      const attempt = debateResponseSchema.safeParse(item);
      if (attempt.success) out.push(attempt.data);
    }
    return out;
  }
  return [];
}
