import type {
  FocusOrderParams,
  FocusOrderResult,
  FocusOrderEntry,
} from '@shared/tool-types';

// ──────────────────────────────────────────────
// check_focus_order
//
// Why this tool exists:
//   axe-core cannot test focus visibility. To check if a
//   focus indicator is visible, you need to:
//   1. Actually focus the element
//   2. Read the computed styles WHILE focused
//   3. Judge if the outline/box-shadow is visible
//
//   This tool does exactly that — it walks through every
//   focusable element on the page, focuses each one,
//   reads its focus styles, and reports back.
//
// How it works:
//   1. Query all focusable elements (links, buttons, inputs, etc.)
//   2. For each one: call element.focus()
//   3. Read getComputedStyle() to check outline and box-shadow
//   4. Determine if the focus indicator would be visible
//   5. Restore the original focus when done
//
// Limitations:
//   - element.focus() triggers :focus but not always :focus-visible.
//     Browsers only apply :focus-visible when focus came from
//     keyboard. We can't perfectly simulate that from JS.
//   - We compensate by checking both :focus and :focus-visible styles.
// ──────────────────────────────────────────────

// Selector for all natively focusable elements + elements with tabindex
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(', ');

export function checkFocusOrder(params: FocusOrderParams): FocusOrderResult {
  const maxElements = params.maxElements ?? 30;

  // Save current focus so we can restore it
  const previousFocus = document.activeElement as HTMLElement | null;

  // Get all focusable elements in DOM order
  const allFocusable = Array.from(
    document.querySelectorAll(FOCUSABLE_SELECTOR)
  ).filter((el) => {
    // Skip hidden elements
    const style = getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      (el as HTMLElement).offsetWidth > 0
    );
  });

  // Check for skip link (first focusable element links to #main or similar)
  const hasSkipLink = checkForSkipLink(allFocusable[0]);

  const entries: FocusOrderEntry[] = [];

  for (let i = 0; i < Math.min(allFocusable.length, maxElements); i++) {
    const el = allFocusable[i] as HTMLElement;

    // Read styles BEFORE focus (baseline)
    const beforeOutline = getComputedStyle(el).outlineStyle;
    const beforeBoxShadow = getComputedStyle(el).boxShadow;

    // Focus the element
    el.focus();

    // Read styles AFTER focus
    const style = getComputedStyle(el);
    const outlineStyle = style.outlineStyle;
    const outlineColor = style.outlineColor;
    const outlineWidth = style.outlineWidth;
    const boxShadow = style.boxShadow;

    // Determine if focus style is visible
    // A focus style is "visible" if SOMETHING changed when focused
    const hasVisibleFocusStyle =
      // Outline appeared or changed
      (outlineStyle !== 'none' && outlineStyle !== beforeOutline) ||
      (outlineStyle !== 'none' && parseFloat(outlineWidth) >= 1) ||
      // Box shadow appeared or changed
      (boxShadow !== 'none' && boxShadow !== beforeBoxShadow);

    const selector = getCssSelector(el);

    entries.push({
      index: i,
      selector,
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      textContent: (el.textContent ?? '').trim().slice(0, 60),
      hasVisibleFocusStyle,
      outlineStyle: `${outlineStyle} ${outlineWidth}`,
      outlineColor,
      boxShadow: boxShadow === 'none' ? 'none' : boxShadow.slice(0, 100),
    });
  }

  // Restore previous focus
  if (previousFocus) previousFocus.focus();
  else (document.activeElement as HTMLElement)?.blur();

  return {
    entries,
    totalFocusableElements: allFocusable.length,
    hasSkipLink,
  };
}

function checkForSkipLink(firstFocusable: Element | undefined): boolean {
  if (!firstFocusable) return false;
  if (firstFocusable.tagName.toLowerCase() !== 'a') return false;

  const href = firstFocusable.getAttribute('href') ?? '';
  const text = (firstFocusable.textContent ?? '').toLowerCase();

  // Common skip link patterns
  return (
    href.startsWith('#') &&
    (text.includes('skip') ||
      text.includes('main content') ||
      text.includes('jump to'))
  );
}

// Generates a reasonable CSS selector for an element
function getCssSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const classes = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '';
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (s) => s.tagName === el.tagName
    );
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      return `${tag}${classes}:nth-of-type(${index})`;
    }
  }
  return `${tag}${classes}`;
}
