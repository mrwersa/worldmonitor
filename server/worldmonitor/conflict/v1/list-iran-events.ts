import type {
  ServerContext,
  ListIranEventsRequest,
  ListIranEventsResponse,
} from '../../../../src/generated/server/worldmonitor/conflict/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';

const REDIS_KEY = 'conflict:iran-events:v1';

// Iran-events domain: opt-in steady-state conflict monitor, off by default —
// serve empty immediately rather than the stale cached snapshot that lingers
// for the key's 14-day TTL while disabled. Set IRAN_EVENTS_ENABLED=true to
// enable. See api/health.js.
const IRAN_EVENTS_ENABLED = (process.env.IRAN_EVENTS_ENABLED ?? 'false').toLowerCase() === 'true';

export async function listIranEvents(
  _ctx: ServerContext,
  _req: ListIranEventsRequest,
): Promise<ListIranEventsResponse> {
  if (!IRAN_EVENTS_ENABLED) return { events: [], scrapedAt: '0' };
  try {
    const cached = await getCachedJson(REDIS_KEY);
    if (cached && typeof cached === 'object' && 'events' in (cached as Record<string, unknown>)) {
      return cached as ListIranEventsResponse;
    }
    return { events: [], scrapedAt: '0' };
  } catch {
    return { events: [], scrapedAt: '0' };
  }
}
