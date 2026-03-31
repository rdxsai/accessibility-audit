import type OpenAI from 'openai';

// ──────────────────────────────────────────────
// Tool declarations for the LLM.
//
// The LLM no longer calls browser inspection tools —
// the collector handles that deterministically.
//
// The LLM only has WCAG verification tools:
//   - verify_violation: confirm a finding against the spec
//   - get_success_criterion: look up SC details
//   - get_technique: look up technique details
//   - highlight_element: show the user which element
// ──────────────────────────────────────────────

export const toolDeclarations: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'verify_violation',
      description:
        'Verifies whether a finding is a real WCAG violation by checking it against the WCAG 2.2 spec. Returns mapped success criteria, relevant techniques, and failure conditions. MUST be called for every issue before reporting.',
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
            description: 'WCAG SC ID, e.g. "4.1.2".',
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
      name: 'get_success_criterion',
      description:
        'Looks up a WCAG 2.2 success criterion by ID. Returns title, level, intent, benefits, techniques.',
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
  {
    type: 'function',
    function: {
      name: 'get_technique',
      description:
        'Looks up a WCAG technique by ID. Returns description, test procedure, and code examples.',
      parameters: {
        type: 'object',
        properties: {
          technique_id: {
            type: 'string',
            description: 'Technique ID, e.g. "G18", "ARIA5", "F78".',
          },
        },
        required: ['technique_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'highlight_element',
      description:
        'Highlights an element on the page for the user.',
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
];
