import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildReport,
  computeSelfTimes,
  decomposeTraceEvents,
  findMainThreadTid,
  parseArgs,
} from '../scripts/measure-desktop-mainthread.mjs';

// A settled main-thread task: RunTask(100ms) containing Layout(30) + HitTest(10)
// + FunctionCall(20). Durations are microseconds (trace units). A RasterTask on a
// different thread must be excluded once the main-thread tid is resolved.
const TRACE = [
  { ph: 'M', name: 'thread_name', tid: 1, args: { name: 'CrRendererMain' } },
  { ph: 'M', name: 'thread_name', tid: 2, args: { name: 'Compositor' } },
  { ph: 'X', name: 'RunTask', tid: 1, ts: 1_000, dur: 100_000 },
  { ph: 'X', name: 'Layout', tid: 1, ts: 1_000, dur: 30_000 },
  { ph: 'X', name: 'HitTest', tid: 1, ts: 31_000, dur: 10_000 },
  { ph: 'X', name: 'FunctionCall', tid: 1, ts: 41_000, dur: 20_000 },
  { ph: 'X', name: 'RasterTask', tid: 2, ts: 1_000, dur: 500_000 },
];

describe('findMainThreadTid (#4539 U2)', () => {
  it('resolves CrRendererMain from thread_name metadata; null when absent', () => {
    assert.equal(findMainThreadTid(TRACE), 1);
    assert.equal(findMainThreadTid([{ ph: 'M', name: 'thread_name', tid: 9, args: { name: 'Other' } }]), null);
    assert.equal(findMainThreadTid(null), null);
  });
});

describe('computeSelfTimes (#4539 U2)', () => {
  it('subtracts nested children so no time is double-counted', () => {
    const self = computeSelfTimes(TRACE.filter((e) => e.tid === 1 && e.ph === 'X'));
    const byName = new Map([...self.entries()].map(([e, us]) => [e.name, us]));
    assert.equal(byName.get('RunTask'), 40_000, 'RunTask self = 100 - (30+10+20)');
    assert.equal(byName.get('Layout'), 30_000);
    assert.equal(byName.get('HitTest'), 10_000);
    assert.equal(byName.get('FunctionCall'), 20_000);
    // Self-times sum to the top-level task duration (no over-count).
    assert.equal([...self.values()].reduce((a, b) => a + b, 0), 100_000);
  });

  it('ignores instant/duration-less and non-complete events', () => {
    const self = computeSelfTimes([
      { ph: 'X', name: 'A', ts: 0, dur: 10 },
      { ph: 'B', name: 'begin', ts: 0 }, // not a complete event
      { ph: 'X', name: 'NoTs', dur: 5 }, // missing ts
    ]);
    assert.equal(self.size, 1);
  });
});

describe('decomposeTraceEvents (#4539 U2)', () => {
  it('categorizes by name and opens the Other bucket by event, main-thread only', () => {
    const d = decomposeTraceEvents(TRACE);
    assert.equal(d.totalMs, 100, 'RasterTask on the compositor thread is excluded');
    assert.equal(d.byCategory.styleLayout.ms, 30);
    assert.equal(d.byCategory.scriptEval.ms, 20);
    assert.equal(d.byCategory.other.ms, 50, 'RunTask(40) + HitTest(10)');
    // proportions sum to ~100%
    const pctSum = Object.values(d.byCategory).reduce((s, v) => s + v.pct, 0);
    assert.ok(Math.abs(pctSum - 100) < 0.5, `category proportions ~100% (got ${pctSum})`);
    // the "Other" black box is decomposed by event, ranked
    assert.deepEqual(d.otherBreakdown.map((r) => r.name), ['RunTask', 'HitTest']);
    assert.equal(d.otherBreakdown[0].ms, 40);
  });

  it('an unmapped event name lands in Other (never silently dropped)', () => {
    const d = decomposeTraceEvents([
      { ph: 'M', name: 'thread_name', tid: 1, args: { name: 'CrRendererMain' } },
      { ph: 'X', name: 'SomeFutureEvent', tid: 1, ts: 0, dur: 5_000 },
    ]);
    assert.equal(d.byCategory.other.ms, 5);
    assert.equal(d.otherBreakdown[0].name, 'SomeFutureEvent');
  });

  it('empty/invalid trace yields a zeroed decomposition without throwing', () => {
    const d = decomposeTraceEvents([]);
    assert.equal(d.totalMs, 0);
    assert.deepEqual(d.otherBreakdown, []);
    assert.equal(d.byCategory.other.pct, 0);
  });
});

describe('parseArgs (#4539 U1)', () => {
  it('desktop defaults (cpu 1, /dashboard) and overrides', () => {
    assert.deepEqual(parseArgs(['node', 's']), {
      url: 'https://worldmonitor.app/dashboard', cpu: 1, settle: 15000, json: false,
    });
    const a = parseArgs(['node', 's', 'https://x.test/p', '--cpu', '4', '--settle', '9000', '--json']);
    assert.equal(a.url, 'https://x.test/p');
    assert.equal(a.cpu, 4);
    assert.equal(a.settle, 9000);
    assert.equal(a.json, true);
  });
});

describe('buildReport (#4539 U1+U2)', () => {
  it('combines long-task attribution with the main-thread decomposition', () => {
    const report = buildReport({
      url: 'https://x.test/dashboard',
      cpu: 1,
      longtasks: [{ name: 'self', duration: 120, attribution: [{ containerName: 'panels' }] }],
      traceEvents: TRACE,
    });
    assert.equal(report.url, 'https://x.test/dashboard');
    assert.equal(report.tasks.taskCount, 1);
    assert.equal(report.tasks.tbtMs, 70); // 120 - 50
    assert.equal(report.mainThread.byCategory.other.ms, 50);
  });
});

describe('module import safety (#4539 KTD1)', () => {
  it('importing the module for its helpers launched no browser (this test ran)', () => {
    // If the top-level import had launched Playwright, this file would hang/fail
    // before reaching here. Reaching this assertion proves the invokedDirectly guard.
    assert.equal(typeof decomposeTraceEvents, 'function');
  });
});
