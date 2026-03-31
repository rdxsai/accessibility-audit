// ──────────────────────────────────────────────
// ARIA audit — checks interactive elements, landmarks,
// and decorative elements for proper ARIA attributes.
//
// Scoping rules (to avoid false positives):
//   - aria-controls: ONLY required when aria-expanded is present
//   - aria-expanded: ONLY flag on buttons that suggest toggling
//     (text contains expand/collapse/show/hide/toggle/menu/etc.)
//   - accessible name: ONLY required on interactive elements
//     (button, a, input, select, textarea) and landmarks
//     (section, nav, main, etc.) — NOT on layout divs
// ──────────────────────────────────────────────

export interface AriaFinding {
  type: 'button-missing-state' | 'section-missing-name' | 'decorative-not-hidden' | 'input-missing-label';
  selector: string;
  element: string;
  details: string;
  ariaExpanded: string | null;
  ariaControls: string | null;
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
  ariaHidden: string | null;
  role: string | null;
}

export interface ViewportIssue {
  content: string;
  issue: string;
}

export interface AriaAuditResult {
  totalButtons: number;
  buttonsWithIssues: AriaFinding[];
  totalSections: number;
  sectionsWithIssues: AriaFinding[];
  totalDecorativeElements: number;
  decorativeWithIssues: AriaFinding[];
  totalInputs: number;
  inputsWithIssues: AriaFinding[];
  viewportIssues: ViewportIssue[];
}

