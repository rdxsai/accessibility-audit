import type {
  ElementInteractionsParams,
  ElementInteractionsResult,
} from '@shared/tool-types';

// ──────────────────────────────────────────────
// get_element_interactions
//
// Why this tool exists:
//   axe-core can tell you "this aria-expanded value is invalid"
//   but it CANNOT tell you "this button toggles a panel and
//   should have aria-expanded but doesn't."
//
//   This tool gives the LLM the raw facts:
//   - What ARIA attributes does this element have?
//   - Does it have click/keyboard listeners?
//   - What's its role?
//
//   The LLM then uses its understanding of UI patterns to
//   decide: "A button with a click listener that shows/hides
//   content should have aria-expanded. This one doesn't."
//
// How we detect event listeners:
//   There's no direct API to list listeners added via
//   addEventListener(). But we can check:
//   1. onclick/onkeydown HTML attributes (rare in modern code)
//   2. Use getEventListeners() in Chrome DevTools protocol
//      (not available in content scripts)
//   3. Check if the element's prototype has been modified
//
//   In practice, we mark hasClickListener based on heuristics:
//   - Is it a <button> or <a>? → almost certainly clickable
//   - Does it have role="button"? → intended to be clickable
//   - Does it have tabindex? → made focusable for a reason
//   - Does it have an onclick attribute? → directly clickable
// ──────────────────────────────────────────────

export function getElementInteractions(
  params: ElementInteractionsParams
): ElementInteractionsResult {
  const el = document.querySelector(params.selector) as HTMLElement | null;

  if (!el) {
    return {
      found: false,
      selector: params.selector,
      tagName: '',
      role: null,
      ariaExpanded: null,
      ariaControls: null,
      ariaSelected: null,
      ariaPressed: null,
      ariaHidden: null,
      ariaLive: null,
      ariaLabel: null,
      ariaDescribedBy: null,
      hasClickListener: false,
      hasKeydownListener: false,
      tabIndex: null,
      textContent: '',
      innerHtml: '',
    };
  }

  const tagName = el.tagName.toLowerCase();

  // Heuristic for click listener detection
  const hasClickListener =
    el.hasAttribute('onclick') ||
    tagName === 'button' ||
    tagName === 'a' ||
    el.getAttribute('role') === 'button' ||
    el.getAttribute('role') === 'tab' ||
    el.getAttribute('role') === 'menuitem' ||
    (el.hasAttribute('tabindex') && tagName === 'div') ||
    (el.hasAttribute('tabindex') && tagName === 'span');

  const hasKeydownListener =
    el.hasAttribute('onkeydown') || el.hasAttribute('onkeyup');

  return {
    found: true,
    selector: params.selector,
    tagName,
    role: el.getAttribute('role'),
    ariaExpanded: el.getAttribute('aria-expanded'),
    ariaControls: el.getAttribute('aria-controls'),
    ariaSelected: el.getAttribute('aria-selected'),
    ariaPressed: el.getAttribute('aria-pressed'),
    ariaHidden: el.getAttribute('aria-hidden'),
    ariaLive: el.getAttribute('aria-live'),
    ariaLabel: el.getAttribute('aria-label'),
    ariaDescribedBy: el.getAttribute('aria-describedby'),
    hasClickListener,
    hasKeydownListener,
    tabIndex: el.hasAttribute('tabindex')
      ? parseInt(el.getAttribute('tabindex')!)
      : null,
    textContent: (el.textContent ?? '').trim().slice(0, 100),
    innerHtml: el.innerHTML.slice(0, 200),
  };
}
