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
import { loadRegionConfig, geolocate, categorizeSeverity } from '../scripts/lib/liveuamap-parser.mjs';

// Imports from scripts/lib/liveuamap-parser.mjs, NOT scripts/seed-iran-events.mjs
// directly — that script has a top-level `if (!IRAN_EVENTS_ENABLED) process.exit(0)`
// gate plus an unconditional runSeed() call at module scope (both intentional:
// direct `node scripts/seed-iran-events.mjs` runs should no-op cleanly while
// disabled, and otherwise kick off the real seed run). Importing it directly
// would trip the gate or the Redis-backed seed run. The pure parsing/attribution
// logic lives in lib/liveuamap-parser.mjs specifically so it's safe to import
// here (see that file's header comment).

const IR_REGION = loadRegionConfig('IR');
const locate = title => geolocate(title, IR_REGION);

describe('iran-events country attribution', () => {
  it('loads the theater dictionary by country code', () => {
    assert.equal(IR_REGION.regionCode, 'IR');
    assert.equal(IR_REGION.defaultLocation.country, 'IR');
    assert.ok(IR_REGION.locations.tehran);
    assert.throws(() => loadRegionConfig('iran'), /two-letter country code/);
  });

  it('attributes Iranian cities to IR', () => {
    assert.equal(locate('Explosion reported near Tehran').country, 'IR');
    assert.equal(locate('Strike hits Isfahan nuclear facility').country, 'IR');
  });

  it('attributes Israeli cities to IL, not IR', () => {
    assert.equal(locate('Sirens sound in Tel Aviv').country, 'IL');
    assert.equal(locate('Interceptor fired over Haifa').country, 'IL');
  });

  it('attributes Iraqi/Gulf cities to their own country, not IR', () => {
    assert.equal(locate('Rocket fired near Baghdad').country, 'IQ');
    assert.equal(locate('Reports from Manama, Bahrain').country, 'BH');
    assert.equal(locate('Base at Al Udeid on alert').country, 'QA');
  });

  it('leaves international-waters/chokepoint mentions unattributed (null), not guessed', () => {
    const hormuz = locate('Tanker seized in the Strait of Hormuz');
    assert.equal(hormuz.country, null);
    assert.equal(hormuz.locationName, 'strait of hormuz', 'the longest matching location phrase wins');
    assert.equal(locate('Naval buildup in the Persian Gulf').country, null);
  });

  it('falls back to Iran centroid + IR when no known location matches', () => {
    const geo = locate('Unspecified regional escalation reported');
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
