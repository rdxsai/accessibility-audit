import axe from 'axe-core';
import type { Message, Violation, ViolationNode } from '@shared/messages';
// highlight.css is loaded via manifest.json content_scripts.css
// (not imported here — Vite would extract it as a separate chunk)
import { getPageDimensions } from './tools/screenshot';
import { getDomSnapshot } from './tools/dom-snapshot';
import { getComputedStyles } from './tools/computed-styles';
import { getElementInteractions } from './tools/element-interactions';
import { checkFocusOrder } from './tools/focus-order';
import { checkMotion } from './tools/motion-check';
import { clickElement, tabToElement } from './tools/interactions';

// ──────────────────────────────────────────────
// Content script — injected into every page.
// Responsibilities:
//   1. Run axe-core scans on the DOM
//   2. Execute browser inspection tools on request
//   3. Highlight/interact with elements on request
//   4. Relay all results to the service worker
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    switch (message.type) {
      // ─── Tier 1: Automated scan ──────────
      case 'SCAN_REQUEST':
        runScan(message.payload.scope).then(sendResponse);
        return true;

      // ─── Tier 2: Browser inspection tools ─
      case 'GET_PAGE_DIMENSIONS':
        sendResponse(getPageDimensions());
        break;

      case 'GET_DOM_SNAPSHOT':
        sendResponse(getDomSnapshot(message.payload));
        break;

      case 'GET_COMPUTED_STYLES':
        sendResponse(getComputedStyles(message.payload));
        break;

      case 'GET_ELEMENT_INTERACTIONS':
        sendResponse(getElementInteractions(message.payload));
        break;

      case 'CHECK_FOCUS_ORDER':
        sendResponse(checkFocusOrder(message.payload));
        break;

      case 'CHECK_MOTION':
        sendResponse(checkMotion());
        break;

      // ─── Page interaction tools ───────────
      case 'HIGHLIGHT_ELEMENT':
        highlightElement(message.payload.selector);
        sendResponse({ ok: true });
        break;

      case 'CLEAR_HIGHLIGHTS':
        clearHighlights();
        sendResponse({ ok: true });
        break;

      case 'CLICK_ELEMENT':
        clickElement(message.payload).then(sendResponse);
        return true; // async

      case 'TAB_TO_ELEMENT':
        sendResponse(tabToElement(message.payload));
        break;
    }
  }
);

// ──────────────────────────────────────────────
// axe-core scan (Tier 1)
// ──────────────────────────────────────────────

async function runScan(
  scope: 'full' | 'visible'
): Promise<{ violations: Violation[] }> {
  console.log('[WCAG Scout] Running scan, scope:', scope);

  const context: axe.ElementContext =
    scope === 'visible'
      ? { include: [getVisibleSelector()] }
      : document;

  const results = await axe.run(context, {
    resultTypes: ['violations'],
  });

  const violations: Violation[] = results.violations.map((result) => ({
    id: result.id,
    impact: (result.impact ?? 'minor') as Violation['impact'],
    description: result.description,
    helpUrl: result.helpUrl,
    wcagTags: result.tags.filter((tag) => tag.startsWith('wcag')),
    nodes: result.nodes.map(
      (node): ViolationNode => ({
        html: node.html,
        target: node.target.map(String),
        failureSummary: node.failureSummary ?? '',
      })
    ),
  }));

  console.log(`[WCAG Scout] Found ${violations.length} violations`);
  return { violations };
}

function getVisibleSelector(): string {
  return 'body';
}

// ──────────────────────────────────────────────
// Element highlighting
// ──────────────────────────────────────────────

function highlightElement(selector: string): void {
  clearHighlights();
  try {
    const el = document.querySelector(selector);
    if (el) {
      (el as HTMLElement).dataset.wcagScoutHighlight = 'true';
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (e) {
    console.warn('[WCAG Scout] Invalid selector:', selector);
  }
}

function clearHighlights(): void {
  document
    .querySelectorAll('[data-wcag-scout-highlight]')
    .forEach((el) => delete (el as HTMLElement).dataset.wcagScoutHighlight);
}

console.log('[WCAG Scout] Content script loaded');
