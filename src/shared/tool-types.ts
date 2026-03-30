// ──────────────────────────────────────────────
// Tool parameter and return types.
//
// Each tool has a Params type (what the LLM sends)
// and a Result type (what comes back).
//
// These types are shared between:
//   - Content script (implements the browser tools)
//   - Service worker (registers tools with ADK)
//   - Agent prompt (describes tools to Gemini)
// ──────────────────────────────────────────────

// ─── Browser Inspection Tools ────────────────

export interface ScreenshotParams {
  fullPage?: boolean;
}

export interface ScreenshotResult {
  imageBase64: string;
  width: number;
  height: number;
}

export interface DomSnapshotParams {
  selector?: string; // scope to a section, e.g. "nav", "#about". defaults to "body"
  maxDepth?: number; // how deep to traverse. defaults to 5
}

export interface DomSnapshotNode {
  tag: string;
  role?: string;           // ARIA role (explicit or implicit)
  ariaLabel?: string;
  ariaLabelledBy?: string;
  id?: string;
  classes?: string;
  textContent?: string;    // trimmed, max 100 chars
  children?: DomSnapshotNode[];
}

export interface DomSnapshotResult {
  root: DomSnapshotNode;
  landmarkCount: number;
  headingCount: number;
}

export interface ComputedStylesParams {
  selector: string;
}

export interface ComputedStylesResult {
  found: boolean;
  selector: string;
  // Colors (resolved — no rgba, no "inherit", no variables)
  color: string;
  backgroundColor: string;
  // Contrast (we compute it for the LLM)
  contrastRatio: number | null;
  // Text properties
  fontSize: string;
  fontWeight: string;
  // Focus styling
  outlineStyle: string;
  outlineColor: string;
  outlineWidth: string;
  // Opacity
  opacity: string;
  // Visibility
  isVisible: boolean;
}

export interface ElementInteractionsParams {
  selector: string;
}

export interface ElementInteractionsResult {
  found: boolean;
  selector: string;
  tagName: string;
  role: string | null;      // computed ARIA role
  // ARIA states
  ariaExpanded: string | null;
  ariaControls: string | null;
  ariaSelected: string | null;
  ariaPressed: string | null;
  ariaHidden: string | null;
  ariaLive: string | null;
  ariaLabel: string | null;
  ariaDescribedBy: string | null;
  // Interactivity
  hasClickListener: boolean;
  hasKeydownListener: boolean;
  tabIndex: number | null;
  // Content
  textContent: string;
  innerHtml: string;        // truncated to 200 chars
}

export interface FocusOrderParams {
  maxElements?: number; // how many elements to tab through. defaults to 30
}

export interface FocusOrderEntry {
  index: number;
  selector: string;
  tagName: string;
  role: string | null;
  textContent: string;      // truncated
  // Focus indicator visibility
  hasVisibleFocusStyle: boolean;
  outlineStyle: string;
  outlineColor: string;
  boxShadow: string;
}

export interface FocusOrderResult {
  entries: FocusOrderEntry[];
  totalFocusableElements: number;
  hasSkipLink: boolean;
}

export interface MotionCheckResult {
  // CSS animations currently running
  cssAnimations: {
    selector: string;
    animationName: string;
    duration: string;
  }[];
  // Whether any element uses CSS transitions
  cssTransitionCount: number;
  // Canvas elements (potential JS animations)
  canvasElements: {
    selector: string;
    ariaHidden: string | null;
    width: number;
    height: number;
  }[];
  // Whether a prefers-reduced-motion media query exists in stylesheets
  hasReducedMotionQuery: boolean;
}

// ─── Page Interaction Tools ──────────────────

export interface ClickElementParams {
  selector: string;
}

export interface ClickElementResult {
  clicked: boolean;
  // State AFTER clicking
  ariaExpanded: string | null;
  ariaSelected: string | null;
  ariaPressed: string | null;
  // Any new elements that appeared/disappeared
  domChanged: boolean;
}

export interface TabToElementParams {
  selector: string;
}

export interface TabToElementResult {
  reached: boolean;
  tabPresses: number;        // how many tabs it took
  focusVisible: boolean;     // is the focus indicator visible?
  outlineStyle: string;
}
