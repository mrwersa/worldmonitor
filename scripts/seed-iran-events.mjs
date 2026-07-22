#!/usr/bin/env node

/**
 * @notification-source: domain (iran-events)
 *   publishNotificationEvent() below builds payload.title from structured
 *   category/location/severity fields parsed out of the LiveUAMap dump.
 *   Events are NOT RSS-origin and MUST NOT set payload.description. Enforced
 *   by tests/notification-relay-payload-audit.test.mjs.
 */

import { loadEnvFile, CHROME_UA, getRedisCredentials, runSeed } from './_seed-utils.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import notificationDedup from './shared/notification-dedup.cjs';
import { loadRegionConfig, geolocate, categorizeSeverity, parseRelativeTime, CATEGORY_MAP } from './lib/liveuamap-parser.mjs';

const { buildDedupMaterial, classifySetNxResult, recordDedupOutcome } = notificationDedup;

loadEnvFile(import.meta.url);

// Iran-events domain: opt-in steady-state conflict monitor, off by default.
// This is a manually re-seeded feed (an operator runs this script against a
// fresh LiveUAMap dump when there's something worth capturing), so no-op
// cleanly (exit 0) instead of republishing a stale dump when disabled. Set
// IRAN_EVENTS_ENABLED=true (see api/health.js) to enable across the domain —
// bootstrap delivery, the map layer, CII inputs, and country-scoped alerting
// all gate on the same flag. Nothing imports this module, so the early exit
// is safe.
if ((process.env.IRAN_EVENTS_ENABLED ?? 'false').toLowerCase() !== 'true') {
  console.log('[iran-events] Skipped: IRAN_EVENTS_ENABLED is off. Set it to true to enable this domain.');
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANONICAL_KEY = 'conflict:iran-events:v1';
const REGION_CONFIG = loadRegionConfig('IR');

// ─── Notification publishing ─────────────────────────────────────────────────
// Mirrors seed-aviation.mjs::publishNotificationEvent (itself mirroring
// ais-relay.cjs): LPUSH the event onto wm:events:queue, guarded by a SETNX
// dedup key. This seeder is manually re-run (not a persistent cron loop —
// see runSeed call below), so dedup MUST be Redis-backed rather than an
// in-memory Set like ais-relay.cjs's UCDP producer uses; otherwise every
// manual re-seed would re-alert on events already seen in a prior run.
// coalesceKey is the LiveUAMap event id, so dedup keys off the stable event
// identity rather than a title hash (titles are sometimes edited upstream).
// Dedup TTL matches the 14-day canonical TTL below so the dedup window
// never outlives the data it's guarding against re-alerting.
const NOTIFY_DEDUP_TTL_SECONDS = 1209600; // 14 days

async function upstashCommand(cmd) {
  const { url, token } = getRedisCredentials();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Upstash ${cmd[0]} failed: HTTP ${resp.status}`);
  return resp.json();
}

async function upstashSetNx(key, value, ttlSeconds) {
  try {
    const result = await upstashCommand(['SET', key, value, 'NX', 'EX', String(ttlSeconds)]);
    return classifySetNxResult(result?.result);
  } catch { return 'error'; }
}

async function upstashLpush(key, value) {
  try {
    const result = await upstashCommand(['LPUSH', key, value]);
    return typeof result?.result === 'number' && result.result > 0;
  } catch { return false; }
}

async function upstashDel(key) {
  try {
    const result = await upstashCommand(['DEL', key]);
    return result?.result === 1;
  } catch { return false; }
}

function notifyHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

async function publishNotificationEvent({ eventType, payload, severity, coalesceKey, dedupTtl = NOTIFY_DEDUP_TTL_SECONDS }) {
  try {
    const dedupMaterial = buildDedupMaterial(eventType, payload?.title, coalesceKey);
    const dedupKey = `wm:notif:scan-dedup:${eventType}:${notifyHash(dedupMaterial)}`;
    const dedupResult = await upstashSetNx(dedupKey, '1', dedupTtl);
    const dedupDecision = recordDedupOutcome(dedupResult, {
      surface: 'seed-iran-events',
      eventType,
      severity,
      fallbackKey: dedupKey,
      fallbackTtlSeconds: dedupTtl,
      emitTelemetry: ({ line }) => console.warn(line),
    });
    if (!dedupDecision.shouldPublish) {
      if (dedupDecision.isDuplicate) console.log(`[iran-events] Dedup hit — ${eventType}: ${String(payload.title ?? '').slice(0, 60)}`);
      return;
    }
    const msg = JSON.stringify({ eventType, payload, severity: dedupDecision.severity, publishedAt: Date.now() });
    const ok = await upstashLpush('wm:events:queue', msg);
    if (ok) {
      console.log(`[iran-events] Queued ${dedupDecision.severity} event: ${eventType} — ${String(payload.title ?? '').slice(0, 60)}`);
    } else {
      console.warn(`[iran-events] LPUSH failed for ${eventType} — rolling back dedup key`);
      await upstashDel(dedupKey);
    }
  } catch (e) {
    console.warn(`[iran-events] publishNotificationEvent error (${eventType}):`, e?.message || e);
  }
}

async function fetchIranEvents() {
  const dataPath = process.argv[2] || join(__dirname, 'data', 'iran-events-latest.json');
  console.log(`  Reading from: ${dataPath}`);

  const raw = JSON.parse(readFileSync(dataPath, 'utf8'));
  const events = raw.filter(e => e.id && e.title);

  console.log(`  Raw events: ${events.length}`);

  const mapped = events.map(e => {
    const geo = geolocate(e.title, REGION_CONFIG);
    const cat = CATEGORY_MAP[e.category] || 'general';
    return {
      id: e.id,
      title: e.title.slice(0, 500),
      category: cat,
      sourceUrl: e.link || '',
      latitude: geo.lat,
      longitude: geo.lon,
      locationName: geo.locationName,
      countryCode: geo.country,
      timestamp: parseRelativeTime(e.time || ''),
      severity: categorizeSeverity(e.title),
    };
  });

  mapped.sort((a, b) => b.timestamp - a.timestamp);

  // Only alert on the two severities the Alert Rule relay's sensitivity
  // gating actually distinguishes (matchesSensitivity in
  // notification-relay.cjs treats 'elevated'/'moderate' as neither 'high'
  // nor 'critical', so they'd never pass any rule) — publishing them would
  // just be wasted Redis calls.
  const alertable = mapped.filter(e => e.severity === 'critical' || e.severity === 'high');
  for (const e of alertable) {
    await publishNotificationEvent({
      eventType: 'conflict_escalation',
      payload: {
        title: e.title,
        source: 'LiveUAMap',
        ...(e.countryCode ? { countryCode: e.countryCode } : {}),
      },
      severity: e.severity,
      coalesceKey: e.id,
    });
  }

  return {
    events: mapped,
    scrapedAt: Date.now(),
  };
}

function validate(data) {
  return Array.isArray(data?.events) && data.events.length >= 1;
}

export function declareRecords(data) {
  return Array.isArray(data?.events) ? data.events.length : 0;
}

runSeed('conflict', 'iran-events', CANONICAL_KEY, fetchIranEvents, {
  validateFn: validate,
  // 14d canonical TTL == maxStaleMin (20160 min = 14d). This is a MANUALLY
  // re-seeded source (operator runs the script ~weekly when LiveUAMap has
  // fresh events); pre-fix the canonical TTL was 2 days while the
  // health-tolerance was 14 days, so any operator-cadence delay >2d left
  // the canonical TTL'd-out while seed-meta survived. Health then reported
  // `iranEvents: EMPTY records=0` while seed-meta still showed last-good
  // recordCount. Symptom on WM 2026-05-08: last manual seed 2.7d ago
  // (within tolerance), but canonical missing → CRIT in /api/health.
  // Bumping canonical TTL to match maxStaleMin keeps the canonical alive
  // for the full health-tolerance window. Same trap family as BIS PR #3610.
  ttlSeconds: 1209600,     // 14 days = 14 * 24 * 3600
  sourceVersion: 'liveuamap-manual-v1',

  declareRecords,
  schemaVersion: 1,
  maxStaleMin: 20160,
}).catch((err) => {
  const _cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : ''; console.error('FATAL:', (err.message || err) + _cause);
  process.exit(0);
});
