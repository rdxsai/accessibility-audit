import type { Violation } from '@shared/messages';
import type { Message } from '@shared/messages';
import type {
  DomSnapshotResult,
  ComputedStylesResult,
  ElementInteractionsResult,
  FocusOrderResult,
  MotionCheckResult,
} from '@shared/tool-types';
import { sendToContentScript as _send } from './executor';

// Type-safe wrapper around the executor's sendToContentScript
function sendToTab<T>(tabId: number, message: Message): Promise<T> {
  return _send(tabId, message) as Promise<T>;
}

// ──────────────────────────────────────────────
// Deterministic data collector.
//
// This is the key architectural change:
//   BEFORE: LLM decides which tools to call (unreliable)
//   AFTER:  Code collects ALL data, LLM only analyzes
//
// The collector runs every browser tool in a fixed
// sequence, discovers elements from the DOM snapshot,
// then inspects each one. Nothing is skipped.
//
// Flow:
//   1. axe-core scan → violations
//   2. DOM snapshot → discover all nav links, buttons, landmarks
//   3. Computed styles → check EVERY nav link for contrast
//   4. Element interactions → check EVERY button for ARIA
//   5. Focus order → tab through ALL focusable elements
//   6. Motion check → animations + reduced-motion
//   7. Bundle everything into one PageAuditData object
//   8. Hand to LLM for analysis
// ──────────────────────────────────────────────

export interface PageAuditData {
  url: string;
  timestamp: number;

  // Tier 1: axe-core
  axeViolations: Violation[];

  // Tier 2: deterministic collection
  domSnapshot: DomSnapshotResult;
  navLinkStyles: ComputedStylesResult[];
  buttonInteractions: ElementInteractionsResult[];
  focusOrder: FocusOrderResult;
  motionCheck: MotionCheckResult;

  // Derived summaries (so LLM doesn't have to count)
  summary: {
    totalAxeViolations: number;
    totalNavLinks: number;
    navLinksWithLowContrast: number;
    totalButtons: number;
    buttonsWithoutAriaExpanded: number;
    totalFocusableElements: number;
    elementsWithoutVisibleFocus: number;
    hasSkipLink: boolean;
    sectionsWithoutAccessibleName: number;
    totalSections: number;
    hasReducedMotionQuery: boolean;
    canvasElementsWithoutAriaHidden: number;
  };
}

export async function collectPageAuditData(
  tabId: number,
  onProgress: (step: string) => void
): Promise<PageAuditData> {
  const url = await getTabUrl(tabId);

  // ─── Step 1: axe-core scan ─────────────────
  onProgress('Running axe-core scan...');
  const scanResult = await sendToTab<{ violations: Violation[] }>(
    tabId,
    { type: 'SCAN_REQUEST', payload: { scope: 'full' } } as Message
  );
  const axeViolations = scanResult?.violations ?? [];

  // ─── Step 2: DOM snapshot ──────────────────
  onProgress('Analyzing page structure...');
  const domSnapshot = await sendToTab<DomSnapshotResult>(
    tabId,
    { type: 'GET_DOM_SNAPSHOT', payload: { selector: 'body', maxDepth: 6 } } as Message
  );

  // ─── Step 3: Discover and check nav links ──
  onProgress('Checking navigation link contrast...');

  // Find all nav link selectors by querying the page
  const navLinkSelectors = await sendToTab<string[]>(
    tabId,
    { type: 'DISCOVER_ELEMENTS', payload: { query: 'nav-links' } } as Message
  );

  const navLinkStyles: ComputedStylesResult[] = [];
  for (const selector of navLinkSelectors ?? []) {
    const styles = await sendToTab<ComputedStylesResult>(
      tabId,
      { type: 'GET_COMPUTED_STYLES', payload: { selector } } as Message
    );
    if (styles?.found) navLinkStyles.push(styles);
  }

  // ─── Step 4: Discover and check buttons ────
  onProgress('Checking button ARIA states...');

  const buttonSelectors = await sendToTab<string[]>(
    tabId,
    { type: 'DISCOVER_ELEMENTS', payload: { query: 'buttons' } } as Message
  );

  const buttonInteractions: ElementInteractionsResult[] = [];
  for (const selector of buttonSelectors ?? []) {
    const interactions = await sendToTab<ElementInteractionsResult>(
      tabId,
      { type: 'GET_ELEMENT_INTERACTIONS', payload: { selector } } as Message
    );
    if (interactions?.found) buttonInteractions.push(interactions);
  }

  // ─── Step 5: Focus order ───────────────────
  onProgress('Testing keyboard navigation...');
  const focusOrder = await sendToTab<FocusOrderResult>(
    tabId,
    { type: 'CHECK_FOCUS_ORDER', payload: { maxElements: 50 } } as Message
  );

  // ─── Step 6: Motion check ──────────────────
  onProgress('Checking animations...');
  const motionCheck = await sendToTab<MotionCheckResult>(
    tabId,
    { type: 'CHECK_MOTION' } as Message
  );

  // ─── Step 7: Compute summaries ─────────────
  onProgress('Compiling results...');

  const navLinksWithLowContrast = navLinkStyles.filter(
    (s) => s.contrastRatio !== null && s.contrastRatio < 4.5
  ).length;

  const buttonsWithoutAriaExpanded = buttonInteractions.filter(
    (b) => b.hasClickListener && b.ariaExpanded === null
  ).length;

  const elementsWithoutVisibleFocus = (focusOrder?.entries ?? []).filter(
    (e) => !e.hasVisibleFocusStyle
  ).length;

  const sections = countSections(domSnapshot);

  const canvasWithoutAriaHidden = (motionCheck?.canvasElements ?? []).filter(
    (c) => c.ariaHidden !== 'true'
  ).length;

  return {
    url,
    timestamp: Date.now(),
    axeViolations,
    domSnapshot,
    navLinkStyles,
    buttonInteractions,
    focusOrder: focusOrder ?? { entries: [], totalFocusableElements: 0, hasSkipLink: false },
    motionCheck: motionCheck ?? {
      cssAnimations: [],
      cssTransitionCount: 0,
      canvasElements: [],
      hasReducedMotionQuery: false,
    },
    summary: {
      totalAxeViolations: axeViolations.length,
      totalNavLinks: navLinkStyles.length,
      navLinksWithLowContrast,
      totalButtons: buttonInteractions.length,
      buttonsWithoutAriaExpanded,
      totalFocusableElements: focusOrder?.totalFocusableElements ?? 0,
      elementsWithoutVisibleFocus,
      hasSkipLink: focusOrder?.hasSkipLink ?? false,
      sectionsWithoutAccessibleName: sections.withoutName,
      totalSections: sections.total,
      hasReducedMotionQuery: motionCheck?.hasReducedMotionQuery ?? false,
      canvasElementsWithoutAriaHidden: canvasWithoutAriaHidden,
    },
  };
}

// ─── Helpers ─────────────────────────────────

async function getTabUrl(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return tab.url ?? 'unknown';
}

function countSections(snapshot: DomSnapshotResult): {
  total: number;
  withoutName: number;
} {
  let total = 0;
  let withoutName = 0;

  function walk(node: DomSnapshotResult['root']) {
    if (node.tag === 'section') {
      total++;
      if (!node.ariaLabel && !node.ariaLabelledBy) {
        withoutName++;
      }
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(snapshot.root);
  return { total, withoutName };
}
