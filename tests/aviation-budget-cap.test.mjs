/**
 * Tests for the AviationStack monthly call budget — the hard ceiling that keeps
 * total paid usage under the plan limit.
 *
 *   reserveAviationStackCalls()  server/worldmonitor/aviation/v1/_avstack-budget.ts
 *   request-time wiring          list-airport-flights.ts, get-flight-status.ts
 *   seeder backstop              scripts/seed-aviation.mjs
 *
 * Behavioural tests mock the Upstash pipeline so the shared counter is
 * exercised end-to-end without network. Static tests pin the wiring + the
 * limit cache-key quantization (a separate spend regression).
 *
 * Run with: npm run test:data -- --test-name-pattern="aviation budget"
 */

import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ────────────────────────────────────────────────────────────────────────────
// 1. Behavioural — shared counter enforces request + hard ceilings
// ────────────────────────────────────────────────────────────────────────────

describe('aviation budget: reserveAviationStackCalls enforces ceilings', () => {
  let reserveAviationStackCalls;
  let counter; // simulated Redis INCRBY/DECRBY state

  before(async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'http://localhost:0';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    delete process.env.LOCAL_API_MODE;
    ({ reserveAviationStackCalls } = await import(
      '../server/worldmonitor/aviation/v1/_avstack-budget.ts'
    ));
  });

  beforeEach(() => {
    counter = 0;
    mock.method(globalThis, 'fetch', async (_url, opts) => {
      const cmds = JSON.parse(opts.body); // [[ 'INCRBY', key, n ], [ 'EXPIRE', ... ]]
      const results = cmds.map((cmd) => {
        const [verb, , n] = cmd;
        if (verb === 'INCRBY') { counter += Number(n); return { result: counter }; }
        if (verb === 'DECRBY') { counter -= Number(n); return { result: counter }; }
        return { result: 1 }; // EXPIRE
      });
      return { ok: true, json: async () => results };
    });
  });

  afterEach(() => {
    mock.restoreAll();
    delete process.env.AVIATIONSTACK_MONTHLY_BUDGET;
    delete process.env.AVIATIONSTACK_REQUEST_BUDGET;
  });

  it('allows request-time calls up to AVIATIONSTACK_REQUEST_BUDGET, then denies', async () => {
    process.env.AVIATIONSTACK_MONTHLY_BUDGET = '10';
    process.env.AVIATIONSTACK_REQUEST_BUDGET = '5';

    for (let i = 0; i < 5; i++) {
      assert.equal(await reserveAviationStackCalls(1, 'request'), true, `call ${i + 1} should be allowed`);
    }
    // 6th request would exceed the request ceiling.
    assert.equal(await reserveAviationStackCalls(1, 'request'), false);
    // Denied reservation is returned — counter stays at the ceiling, not above.
    assert.equal(counter, 5);
  });

  it('reserves headroom for the seeder above the request ceiling', async () => {
    process.env.AVIATIONSTACK_MONTHLY_BUDGET = '10';
    process.env.AVIATIONSTACK_REQUEST_BUDGET = '5';

    // Burn the request budget.
    for (let i = 0; i < 5; i++) await reserveAviationStackCalls(1, 'request');
    assert.equal(await reserveAviationStackCalls(1, 'request'), false);

    // Seeder can still use the reserved gap (5 → 10).
    assert.equal(await reserveAviationStackCalls(3, 'seed'), true);
    assert.equal(counter, 8);
    // ...but not past the hard cap.
    assert.equal(await reserveAviationStackCalls(3, 'seed'), false);
    assert.equal(counter, 8);
  });

  it('treats a zero MONTHLY budget as disabled (always allow, no Redis I/O)', async () => {
    process.env.AVIATIONSTACK_MONTHLY_BUDGET = '0';
    const fetchMock = globalThis.fetch;
    assert.equal(await reserveAviationStackCalls(999, 'request'), true);
    assert.equal(await reserveAviationStackCalls(999, 'seed'), true);
    assert.equal(fetchMock.mock.callCount(), 0, 'disabled cap must not touch Redis');
  });

  it('fails open when Redis is unreachable (never blanks the panel on a blip)', async () => {
    process.env.AVIATIONSTACK_MONTHLY_BUDGET = '10';
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
    assert.equal(await reserveAviationStackCalls(1, 'request'), true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Static — wiring + limit cache-key quantization
// ────────────────────────────────────────────────────────────────────────────

describe('aviation budget: call sites are wired to the cap', () => {
  const read = (p) => readFileSync(resolve(root, p), 'utf-8');

  it('list-airport-flights reserves budget and quantizes the limit out of the cache key', () => {
    const src = read('server/worldmonitor/aviation/v1/list-airport-flights.ts');
    assert.match(src, /reserveAviationStackCalls\(1, 'request'\)/);
    // Cache key must NOT vary by limit (was the spend-multiplying explosion).
    assert.doesNotMatch(src, /aviation:flights:\$\{airport\}:\$\{direction\}:\$\{limit\}/);
    assert.match(src, /aviation:flights:\$\{airport\}:\$\{direction\}:v2/);
    // Upstream always fetches a fixed page, then slices in memory.
    assert.match(src, /limit:\s*String\(UPSTREAM_PAGE\)/);
    assert.match(src, /flights\.slice\(0, limit\)/);
  });

  it('get-flight-status reserves budget before the upstream call', () => {
    const src = read('server/worldmonitor/aviation/v1/get-flight-status.ts');
    assert.match(src, /reserveAviationStackCalls\(1, 'request'\)/);
  });

  it('seeder reserves its batch against the same shared counter + key', () => {
    const src = read('scripts/seed-aviation.mjs');
    assert.match(src, /reserveAviationStackBudget\(AVIATIONSTACK_LIST\.length\)/);
    // Same Redis key format as the server helper — they MUST share the counter.
    assert.match(src, /aviation:avstack:calls:\$\{ym\}/);
  });
});
