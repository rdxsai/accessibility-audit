import type { ScreenshotResult } from '@shared/tool-types';

// ──────────────────────────────────────────────
// capture_screenshot
//
// Why the content script can't take a screenshot directly:
//   The content script runs inside the page, but it has no
//   API to capture pixels. That's a browser-level operation.
//
// How it works instead:
//   The content script CAN'T take the screenshot. It will
//   ask the service worker to do it via chrome.tabs.captureVisibleTab().
//   The service worker has this API because it's an extension-level
//   privilege.
//
//   So this tool is a special case — the content script just
//   returns page dimensions, and the actual capture happens
//   in the service worker.
// ──────────────────────────────────────────────

export function getPageDimensions(): {
  width: number;
  height: number;
  scrollHeight: number;
} {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  };
}

// The screenshot result is assembled in the service worker.
// See background/tools/screenshot.ts for the capture logic.
