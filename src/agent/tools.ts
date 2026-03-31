import type OpenAI from 'openai';

// ──────────────────────────────────────────────
// Tool declarations for OpenAI gpt-4o-mini.
//
// OpenAI uses standard JSON Schema for parameters,
// unlike Gemini's custom SchemaType format.
// ──────────────────────────────────────────────

export const toolDeclarations: OpenAI.ChatCompletionTool[] = [
  // ─── Tier 1: Automated scan ────────────────
  {
    type: 'function',
    function: {
      name: 'scan_page',
      description:
        'Runs axe-core accessibility scan on the current page. Returns structured violations with impact level, WCAG tags, affected elements, and failure summaries. Always call this first.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['full', 'visible'],
            description: 'Scan scope: "full" for entire page, "visible" for viewport only',
          },
        },
      },
    },
  },

  // ─── Tier 2: Browser inspection tools ──────
  {
    type: 'function',
    function: {
      name: 'capture_screenshot',
      description:
        'Takes a screenshot of the current page for visual analysis. Use to spot contrast issues, layout problems, and visual focus indicators.',
      parameters: {
        type: 'object',
        properties: {
          fullPage: {
            type: 'boolean',
            description: 'If true, captures the full scrollable page. Default: false.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dom_snapshot',
      description:
        'Returns a cleaned-up DOM tree showing landmarks, headings, ARIA attributes, and semantic structure. Use to check landmark completeness, heading hierarchy, and missing ARIA patterns.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector to scope the snapshot, e.g. "nav", "#about", "body". Default: "body".',
          },
          maxDepth: {
            type: 'number',
            description: 'Max DOM depth to traverse. Default: 5.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_computed_styles',
      description:
        'Gets resolved CSS styles for a specific element — colors (with alpha blending resolved), font size, opacity, outline styles. Also computes the contrast ratio between foreground and background. Use when investigating color contrast issues.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the element, e.g. ".nav-link", "#footer span".',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_element_interactions',
      description:
        'Gets ARIA attributes, role, event listeners, and content for an interactive element. Use to check if buttons/toggles have proper aria-expanded, aria-controls, etc.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the element.',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_focus_order',
      description:
        'Tabs through all focusable elements on the page and reports the tab order, focus indicator visibility (outline style, color), and whether a skip navigation link exists.',
      parameters: {
        type: 'object',
        properties: {
          maxElements: {
            type: 'number',
            description: 'Max number of elements to check. Default: 30.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_motion',
      description:
        'Detects CSS animations, canvas elements (potential JS animations), and whether the page respects prefers-reduced-motion. Use to check for vestibular/motion accessibility.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  // ─── Page interaction tools ────────────────
  {
    type: 'function',
    function: {
      name: 'highlight_element',
      description:
        'Highlights a specific element on the page with a visual overlay and scrolls it into view. Use when explaining a violation to the user.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the element to highlight.',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_element',
      description:
        'Clicks an element and reports the ARIA state after click (aria-expanded, aria-pressed, etc.) and whether the DOM changed. Use to test toggle buttons and expandable sections.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the element to click.',
          },
        },
        required: ['selector'],
      },
    },
  },

  // ─── WCAG verification tools ───────────────
  {
    type: 'function',
    function: {
      name: 'get_success_criterion',
      description:
        'Looks up a WCAG 2.2 success criterion by ID. Returns title, level, intent, benefits, sufficient techniques, and failure techniques. Use to verify findings against the spec.',
      parameters: {
        type: 'object',
        properties: {
          sc_id: {
            type: 'string',
            description: 'Success criterion ID, e.g. "1.4.3", "2.4.7", "4.1.2".',
          },
        },
        required: ['sc_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_technique',
      description:
        'Looks up a WCAG technique by ID. Returns description, test procedure, and code examples. Use to provide specific fix suggestions.',
      parameters: {
        type: 'object',
        properties: {
          technique_id: {
            type: 'string',
            description: 'Technique ID, e.g. "G18", "H37", "ARIA5", "F78".',
          },
        },
        required: ['technique_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_violation',
      description:
        'Verifies whether a finding is a real WCAG violation. Maps the finding to success criteria, returns relevant techniques and failure conditions. MUST be called for every Tier 2 finding before reporting.',
      parameters: {
        type: 'object',
        properties: {
          finding: {
            type: 'string',
            description: 'Description of the issue found.',
          },
          axe_rule_id: {
            type: 'string',
            description: 'axe-core rule ID if applicable.',
          },
          sc_id: {
            type: 'string',
            description: 'WCAG SC ID if known, e.g. "4.1.2".',
          },
          element_context: {
            type: 'string',
            description: 'HTML or selector of the affected element.',
          },
        },
        required: ['finding'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_related_criteria',
      description:
        'Finds WCAG success criteria related to a given one (under the same guideline). Use for additional context when investigating an issue.',
      parameters: {
        type: 'object',
        properties: {
          sc_id: {
            type: 'string',
            description: 'Success criterion ID, e.g. "1.4.3".',
          },
        },
        required: ['sc_id'],
      },
    },
  },
];
