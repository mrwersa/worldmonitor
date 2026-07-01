/**
 * Viewport-culling + cache-key helpers for the conflict-zone GeoJson layer
 * (#4561, follow-up to #4558; part of #4537 / #4487).
 *
 * Pure and dependency-free (geojson types only) so it is unit-testable under
 * `tsx --test` without a DOM/WebGL context. `DeckGLMap.buildConflictZoneGeoJson`
 * uses these to bound the deck.gl tessellation to the zones intersecting the
 * current map viewport instead of tessellating every zone's polygon (the
 * dominant warm-INP presentation-delay cost — field data 2026-06-30/07-01).
 *
 * The cull is deliberately conservative so it never hides a zone that should be
 * visible (R5): it tests each zone's axis-aligned bounding box (never the
 * polygon itself → over-inclusion, never under-inclusion), pads the viewport,
 * and never culls at world/low zoom or across the antimeridian.
 */
import type { Feature, Geometry } from 'geojson';

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

/** A conflict-zone feature paired with its precomputed geographic bounds. */
export interface BoundedFeature {
  bounds: BBox;
  feature: Feature;
}

/** Fraction of the viewport span added as padding on each side before culling. */
export const CULL_PAD_FRACTION = 0.5;
/** Longitude span (deg) at/above which the viewport is treated as "world" (no cull). */
export const WORLD_LON_SPAN = 300;

function walkPositions(coords: unknown, visit: (lon: number, lat: number) => void): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    visit(coords[0], coords[1]);
    return;
  }
  for (const child of coords) walkPositions(child, visit);
}

/**
 * Axis-aligned bounds of a Polygon / MultiPolygon / GeometryCollection, or null
 * when the geometry carries no coordinates. Walks nested coordinate arrays so it
 * works for both a zone's own polygon and a substituted country multipolygon.
 */
export function geometryBounds(geometry: Geometry | null | undefined): BBox | null {
  if (!geometry) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (lon: number, lat: number): void => {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  };
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries) {
      const b = geometryBounds(child);
      if (b) {
        visit(b[0], b[1]);
        visit(b[2], b[3]);
      }
    }
  } else if ('coordinates' in geometry) {
    walkPositions(geometry.coordinates, visit);
  }
  return Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)
    ? [west, south, east, north]
    : null;
}

/** Standard AABB overlap. Assumes both boxes are non-antimeridian-crossing (west <= east). */
export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * True when the viewport must NOT be culled: it crosses the antimeridian
 * (east <= west), is degenerate/non-finite, or spans (near) the whole globe.
 * Culling in those cases could hide a visible zone, so the caller renders all.
 */
export function isWorldViewport(viewport: BBox, worldLonSpan = WORLD_LON_SPAN): boolean {
  const [west, south, east, north] = viewport;
  if (![west, south, east, north].every((v) => Number.isFinite(v))) return true;
  if (east <= west) return true; // antimeridian crossing / degenerate → don't cull
  return east - west >= worldLonSpan;
}

/** Expand a bbox by a fraction of its span on each side. */
export function padViewport(viewport: BBox, fraction = CULL_PAD_FRACTION): BBox {
  const [west, south, east, north] = viewport;
  const dLon = (east - west) * fraction;
  const dLat = (north - south) * fraction;
  return [west - dLon, south - dLat, east + dLon, north + dLat];
}

/**
 * The features whose bounds intersect the padded viewport, order preserved. At
 * world/low zoom (or across the antimeridian) returns every feature so we never
 * under-cull.
 */
export function cullToViewport(
  features: readonly BoundedFeature[],
  viewport: BBox,
  padFraction = CULL_PAD_FRACTION,
): Feature[] {
  if (isWorldViewport(viewport)) return features.map((f) => f.feature);
  const padded = padViewport(viewport, padFraction);
  const out: Feature[] = [];
  for (const f of features) {
    if (bboxIntersects(f.bounds, padded)) out.push(f.feature);
  }
  return out;
}

/**
 * Quantized cache key: identical within a grid cell (~1/4 of the viewport span)
 * so a small pan reuses the cached cull, while a pan past the step yields a new
 * key. The step (span/4) is smaller than the pad (span/2), so the cache always
 * refreshes before the padding is exhausted — no stale/missing zone on pan.
 */
export function viewportCacheKey(viewport: BBox, zoom: number): string {
  if (isWorldViewport(viewport)) return `world:${Math.round(zoom)}`;
  const [west, south, east, north] = viewport;
  const stepLon = Math.max((east - west) / 4, 0.01);
  const stepLat = Math.max((north - south) / 4, 0.01);
  const q = (v: number, step: number): string => (Math.round(v / step) * step).toFixed(3);
  return `${Math.round(zoom)}:${q(west, stepLon)}:${q(south, stepLat)}:${q(east, stepLon)}:${q(north, stepLat)}`;
}
