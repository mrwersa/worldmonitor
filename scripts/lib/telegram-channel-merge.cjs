// Pure telegram-channel loading/merging logic, extracted from
// scripts/ais-relay.cjs so it's safely importable. ais-relay.cjs is an
// 11k+ line monolithic script with no module.exports and heavy top-level
// side effects (server startup, live polling setInterval loops) that all
// fire on require() — genuinely unsafe to require() from a test process.
// Keeping this logic here, with no top-level side effects of its own,
// lets tests exercise the real merge/error-handling behavior instead of a
// hand-copied duplicate that can silently drift from what ships.

const { readFileSync } = require('node:fs');

/**
 * Reads one telegram-channels JSON file and returns the parsed+filtered
 * channel list for one channel-set bucket (e.g. 'full', 'tech').
 *
 * @param {string} filePath
 * @param {string} set
 * @param {{ optional: boolean }} opts `optional: true` treats a missing
 *   file (ENOENT) as the expected steady state (no error reported) — used
 *   for the operator-provided local override, which usually doesn't exist.
 *   The required base file reports ENOENT as a genuine error, same as any
 *   other read/parse failure.
 * @returns {{ channels: Array<object>, error: string|null }}
 */
function readChannelFile(filePath, set, opts) {
  const optional = opts?.optional ?? false;
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    const bucket = raw?.channels?.[set];
    const channels = Array.isArray(bucket) ? bucket : [];
    return {
      channels: channels
        .filter(c => c && typeof c.handle === 'string' && c.handle.length > 1 && c.enabled !== false)
        .map(c => ({
          handle: String(c.handle).replace(/^@/, ''),
          label: c.label ? String(c.label) : undefined,
          topic: c.topic ? String(c.topic) : undefined,
          region: c.region ? String(c.region) : undefined,
          tier: c.tier != null ? Number(c.tier) : undefined,
          enabled: c.enabled !== false,
          maxMessages: c.maxMessages != null ? Number(c.maxMessages) : undefined,
        })),
      error: null,
    };
  } catch (e) {
    if (optional && e?.code === 'ENOENT') {
      return { channels: [], error: null };
    }
    return { channels: [], error: `failed to load ${filePath}: ${e?.message || String(e)}` };
  }
}

/**
 * Merges a base channel list with a local-override channel list. Local
 * entries replace base entries with the same handle; everything else from
 * both lists is kept. Returns `base` unchanged (same reference) when there
 * are no local channels, so callers can cheaply detect the no-override case.
 *
 * @param {Array<{handle: string}>} base
 * @param {Array<{handle: string}>} local
 * @returns {Array<{handle: string}>}
 */
function mergeChannels(base, local) {
  if (!local.length) return base;
  const merged = new Map();
  for (const c of base) merged.set(c.handle, c);
  for (const c of local) merged.set(c.handle, c);
  return Array.from(merged.values());
}

module.exports = { readChannelFile, mergeChannels };
