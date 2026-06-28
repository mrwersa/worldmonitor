import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, it } from 'node:test';

import {
  DEFAULT_PANEL_FOOTPRINTS,
  countInteractiveControls,
  createDeferredPanelShell,
  derivePanelReservation,
  getDefaultPanelFootprint,
  getInitialPanelMountBudget,
  shouldDeferInitialPanelMount,
} from '../src/app/panel-mount-deferral';
import { createBrowserEnvironment } from './helpers/runtime-config-panel-harness.mjs';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');

function installDom() {
  const env = createBrowserEnvironment();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: env.document,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: env.HTMLElement,
  });
  return env.document;
}

function restoreDom(): void {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete (globalThis as { document?: unknown }).document;
  if (originalHTMLElement) Object.defineProperty(globalThis, 'HTMLElement', originalHTMLElement);
  else delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
}

function createFullPanel(id: string): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.dataset.panel = id;

  const header = document.createElement('div');
  header.className = 'panel-header';
  header.appendChild(document.createElement('button'));
  header.appendChild(document.createElement('button'));

  const content = document.createElement('div');
  content.className = 'panel-content';
  content.appendChild(document.createElement('input'));
  content.appendChild(document.createElement('button'));
  for (let index = 0; index < 8; index++) {
    const row = document.createElement('div');
    row.className = 'test-row';
    row.appendChild(document.createElement('span'));
    row.appendChild(document.createElement('span'));
    content.appendChild(row);
  }

  panel.appendChild(header);
  panel.appendChild(content);
  return panel;
}

function elementCount(root: ParentNode): number {
  return root.querySelectorAll('*').length;
}

afterEach(() => {
  restoreDom();
});

