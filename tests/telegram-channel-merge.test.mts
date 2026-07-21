import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mirror the merge logic from scripts/ais-relay.cjs — these functions are
// extracted for testability since the relay is a monolithic .cjs file.
// The tests validate the contract: base + local = merged, local overrides.

function readChannelFile(filePath: string, set: string) {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    const bucket = raw?.channels?.[set];
    const channels = Array.isArray(bucket) ? bucket : [];
    return channels
      .filter((c: Record<string, unknown>) => c && typeof c.handle === 'string' && c.handle.length > 1 && c.enabled !== false)
      .map((c: Record<string, unknown>) => ({
        handle: String(c.handle).replace(/^@/, ''),
        label: c.label ? String(c.label) : undefined,
        topic: c.topic ? String(c.topic) : undefined,
        region: c.region ? String(c.region) : undefined,
        tier: c.tier != null ? Number(c.tier) : undefined,
        enabled: c.enabled !== false,
        maxMessages: c.maxMessages != null ? Number(c.maxMessages) : undefined,
      }));
  } catch {
    return [];
  }
}

function mergeChannels(base: ReturnType<typeof readChannelFile>, local: ReturnType<typeof readChannelFile>) {
  if (!local.length) return base;
  const merged = new Map<string, (typeof base)[number]>();
  for (const c of base) merged.set(c.handle, c);
  for (const c of local) merged.set(c.handle, c);
  return Array.from(merged.values());
}

let tmpDir: string;

function writeChannelFile(fileName: string, content: object): string {
  if (!tmpDir) tmpDir = mkdtempSync(join(tmpdir(), 'wm-tg-test-'));
  const p = join(tmpDir, fileName);
  writeFileSync(p, JSON.stringify(content));
  return p;
}

test.after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

test('telegram-channels: base file loaded, local empty — returns base', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: 'testChan', label: 'Test', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });
  const localPath = writeChannelFile('local.json', { channels: { full: [] } });

  const base = readChannelFile(basePath, 'full');
  const local = readChannelFile(localPath, 'full');
  const merged = mergeChannels(base, local);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].handle, 'testChan');
});

test('telegram-channels: local file missing — returns base', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: 'testChan', label: 'Test', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });
  const missingPath = join(tmpDir, 'does-not-exist.json');

  const base = readChannelFile(basePath, 'full');
  const local = readChannelFile(missingPath, 'full');
  const merged = mergeChannels(base, local);

  assert.equal(merged.length, 1);
});

test('telegram-channels: local channel overrides base by same handle', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: 'overlap', label: 'Original', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });
  const localPath = writeChannelFile('local.json', {
    channels: { full: [{ handle: 'overlap', label: 'Overridden', topic: 'cyber', tier: 1, enabled: true, region: 'iran', maxMessages: 25 }] }
  });

  const base = readChannelFile(basePath, 'full');
  const local = readChannelFile(localPath, 'full');
  const merged = mergeChannels(base, local);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, 'Overridden');
  assert.equal(merged[0].topic, 'cyber');
  assert.equal(merged[0].tier, 1);
  assert.equal(merged[0].region, 'iran');
  assert.equal(merged[0].maxMessages, 25);
});

test('telegram-channels: local channels added alongside base', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: 'baseChan', label: 'Base', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });
  const localPath = writeChannelFile('local.json', {
    channels: { full: [{ handle: 'localChan', label: 'Local', topic: 'osint', tier: 3, enabled: true, region: 'iran', maxMessages: 15 }] }
  });

  const base = readChannelFile(basePath, 'full');
  const local = readChannelFile(localPath, 'full');
  const merged = mergeChannels(base, local);

  assert.equal(merged.length, 2);
  assert.ok(merged.some(c => c.handle === 'baseChan'));
  assert.ok(merged.some(c => c.handle === 'localChan'));
});

test('telegram-channels: disabled channels excluded', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: 'enabled', label: 'On', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });
  const localPath = writeChannelFile('local.json', {
    channels: { full: [{ handle: 'disabled', label: 'Off', topic: 'osint', tier: 3, enabled: false, region: 'iran', maxMessages: 15 }] }
  });

  const base = readChannelFile(basePath, 'full');
  const local = readChannelFile(localPath, 'full');
  const merged = mergeChannels(base, local);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].handle, 'enabled');
});

test('telegram-channels: @-prefixed handles stripped', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: '@atPrefix', label: 'Has At', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });
  const localPath = writeChannelFile('local.json', { channels: { full: [] } });

  const base = readChannelFile(basePath, 'full');
  const merged = mergeChannels(base, []);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].handle, 'atPrefix');
});

test('telegram-channels: different set keys isolate channels', () => {
  const basePath = writeChannelFile('base.json', {
    channels: {
      full: [{ handle: 'fullChan', label: 'Full', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }],
      tech: [{ handle: 'techChan', label: 'Tech', topic: 'cyber', tier: 2, enabled: true, region: 'global', maxMessages: 10 }],
    }
  });

  const full = readChannelFile(basePath, 'full');
  const tech = readChannelFile(basePath, 'tech');

  assert.equal(full.length, 1);
  assert.equal(full[0].handle, 'fullChan');
  assert.equal(tech.length, 1);
  assert.equal(tech[0].handle, 'techChan');
});