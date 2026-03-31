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

      // ─── Element discovery (for collector) ─
      case 'DISCOVER_ELEMENTS':
        sendResponse(discoverElements(message.payload.query));
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

// ──────────────────────────────────────────────
// Element discovery
//
// Returns unique CSS selectors for all elements of a given
// type. Used by the collector to enumerate elements BEFORE
// inspecting each one — so nothing gets missed.
// ──────────────────────────────────────────────

function discoverElements(query: string): string[] {
  const selectors: string[] = [];

  function makeSelector(el: Element, index: number, tag: string): string {
    if (el.id) return `#${el.id}`;
    const cls =
      el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    // Use nth-of-type for uniqueness
    return `${tag}${cls}:nth-of-type(${index + 1})`;
  }

  switch (query) {
    case 'nav-links': {
      // All links inside nav, header, or with nav-related classes
      const links = document.querySelectorAll(
        'nav a, header a, [role="navigation"] a'
      );
      const seen = new Set<Element>();
      links.forEach((el, i) => {
        if (!seen.has(el)) {
          seen.add(el);
          // Build a precise selector using parent context
          const parent = el.closest('nav, header, [role="navigation"]');
          const parentSel = parent?.tagName.toLowerCase() ?? 'body';
          const siblings = parent
            ? Array.from(parent.querySelectorAll('a'))
            : [el];
          const idx = siblings.indexOf(el) + 1;
          selectors.push(`${parentSel} a:nth-of-type(${idx})`);
        }
      });
      break;
    }

    case 'buttons': {
      const buttons = document.querySelectorAll(
        'button, [role="button"], input[type="button"], input[type="submit"]'
      );
      buttons.forEach((el, i) => {
        const tag = el.tagName.toLowerCase();
        if (el.id) {
          selectors.push(`#${el.id}`);
        } else {
          const cls =
            el.className && typeof el.className === 'string'
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
              : '';
          // Use a parent-scoped nth selector for uniqueness
          selectors.push(`${tag}${cls}:nth-of-type(${i + 1})`);
        }
      });
      break;
    }

    case 'sections': {
      const sections = document.querySelectorAll('section, [role="region"]');
      sections.forEach((el, i) => {
        if (el.id) selectors.push(`#${el.id}`);
        else selectors.push(`section:nth-of-type(${i + 1})`);
      });
      break;
    }

    case 'headings': {
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      headings.forEach((el, i) => {
        const tag = el.tagName.toLowerCase();
        selectors.push(el.id ? `#${el.id}` : `${tag}:nth-of-type(${i + 1})`);
      });
      break;
    }
  }

  return selectors;
}

console.log('[WCAG Scout] Content script loaded');
