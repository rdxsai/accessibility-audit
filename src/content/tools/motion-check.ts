import type { MotionCheckResult } from '@shared/tool-types';

// ──────────────────────────────────────────────
// check_motion
//
// Why this tool exists:
//   axe-core can detect CSS animations but NOT canvas/JS-driven
//   animations. Your portfolio's starfield is a canvas animation —
//   completely invisible to axe-core.
//
// What this tool checks:
//   1. CSS animations currently running on any element
//   2. Canvas elements (likely JS-driven animations)
//   3. Whether any stylesheet contains a prefers-reduced-motion
//      media query (meaning the developer considered motion prefs)
//
// What it CAN'T check:
//   - Whether a specific canvas IS actually animating (we'd need
//     to compare frames, which is expensive and unreliable)
//   - Whether JS code checks prefers-reduced-motion at runtime
//     (would require static analysis of the page's scripts)
//
//   So we report: "canvas exists, no reduced-motion query found"
//   and let the LLM flag it as a potential issue.
// ──────────────────────────────────────────────

export function checkMotion(): MotionCheckResult {
  // 1. Find elements with CSS animations
  const cssAnimations: MotionCheckResult['cssAnimations'] = [];
  const allElements = document.querySelectorAll('*');

  for (const el of allElements) {
    const style = getComputedStyle(el);
    const animName = style.animationName;
    const animDuration = style.animationDuration;

    // "none" means no animation
    if (animName && animName !== 'none') {
      cssAnimations.push({
        selector: getBasicSelector(el),
        animationName: animName,
        duration: animDuration,
      });
    }
  }

  // 2. Count elements with CSS transitions
  let cssTransitionCount = 0;
  for (const el of allElements) {
    const transition = getComputedStyle(el).transitionProperty;
    if (transition && transition !== 'none' && transition !== 'all') {
      cssTransitionCount++;
    }
  }

  // 3. Find canvas elements (potential JS animations)
  const canvasElements: MotionCheckResult['canvasElements'] = [];
  for (const canvas of document.querySelectorAll('canvas')) {
    canvasElements.push({
      selector: getBasicSelector(canvas),
      ariaHidden: canvas.getAttribute('aria-hidden'),
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    });
  }

  // 4. Check if any stylesheet contains prefers-reduced-motion
  const hasReducedMotionQuery = checkStylesheetsForReducedMotion();

  return {
    cssAnimations,
    cssTransitionCount,
    canvasElements,
    hasReducedMotionQuery,
  };
}

function checkStylesheetsForReducedMotion(): boolean {
  // Walk through all stylesheets and check their rules
  // for @media (prefers-reduced-motion: ...)
  try {
    for (const sheet of document.styleSheets) {
      try {
        // Cross-origin stylesheets throw SecurityError
        // when you try to read their rules
        for (const rule of sheet.cssRules) {
          if (
            rule instanceof CSSMediaRule &&
            rule.conditionText?.includes('prefers-reduced-motion')
          ) {
            return true;
          }
        }
      } catch {
        // SecurityError for cross-origin sheets — skip
        continue;
      }
    }
  } catch {
    // If stylesheet access fails entirely
  }
  return false;
}

function getBasicSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/)[0]
    : '';
  return `${tag}${cls}`;
}
