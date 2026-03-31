// ──────────────────────────────────────────────
// ARIA audit — checks interactive elements, sections,
// and decorative elements for proper ARIA attributes.
//
// Checks:
//   1. Every <button> → aria-expanded, aria-controls, aria-label
//   2. Every <section> → aria-label or aria-labelledby
//   3. Every <canvas>/<svg> → aria-hidden or role="presentation"
//   4. Every <input>/<select>/<textarea> → associated label
// ──────────────────────────────────────────────

export interface AriaFinding {
  type: 'button-missing-state' | 'section-missing-name' | 'decorative-not-hidden' | 'input-missing-label';
  selector: string;
  element: string;        // tag + text excerpt
  details: string;        // what's missing
  ariaExpanded: string | null;
  ariaControls: string | null;
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
  ariaHidden: string | null;
  role: string | null;
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
  };

  // ─── 1. Buttons ────────────────────────────
  const buttons = document.querySelectorAll(
    'button, [role="button"], [role="tab"], [role="menuitem"]'
  );
  result.totalButtons = buttons.length;

  buttons.forEach((el) => {
    const expanded = el.getAttribute('aria-expanded');
    const controls = el.getAttribute('aria-controls');
    const label = el.getAttribute('aria-label');
    const role = el.getAttribute('role');
    const text = (el.textContent ?? '').trim().slice(0, 40);

    // Heuristic: if the button text suggests toggling (expand, collapse,
    // show, hide, toggle, menu, more, details) → it should have aria-expanded
    const suggestsToggle = /expand|collapse|show|hide|toggle|menu|more|detail|open|close/i.test(text);

    // Also check if clicking this button changes visibility of another element
    // (we can't know for sure without clicking, but missing aria-expanded
    // on a button is always worth flagging)
    const issues: string[] = [];

    if (expanded === null && (suggestsToggle || controls !== null)) {
      issues.push('aria-expanded missing');
    }
    if (expanded !== null && controls === null) {
      issues.push('aria-controls missing (has aria-expanded but no controlled element)');
    }

    // Buttons without any accessible name
    if (!text && !label && !el.getAttribute('aria-labelledby') && !el.getAttribute('title')) {
      issues.push('no accessible name (no text, no aria-label, no title)');
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
        ariaLabelledBy: el.getAttribute('aria-labelledby'),
        ariaHidden: el.getAttribute('aria-hidden'),
        role,
      });
    }
  });

  // ─── 2. Sections ───────────────────────────
  const sections = document.querySelectorAll(
    'section, [role="region"]'
  );
  result.totalSections = sections.length;

  sections.forEach((el) => {
    const label = el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');

    if (!label && !labelledBy) {
      result.sectionsWithIssues.push({
        type: 'section-missing-name',
        selector: buildSelector(el),
        element: `<section${el.id ? ` id="${el.id}"` : ''}>`,
        details: 'No aria-label or aria-labelledby — screen readers cannot distinguish this from other sections',
        ariaExpanded: null,
        ariaControls: null,
        ariaLabel: label,
        ariaLabelledBy: labelledBy,
        ariaHidden: el.getAttribute('aria-hidden'),
        role: el.getAttribute('role'),
      });
    }
  });

  // ─── 3. Decorative elements ────────────────
  const decorative = document.querySelectorAll('canvas, svg');
  result.totalDecorativeElements = decorative.length;

  decorative.forEach((el) => {
    const ariaHidden = el.getAttribute('aria-hidden');
    const role = el.getAttribute('role');
    const tag = el.tagName.toLowerCase();

    // SVGs that are inside buttons/links are functional, not decorative
    if (el.closest('a, button, [role="button"], [role="link"]')) return;

    const isHidden = ariaHidden === 'true' || role === 'presentation' || role === 'none';

    if (!isHidden) {
      // Check if it has meaningful alt/label
      const label = el.getAttribute('aria-label');
      const labelledBy = el.getAttribute('aria-labelledby');

      if (!label && !labelledBy) {
        result.decorativeWithIssues.push({
          type: 'decorative-not-hidden',
          selector: buildSelector(el),
          element: `<${tag}${el.className ? ` class="${(el.className as any).baseVal ?? el.className}"` : ''}>`,
          details: `No aria-hidden="true" or role="presentation" — screen readers will attempt to announce this ${tag}`,
          ariaExpanded: null,
          ariaControls: null,
          ariaLabel: label,
          ariaLabelledBy: labelledBy,
          ariaHidden: ariaHidden,
          role,
        });
      }
    }
  });

  // ─── 4. Inputs without labels ──────────────
  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
  );
  result.totalInputs = inputs.length;

  inputs.forEach((el) => {
    const id = el.id;
    const label = el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');
    const title = el.getAttribute('title');
    const placeholder = el.getAttribute('placeholder');

    // Check for associated <label>
    const hasLabel = id
      ? document.querySelector(`label[for="${id}"]`) !== null
      : el.closest('label') !== null;

    if (!hasLabel && !label && !labelledBy && !title) {
      result.inputsWithIssues.push({
        type: 'input-missing-label',
        selector: buildSelector(el),
        element: `<${el.tagName.toLowerCase()} type="${el.getAttribute('type') ?? 'text'}">`,
        details: `No associated <label>, no aria-label, no aria-labelledby, no title${placeholder ? ` (has placeholder="${placeholder}" but that's not sufficient)` : ''}`,
        ariaExpanded: null,
        ariaControls: null,
        ariaLabel: label,
        ariaLabelledBy: labelledBy,
        ariaHidden: el.getAttribute('aria-hidden'),
        role: el.getAttribute('role'),
      });
    }
  });

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
