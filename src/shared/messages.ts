// ──────────────────────────────────────────────
// Chrome messaging bridge — defines every message
// that flows between content script, service worker,
// and side panel. This is the "contract" between layers.
// ──────────────────────────────────────────────

import type {
  DomSnapshotParams,
  ComputedStylesParams,
  ElementInteractionsParams,
  FocusOrderParams,
  ClickElementParams,
  TabToElementParams,
} from './tool-types';

// ─── Existing messages ───────────────────────

export type ScanRequest = {
  type: 'SCAN_REQUEST';
  payload: { scope: 'full' | 'visible' };
};

export type ScanResult = {
  type: 'SCAN_RESULT';
  payload: { violations: Violation[] };
};

export type HighlightRequest = {
  type: 'HIGHLIGHT_ELEMENT';
  payload: { selector: string };
};

export type ClearHighlights = {
  type: 'CLEAR_HIGHLIGHTS';
};

export type ChatMessage = {
  type: 'CHAT_MESSAGE';
  payload: { text: string };
};

export type ChatResponse = {
  type: 'CHAT_RESPONSE';
  payload: { text: string; done: boolean };
};

export type ViolationsUpdate = {
  type: 'VIOLATIONS_UPDATE';
  payload: { violations: Violation[]; url: string; timestamp: number };
};

// ─── New tool messages ───────────────────────

// Service worker → Content script (tool calls)
export type GetPageDimensions = {
  type: 'GET_PAGE_DIMENSIONS';
};

export type GetDomSnapshot = {
  type: 'GET_DOM_SNAPSHOT';
  payload: DomSnapshotParams;
};

export type GetComputedStylesMsg = {
  type: 'GET_COMPUTED_STYLES';
  payload: ComputedStylesParams;
};

export type GetElementInteractionsMsg = {
  type: 'GET_ELEMENT_INTERACTIONS';
  payload: ElementInteractionsParams;
};

export type CheckFocusOrderMsg = {
  type: 'CHECK_FOCUS_ORDER';
  payload: FocusOrderParams;
};

export type CheckMotionMsg = {
  type: 'CHECK_MOTION';
};

export type ClickElementMsg = {
  type: 'CLICK_ELEMENT';
  payload: ClickElementParams;
};

export type TabToElementMsg = {
  type: 'TAB_TO_ELEMENT';
  payload: TabToElementParams;
};

// Collector asks content script to find all elements of a type
// Returns CSS selectors for each found element
export type DiscoverElements = {
  type: 'DISCOVER_ELEMENTS';
  payload: { query: 'nav-links' | 'buttons' | 'sections' | 'headings' };
};

// ─── Union of all messages ───────────────────

export type Message =
  | ScanRequest
  | ScanResult
  | HighlightRequest
  | ClearHighlights
  | ChatMessage
  | ChatResponse
  | ViolationsUpdate
  | GetPageDimensions
  | GetDomSnapshot
  | GetComputedStylesMsg
  | GetElementInteractionsMsg
  | CheckFocusOrderMsg
  | CheckMotionMsg
  | ClickElementMsg
  | TabToElementMsg
  | DiscoverElements;

// ──────────────────────────────────────────────
// Core data types
// ──────────────────────────────────────────────

export interface ViolationNode {
  html: string;
  target: string[];
  failureSummary: string;
}

export interface Violation {
  id: string;               // axe rule id, e.g. "image-alt"
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  helpUrl: string;
  wcagTags: string[];       // e.g. ["wcag2a", "wcag111"]
  nodes: ViolationNode[];
}
