import type { Message } from '@shared/messages';

// ──────────────────────────────────────────────
// Tool executor — routes Gemini's function calls
// to either the content script or the MCP server.
//
// When Gemini decides to call a tool, it returns a
// FunctionCall with { name, args }. This executor
// maps the name to the right handler:
//
//   Browser tools → send Chrome message to content script
//   MCP tools     → HTTP call to the WCAG MCP server
//   Interaction   → send Chrome message to content script
// ──────────────────────────────────────────────

// MCP server URL — runs locally during development
const MCP_SERVER_URL = 'http://localhost:8000';

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tabId: number
): Promise<unknown> {
  switch (name) {
    // ─── Browser tools → content script ──────
    case 'scan_page':
      return sendToContentScript(tabId, {
        type: 'SCAN_REQUEST',
        payload: { scope: ((args.scope as string) || 'full') as 'full' | 'visible' },
      });

    case 'capture_screenshot':
      // Screenshot is special — captured by the service worker,
      // not the content script (it needs chrome.tabs.captureVisibleTab)
      return captureScreenshot();

    case 'get_dom_snapshot':
      return sendToContentScript(tabId, {
        type: 'GET_DOM_SNAPSHOT',
        payload: {
          selector: (args.selector as string) || 'body',
          maxDepth: (args.maxDepth as number) || 5,
        },
      });

    case 'get_computed_styles':
      return sendToContentScript(tabId, {
        type: 'GET_COMPUTED_STYLES',
        payload: { selector: args.selector as string },
      });

    case 'get_element_interactions':
      return sendToContentScript(tabId, {
        type: 'GET_ELEMENT_INTERACTIONS',
        payload: { selector: args.selector as string },
      });

    case 'check_focus_order':
      return sendToContentScript(tabId, {
        type: 'CHECK_FOCUS_ORDER',
        payload: { maxElements: (args.maxElements as number) || 30 },
      });

    case 'check_motion':
      return sendToContentScript(tabId, { type: 'CHECK_MOTION' });

    // ─── Interaction tools → content script ──
    case 'highlight_element':
      return sendToContentScript(tabId, {
        type: 'HIGHLIGHT_ELEMENT',
        payload: { selector: args.selector as string },
      });

    case 'click_element':
      return sendToContentScript(tabId, {
        type: 'CLICK_ELEMENT',
        payload: { selector: args.selector as string },
      });

    // ─── MCP tools → WCAG server ─────────────
    case 'get_success_criterion':
      return callMcpTool('get_success_criterion', { sc_id: args.sc_id });

    case 'get_technique':
      return callMcpTool('get_technique', { technique_id: args.technique_id });

    case 'verify_violation':
      return callMcpTool('verify_violation', {
        finding: args.finding,
        axe_rule_id: args.axe_rule_id || '',
        sc_id: args.sc_id || '',
        element_context: args.element_context || '',
      });

    case 'get_related_criteria':
      return callMcpTool('get_related_criteria', { sc_id: args.sc_id });

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Chrome messaging helper ─────────────────

function sendToContentScript(
  tabId: number,
  message: Message
): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(response ?? { error: 'No response from content script' });
    });
  });
}

// ─── Screenshot capture ─────────────────────

async function captureScreenshot(): Promise<{
  imageBase64: string;
  width: number;
  height: number;
}> {
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
  // dataUrl is "data:image/png;base64,iVBOR..."
  // Strip the prefix to get raw base64
  const base64 = dataUrl.split(',')[1];
  return {
    imageBase64: base64,
    width: 0, // Actual dimensions aren't available from this API
    height: 0,
  };
}

// ─── MCP server HTTP call ────────────────────
//
// Plain REST call to the WCAG server:
// POST /api/tool { name, args } → tool result as JSON

async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  try {
    const response = await fetch(`${MCP_SERVER_URL}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: toolName, args }),
    });

    if (!response.ok) {
      return { error: `MCP server error: ${response.status}` };
    }

    return await response.json();
  } catch (e) {
    return {
      error: `MCP server unreachable at ${MCP_SERVER_URL}. Is it running? Start with: python server.py --http`,
    };
  }
}
