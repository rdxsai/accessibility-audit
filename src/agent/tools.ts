import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { executeMcpTool } from './executor';

// ──────────────────────────────────────────────
// LangGraph tool definitions.
//
// Using @langchain/core's tool() helper — each tool gets:
//   - A Zod schema for parameters
//   - A description for the LLM
//   - An execute function
//
// These are ONLY verification + display tools.
// Data collection is handled by collector.ts (deterministic).
// ──────────────────────────────────────────────

export const verifyViolation = tool(
  async (input) => {
    const result = await executeMcpTool('verify_violation', {
      finding: input.finding,
      axe_rule_id: input.axe_rule_id || '',
      sc_id: input.sc_id || '',
      element_context: input.element_context || '',
    });
    return JSON.stringify(result);
  },
  {
    name: 'verify_violation',
    description:
      'Verifies whether a finding is a real WCAG violation by checking it against the WCAG 2.2 spec. Returns mapped success criteria, relevant techniques, and failure conditions. MUST be called for every issue before reporting.',
    schema: z.object({
      finding: z.string().describe('Description of the issue found.'),
      axe_rule_id: z.string().optional().describe('axe-core rule ID if applicable.'),
      sc_id: z.string().optional().describe('WCAG SC ID, e.g. "4.1.2".'),
      element_context: z.string().optional().describe('HTML or selector of the affected element.'),
    }),
  }
);

export const getSuccessCriterion = tool(
  async (input) => {
    const result = await executeMcpTool('get_success_criterion', {
      sc_id: input.sc_id,
    });
    return JSON.stringify(result);
  },
  {
    name: 'get_success_criterion',
    description:
      'Looks up a WCAG 2.2 success criterion by ID. Returns title, level, intent, benefits, techniques.',
    schema: z.object({
      sc_id: z.string().describe('Success criterion ID, e.g. "1.4.3", "2.4.7".'),
    }),
  }
);

export const getTechnique = tool(
  async (input) => {
    const result = await executeMcpTool('get_technique', {
      technique_id: input.technique_id,
    });
    return JSON.stringify(result);
  },
  {
    name: 'get_technique',
    description:
      'Looks up a WCAG technique by ID. Returns description, test procedure, and code examples.',
    schema: z.object({
      technique_id: z.string().describe('Technique ID, e.g. "G18", "ARIA5", "F78".'),
    }),
  }
);

export const highlightElement = tool(
  async (input) => {
    // This will be called via the executor's content script bridge
    // For now, return confirmation — the actual highlighting
    // happens via chrome messaging in the service worker
    return JSON.stringify({ highlighted: input.selector });
  },
  {
    name: 'highlight_element',
    description: 'Highlights an element on the page for the user.',
    schema: z.object({
      selector: z.string().describe('CSS selector for the element.'),
    }),
  }
);

// Export all tools as an array for createReactAgent
export const agentTools = [
  verifyViolation,
  getSuccessCriterion,
  getTechnique,
  highlightElement,
];
