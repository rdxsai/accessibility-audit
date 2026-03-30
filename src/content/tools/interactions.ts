import type {
  ClickElementParams,
  ClickElementResult,
  TabToElementParams,
  TabToElementResult,
} from '@shared/tool-types';

// ──────────────────────────────────────────────
// click_element
//
// Why this tool exists:
//   To check if a button properly updates aria-expanded when
//   clicked, the LLM needs to actually click it and observe
//   the state change.
//
//   Flow:
//   1. Read ARIA state before click
//   2. Click the element
//   3. Wait a tick for React/JS to update state
//   4. Read ARIA state after click
//   5. Check if DOM changed (new elements appeared/disappeared)
// ──────────────────────────────────────────────

export async function clickElement(
  params: ClickElementParams
): Promise<ClickElementResult> {
  const el = document.querySelector(params.selector) as HTMLElement | null;

  if (!el) {
    return {
      clicked: false,
      ariaExpanded: null,
      ariaSelected: null,
      ariaPressed: null,
      domChanged: false,
    };
  }

  // Snapshot DOM state before click
  const beforeHtml = document.body.innerHTML.length;

  // Click the element
  el.click();

  // Wait for frameworks (React, Vue, etc.) to process the click
  // and update the DOM. requestAnimationFrame + setTimeout gives
  // the framework one full render cycle.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 100));
  });

  // Read state after click
  const afterHtml = document.body.innerHTML.length;

  return {
    clicked: true,
    ariaExpanded: el.getAttribute('aria-expanded'),
    ariaSelected: el.getAttribute('aria-selected'),
    ariaPressed: el.getAttribute('aria-pressed'),
    // Rough heuristic: if innerHTML length changed significantly,
    // something appeared or disappeared
    domChanged: Math.abs(afterHtml - beforeHtml) > 50,
  };
}

// ──────────────────────────────────────────────
// tab_to_element
//
// Simulates pressing Tab repeatedly until we reach
// the target element. Reports how many presses it took
// and whether focus is visible when we get there.
// ──────────────────────────────────────────────

export function tabToElement(
  params: TabToElementParams
): TabToElementResult {
  const target = document.querySelector(params.selector) as HTMLElement | null;

  if (!target) {
    return { reached: false, tabPresses: 0, focusVisible: false, outlineStyle: '' };
  }

  // Start from the top of the document
  document.body.focus();

  // Get all focusable elements in order
  const focusable = Array.from(
    document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  // Find the target in the tab order
  const targetIndex = focusable.indexOf(target);

  if (targetIndex === -1) {
    return { reached: false, tabPresses: 0, focusVisible: false, outlineStyle: '' };
  }

  // Focus the target
  target.focus();
  const style = getComputedStyle(target);
  const outlineStyle = `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`;
  const focusVisible =
    style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1;

  return {
    reached: true,
    tabPresses: targetIndex + 1, // +1 because tab order is 1-indexed from body
    focusVisible,
    outlineStyle,
  };
}
