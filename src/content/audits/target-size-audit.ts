// ──────────────────────────────────────────────
// Target size audit — WCAG 2.5.8 Target Size (Minimum).
//
// Every interactive element (<a>, <button>, <input>, etc.)
// should have a touch target of at least 24x24 CSS pixels
// (Level AA) or 44x44 (Level AAA / best practice).
//
// We measure getBoundingClientRect() on each and flag
// any below 44x44 (the more practical threshold).
//
// Exceptions (per WCAG):
//   - Inline links within text (we skip <a> inside <p>)
//   - Elements the user can resize
//   - Elements whose size is determined by the user agent
// ──────────────────────────────────────────────

export interface TargetSizeFinding {
  selector: string;
  element: string;       // tag + text
  width: number;
  height: number;
  minDimension: number;  // the smaller of width/height
  passes24: boolean;     // ≥ 24px (Level AA)
  passes44: boolean;     // ≥ 44px (best practice / AAA)
}

export interface TargetSizeAuditResult {
  totalInteractiveElements: number;
  checkedElements: number;
  failuresBelow24: TargetSizeFinding[];
  failuresBelow44: TargetSizeFinding[];
}

export function runTargetSizeAudit(): TargetSizeAuditResult {
  const result: TargetSizeAuditResult = {
    totalInteractiveElements: 0,
    checkedElements: 0,
    failuresBelow24: [],
    failuresBelow44: [],
  };

  const interactive = document.querySelectorAll(
    'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'
  );

  result.totalInteractiveElements = interactive.length;

  for (const el of interactive) {
    const htmlEl = el as HTMLElement;

    // Skip hidden elements
    const style = getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      htmlEl.offsetWidth === 0 ||
      htmlEl.offsetHeight === 0
    ) {
      continue;
    }

    // Skip inline links inside text (WCAG exception)
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.parentElement) {
      const parentTag = el.parentElement.tagName.toLowerCase();
      if (['p', 'li', 'td', 'span', 'label', 'dd', 'dt'].includes(parentTag)) {
        continue;
      }
    }

    const rect = el.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const minDim = Math.min(width, height);

    result.checkedElements++;

    const finding: TargetSizeFinding = {
      selector: buildSelector(el),
      element: `<${tag}> "${(el.textContent ?? '').trim().slice(0, 30)}"`,
      width,
      height,
      minDimension: minDim,
      passes24: minDim >= 24,
      passes44: minDim >= 44,
    };

    if (!finding.passes24) {
      result.failuresBelow24.push(finding);
    } else if (!finding.passes44) {
      result.failuresBelow44.push(finding);
    }
  }

  return result;
}

function buildSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '';
  return `${tag}${cls}`;
}
