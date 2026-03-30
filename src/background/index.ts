import type { Message } from '@shared/messages';

// ──────────────────────────────────────────────
// Service worker (background script).
// Responsibilities:
//   1. Open side panel when extension icon is clicked
//   2. Relay messages between content script ↔ side panel
//   3. Will later host the ADK agent and MCP client
// ──────────────────────────────────────────────

// Open the side panel when the user clicks the extension icon
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Central message router
chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    switch (message.type) {
      // Side panel asked for a scan → forward to content script
      case 'SCAN_REQUEST':
        forwardToContentScript(message, sendResponse);
        return true;

      // Content script sent results → broadcast to side panel
      case 'SCAN_RESULT':
        chrome.runtime.sendMessage(message);
        break;

      // Chat message from side panel → will route to ADK agent later
      case 'CHAT_MESSAGE':
        handleChatMessage(message.payload.text, sendResponse);
        return true;
    }
  }
);

async function forwardToContentScript(
  message: Message,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    sendResponse({ violations: [] });
    return;
  }
  chrome.tabs.sendMessage(tab.id, message, sendResponse);
}

async function handleChatMessage(
  text: string,
  sendResponse: (response: unknown) => void
): Promise<void> {
  // ADK agent will be wired in Phase 3 — echo stub for now
  console.log('[WCAG Scout] Chat:', text);
  sendResponse({ text: `Echo: ${text}`, done: true });
}

console.log('[WCAG Scout] Service worker loaded');
