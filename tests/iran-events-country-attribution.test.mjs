// Iran-events country attribution + notification-eligibility.
//
// Covers the reactivation work that wires this domain into the Alert Rule
// country-scope pipeline (scripts/notification-relay.cjs eventMatchesCountryScope):
// each parsed event must carry a countryCode so scoped alert rules can match
// it, and only 'critical'/'high' severity events are eligible for the
// conflict_escalation notification (see scripts/seed-iran-events.mjs
// fetchIranEvents — 'elevated'/'moderate' never pass matchesSensitivity in
// notification-relay.cjs, so publishing them would be wasted Redis calls).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { geolocate, categorizeSeverity } from '../scripts/lib/iran-events-parser.mjs';

// Imports from scripts/lib/iran-events-parser.mjs, NOT scripts/seed-iran-events.mjs
// directly — that script has a top-level `if (!IRAN_EVENTS_ENABLED) process.exit(0)`
// gate plus an unconditional runSeed() call at module scope (both intentional:
// direct `node scripts/seed-iran-events.mjs` runs should no-op cleanly while
// disabled, and otherwise kick off the real seed run). Importing it directly
// would trip the gate or the Redis-backed seed run. The pure parsing/attribution
// logic lives in lib/iran-events-parser.mjs specifically so it's safe to import
// here (see that file's header comment).

describe('iran-events country attribution', () => {
  it('attributes Iranian cities to IR', () => {
    assert.equal(geolocate('Explosion reported near Tehran').country, 'IR');
    assert.equal(geolocate('Strike hits Isfahan nuclear facility').country, 'IR');
  });

  it('attributes Israeli cities to IL, not IR', () => {
    assert.equal(geolocate('Sirens sound in Tel Aviv').country, 'IL');
    assert.equal(geolocate('Interceptor fired over Haifa').country, 'IL');
  });

  it('attributes Iraqi/Gulf cities to their own country, not IR', () => {
    assert.equal(geolocate('Rocket fired near Baghdad').country, 'IQ');
    assert.equal(geolocate('Reports from Manama, Bahrain').country, 'BH');
    assert.equal(geolocate('Base at Al Udeid on alert').country, 'QA');
  });

  it('leaves international-waters/chokepoint mentions unattributed (null), not guessed', () => {
    assert.equal(geolocate('Tanker seized in the Strait of Hormuz').country, null);
    assert.equal(geolocate('Naval buildup in the Persian Gulf').country, null);
  });

  it('falls back to Iran centroid + IR when no known location matches', () => {
    const geo = geolocate('Unspecified regional escalation reported');
    assert.equal(geo.locationName, 'Iran');
    assert.equal(geo.country, 'IR');
  });
});

describe('iran-events severity → notification eligibility', () => {
  it('classifies casualty language as critical', () => {
    assert.equal(categorizeSeverity('Airstrike kills several, dozens wounded'), 'critical');
  });

  it('classifies kinetic language without casualties as high', () => {
    assert.equal(categorizeSeverity('Missile strike destroys building'), 'high');
  });

  it('classifies defensive/alert language as elevated (below the notification threshold)', () => {
    assert.equal(categorizeSeverity('Air defense sirens sound, interceptors fire'), 'elevated');
  });

  it('classifies everything else as moderate (below the notification threshold)', () => {
    assert.equal(categorizeSeverity('Political statement issued from Baghdad'), 'moderate');
  });
});
