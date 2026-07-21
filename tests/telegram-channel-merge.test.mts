import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import telegramChannelMerge from '../scripts/lib/telegram-channel-merge.cjs';

// Imports the REAL implementation from scripts/lib/telegram-channel-merge.cjs
// (extracted specifically so it's safely importable — see that file's header
// comment) rather than a hand-copied duplicate. scripts/ais-relay.cjs itself
// can't be required directly in a test: it's an 11k+ line monolithic script
// with heavy top-level side effects (server startup, live polling loops).

const { readChannelFile, mergeChannels } = telegramChannelMerge;

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

  const base = readChannelFile(basePath, 'full', { optional: false });
  const local = readChannelFile(localPath, 'full', { optional: true });
  const merged = mergeChannels(base.channels, local.channels);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].handle, 'testChan');
  assert.equal(base.error, null);
  assert.equal(local.error, null);
});

test('telegram-channels: local file missing — returns base, no error (expected steady state)', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: 'testChan', label: 'Test', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });
  const missingPath = join(tmpDir, 'does-not-exist.json');

  const base = readChannelFile(basePath, 'full', { optional: false });
  const local = readChannelFile(missingPath, 'full', { optional: true });
  const merged = mergeChannels(base.channels, local.channels);

  assert.equal(merged.length, 1);
  assert.equal(local.error, null, 'a missing OPTIONAL file must not report an error');
});

test('telegram-channels: missing REQUIRED (base) file reports an error', () => {
  const missingPath = join(mkdtempSync(join(tmpdir(), 'wm-tg-test-')), 'does-not-exist.json');

  const base = readChannelFile(missingPath, 'full', { optional: false });

  assert.equal(base.channels.length, 0);
  assert.ok(base.error, 'a missing REQUIRED file must report an error (regression: this used to be silently swallowed, dropping telegramState.lastError and the /status endpoint visibility it feeds)');
  assert.match(base.error!, /does-not-exist\.json/);
});

test('telegram-channels: a local file that exists but fails to parse reports an error, not silence', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: 'testChan', label: 'Test', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });
  const badLocalPath = join(tmpDir, 'local-broken.json');
  writeFileSync(badLocalPath, '{ this is not valid json');

  const base = readChannelFile(basePath, 'full', { optional: false });
  const local = readChannelFile(badLocalPath, 'full', { optional: true });
  const merged = mergeChannels(base.channels, local.channels);

  // Base channels still load fine — a broken override doesn't take down the base set.
  assert.equal(merged.length, 1);
  // But the operator should be told their override isn't being applied.
  assert.ok(local.error, 'a local file that exists but fails to parse must report an error even though it is optional');
});

test('telegram-channels: local channel overrides base by same handle', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: 'overlap', label: 'Original', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });
  const localPath = writeChannelFile('local.json', {
    channels: { full: [{ handle: 'overlap', label: 'Overridden', topic: 'cyber', tier: 1, enabled: true, region: 'iran', maxMessages: 25 }] }
  });

  const base = readChannelFile(basePath, 'full', { optional: false });
  const local = readChannelFile(localPath, 'full', { optional: true });
  const merged = mergeChannels(base.channels, local.channels);

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

  const base = readChannelFile(basePath, 'full', { optional: false });
  const local = readChannelFile(localPath, 'full', { optional: true });
  const merged = mergeChannels(base.channels, local.channels);

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

  const base = readChannelFile(basePath, 'full', { optional: false });
  const local = readChannelFile(localPath, 'full', { optional: true });
  const merged = mergeChannels(base.channels, local.channels);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].handle, 'enabled');
});

test('telegram-channels: @-prefixed handles stripped', () => {
  const basePath = writeChannelFile('base.json', {
    channels: { full: [{ handle: '@atPrefix', label: 'Has At', topic: 'news', tier: 2, enabled: true, region: 'global', maxMessages: 10 }] }
  });

  const base = readChannelFile(basePath, 'full', { optional: false });
  const merged = mergeChannels(base.channels, []);

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

  const full = readChannelFile(basePath, 'full', { optional: false });
  const tech = readChannelFile(basePath, 'tech', { optional: false });

  assert.equal(full.channels.length, 1);
  assert.equal(full.channels[0].handle, 'fullChan');
  assert.equal(tech.channels.length, 1);
  assert.equal(tech.channels[0].handle, 'techChan');
});
