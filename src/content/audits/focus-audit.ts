// ──────────────────────────────────────────────
// Focus audit — skip links and :focus-visible CSS inspection.
//
// Checks:
//   1. Is the first focusable element a skip link?
//   2. Which CSS rules define :focus-visible styles?
//   3. Which interactive elements DON'T have custom focus styles?
//   4. Tab order: are elements reachable and does focus move?
// ──────────────────────────────────────────────

export interface FocusVisibleRule {
  selectorText: string;
  properties: string[];   // e.g. ["outline", "box-shadow", "border"]
  sourceSheet: string;    // stylesheet href or "inline"
}

export interface FocusAuditResult {
  // Skip link
  hasSkipLink: boolean;
  firstFocusableElement: string | null;
  firstFocusableText: string | null;

  // :focus-visible CSS
  focusVisibleRules: FocusVisibleRule[];
  focusRules: FocusVisibleRule[];     // :focus (not :focus-visible)

  // Elements without custom focus styles
  totalFocusableElements: number;
  elementsWithCustomFocus: string[];
  elementsWithoutCustomFocus: string[];
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function runFocusAudit(): FocusAuditResult {
  const result: FocusAuditResult = {
    hasSkipLink: false,
    firstFocusableElement: null,
    firstFocusableText: null,
    focusVisibleRules: [],
    focusRules: [],
    totalFocusableElements: 0,
    elementsWithCustomFocus: [],
    elementsWithoutCustomFocus: [],
  };

  // ─── 1. Skip link check ────────────────────
  const focusable = Array.from(
    document.querySelectorAll(FOCUSABLE_SELECTOR)
  ).filter((el) => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  result.totalFocusableElements = focusable.length;

  if (focusable.length > 0) {
    const first = focusable[0];
    const tag = first.tagName.toLowerCase();
    const text = (first.textContent ?? '').trim();
    const href = first.getAttribute('href') ?? '';

    result.firstFocusableElement = `<${tag}${href ? ` href="${href}"` : ''}>`;
    result.firstFocusableText = text.slice(0, 60);

    result.hasSkipLink =
      tag === 'a' &&
      href.startsWith('#') &&
      /skip|main.content|jump.to/i.test(text);
  }

  // ─── 2. Inspect CSS for :focus-visible rules ──
  try {
    for (const sheet of document.styleSheets) {
      const source = sheet.href ?? 'inline';
      try {
        inspectRules(sheet.cssRules, source, result);
      } catch {
        // Cross-origin — can't read
        continue;
      }
    }
  } catch {}

  // ─── 3. Determine which elements have custom focus ──
  // Collect all selectors from :focus-visible and :focus rules
  const focusSelectors = new Set<string>();
  for (const rule of [...result.focusVisibleRules, ...result.focusRules]) {
    // Extract the base selector (before :focus-visible/:focus)
    const base = rule.selectorText
      .replace(/:focus-visible/g, '')
      .replace(/:focus/g, '')
      .trim();
    if (base) focusSelectors.add(base);
  }

  // Check each focusable element against the focus selectors
  for (const el of focusable.slice(0, 50)) {
    const selector = buildSelector(el);
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent ?? '').trim().slice(0, 30);
    const label = `<${tag}> "${text}"`;

    // Check if any focus CSS rule matches this element
    let hasCustom = false;
    for (const sel of focusSelectors) {
      try {
        if (el.matches(sel)) {
          hasCustom = true;
          break;
        }
      } catch {
        // Invalid selector — skip
      }
    }

    if (hasCustom) {
      result.elementsWithCustomFocus.push(label);
    } else {
      result.elementsWithoutCustomFocus.push(label);
    }
  }

  return result;
}

// Recursively inspect CSS rules (handles @media nesting)
function inspectRules(
  rules: CSSRuleList,
  source: string,
  result: FocusAuditResult
): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const sel = rule.selectorText;

      if (sel.includes(':focus-visible')) {
        result.focusVisibleRules.push({
          selectorText: sel,
          properties: extractFocusProperties(rule.style),
          sourceSheet: source,
        });
      } else if (sel.includes(':focus') && !sel.includes(':focus-within')) {
        result.focusRules.push({
          selectorText: sel,
          properties: extractFocusProperties(rule.style),
          sourceSheet: source,
        });
      }
    } else if (rule instanceof CSSMediaRule) {
      // Recurse into @media blocks
      inspectRules(rule.cssRules, source, result);
    }
  }
}

// Extract the CSS properties that affect focus appearance
function extractFocusProperties(style: CSSStyleDeclaration): string[] {
  const props: string[] = [];
  const relevant = [
    'outline', 'outline-style', 'outline-color', 'outline-width', 'outline-offset',
    'box-shadow', 'border', 'border-color', 'border-width',
    'background', 'background-color', 'text-decoration',
  ];
  for (const prop of relevant) {
    const value = style.getPropertyValue(prop);
    if (value && value !== 'initial' && value !== 'inherit') {
      props.push(`${prop}: ${value}`);
    }
  }
  return props;
}

function buildSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '';
  return `${tag}${cls}`;
}
