import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { SYSTEM_PROMPT } from './prompt';
import { agentTools } from './tools';
import { collectPageAuditData, type PageAuditData } from './collector';

// ──────────────────────────────────────────────
// Agent — LangGraph ReAct agent with ChatOpenAI.
//
// Architecture:
//   Phase 1 (deterministic): collector.ts gathers ALL page data
//   Phase 2 (LangGraph): ReAct agent analyzes data + verifies
//     via MCP tools in a proper agent loop
//
// LangGraph gives us:
//   - Proper ReAct loop (reason → act → observe → repeat)
//   - Built-in tool execution via ToolNode
//   - Message state management
//   - No manual tool-call parsing needed
// ──────────────────────────────────────────────

let apiKey: string | null = null;

export function setApiKey(key: string): void {
  apiKey = key;
}

export async function getApiKey(): Promise<string | null> {
  if (apiKey) return apiKey;
  const stored = await chrome.storage.local.get('openai_api_key');
  if (stored.openai_api_key) {
    apiKey = stored.openai_api_key;
    return apiKey;
  }
  return null;
}

export async function runAgent(
  userMessage: string,
  tabId: number,
  onChunk: (text: string, done: boolean) => void
): Promise<void> {
  const key = await getApiKey();
  if (!key) {
    onChunk('Error: No OpenAI API key configured. Click "Key" to set it.', true);
    return;
  }

  try {
    // ─── Create the LangGraph agent ────────────
    const model = new ChatOpenAI({
      model: 'gpt-4o',
      temperature: 0,
      apiKey: key,
    });

    const agent = createReactAgent({
      llm: model,
      tools: agentTools,
      prompt: SYSTEM_PROMPT,
    });

    // ─── Detect scan request ───────────────────
    const isScanRequest = /scan|audit|check|review|accessibility|violations/i.test(userMessage);

    let inputMessage: string;

    if (isScanRequest) {
      // Phase 1: Deterministic data collection
      let auditData: PageAuditData;
      try {
        auditData = await collectPageAuditData(tabId, (step) => {
          console.log(`[Collector] ${step}`);
        });
      } catch (collectError: any) {
        console.error('[Collector] Failed:', collectError);
        onChunk(`Error during data collection: ${collectError.message}`, true);
        return;
      }

      inputMessage = buildDataMessage(auditData);
    } else {
      inputMessage = userMessage;
    }

    // ─── Phase 2: Run the LangGraph agent ──────
    console.log('[Agent] Starting LangGraph ReAct agent...');

    const result = await agent.invoke({
      messages: [new HumanMessage(inputMessage)],
    });

    // Extract the final assistant message
    const messages = result.messages;
    const lastMessage = messages[messages.length - 1];
    const responseText =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

    console.log('[Agent] Done. Tool calls made:',
      messages.filter((m: any) => m._getType?.() === 'tool').length
    );

    onChunk(responseText, true);
  } catch (error: any) {
    console.error('[Agent] Error:', error);
    onChunk(`Error: ${error.message || 'Something went wrong.'}`, true);
  }
}

// ──────────────────────────────────────────────
// Build the data message for the LLM from Stage 1 + Stage 2 results.
// ──────────────────────────────────────────────