export function runAriaAudit(): AriaAuditResult {
  const result: AriaAuditResult = {
    totalButtons: 0,
    buttonsWithIssues: [],
    totalSections: 0,
    sectionsWithIssues: [],
    totalDecorativeElements: 0,
    decorativeWithIssues: [],
    totalInputs: 0,
    inputsWithIssues: [],
    viewportIssues: [],
  };

  // ─── 1. Buttons ────────────────────────────
  // Only check <button> and [role="button"] — not divs with click handlers
  const buttons = document.querySelectorAll('button, [role="button"]');
  result.totalButtons = buttons.length;

  buttons.forEach((el) => {
    // Skip hidden buttons
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    const expanded = el.getAttribute('aria-expanded');
    const controls = el.getAttribute('aria-controls');
    const label = el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');
    const role = el.getAttribute('role');
    const title = el.getAttribute('title');
    const text = (el.textContent ?? '').trim().slice(0, 40);

    const issues: string[] = [];

    // Rule 1: If button has aria-expanded but no aria-controls → missing
    if (expanded !== null && controls === null) {
      issues.push('has aria-expanded but missing aria-controls');
    }

    // Rule 2: If button text strongly suggests toggling but has no aria-expanded
    // Only flag if the text clearly indicates expand/collapse behavior
    const suggestsToggle = /^(expand|collapse|show|hide|toggle|open|close)\b/i.test(text)
      || /\b(expand|collapse)\s*(details|section|content|panel|menu)?$/i.test(text);

    if (expanded === null && suggestsToggle) {
      issues.push('text suggests toggle behavior but missing aria-expanded');
    }

    // Rule 3: Button has NO accessible name at all
    // (no visible text, no aria-label, no aria-labelledby, no title)
    if (!text && !label && !labelledBy && !title) {
      // Check for img/svg child with alt
      const hasImgAlt = el.querySelector('img[alt]:not([alt=""])') !== null;
      const hasSvgTitle = el.querySelector('svg title') !== null;
      if (!hasImgAlt && !hasSvgTitle) {
        issues.push('no accessible name');
      }
    }

    if (issues.length > 0) {
      result.buttonsWithIssues.push({
        type: 'button-missing-state',
        selector: buildSelector(el),
        element: `<${el.tagName.toLowerCase()}> "${text}"`,
        details: issues.join('; '),
        ariaExpanded: expanded,
        ariaControls: controls,
        ariaLabel: label,
        ariaLabelledBy: labelledBy,
        ariaHidden: el.getAttribute('aria-hidden'),
        role,
      });
    }
  });

  // ─── 2. Landmarks (sections with region role) ───
  // Only sections need accessible names — they become "region" landmarks
  // and screen readers list them. Without a name, "region" is meaningless.
  // Note: <main>, <nav>, <header>, <footer> have implicit roles and don't
  // strictly need aria-label (their role IS their name), but <section> does.
  const sections = document.querySelectorAll('section');
  result.totalSections = sections.length;

  sections.forEach((el) => {
    // Skip hidden sections
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    const label = el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');

    // Check if section has a heading child that could serve as its label
    const hasHeading = el.querySelector('h1, h2, h3, h4, h5, h6') !== null;

    if (!label && !labelledBy) {
      result.sectionsWithIssues.push({
        type: 'section-missing-name',
        selector: buildSelector(el),
        element: `<section${el.id ? ` id="${el.id}"` : ''}>`,
        details: hasHeading
          ? 'No aria-label/aria-labelledby — has heading child, use aria-labelledby to reference it'
          : 'No aria-label or aria-labelledby',
        ariaExpanded: null,
        ariaControls: null,
        ariaLabel: label,
        ariaLabelledBy: labelledBy,
        ariaHidden: el.getAttribute('aria-hidden'),
        role: el.getAttribute('role'),
      });
    }
  });

  // ─── 3. Decorative elements (canvas/svg) ───
  // Only flag standalone canvas/svg that aren't inside interactive elements
  // and don't have aria-hidden or role="presentation"
  const decorative = document.querySelectorAll('canvas, svg');
  result.totalDecorativeElements = decorative.length;

  decorative.forEach((el) => {
    // Skip SVGs inside buttons/links — they're functional icons, not decorative
    if (el.closest('a, button, [role="button"], [role="link"]')) return;

    // Skip tiny SVGs (likely icons handled by parent)
    if (el.tagName.toLowerCase() === 'svg') {
      const rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) return;
    }

    // Skip hidden elements
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    const ariaHidden = el.getAttribute('aria-hidden');
    const role = el.getAttribute('role');

    const isHidden = ariaHidden === 'true' || role === 'presentation' || role === 'none';

    if (!isHidden) {
      const label = el.getAttribute('aria-label');
      const labelledBy = el.getAttribute('aria-labelledby');

      // If it has a meaningful label, it's intentionally exposed — not a problem
      if (label || labelledBy) return;

      result.decorativeWithIssues.push({
        type: 'decorative-not-hidden',
        selector: buildSelector(el),
        element: `<${el.tagName.toLowerCase()}${el.className ? ` class="${(el.className as any).baseVal ?? el.className}"` : ''}>`,
        details: `Not hidden from assistive technology — add aria-hidden="true" if decorative`,
        ariaExpanded: null,
        ariaControls: null,
        ariaLabel: label,
        ariaLabelledBy: labelledBy,
        ariaHidden: ariaHidden,
        role,
      });
    }
  });

  // ─── 4. Inputs without labels ──────────────
  // Only actual form controls — not hidden inputs, not submit/button types
  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), select, textarea'
  );
  result.totalInputs = inputs.length;

  inputs.forEach((el) => {
    // Skip hidden inputs
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    const id = el.id;
    const label = el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');
    const title = el.getAttribute('title');

    // Check for associated <label>
    const hasLabel = id
      ? document.querySelector(`label[for="${id}"]`) !== null
      : el.closest('label') !== null;

    if (!hasLabel && !label && !labelledBy && !title) {
      result.inputsWithIssues.push({
        type: 'input-missing-label',
        selector: buildSelector(el),
        element: `<${el.tagName.toLowerCase()} type="${el.getAttribute('type') ?? 'text'}">`,
        details: `No associated label, no aria-label, no aria-labelledby, no title`,
        ariaExpanded: null,
        ariaControls: null,
        ariaLabel: label,
        ariaLabelledBy: labelledBy,
        ariaHidden: el.getAttribute('aria-hidden'),
        role: el.getAttribute('role'),
      });
    }
  });

  // ─── 5. Viewport meta check (SC 1.4.4) ─────
  // user-scalable=no or maximum-scale<2 prevents zooming
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    const content = viewportMeta.getAttribute('content') ?? '';

    if (/user-scalable\s*=\s*no/i.test(content)) {
      result.viewportIssues.push({
        content,
        issue: 'user-scalable=no prevents users from zooming — violates SC 1.4.4 (Resize Text)',
      });
    }

    const maxScaleMatch = content.match(/maximum-scale\s*=\s*([\d.]+)/i);
    if (maxScaleMatch) {
      const maxScale = parseFloat(maxScaleMatch[1]);
      if (maxScale < 2) {
        result.viewportIssues.push({
          content,
          issue: `maximum-scale=${maxScale} restricts zoom below 200% — violates SC 1.4.4 (Resize Text)`,
        });
      }
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
