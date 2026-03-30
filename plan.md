# WCAG Scout — AI Accessibility Scanner Chrome Extension

## Project Summary

A Chrome extension that scans any web page for accessibility violations using axe-core, verifies them against WCAG specs via an MCP server, and explains violations in plain language through a chat-based side panel UI — powered by Google ADK + Gemini Flash.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │Content Script │  │Service Worker│  │  Side Panel   │ │
│  │              │  │  (Background)│  │  (Chat UI)    │ │
│  │ • axe-core   │──│ • ADK Agent  │──│ • React       │ │
│  │ • DOM access  │  │ • Tool defs  │  │ • Streaming   │ │
│  │ • Violation   │  │ • MCP client │  │ • Violation   │ │
│  │   extraction  │  │ • Gemini API │  │   cards       │ │
│  └──────────────┘  └──────┬───────┘  └───────────────┘ │
│                           │                              │
└───────────────────────────┼──────────────────────────────┘
                            │
                    ┌───────▼───────┐
                    │  WCAG MCP     │
                    │  Server       │
                    │               │
                    │ • Spec lookup │
                    │ • SC mapping  │
                    │ • Technique   │
                    │   retrieval   │
                    └───────────────┘
```

---

## Phase 1: Foundation (Week 1)

### 1.1 Chrome Extension Scaffold

- **Manifest V3** setup with permissions: `activeTab`, `sidePanel`, `storage`
- Three entry points:
  - `content.js` — injected into pages, runs axe-core
  - `background.js` (service worker) — orchestrates agent, manages state
  - `sidepanel.html` — React-based chat UI
- Chrome messaging bridge between all three layers
- Extension icon with badge count (violation count)

### 1.2 axe-core Integration

- Bundle `axe-core` into the content script
- On user click (or auto-scan toggle): run `axe.run()` against current DOM
- Extract structured violation data:
  ```ts
  interface Violation {
    id: string;              // e.g., "image-alt"
    impact: string;          // "critical" | "serious" | "moderate" | "minor"
    description: string;     // axe's description
    wcagTags: string[];      // e.g., ["wcag2a", "wcag111"]
    nodes: {
      html: string;          // offending element HTML snippet
      target: string[];      // CSS selector path
      failureSummary: string;
    }[];
  }
  ```
- Deduplicate and group violations by WCAG success criterion
- Send grouped violations to service worker via `chrome.runtime.sendMessage`

### 1.3 Basic Side Panel UI

- React + Tailwind in side panel (bundled with Vite)
- Initial views:
  - Scan button + page status
  - Violation list (grouped by criterion, sorted by impact)
  - Individual violation card (element highlight, raw axe output)
- No AI yet — just structured axe-core output displayed cleanly

**Milestone: Extension that scans pages and shows raw violations in side panel.**

---

## Phase 2: WCAG MCP Server (Week 2)

### 2.1 MCP Server Setup

- FastAPI + FastMCP (Python) — you already know this stack from the tutoring project
- Data source: WCAG 2.2 spec (scraped or from W3C's structured JSON/XML)
- Tools to expose:
  ```
  get_success_criterion(sc_id: str)
    → Returns SC title, level, intent, benefits, and sufficient techniques

  get_technique(technique_id: str)
    → Returns technique description, examples, and test procedure

  verify_violation(axe_rule_id: str, element_context: str)
    → Maps axe rule → WCAG SC, confirms applicability,
      returns relevant techniques and failure conditions

  get_related_criteria(sc_id: str)
    → Returns related SCs for context (e.g., 1.1.1 relates to 1.4.5)
  ```

### 2.2 Data Pipeline

- Parse WCAG 2.2 Understanding docs + Techniques docs into structured store
- Map axe-core rule IDs → WCAG success criteria (axe provides `tags` but the MCP server should hold the canonical mapping with richer context)
- Store in SQLite for simplicity (single-file, no infra)
- Consider embedding technique descriptions for semantic search later

**Milestone: MCP server running locally, responds to tool calls with WCAG spec data.**

---

## Phase 3: ADK Agent Integration (Week 2-3)

### 3.1 Agent Design

- Single `LlmAgent` — no multi-agent complexity needed
- Model: `gemini-2.5-flash` (fast, cheap, good enough for explanation tasks)
- System instruction:
  ```
  You are an accessibility expert assistant integrated into a Chrome extension.
  You receive structured accessibility violations detected by axe-core on web pages.
  Your job is to:
  1. Use the WCAG MCP tools to verify each violation against the official spec
  2. Explain what the violation means in plain language
  3. Suggest specific, actionable fixes with code examples
  4. Prioritize by real-world user impact, not just severity labels

  Be concise. Developers are reading this in a side panel while working.
  Lead with the "so what" — how does this affect a real user?
  ```

### 3.2 Tool Definitions (ADK FunctionTools)

```ts
// Tool 1: Scan page (delegates to content script via chrome messaging)
const scanPage = new FunctionTool({
  name: 'scan_current_page',
  description: 'Runs axe-core accessibility scan on the current page',
  parameters: z.object({
    scope: z.enum(['full', 'visible', 'selection']).optional()
  }),
  execute: async ({ scope }) => { /* bridge to content script */ }
});