describe('panel mount deferral', () => {
  it('uses a smaller initial real-panel budget on mobile', () => {
    assert.equal(getInitialPanelMountBudget(false), 8);
    assert.equal(getInitialPanelMountBudget(true), 3);
    assert.equal(shouldDeferInitialPanelMount({ enabled: false, mountedEnabledCount: 100, isMobile: false }), false);
    assert.equal(shouldDeferInitialPanelMount({ enabled: true, mountedEnabledCount: 7, isMobile: false }), false);
    assert.equal(shouldDeferInitialPanelMount({ enabled: true, mountedEnabledCount: 8, isMobile: false }), true);
    // Mobile budget is 3: the first 3 enabled panels mount immediately; the 4th defers.
    assert.equal(shouldDeferInitialPanelMount({ enabled: true, mountedEnabledCount: 2, isMobile: true }), false);
    assert.equal(shouldDeferInitialPanelMount({ enabled: true, mountedEnabledCount: 3, isMobile: true }), true);
  });

  it('creates inert shells with panel identity but no startup controls', () => {
    const document = installDom();
    const shell = createDeferredPanelShell('strategic-risk', 'Strategic Risk Overview');
    document.body.appendChild(shell);

    assert.equal(shell.dataset.panel, 'strategic-risk');
    assert.equal(shell.dataset.deferredPanel, 'true');
    assert.equal(shell.getAttribute('aria-hidden'), 'true');
    assert.equal(shell.querySelector('.panel-title')?.textContent, 'Strategic Risk Overview');
    assert.equal(countInteractiveControls(shell), 0);
  });

  it('keeps the static reservation map in sync with constructor-sized panels', () => {
    assert.deepEqual(Object.keys(DEFAULT_PANEL_FOOTPRINTS).sort(), [
      'chat-analyst',
      'cii',
      'consumer-prices',
      'displacement',
      'economic',
      'energy-complex',
      'energy-crisis',
      'energy-disruptions',
      'fuel-shortages',
      'gdelt-intel',
      'internet-disruptions',
      'live-news',
      'live-webcams',
      'oil-inventories',
      'pipeline-status',
      'sanctions-pressure',
      'security-advisories',
      'storage-facility-map',
      'strategic-posture',
      'supply-chain',
      'telegram-intel',
      'threat-timeline',
      'trade-policy',
      'ucdp-events',
      'windy-webcams',
    ].sort());
  });

  it('derives natural, saved, and dynamic panel reservations without importing panel bundles', () => {
    assert.deepEqual(derivePanelReservation('cii', {
      savedRowSpans: {},
      savedColSpans: {},
      savedCollapsed: {},
    }), {
      rowSpan: 2,
      colSpan: 1,
      wide: false,
      rowSpanSource: 'default',
      colSpanSource: 'none',
      collapsed: false,
    });

    assert.deepEqual(derivePanelReservation('strategic-risk', {
      savedRowSpans: {},
      savedColSpans: {},
      savedCollapsed: {},
    }), {
      rowSpan: 1,
      colSpan: 1,
      wide: false,
      rowSpanSource: 'none',
      colSpanSource: 'none',
      collapsed: false,
    });

    assert.deepEqual(getDefaultPanelFootprint('cw-alpha'), { rowSpan: 2 });
    assert.deepEqual(getDefaultPanelFootprint('mcp-alpha'), { rowSpan: 2 });
  });

  it('applies saved span, width, and collapsed reservations to deferred shells', () => {
    const document = installDom();
    const shell = createDeferredPanelShell('strategic-risk', 'Strategic Risk Overview', {
      savedRowSpans: { 'strategic-risk': 3 },
      savedColSpans: { 'strategic-risk': 2 },
      savedCollapsed: { 'strategic-risk': true },
    });
    document.body.appendChild(shell);

    assert.equal(shell.classList.contains('span-3'), true);
    assert.equal(shell.classList.contains('resized'), true);
    assert.equal(shell.classList.contains('col-span-2'), true);
    assert.equal(shell.classList.contains('panel-collapsed'), true);
    assert.equal((shell.querySelector('.panel-content') as HTMLElement | null)?.style.display, 'none');
  });

  it('reserves wide and dynamic deferred shells using their real-panel footprints', () => {
    const document = installDom();
    const wideShell = createDeferredPanelShell('live-news', 'Live News', {
      savedRowSpans: {},
      savedColSpans: {},
      savedCollapsed: {},
    });
    const widgetShell = createDeferredPanelShell('cw-alpha', 'Custom Widget', {
      savedRowSpans: {},
      savedColSpans: {},
      savedCollapsed: {},
    });
    document.body.appendChild(wideShell);
    document.body.appendChild(widgetShell);

    assert.equal(wideShell.classList.contains('panel-wide'), true);
    assert.equal(wideShell.classList.contains('span-2'), false);
    assert.equal(widgetShell.classList.contains('span-2'), true);
  });

  it('keeps dynamic panel real constructors aligned with shell reservations', async () => {
    const [customWidgetSource, mcpDataSource] = await Promise.all([
      readFile(new URL('../src/components/CustomWidgetPanel.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/McpDataPanel.ts', import.meta.url), 'utf8'),
    ]);

    assert.match(customWidgetSource, /defaultRowSpan:\s*2,/, 'CustomWidgetPanel must match the cw-* shell reservation');
    assert.match(mcpDataSource, /defaultRowSpan:\s*2,/, 'McpDataPanel must match the mcp-* shell reservation');
  });

  it('materially reduces initial DOM and control count for below-budget panels', () => {
    const fullDocument = installDom();
    for (let index = 0; index < 12; index++) {
      fullDocument.body.appendChild(createFullPanel(`panel-${index}`));
    }
    const fullElements = elementCount(fullDocument.body);
    const fullControls = countInteractiveControls(fullDocument.body);

    const deferredDocument = installDom();
    const budget = getInitialPanelMountBudget(false);
    for (let index = 0; index < 12; index++) {
      deferredDocument.body.appendChild(
        index < budget
          ? createFullPanel(`panel-${index}`)
          : createDeferredPanelShell(`panel-${index}`, `Panel ${index}`),
      );
    }

    assert.ok(elementCount(deferredDocument.body) < fullElements * 0.8);
    assert.ok(countInteractiveControls(deferredDocument.body) < fullControls * 0.75);
  });

  it('does not toggle a panel twice when settings enable a deferred mount', async () => {
    const source = await readFile(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');

    assert.match(
      source,
      /private\s+mountDeferredPanel\(key:\s*string\):\s*boolean/,
      'mountDeferredPanel must report when it already synchronized panel visibility',
    );
    assert.match(
      source,
      /mountedFromDeferred\s*=\s*this\.mountDeferredPanel\(key\);/,
      'applyPanelSettings must track deferred mounts triggered by settings enablement',
    );
    assert.match(
      source,
      /if\s*\(!mountedFromDeferred\)\s*\{\s*panel\?\.toggle\(config\.enabled\);\s*\}/,
      'applyPanelSettings must skip its own toggle when mountDeferredPanel already toggled',
    );
  });

  it('keeps deferred lazy shells retryable after a failed lazy import', async () => {
    const source = await readFile(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
    const mountDeferredPanel = source.match(/private\s+mountDeferredPanel[\s\S]*?\n  private mountLazyPanel/);
    const destroyMethod = source.match(/destroy\(\):\s*void[\s\S]*?this\.deferredPanelMounts\.clear\(\);/);

    assert.ok(mountDeferredPanel, 'mountDeferredPanel method not found');
    assert.match(
      mountDeferredPanel[0],
      /deferred\.loading = null;[\s\S]*?if\s*\(!panel \|\| this\.ctx\.isDestroyed\)/,
      'failed deferred lazy loads must clear the in-flight deferred.loading guard',
    );
    assert.match(
      mountDeferredPanel[0],
      /this\.lazyPanelRegistrations\.has\(key\)[\s\S]*?deferred\.placeholder\?\.parentNode[\s\S]*?this\.observeDeferredPanelShell\(key, deferred\)/,
      'failed deferred lazy loads must keep the inert shell and re-arm observation for retry',
    );
    assert.match(
      mountDeferredPanel[0],
      /this\.deferredPanelMounts\.delete\(key\);/,
      'deferred entries should only be deleted after the real panel successfully replaces the shell',
    );
    assert.ok(destroyMethod, 'destroy method cleanup not found');
    assert.match(
      destroyMethod[0],
      /clearTimeout\(deferred\.retryTimer\);/,
      'destroy must clear deferred retry timers as well as observers',
    );
  });

  it('signals queued panel work after replacing a deferred shell with the real panel', async () => {
    const source = await readFile(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
    const mountPanelElement = source.match(/private\s+mountPanelElement[\s\S]*?\n  \}/);

    assert.ok(mountPanelElement, 'mountPanelElement method not found');
    assert.match(
      mountPanelElement[0],
      /panel\.notifyConnected\(\);/,
      'mountPanelElement must flush runWhenConnected callbacks after inserting the panel element',
    );
  });
});
