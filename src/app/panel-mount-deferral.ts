import {
  loadPanelCollapsed,
  loadPanelColSpans,
  loadPanelSpans,
} from '@/utils/panel-storage';

export const INITIAL_PANEL_MOUNT_BUDGET_DESKTOP = 8;
// Mobile mounts fewer panels eagerly; the rest get IntersectionObserver shells (700px
// lookahead) and mount before they scroll into view. Lowered 4→3 to trim boot DOM /
// main-thread work on mobile (#4460 / #4443 U4); the typically 1–2 above-the-fold panels
// still mount eagerly, so no added skeleton flash.
export const INITIAL_PANEL_MOUNT_BUDGET_MOBILE = 3;

export interface PanelMountDeferralInput {
  enabled: boolean;
  mountedEnabledCount: number;
  isMobile: boolean;
}

export interface PanelFootprint {
  rowSpan?: number;
  colSpan?: number;
  wide?: boolean;
}

export interface PanelReservation extends Required<PanelFootprint> {
  rowSpanSource: 'default' | 'saved' | 'none';
  colSpanSource: 'default' | 'saved' | 'none';
  collapsed: boolean;
}

export interface PanelReservationInput {
  defaultFootprints?: Readonly<Record<string, PanelFootprint>>;
  savedRowSpans?: Readonly<Record<string, number>>;
  savedColSpans?: Readonly<Record<string, number>>;
  savedCollapsed?: Readonly<Record<string, boolean>>;
}

const MIN_ROW_SPAN = 1;
const MAX_ROW_SPAN = 4;
const MIN_COL_SPAN = 1;
const MAX_COL_SPAN = 3;
const DYNAMIC_PANEL_DEFAULT_FOOTPRINT: PanelFootprint = Object.freeze({ rowSpan: 2 });

export const DEFAULT_PANEL_FOOTPRINTS: Readonly<Record<string, PanelFootprint>> = Object.freeze({
  'chat-analyst': { rowSpan: 2 },
  'consumer-prices': { rowSpan: 2 },
  cii: { rowSpan: 2 },
  displacement: { rowSpan: 2 },
  economic: { rowSpan: 2 },
  'energy-complex': { rowSpan: 2 },
  'energy-crisis': { rowSpan: 2 },
  'energy-disruptions': { rowSpan: 2 },
  'fuel-shortages': { rowSpan: 2 },
  'gdelt-intel': { rowSpan: 2 },
  'internet-disruptions': { rowSpan: 2 },
  'live-news': { rowSpan: 2, colSpan: 2, wide: true },
  'live-webcams': { rowSpan: 2, colSpan: 2, wide: true },
  'oil-inventories': { rowSpan: 2 },
  'pipeline-status': { rowSpan: 2 },
  'sanctions-pressure': { rowSpan: 2 },
  'security-advisories': { rowSpan: 2 },
  'storage-facility-map': { rowSpan: 2 },
  'strategic-posture': { rowSpan: 2 },
  'supply-chain': { rowSpan: 2 },
  'telegram-intel': { rowSpan: 2 },
  'threat-timeline': { rowSpan: 2 },
  'trade-policy': { rowSpan: 2 },
  'ucdp-events': { rowSpan: 2 },
  'windy-webcams': { rowSpan: 2, colSpan: 2, wide: true },
});

const CONTROL_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a[href]',
  '[role="button"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function validIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function getDefaultPanelFootprint(
  panelId: string,
  defaultFootprints: Readonly<Record<string, PanelFootprint>> = DEFAULT_PANEL_FOOTPRINTS,
): PanelFootprint {
  const staticFootprint = defaultFootprints[panelId];
  if (staticFootprint) return staticFootprint;
  if (panelId.startsWith('cw-') || panelId.startsWith('mcp-')) return DYNAMIC_PANEL_DEFAULT_FOOTPRINT;
  return {};
}