function buildDataMessage(data: PageAuditData): string {
  const { stage2: s2 } = data;

  let msg = `Page: ${data.url}\nComplete audit data below. Analyze ALL of it. Report ALL issues.\n\n`;

  // ─── Stage 1: axe-core ─────────────────────
  msg += `## STAGE 1: axe-core (${data.axeViolations.length} violations)\n\n`;
  for (const v of data.axeViolations) {
    msg += `[${v.impact.toUpperCase()}] ${v.id}: ${v.description}\n`;
    msg += `  WCAG: ${v.wcagTags.join(', ')}, ${v.nodes.length} elements\n`;
    for (const node of v.nodes.slice(0, 3)) {
      msg += `  - ${node.target.join(' > ')}: ${node.html.slice(0, 120)}\n`;
    }
    msg += '\n';
  }

  // ─── Stage 2: Contrast ─────────────────────
  msg += `## STAGE 2a: Contrast Audit\n`;
  msg += `Scanned ${s2.contrast.totalTextElements} text elements (${s2.contrast.uniqueColorCombos} unique color combos).\n`;
  msg += `Failures: ${s2.contrast.failures.length}, Passes: ${s2.contrast.passes}\n\n`;
  for (const f of s2.contrast.failures) {
    msg += `FAIL: "${f.text}" at ${f.selector}\n`;
    msg += `  fg=${f.fgColor}, bg=${f.bgColor}, ratio=${f.contrastRatio}:1\n`;
    msg += `  fontSize=${f.fontSize}, fontWeight=${f.fontWeight}, isLarge=${f.isLargeText}, required=${f.requiredRatio}:1\n\n`;
  }

  // ─── Stage 2: ARIA ─────────────────────────
  msg += `## STAGE 2b: ARIA Audit\n`;
  msg += `Buttons: ${s2.aria.totalButtons} total, ${s2.aria.buttonsWithIssues.length} with issues\n`;
  for (const b of s2.aria.buttonsWithIssues) {
    msg += `  ${b.element} at ${b.selector}: ${b.details}\n`;
  }
  msg += `Sections: ${s2.aria.totalSections} total, ${s2.aria.sectionsWithIssues.length} without accessible name\n`;
  for (const s of s2.aria.sectionsWithIssues) {
    msg += `  ${s.element} at ${s.selector}\n`;
  }
  msg += `Decorative (canvas/svg): ${s2.aria.totalDecorativeElements} total, ${s2.aria.decorativeWithIssues.length} not hidden\n`;
  for (const d of s2.aria.decorativeWithIssues) {
    msg += `  ${d.element} at ${d.selector}: ${d.details}\n`;
  }
  msg += `Inputs: ${s2.aria.totalInputs} total, ${s2.aria.inputsWithIssues.length} without labels\n`;
  for (const inp of s2.aria.inputsWithIssues) {
    msg += `  ${inp.element} at ${inp.selector}: ${inp.details}\n`;
  }
  msg += '\n';

  // ─── Stage 2: Motion ───────────────────────
  msg += `## STAGE 2c: Motion Audit\n`;
  msg += `prefers-reduced-motion in CSS: ${s2.motion.hasReducedMotionCSS}\n`;
  if (s2.motion.reducedMotionCSSRules.length > 0) {
    msg += `  Rules: ${s2.motion.reducedMotionCSSRules.join(', ')}\n`;
  }
  msg += `prefers-reduced-motion in JS: ${s2.motion.hasReducedMotionJS}\n`;
  if (s2.motion.scriptSnippets.length > 0) {
    msg += `  Snippets: ${s2.motion.scriptSnippets.join('; ')}\n`;
  }
  msg += `CSS animations: ${s2.motion.cssAnimations.length}\n`;
  for (const a of s2.motion.cssAnimations) {
    msg += `  ${a.selector}: ${a.animationName} (${a.duration}, ${a.iterationCount})\n`;
  }
  msg += `Canvas elements: ${s2.motion.canvasElements.length}\n`;
  for (const c of s2.motion.canvasElements) {
    msg += `  ${c.selector}: aria-hidden=${c.ariaHidden ?? 'MISSING'}\n`;
  }
  msg += `CSS transitions: ${s2.motion.totalCSSTransitions}\n\n`;

  // ─── Stage 2: Target Size ──────────────────
  msg += `## STAGE 2d: Target Size Audit (44x44px)\n`;
  msg += `Checked ${s2.targetSize.checkedElements} of ${s2.targetSize.totalInteractiveElements} interactive elements\n`;
  msg += `Below 24px: ${s2.targetSize.failuresBelow24.length}, Below 44px: ${s2.targetSize.failuresBelow44.length}\n`;
  for (const f of s2.targetSize.failuresBelow24) {
    msg += `  CRITICAL: ${f.element} at ${f.selector} — ${f.width}x${f.height}px\n`;
  }
  for (const f of s2.targetSize.failuresBelow44.slice(0, 10)) {
    msg += `  WARNING: ${f.element} at ${f.selector} — ${f.width}x${f.height}px\n`;
  }
  msg += '\n';

  // ─── Stage 2: Focus ────────────────────────
  msg += `## STAGE 2e: Focus Audit\n`;
  msg += `Skip link: ${s2.focus.hasSkipLink ? 'YES' : 'NO'}\n`;
  msg += `First focusable: ${s2.focus.firstFocusableElement} "${s2.focus.firstFocusableText}"\n`;
  msg += `:focus-visible CSS rules: ${s2.focus.focusVisibleRules.length}\n`;
  for (const r of s2.focus.focusVisibleRules) {
    msg += `  ${r.selectorText} → ${r.properties.join(', ')}\n`;
  }
  msg += `:focus CSS rules: ${s2.focus.focusRules.length}\n`;
  for (const r of s2.focus.focusRules) {
    msg += `  ${r.selectorText} → ${r.properties.join(', ')}\n`;
  }
  msg += `Elements WITH custom focus: ${s2.focus.elementsWithCustomFocus.length}\n`;
  for (const e of s2.focus.elementsWithCustomFocus.slice(0, 5)) {
    msg += `  ${e}\n`;
  }
  msg += `Elements WITHOUT custom focus: ${s2.focus.elementsWithoutCustomFocus.length}\n`;
  for (const e of s2.focus.elementsWithoutCustomFocus) {
    msg += `  ${e}\n`;
  }
  msg += '\n';

  // ─── Quick flags ───────────────────────────
  msg += `## FLAGS\n`;
  if (s2.contrast.failures.length > 0) msg += `- ${s2.contrast.failures.length} text elements fail contrast\n`;
  if (s2.aria.buttonsWithIssues.length > 0) msg += `- ${s2.aria.buttonsWithIssues.length} buttons have ARIA issues\n`;
  if (s2.aria.sectionsWithIssues.length > 0) msg += `- ${s2.aria.sectionsWithIssues.length} sections missing accessible name\n`;
  if (s2.aria.decorativeWithIssues.length > 0) msg += `- ${s2.aria.decorativeWithIssues.length} decorative elements not hidden from AT\n`;
  if (s2.aria.inputsWithIssues.length > 0) msg += `- ${s2.aria.inputsWithIssues.length} inputs without labels\n`;
  if (!s2.focus.hasSkipLink) msg += `- No skip navigation link\n`;
  if (s2.focus.elementsWithoutCustomFocus.length > 0) msg += `- ${s2.focus.elementsWithoutCustomFocus.length} elements without custom focus style\n`;
  if (!s2.motion.hasReducedMotionCSS && !s2.motion.hasReducedMotionJS) msg += `- No prefers-reduced-motion support\n`;
  if (s2.targetSize.failuresBelow24.length > 0) msg += `- ${s2.targetSize.failuresBelow24.length} targets below 24px minimum\n`;
  if (s2.targetSize.failuresBelow44.length > 0) msg += `- ${s2.targetSize.failuresBelow44.length} targets below 44px best practice\n`;

  msg += `\nVerify each flagged issue with verify_violation before reporting. Report ALL issues.`;

  return msg;
}

export function resetConversation(): void {
  // LangGraph manages its own state per invocation
  // Nothing to reset unless we add checkpointing later
}
