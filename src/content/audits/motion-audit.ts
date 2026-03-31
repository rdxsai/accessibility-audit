// ──────────────────────────────────────────────
// Motion audit — checks animations and reduced-motion support.
//
// Checks:
//   1. CSS stylesheets for prefers-reduced-motion media queries
//   2. Inline <script> tags for "prefers-reduced-motion" string
//   3. All elements with CSS animations running
//   4. Canvas elements (potential JS-driven animation)
// ──────────────────────────────────────────────

export interface MotionAuditResult {
  hasReducedMotionCSS: boolean;
  reducedMotionCSSRules: string[];      // selectors of matching @media rules
  hasReducedMotionJS: boolean;
  scriptSnippets: string[];             // first 100 chars of matching scripts
  cssAnimations: {
    selector: string;
    animationName: string;
    duration: string;
    iterationCount: string;
  }[];
  canvasElements: {
    selector: string;
    ariaHidden: string | null;
    width: number;
    height: number;
  }[];
  totalCSSTransitions: number;
}

export function runMotionAudit(): MotionAuditResult {
  const result: MotionAuditResult = {
    hasReducedMotionCSS: false,
    reducedMotionCSSRules: [],
    hasReducedMotionJS: false,
    scriptSnippets: [],
    cssAnimations: [],
    canvasElements: [],
    totalCSSTransitions: 0,
  };

  // ─── 1. Search CSS stylesheets ─────────────
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (
            rule instanceof CSSMediaRule &&
            rule.conditionText?.includes('prefers-reduced-motion')
          ) {
            result.hasReducedMotionCSS = true;
            // Collect the selectors inside this media query
            for (const inner of rule.cssRules) {
              if (inner instanceof CSSStyleRule) {
                result.reducedMotionCSSRules.push(inner.selectorText);
              }
            }
          }
        }
      } catch {
        // Cross-origin stylesheet — can't read rules
        continue;
      }
    }
  } catch {
    // StyleSheet access failed entirely
  }

  // ─── 2. Search inline scripts ──────────────
  const scripts = document.querySelectorAll('script:not([src])');
  for (const script of scripts) {
    const text = script.textContent ?? '';
    if (text.includes('prefers-reduced-motion')) {
      result.hasReducedMotionJS = true;
      // Find the line containing the match
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.includes('prefers-reduced-motion')) {
          result.scriptSnippets.push(line.trim().slice(0, 100));
        }
      }
    }
  }

  // ─── 3. Find running CSS animations ────────
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const style = getComputedStyle(el);

    // Animations
    if (style.animationName && style.animationName !== 'none') {
      result.cssAnimations.push({
        selector: buildSelector(el),
        animationName: style.animationName,
        duration: style.animationDuration,
        iterationCount: style.animationIterationCount,
      });
    }

    // Count transitions
    if (style.transitionProperty && style.transitionProperty !== 'none' && style.transitionProperty !== 'all') {
      result.totalCSSTransitions++;
    }
  }

  // ─── 4. Canvas elements ────────────────────
  for (const canvas of document.querySelectorAll('canvas')) {
    result.canvasElements.push({
      selector: buildSelector(canvas),
      ariaHidden: canvas.getAttribute('aria-hidden'),
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    });
  }

  return result;
}

function buildSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0, 1).join('.')
    : '';
  return `${tag}${cls}`;
}
