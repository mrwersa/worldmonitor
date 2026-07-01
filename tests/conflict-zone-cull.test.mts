import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Feature, Geometry } from 'geojson';

import {
  type BBox,
  type BoundedFeature,
  bboxIntersects,
  CULL_PAD_FRACTION,
  cullToViewport,
  geometryBounds,
  isWorldViewport,
  padViewport,
  viewportCacheKey,
} from '../src/components/map/conflict-zone-cull.ts';

function polygon(id: string, bounds: BBox): BoundedFeature {
  const [w, s, e, n] = bounds;
  const feature: Feature = {
    type: 'Feature',
    properties: { id },
    geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  };
  return { bounds, feature };
}

const idsOf = (features: Feature[]): string[] => features.map((f) => String(f.properties?.id));

describe('geometryBounds (#4561 U1)', () => {
  it('computes bounds of a Polygon', () => {
    const geom: Geometry = { type: 'Polygon', coordinates: [[[10, 20], [30, 20], [30, 40], [10, 40], [10, 20]]] };
    assert.deepEqual(geometryBounds(geom), [10, 20, 30, 40]);
  });

  it('computes bounds spanning a MultiPolygon', () => {
    const geom: Geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]],
        [[[-10, -8], [-6, -8], [-6, -4], [-10, -4], [-10, -8]]],
      ],
    };
    assert.deepEqual(geometryBounds(geom), [-10, -8, 5, 5]);
  });

  it('spans a GeometryCollection and returns null for empty coordinates', () => {
    const gc: Geometry = {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] },
        { type: 'Point', coordinates: [8, 9] },
      ],
    };
    assert.deepEqual(geometryBounds(gc), [1, 1, 8, 9]);
    assert.equal(geometryBounds({ type: 'Polygon', coordinates: [] }), null);
    assert.equal(geometryBounds(null), null);
  });
});

describe('bboxIntersects (#4561 U1)', () => {
  it('detects overlap, non-overlap, and edge-touch', () => {
    assert.equal(bboxIntersects([0, 0, 10, 10], [5, 5, 15, 15]), true); // overlap
    assert.equal(bboxIntersects([0, 0, 10, 10], [20, 20, 30, 30]), false); // disjoint
    assert.equal(bboxIntersects([0, 0, 10, 10], [10, 10, 20, 20]), true); // corner touch (boundary)
  });
});

describe('isWorldViewport (#4561 U1)', () => {
  it('treats near-global, antimeridian-crossing, and non-finite viewports as world', () => {
    assert.equal(isWorldViewport([-160, -70, 160, 70]), true); // 320deg span
    assert.equal(isWorldViewport([170, -10, -170, 10]), true); // east <= west (antimeridian)
    assert.equal(isWorldViewport([Number.NaN, 0, 10, 10]), true); // non-finite
    assert.equal(isWorldViewport([10, 0, 40, 20]), false); // regional
  });
});

describe('padViewport (#4561 U1)', () => {
  it('expands by the configured fraction on each side', () => {
    assert.deepEqual(padViewport([0, 0, 10, 20], 0.5), [-5, -10, 15, 30]);
    assert.deepEqual(padViewport([0, 0, 10, 20]), [
      -10 * CULL_PAD_FRACTION, -20 * CULL_PAD_FRACTION, 10 + 10 * CULL_PAD_FRACTION, 20 + 20 * CULL_PAD_FRACTION,
    ]);
  });
});

describe('cullToViewport (#4561 U1)', () => {
  const zones: BoundedFeature[] = [
    polygon('inside', [12, 12, 18, 18]), // well inside a [10,10,40,30] viewport
    polygon('straddle', [8, 9, 11, 11]), // straddles the west/south edge
    polygon('outside', [80, 60, 90, 70]), // far outside, beyond padding
  ];

  it('includes overlapping and edge-straddling zones, excludes far-outside ones', () => {
    const visible = cullToViewport(zones, [10, 10, 40, 30]);
    const ids = idsOf(visible);
    assert.ok(ids.includes('inside'), 'inside zone rendered');
    assert.ok(ids.includes('straddle'), 'edge-straddling zone rendered');
    assert.ok(!ids.includes('outside'), 'far-outside zone culled');
  });

  it('returns an empty list (no throw) when no zone intersects', () => {
    const visible = cullToViewport([polygon('far', [80, 60, 90, 70])], [10, 10, 40, 30]);
    assert.deepEqual(visible, []);
  });

  it('returns every zone at world / antimeridian viewports (never under-culls)', () => {
    assert.equal(cullToViewport(zones, [-160, -80, 160, 80]).length, zones.length);
    assert.equal(cullToViewport(zones, [170, -10, -170, 10]).length, zones.length);
  });

  it('keeps a zone just outside the raw viewport but within the pad margin', () => {
    // viewport [0,0,10,10], pad 0.5 -> padded [-5,-5,15,15]; zone at [12,12,14,14] is
    // outside the raw viewport but inside the padded box, so it stays (no pop-in on pan).
    const near = [polygon('near', [12, 12, 14, 14])];
    assert.deepEqual(idsOf(cullToViewport(near, [0, 0, 10, 10])), ['near']);
  });
});

describe('viewportCacheKey (#4561 U1)', () => {
  it('is stable for a sub-step pan and changes past the quantization step', () => {
    const base: BBox = [0, 0, 40, 20]; // stepLon = 10, stepLat = 5
    const key = viewportCacheKey(base, 4);
    // small pan (< step) quantizes to the same cell -> same key
    assert.equal(viewportCacheKey([1, 1, 41, 21], 4), key);
    // pan past the step -> new key
    assert.notEqual(viewportCacheKey([12, 7, 52, 27], 4), key);
    // zoom change -> new key
    assert.notEqual(viewportCacheKey(base, 6), key);
  });

  it('collapses all world/antimeridian viewports to a per-zoom world key', () => {
    assert.equal(viewportCacheKey([-170, -80, 170, 80], 2), 'world:2');
    assert.equal(viewportCacheKey([170, -10, -170, 10], 2), 'world:2');
  });
});
