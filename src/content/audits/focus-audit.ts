import {
  parseRgb,
  contrastRatio,
  getEffectiveBgColor,
  buildSelector,
} from './color-utils';

// ──────────────────────────────────────────────
// Focus audit — comprehensive keyboard accessibility check.
//
// Three parts:
//   1. Focus style diffing — for each focusable element,
//      snapshot computed styles before/after .focus(),
//      diff them, flag elements with no visual change.
//      If a change exists, check that the indicator color
//      has ≥ 3:1 contrast against the background.
//      Flag outlineWidth < 2px as a warning.
//
//   2. Skip link validation — not just existence, but:
//      - Target ID exists in the DOM
//      - Skip link is visually hidden by default
//      - Becomes visible on focus
//
//   3. Tab order — build expected sequence from DOM,
//      detect tabindex anomalies and potential traps.
// ──────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(', ');

// Properties we diff between unfocused and focused state
const DIFF_PROPERTIES = [
  'outline', 'outlineColor', 'outlineWidth', 'outlineStyle', 'outlineOffset',
  'boxShadow',
  'border', 'borderColor',
  'backgroundColor',
  'textDecoration',
] as const;

// ─── Result types ────────────────────────────

export interface FocusStyleDiff {
  selector: string;
  tagName: string;
  textContent: string;
  // What changed
  hasCustomFocusStyle: boolean;
  changedProperties: { property: string; before: string; after: string }[];
  // Indicator quality
  indicatorContrast: number | null;   // contrast of outline/shadow color vs background
  indicatorContrastSufficient: boolean; // ≥ 3:1
  outlineWidthPx: number;
  thinOutlineWarning: boolean;         // < 2px
  // Raw values at focus
  focusOutline: string;
  focusBoxShadow: string;
  backgroundColor: string;
}

export interface SkipLinkResult {
  exists: boolean;
  selector: string | null;
  text: string | null;
  href: string | null;
  targetExists: boolean;             // does the #id target exist in DOM?
  isVisuallyHiddenByDefault: boolean; // offscreen/clipped when not focused
  becomesVisibleOnFocus: boolean;     // position/clip changes on focus
}

export interface TabOrderEntry {
  index: number;
  selector: string;
  tagName: string;
  textContent: string;
  tabindex: number | null;
}

export interface FocusAuditResult {
  // Focus style diffing
  totalFocusableElements: number;
  elementsChecked: number;
  noFocusStyle: FocusStyleDiff[];
  insufficientContrast: FocusStyleDiff[];
  thinOutline: FocusStyleDiff[];
  goodFocusStyle: number;

  // Skip link
  skipLink: SkipLinkResult;

  // Tab order
  tabOrder: TabOrderEntry[];
  tabindexAnomalies: string[];       // elements with tabindex > 0 (anti-pattern)

  // CSS rule inspection
  focusVisibleRuleCount: number;
  focusRuleCount: number;
  focusVisibleSelectors: string[];
  focusSelectors: string[];
}

export function runFocusAudit(): FocusAuditResult {
  const focusable = getFocusableElements();
  const previousFocus = document.activeElement as HTMLElement | null;

  const result: FocusAuditResult = {
    totalFocusableElements: focusable.length,
    elementsChecked: 0,
    noFocusStyle: [],
    insufficientContrast: [],
    thinOutline: [],
    goodFocusStyle: 0,
    skipLink: checkSkipLink(focusable),
    tabOrder: [],
    tabindexAnomalies: [],
    focusVisibleRuleCount: 0,
    focusRuleCount: 0,
    focusVisibleSelectors: [],
    focusSelectors: [],
  };

  // ─── 1. Focus style diffing ────────────────
  for (const el of focusable.slice(0, 50)) {
    const htmlEl = el as HTMLElement;
    result.elementsChecked++;

    // Snapshot BEFORE focus
    const before = snapshotStyles(htmlEl);

    // Focus the element
    htmlEl.focus();

    // Snapshot AFTER focus
    const after = snapshotStyles(htmlEl);

    // Diff
    const changes: FocusStyleDiff['changedProperties'] = [];
    for (const prop of DIFF_PROPERTIES) {
      if (before[prop] !== after[prop]) {
        changes.push({ property: prop, before: before[prop], after: after[prop] });
      }
    }

    const hasCustom = changes.length > 0;

    // Check indicator contrast against background
    let indicatorContrast: number | null = null;
    let sufficient = true;
    const bgColor = getEffectiveBgColor(htmlEl);
    const bgRgb = parseRgb(bgColor);

    if (hasCustom) {
      // Try to get the indicator color from outline or box-shadow
      const indicatorColor = after.outlineColor !== before.outlineColor
        ? after.outlineColor
        : extractBoxShadowColor(after.boxShadow);

      if (indicatorColor && bgRgb) {
        const indicatorRgb = parseRgb(indicatorColor);
        if (indicatorRgb) {
          indicatorContrast = Math.round(contrastRatio(indicatorRgb, bgRgb) * 100) / 100;
          sufficient = indicatorContrast >= 3;
        }
      }
    }

    // Outline width check
    const outlineWidthPx = parseFloat(after.outlineWidth) || 0;
    const thinWarning = hasCustom && outlineWidthPx > 0 && outlineWidthPx < 2;

    const finding: FocusStyleDiff = {
      selector: buildSelector(el),
      tagName: el.tagName.toLowerCase(),
      textContent: (el.textContent ?? '').trim().slice(0, 40),
      hasCustomFocusStyle: hasCustom,
      changedProperties: changes,
      indicatorContrast,
      indicatorContrastSufficient: sufficient,
      outlineWidthPx,
      thinOutlineWarning: thinWarning,
      focusOutline: `${after.outlineStyle} ${after.outlineWidth} ${after.outlineColor}`,
      focusBoxShadow: after.boxShadow,
      backgroundColor: bgColor,
    };

    if (!hasCustom) {
      result.noFocusStyle.push(finding);
    } else if (!sufficient) {
      result.insufficientContrast.push(finding);
    } else if (thinWarning) {
      result.thinOutline.push(finding);
    } else {
      result.goodFocusStyle++;
    }

    // Blur before moving to next element
    htmlEl.blur();
  }

  // Restore previous focus
  if (previousFocus) previousFocus.focus();

  // ─── 2. Tab order + anomalies ──────────────
  for (let i = 0; i < focusable.length; i++) {
    const el = focusable[i];
    const ti = el.getAttribute('tabindex');
    const tabindex = ti !== null ? parseInt(ti) : null;

    result.tabOrder.push({
      index: i,
      selector: buildSelector(el),
      tagName: el.tagName.toLowerCase(),
      textContent: (el.textContent ?? '').trim().slice(0, 30),
      tabindex,
    });

    // tabindex > 0 is an anti-pattern
    if (tabindex !== null && tabindex > 0) {
      result.tabindexAnomalies.push(
        `${buildSelector(el)} has tabindex="${tabindex}" — disrupts natural tab order`
      );
    }
  }

  // ─── 3. CSS rule inspection ────────────────
  inspectFocusCSS(result);

  return result;
}

