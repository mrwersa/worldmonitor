// Side-effect-free LiveUAMap parsing shared by every theater seeder.
// Location dictionaries live in data/liveuamap-regions/<country-code>.json;
// adding a theater should not require copying or changing this parser.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REGIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'liveuamap-regions');
const regionCache = new Map();
const locationNameCache = new WeakMap();

export const CATEGORY_MAP = {
  cat1: 'military',
  cat2: 'international',
  cat6: 'political',
  cat7: 'civil',
  cat9: 'intelligence',
  cat10: 'airstrike',
  cat11: 'defense',
};

/**
 * Load and validate a theater's location dictionary by ISO-3166 alpha-2 code.
 * The default directory is cached; tests and tools can supply another baseDir.
 */
export function loadRegionConfig(countryCode, { baseDir = DEFAULT_REGIONS_DIR } = {}) {
  const code = String(countryCode ?? '').trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) {
    throw new Error(`LiveUAMap region code must be a two-letter country code; received "${countryCode ?? ''}"`);
  }

  const cacheKey = baseDir === DEFAULT_REGIONS_DIR ? code : null;
  if (cacheKey && regionCache.has(cacheKey)) return regionCache.get(cacheKey);

  const filePath = join(baseDir, `${code}.json`);
  let config;
  try {
    config = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to load LiveUAMap region ${code.toUpperCase()} from ${filePath}: ${error?.message || error}`, { cause: error });
  }

  validateRegionConfig(config, code, filePath);
  if (cacheKey) regionCache.set(cacheKey, config);
  return config;
}

function validateRegionConfig(config, expectedCode, filePath) {
  const defaultLocation = config?.defaultLocation;
  if (String(config?.regionCode ?? '').toLowerCase() !== expectedCode) {
    throw new Error(`LiveUAMap region config ${filePath} must declare regionCode "${expectedCode.toUpperCase()}"`);
  }
  if (!defaultLocation || !Number.isFinite(defaultLocation.lat) || !Number.isFinite(defaultLocation.lon)
    || typeof defaultLocation.locationName !== 'string') {
    throw new Error(`LiveUAMap region config ${filePath} has an invalid defaultLocation`);
  }
  if (defaultLocation.country !== null && !/^[A-Z]{2}$/.test(defaultLocation.country ?? '')) {
    throw new Error(`LiveUAMap region config ${filePath} has an invalid default country attribution`);
  }
  if (!config.locations || typeof config.locations !== 'object' || Array.isArray(config.locations)) {
    throw new Error(`LiveUAMap region config ${filePath} must contain a locations object`);
  }
  for (const [name, location] of Object.entries(config.locations)) {
    if (!name || !Number.isFinite(location?.lat) || !Number.isFinite(location?.lon)) {
      throw new Error(`LiveUAMap region config ${filePath} has invalid coordinates for "${name}"`);
    }
    if (location.country !== null && !/^[A-Z]{2}$/.test(location.country ?? '')) {
      throw new Error(`LiveUAMap region config ${filePath} has invalid country attribution for "${name}"`);
    }
  }
}

export function geolocate(title, regionConfig) {
  if (!regionConfig?.locations || !regionConfig?.defaultLocation) {
    throw new Error('geolocate requires a region config loaded by loadRegionConfig()');
  }
  const lower = String(title ?? '').toLowerCase();
  // Prefer the most specific phrase when names overlap (for example
  // "strait of hormuz" before "hormuz"). JSON insertion order must not
  // silently decide attribution.
  let names = locationNameCache.get(regionConfig);
  if (!names) {
    names = Object.keys(regionConfig.locations).sort((a, b) => b.length - a.length);
    locationNameCache.set(regionConfig, names);
  }
  for (const name of names) {
    if (lower.includes(name)) {
      const { lat, lon, country = null } = regionConfig.locations[name];
      return { lat, lon, locationName: name, country };
    }
  }
  return { ...regionConfig.defaultLocation };
}

export function categorizeSeverity(title) {
  const lower = String(title ?? '').toLowerCase();
  if (/killed|dead|casualties|death toll|wounded/.test(lower)) return 'critical';
  if (/airstrike|bombing|missile|explosion|struck|destroyed/.test(lower)) return 'high';
  if (/intercept|defense|sirens|alert/.test(lower)) return 'elevated';
  return 'moderate';
}

export function parseRelativeTime(timeStr) {
  const value = String(timeStr ?? '');
  const now = Date.now();
  const match = value.match(/(\d+)\s+hours?\s+ago/);
  if (match) return now - parseInt(match[1], 10) * 3600_000;
  const minMatch = value.match(/(\d+)\s+min/);
  if (minMatch) return now - parseInt(minMatch[1], 10) * 60_000;
  if (/a day ago/.test(value)) return now - 86400_000;
  const dayMatch = value.match(/(\d+)\s+days?\s+ago/);
  if (dayMatch) return now - parseInt(dayMatch[1], 10) * 86400_000;
  return now;
}
