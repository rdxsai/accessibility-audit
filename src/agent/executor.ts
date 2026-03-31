import type { Message } from '@shared/messages';

// ──────────────────────────────────────────────
// Executor — bridges between the agent and external services.
//
// Two functions:
//   1. sendToContentScript — Chrome messaging to content script
//   2. executeMcpTool — HTTP call to the WCAG MCP server
//
// The LangGraph tools call executeMcpTool directly.
// The collector calls sendToContentScript via its own helpers.
// ──────────────────────────────────────────────

const MCP_SERVER_URL = 'http://localhost:8000';

// ─── Chrome messaging ────────────────────────

export function sendToContentScript(
  tabId: number,
  message: Message
): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(response ?? { error: 'No response from content script' });
    });
  });
}

// ─── MCP server HTTP call ────────────────────

export async function executeMcpTool(
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
