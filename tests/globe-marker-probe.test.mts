/**
 * #5368 — the globe marker load that rides field INP reports.
 *
 * Two things matter here and both are behavioural: the probe must be SILENT
 * when the globe is not mounted (the flat map is the default, so most reports
 * must carry nothing), and it must not smuggle a device fingerprint into
 * telemetry that only needs a marker count.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketMarkerCount,
  getGlobeMarkerExtra,
  resetGlobeMarkerLoadForTesting,
  setGlobeMarkerLoad,
} from '../src/bootstrap/globe-marker-probe.ts';

beforeEach(() => resetGlobeMarkerLoadForTesting());

describe('globe marker probe (#5368)', () => {
  it('reports nothing until a globe publishes a load', () => {
    assert.equal(getGlobeMarkerExtra(), null);
  });

  it('reports nothing again once the globe unmounts', () => {
    setGlobeMarkerLoad({ rendered: 800, truncated: {}, activeLayerCount: 9 });
    assert.ok(getGlobeMarkerExtra());
    setGlobeMarkerLoad(null);
    assert.equal(getGlobeMarkerExtra(), null, 'a destroyed globe must stop attributing INP events');
  });

  it('carries the marker count, its bucket and the truncated layers', () => {
    setGlobeMarkerLoad({
      rendered: 800,
      truncated: { military: { shown: 300, total: 1526 }, ucdpEvents: { shown: 300, total: 2000 } },
      activeLayerCount: 11,
    });
    assert.deepEqual(getGlobeMarkerExtra(), {
      globeMarkers: 800,
      globeMarkerBucket: '501-1000',
      globeActiveLayerCount: 11,
      globeTruncated: ['military:300/1526', 'ucdpEvents:300/2000'],
    });
  });

  it('does not send a device fingerprint or the user\'s layer-interest vector', () => {
    setGlobeMarkerLoad({ rendered: 2319, truncated: {}, activeLayerCount: 9 });
    const extra = getGlobeMarkerExtra()!;
    for (const banned of ['deviceMemory', 'hardwareConcurrency', 'viewport', 'activeLayers']) {
      assert.ok(!(banned in extra), `${banned} must not ride a perf probe`);
    }
    // The layer COUNT is fine; the list of which layers a user watches is not.
    assert.equal(extra.globeActiveLayerCount, 9);
  });

  it('buckets the counts the census actually produces', () => {
    assert.equal(bucketMarkerCount(122), '0-200', 'mobile default view');
    assert.equal(bucketMarkerCount(200), '0-200');
    assert.equal(bucketMarkerCount(201), '201-500');
    assert.equal(bucketMarkerCount(800), '501-1000', 'desktop budget ceiling');
    assert.equal(bucketMarkerCount(2319), '2000+', 'desktop default view before this fix');
    assert.equal(bucketMarkerCount(4319), '2000+', 'with Armed Conflict Events on');
  });
});
