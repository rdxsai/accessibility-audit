import type { FunctionDeclaration } from '@google/generative-ai';
import { SchemaType } from '@google/generative-ai';

// ──────────────────────────────────────────────
// Tool declarations for Gemini.
//
// These tell Gemini what tools exist, what they do,
// and what parameters they accept. Gemini reads these
// and decides which tool to call based on the
// conversation context.
//
// Important: these are DECLARATIONS only — the actual
// execution code lives in executor.ts
// ──────────────────────────────────────────────

export const toolDeclarations: FunctionDeclaration[] = [
  // ─── Tier 1: Automated scan ────────────────
  {
    name: 'scan_page',
    description:
      'Runs axe-core accessibility scan on the current page. Returns structured violations with impact level, WCAG tags, affected elements, and failure summaries. Always call this first.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        scope: {
          type: SchemaType.STRING,
          format: 'enum',
          description: 'Scan scope: "full" for entire page, "visible" for viewport only',
          enum: ['full', 'visible'],
        },
      },
    },
  },

  // ─── Tier 2: Browser inspection tools ──────
  {
    name: 'capture_screenshot',
    description:
      'Takes a screenshot of the current page for visual analysis. Use to spot contrast issues, layout problems, and visual focus indicators.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        fullPage: {
          type: SchemaType.BOOLEAN,
          description: 'If true, captures the full scrollable page. Default: false (viewport only).',
        },
      },
    },
  },
  {
    name: 'get_dom_snapshot',
    description:
      'Returns a cleaned-up DOM tree showing landmarks, headings, ARIA attributes, and semantic structure. Use to check landmark completeness, heading hierarchy, and missing ARIA patterns.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector to scope the snapshot, e.g. "nav", "#about", "body". Default: "body".',
        },
        maxDepth: {
          type: SchemaType.NUMBER,
          description: 'Max DOM depth to traverse. Default: 5.',
        },
      },
    },
  },
  {
    name: 'get_computed_styles',
    description:
      'Gets resolved CSS styles for a specific element — colors (with alpha blending resolved), font size, opacity, outline styles. Also computes the contrast ratio between foreground and background. Use when investigating color contrast issues.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector for the element, e.g. ".nav-link", "#footer span".',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_element_interactions',
    description:
      'Gets ARIA attributes, role, event listeners, and content for an interactive element. Use to check if buttons/toggles have proper aria-expanded, aria-controls, etc.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector for the element.',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'check_focus_order',
    description:
      'Tabs through all focusable elements on the page and reports the tab order, focus indicator visibility (outline style, color), and whether a skip navigation link exists.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        maxElements: {
          type: SchemaType.NUMBER,
          description: 'Max number of elements to check. Default: 30.',
        },
      },
    },
  },
  {
    name: 'check_motion',
    description:
      'Detects CSS animations, canvas elements (potential JS animations), and whether the page respects prefers-reduced-motion. Use to check for vestibular/motion accessibility.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },

  // ─── Page interaction tools ────────────────
  {
    name: 'highlight_element',
    description:
      'Highlights a specific element on the page with a visual overlay and scrolls it into view. Use when explaining a violation to the user.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector for the element to highlight.',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'click_element',
    description:
      'Clicks an element and reports the ARIA state after click (aria-expanded, aria-pressed, etc.) and whether the DOM changed. Use to test toggle buttons and expandable sections.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector for the element to click.',
        },
      },
      required: ['selector'],
    },
  },

  // ─── WCAG verification tools ───────────────
  {
    name: 'get_success_criterion',
    description:
      'Looks up a WCAG 2.2 success criterion by ID. Returns title, level, intent, benefits, sufficient techniques, and failure techniques. Use to verify findings against the spec.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        sc_id: {
          type: SchemaType.STRING,
          description: 'Success criterion ID, e.g. "1.4.3", "2.4.7", "4.1.2".',
        },
      },
      required: ['sc_id'],
    },
  },
  {
    name: 'get_technique',
    description:
      'Looks up a WCAG technique by ID. Returns description, test procedure, and code examples. Use to provide specific fix suggestions.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        technique_id: {
          type: SchemaType.STRING,
          description: 'Technique ID, e.g. "G18", "H37", "ARIA5", "F78".',
        },
      },
      required: ['technique_id'],
    },
  },
  {
    name: 'verify_violation',
    description:
      'Verifies whether a finding is a real WCAG violation. Maps the finding to success criteria, returns relevant techniques and failure conditions. MUST be called for every Tier 2 finding before reporting.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        finding: {
          type: SchemaType.STRING,
          description: 'Description of the issue found.',
        },
        axe_rule_id: {
          type: SchemaType.STRING,
          description: 'axe-core rule ID if applicable.',
        },
        sc_id: {
          type: SchemaType.STRING,
          description: 'WCAG SC ID if known, e.g. "4.1.2".',
        },
        element_context: {
          type: SchemaType.STRING,
          description: 'HTML or selector of the affected element.',
        },
      },
      required: ['finding'],
    },
  },
  {
    name: 'get_related_criteria',
    description:
      'Finds WCAG success criteria related to a given one (under the same guideline). Use for additional context when investigating an issue.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        sc_id: {
          type: SchemaType.STRING,
          description: 'Success criterion ID, e.g. "1.4.3".',
        },
      },
      required: ['sc_id'],
    },
  },
];
