// ──────────────────────────────────────────────
// Stage 2 audit runner — executes all programmatic
// audits and returns the combined results.
//
// Called via a single RRUN_AUDITS message from the collector.
// No LLM involved — pure JavaScript analysis.
// ──────────────────────────────────────────────

import { runContrastAudit, type ContrastAuditResult } from './contrast-audit';
import { runAriaAudit, type AriaAuditResult } from './aria-audit';
import { runMotionAudit, type MotionAuditResult } from './motion-audit';
import { runTargetSizeAudit, type TargetSizeAuditResult } from './target-size-audit';
import { runFocusAudit, type FocusAuditResult } from './focus-audit';

export interface Stage2AuditResult {
  contrast: ContrastAuditResult;
  aria: AriaAuditResult;
  motion: MotionAuditResult;
  targetSize: TargetSizeAuditResult;
  focus: FocusAuditResult;
}

export function runAllAudits(): Stage2AuditResult {
  return {
    contrast: runContrastAudit(),
    aria: runAriaAudit(),
    motion: runMotionAudit(),
    targetSize: runTargetSizeAudit(),
    focus: runFocusAudit(),
  };
}

// Re-export types for the collector
export type {
  ContrastAuditResult,
  AriaAuditResult,
  MotionAuditResult,
  TargetSizeAuditResult,
  FocusAuditResult,
};