// ─── Style snapshot ──────────────────────────

function snapshotStyles(el: HTMLElement): Record<typeof DIFF_PROPERTIES[number], string> {
  const style = getComputedStyle(el);
  const snap: any = {};
  for (const prop of DIFF_PROPERTIES) {
    snap[prop] = style.getPropertyValue(
      prop.replace(/([A-Z])/g, '-$1').toLowerCase()
    );
  }
  return snap;
}

// ─── Skip link validation ────────────────────

function checkSkipLink(focusable: Element[]): SkipLinkResult {
  const result: SkipLinkResult = {
    exists: false,
    selector: null,
    text: null,
    href: null,
    targetExists: false,
    isVisuallyHiddenByDefault: false,
    becomesVisibleOnFocus: false,
  };

  if (focusable.length === 0) return result;

  const first = focusable[0] as HTMLElement;
  const tag = first.tagName.toLowerCase();
  if (tag !== 'a') return result;

  const href = first.getAttribute('href') ?? '';
  const text = (first.textContent ?? '').trim();

  if (!href.startsWith('#')) return result;
  if (!/skip|main.content|jump.to|go.to.main/i.test(text)) return result;

  result.exists = true;
  result.selector = buildSelector(first);
  result.text = text;
  result.href = href;

  // Check target exists
  const targetId = href.slice(1);
  result.targetExists = targetId.length > 0 && document.getElementById(targetId) !== null;

  // Check if visually hidden by default
  const style = getComputedStyle(first);
  const isOffscreen =
    style.position === 'absolute' &&
    (parseInt(style.top) < -10 ||
     parseInt(style.left) < -10 ||
     style.clip === 'rect(0px, 0px, 0px, 0px)' ||
     style.clipPath === 'inset(50%)' ||
     (parseInt(style.width) <= 1 && parseInt(style.height) <= 1));

  result.isVisuallyHiddenByDefault = isOffscreen;

  // Check if it becomes visible on focus
  if (isOffscreen) {
    const beforeTop = style.top;
    const beforeClip = style.clip;
    const beforeWidth = style.width;

    first.focus();
    const afterStyle = getComputedStyle(first);

    result.becomesVisibleOnFocus =
      afterStyle.top !== beforeTop ||
      afterStyle.clip !== beforeClip ||
      afterStyle.width !== beforeWidth;

    first.blur();
  }

  return result;
}

// ─── CSS rule inspection ─────────────────────

function inspectFocusCSS(result: FocusAuditResult): void {
  try {
    for (const sheet of document.styleSheets) {
      try {
        walkCSSRules(sheet.cssRules, result);
      } catch {
        // Cross-origin — skip
      }
    }
  } catch {}
}

function walkCSSRules(rules: CSSRuleList, result: FocusAuditResult): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const sel = rule.selectorText;
      if (sel.includes(':focus-visible')) {
        result.focusVisibleRuleCount++;
        result.focusVisibleSelectors.push(sel);
      } else if (sel.includes(':focus') && !sel.includes(':focus-within')) {
        result.focusRuleCount++;
        result.focusSelectors.push(sel);
      }
    } else if (rule instanceof CSSMediaRule) {
      walkCSSRules(rule.cssRules, result);
    }
  }
}

// ─── Helpers ─────────────────────────────────

function getFocusableElements(): Element[] {
  return Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    const style = getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      (el as HTMLElement).offsetWidth > 0
    );
  });
}

// Extract color from box-shadow value like "rgb(255,0,0) 0px 0px 0px 3px"
function extractBoxShadowColor(boxShadow: string): string | null {
  if (!boxShadow || boxShadow === 'none') return null;
  const match = boxShadow.match(/rgba?\([^)]+\)/);
  return match ? match[0] : null;
}
