import type { Violation } from '@shared/messages';
import type { Message } from '@shared/messages';
import type { Stage2AuditResult } from '../content/audits';
import { sendToContentScript as _send } from './executor';

// ──────────────────────────────────────────────
// Collector — deterministic data gathering.
//
// Two stages, both code-driven:
//   Stage 1: axe-core scan (SCAN_REQUEST)
//   Stage 2: programmatic audits (RUN_AUDITS)
//     - contrast on every visible text element
//     - ARIA on every button, section, canvas, input
//     - motion + prefers-reduced-motion (CSS + JS)
//     - target size (44x44) on every interactive element
//     - focus-visible CSS rules + skip link
//
// One message each. All the heavy lifting happens in
// the content script. The collector just triggers and
// packages the results.
// ──────────────────────────────────────────────

function sendToTab<T>(tabId: number, message: Message): Promise<T> {
  return _send(tabId, message) as Promise<T>;
}

export interface PageAuditData {
  url: string;
  timestamp: number;
  axeViolations: Violation[];
  stage2: Stage2AuditResult;
}

export async function collectPageAuditData(
  tabId: number,
  onProgress: (step: string) => void
): Promise<PageAuditData> {
  const url = await getTabUrl(tabId);

  // ─── Stage 1: axe-core ─────────────────────
  onProgress('Running axe-core scan...');
  const scanResult = await sendToTab<{ violations: Violation[] }>(
    tabId,
    { type: 'SCAN_REQUEST', payload: { scope: 'full' } } as Message
  );

  // ─── Stage 2: Programmatic audits ──────────
  onProgress('Running programmatic audits (contrast, ARIA, focus, motion, target size)...');
  const stage2 = await sendToTab<Stage2AuditResult>(
    tabId,
    { type: 'RUN_AUDITS' } as Message
  );

  // Debug: log what Stage 2 returned
  console.log('[Collector] Stage 2 results:', {
    contrast: stage2?.contrast ? `${stage2.contrast.failures.length} failures` : 'MISSING',
    aria: stage2?.aria ? `${stage2.aria.buttonsWithIssues.length} button issues, ${stage2.aria.sectionsWithIssues.length} section issues` : 'MISSING',
    focus: stage2?.focus ? `${stage2.focus.noFocusStyle.length} no-focus, skip=${stage2.focus.skipLink.exists}` : 'MISSING',
    motion: stage2?.motion ? `reducedMotionCSS=${stage2.motion.hasReducedMotionCSS}` : 'MISSING',
    targetSize: stage2?.targetSize ? `${stage2.targetSize.failuresBelow44.length} below 44px` : 'MISSING',
  });

  return {
    url,
    timestamp: Date.now(),
    axeViolations: scanResult?.violations ?? [],
    stage2,
  };
}

async function getTabUrl(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return tab.url ?? 'unknown';
}