export function derivePanelReservation(panelId: string, input: PanelReservationInput = {}): PanelReservation {
  const defaultFootprint = getDefaultPanelFootprint(panelId, input.defaultFootprints);
  const savedRowSpans = input.savedRowSpans ?? loadPanelSpans();
  const savedColSpans = input.savedColSpans ?? loadPanelColSpans();
  const savedCollapsed = input.savedCollapsed ?? loadPanelCollapsed();
  const savedRowSpan = savedRowSpans[panelId];
  const savedColSpan = savedColSpans[panelId];
  const defaultRowSpan = validIntegerInRange(defaultFootprint.rowSpan, MIN_ROW_SPAN, MAX_ROW_SPAN)
    ? defaultFootprint.rowSpan
    : MIN_ROW_SPAN;
  const defaultColSpan = validIntegerInRange(defaultFootprint.colSpan, MIN_COL_SPAN, MAX_COL_SPAN)
    ? defaultFootprint.colSpan
    : (defaultFootprint.wide ? 2 : MIN_COL_SPAN);
  const hasSavedRowSpan = validIntegerInRange(savedRowSpan, MIN_ROW_SPAN, MAX_ROW_SPAN);
  const hasSavedColSpan = validIntegerInRange(savedColSpan, MIN_COL_SPAN, MAX_COL_SPAN);

  return {
    rowSpan: hasSavedRowSpan ? savedRowSpan : defaultRowSpan,
    colSpan: hasSavedColSpan ? savedColSpan : defaultColSpan,
    wide: defaultFootprint.wide === true,
    rowSpanSource: hasSavedRowSpan ? 'saved' : (defaultRowSpan > 1 ? 'default' : 'none'),
    colSpanSource: hasSavedColSpan ? 'saved' : (defaultColSpan > 1 ? 'default' : 'none'),
    collapsed: savedCollapsed[panelId] === true,
  };
}

function applyPanelReservation(shell: HTMLElement, reservation: PanelReservation): void {
  if (reservation.wide) {
    shell.classList.add('panel-wide');
  }

  if (reservation.rowSpanSource === 'saved') {
    shell.classList.add(`span-${reservation.rowSpan}`, 'resized');
  } else if (reservation.rowSpanSource === 'default' && !reservation.wide) {
    shell.classList.add(`span-${reservation.rowSpan}`);
  }

  if (reservation.colSpanSource === 'saved') {
    shell.classList.add(`col-span-${reservation.colSpan}`);
  } else if (reservation.colSpanSource === 'default' && !reservation.wide) {
    shell.classList.add(`col-span-${reservation.colSpan}`);
  }

  if (reservation.collapsed) {
    shell.classList.add('panel-collapsed');
  }
}

export function getInitialPanelMountBudget(isMobile: boolean): number {
  return isMobile ? INITIAL_PANEL_MOUNT_BUDGET_MOBILE : INITIAL_PANEL_MOUNT_BUDGET_DESKTOP;
}

export function shouldDeferInitialPanelMount({
  enabled,
  mountedEnabledCount,
  isMobile,
}: PanelMountDeferralInput): boolean {
  return enabled && mountedEnabledCount >= getInitialPanelMountBudget(isMobile);
}

export function createDeferredPanelShell(
  panelId: string,
  title: string,
  reservationInput: PanelReservationInput = {},
): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'panel panel-deferred-shell';
  shell.dataset.panel = panelId;
  shell.dataset.deferredPanel = 'true';
  shell.setAttribute('aria-hidden', 'true');
  applyPanelReservation(shell, derivePanelReservation(panelId, reservationInput));

  const header = document.createElement('div');
  header.className = 'panel-header panel-deferred-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'panel-header-left';

  const titleEl = document.createElement('span');
  titleEl.className = 'panel-title';
  titleEl.textContent = title;
  headerLeft.appendChild(titleEl);
  header.appendChild(headerLeft);

  const content = document.createElement('div');
  content.className = 'panel-content panel-deferred-content';
  if (shell.classList.contains('panel-collapsed')) {
    content.style.display = 'none';
  }
  for (let index = 0; index < 3; index++) {
    const line = document.createElement('span');
    line.className = 'panel-deferred-skeleton';
    line.setAttribute('aria-hidden', 'true');
    content.appendChild(line);
  }

  shell.appendChild(header);
  shell.appendChild(content);
  return shell;
}

export function countInteractiveControls(root: ParentNode): number {
  return root.querySelectorAll(CONTROL_SELECTOR).length;
}