// Tool 2: Verify violation (calls WCAG MCP server)
const verifyViolation = new FunctionTool({
  name: 'verify_violation',
  description: 'Verifies an axe-core violation against WCAG 2.2 spec',
  parameters: z.object({
    axe_rule_id: z.string(),
    element_context: z.string()
  }),
  execute: async ({ axe_rule_id, element_context }) => {
    /* MCP tool call to WCAG server */
  }
});

// Tool 3: Get WCAG details
const getWCAGDetails = new FunctionTool({
  name: 'get_wcag_criterion',
  description: 'Gets full WCAG success criterion details including techniques',
  parameters: z.object({
    sc_id: z.string().describe('e.g., "1.1.1" or "4.1.2"')
  }),
  execute: async ({ sc_id }) => { /* MCP tool call */ }
});

// Tool 4: Highlight element on page
const highlightElement = new FunctionTool({
  name: 'highlight_element',
  description: 'Highlights a specific element on the page for the user',
  parameters: z.object({
    selector: z.string()
  }),
  execute: async ({ selector }) => { /* bridge to content script */ }
});
```

### 3.3 Agent Loop Flow

```
User clicks "Scan" or asks "Check this page"
  → Agent calls scan_current_page tool
  → Receives grouped violations from axe-core
  → For each violation group (batched by SC):
      → Calls verify_violation with axe rule + element context
      → Receives WCAG spec confirmation + techniques
      → Generates explanation + fix suggestion
  → Streams results back to side panel chat
