import type { Message } from '@shared/messages';
import { runAgent, setApiKey, resetConversation } from '../agent/agent';

// ──────────────────────────────────────────────
// Service worker (background script).
// Responsibilities:
//   1. Open side panel when extension icon is clicked
//   2. Relay messages between content script ↔ side panel
//   3. Route chat messages to the Gemini agent
//   4. Forward tool calls from agent to content script
// ──────────────────────────────────────────────

// Open the side panel when the user clicks the extension icon
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Central message router
chrome.runtime.onMessage.addListener(
  (message: Message & { type: string; payload?: any }, sender, sendResponse) => {
    switch (message.type) {
      // Side panel asked for a scan → forward to content script
      case 'SCAN_REQUEST':
        forwardToContentScript(message as Message, sendResponse);
        return true;

      // Content script sent results → broadcast to side panel
      case 'SCAN_RESULT':
        chrome.runtime.sendMessage(message);
        break;

      // Chat message from side panel → route to Gemini agent
      case 'CHAT_MESSAGE':
        handleChatMessage(message.payload.text, sendResponse);
        return true;

      // API key configuration from side panel
      case 'SET_API_KEY' as any:
        setApiKey(message.payload.key);
        chrome.storage.local.set({ openai_api_key: message.payload.key });
        sendResponse({ ok: true });
        break;

      // Reset conversation (e.g., page navigation)
      case 'RESET_CONVERSATION' as any:
        resetConversation();
        sendResponse({ ok: true });
        break;
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
  // Respond immediately — don't hold the message channel open.
  // The actual response streams back via CHAT_RESPONSE messages.
  sendResponse({ ok: true });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    chrome.runtime.sendMessage({
      type: 'CHAT_RESPONSE',
      payload: { text: 'Error: No active tab found.', done: true },
    });
    return;
  }

  // Run the agent — it calls tools and sends the response via onChunk
  runAgent(text, tab.id, (responseText, done) => {
    chrome.runtime.sendMessage({
      type: 'CHAT_RESPONSE',
      payload: { text: responseText, done },
    });
  });
}

console.log('[WCAG Scout] Service worker loaded');