```

### 3.4 Conversation Modes

The chat UI should support two interaction patterns:

1. **Scan mode** — user triggers a scan, agent explains all violations
2. **Ask mode** — user asks follow-up questions:
   - "Why does this matter for screen readers?"
   - "Show me how to fix the third violation"
   - "Is this a WCAG A or AA requirement?"
   - "Ignore all color contrast issues on this page"

**Milestone: Agent scans page, verifies against WCAG spec, streams explanations.**

---

## Phase 4: Polish & UX (Week 3-4)

### 4.1 Side Panel Chat UI

- Streaming responses (Gemini supports SSE)
- Violation cards with:
  - Impact badge (critical/serious/moderate/minor)
  - WCAG SC reference (linked to W3C doc)
  - Affected element preview (HTML snippet)
  - "Highlight on page" button (sends message to content script)
  - "How to fix" expandable section
- Summary header: "Found 12 violations across 5 WCAG criteria"
- Filter/sort controls: by impact, by SC, by element type

### 4.2 Element Highlighting

- When user hovers over a violation card → highlight the element on page
- Overlay with dotted border + tooltip showing violation type
- Click to scroll-to-element
- Content script manages highlight overlays via injected CSS

### 4.3 Page-Aware Context

- Agent receives page URL + title as context
- For SPAs: detect route changes, offer to re-scan
- Store scan history per-tab in service worker memory
- "What changed since last scan?" diff capability (stretch goal)

### 4.4 Cost Optimization

- **Batch violations by SC** before sending to agent (don't explain 15 missing alt texts individually)
- **Cache MCP responses** — WCAG spec doesn't change, cache criterion lookups in extension storage
- **Truncate element HTML** — send only relevant attributes, not full subtrees
- **Lazy explain** — show violation list immediately, generate explanations on-demand when user expands a card
- Target: < 2K tokens per scan for a typical page (10-20 violation groups)

---

## Phase 5: Stretch Goals

### 5.1 Export & Reporting
- Export scan results as structured JSON or Markdown report
- Copy individual violation explanations to clipboard
- Generate VPAT-style summary for a page

### 5.2 Fix Suggestions with Code
- For common patterns (missing alt, missing label, missing lang), generate copy-paste fix code
- Show before/after HTML diffs

### 5.3 Continuous Monitoring
- Auto-scan on page load (opt-in)
- Badge icon shows violation count
- Notification on new violations after DOM mutations (MutationObserver)

### 5.4 Team Features
- Shareable scan results (export as JSON, import to review)
- Annotation mode: attach notes to specific violations
- Integration with issue trackers (GitHub Issues, Jira)

---

## Tech Stack

| Layer              | Technology                                      |
|--------------------|------------------------------------------------|
| Extension          | Manifest V3, TypeScript, Vite                  |
| UI                 | React + Tailwind (side panel)                  |
| Accessibility Scan | axe-core (content script)                      |
| Agent Framework    | Google ADK (TypeScript SDK)                    |
| LLM                | Gemini 2.5 Flash                               |
| WCAG Data          | FastMCP (Python) + SQLite                      |
| MCP Transport      | stdio (local) or SSE (if hosted)               |
| State              | chrome.storage.local (scan history, settings)  |

---

## Key Design Decisions

1. **axe-core for detection, LLM for explanation** — deterministic scanning with intelligent interpretation. Never ask the LLM to find violations.

2. **Single agent, not multi-agent** — the workflow is linear (scan → verify → explain). No need for handoffs or parallel agents. Keep it simple.

3. **WCAG MCP server as separate service** — reusable across projects (your tutor already needs this), testable independently, and keeps the extension lightweight.

4. **Gemini Flash over Sonnet/GPT-4o** — this is a high-frequency, low-stakes explanation task. Flash gives you sub-second responses at ~10x lower cost. Upgrade path to Pro exists if explanation quality needs improvement.

5. **Lazy explanation generation** — show axe-core results immediately, generate LLM explanations on-demand. Users see results in <1 second, AI explanations stream in when they want detail.

6. **Batch by success criterion** — 15 images without alt text = 1 explanation, not 15. Saves tokens and is actually more useful to the developer.

---

## Resume Positioning

**WCAG Scout** — AI-Powered Accessibility Scanner Chrome Extension
- Built Chrome extension using Google ADK + Gemini Flash that scans web pages for WCAG 2.2 violations via axe-core, verifies against spec using a custom WCAG MCP server, and generates plain-language explanations with actionable fix suggestions
- Designed lazy-evaluation architecture: deterministic axe-core scanning (<1s) with on-demand LLM explanation, batching violations by success criterion to keep cost under 2K tokens/scan
- Implemented WCAG MCP server (FastMCP + SQLite) mapping axe-core rules to WCAG 2.2 success criteria with technique retrieval — reusable across accessibility tooling projects

**Paired with your tutor:** "Built both the teaching side (Socratic WCAG tutor) and the enforcement side (accessibility scanner) of web accessibility — with a shared WCAG MCP server powering both."