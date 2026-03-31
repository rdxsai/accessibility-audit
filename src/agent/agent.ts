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
// Build the data message for the LLM.
// Same as before — comprehensive summary of ALL collected data.
// ──────────────────────────────────────────────

function buildDataMessage(data: PageAuditData): string {
  const s = data.summary;

  let msg = `I've scanned the page at ${data.url}. Here is the COMPLETE audit data. Analyze ALL of it and produce a full accessibility report.\n\n`;

  msg += `## TIER 1: axe-core Scan Results\n`;
  msg += `Found ${s.totalAxeViolations} automated violations:\n\n`;
  for (const v of data.axeViolations) {
    msg += `### [${v.impact.toUpperCase()}] ${v.id}\n`;
    msg += `- Description: ${v.description}\n`;
    msg += `- WCAG tags: ${v.wcagTags.join(', ')}\n`;
    msg += `- Elements affected: ${v.nodes.length}\n`;
    for (const node of v.nodes.slice(0, 5)) {
      msg += `  - Selector: ${node.target.join(' > ')}\n`;
      msg += `    HTML: ${node.html.slice(0, 150)}\n`;
      msg += `    Why: ${node.failureSummary.split('\n')[0]}\n`;
    }
    msg += '\n';
  }

  msg += `## TIER 2: Navigation Link Contrast\n`;
  msg += `Checked ${s.totalNavLinks} nav links. ${s.navLinksWithLowContrast} have contrast below 4.5:1.\n\n`;
  for (const style of data.navLinkStyles) {
    const flag = style.contrastRatio !== null && style.contrastRatio < 4.5 ? ' FAILS' : ' PASSES';
    msg += `- ${style.selector}: color=${style.color}, bg=${style.backgroundColor}, contrast=${style.contrastRatio ?? 'unknown'}:1, fontSize=${style.fontSize}${flag}\n`;
  }
  msg += '\n';

  msg += `## TIER 2: Button ARIA States\n`;
  msg += `Checked ${s.totalButtons} buttons. ${s.buttonsWithoutAriaExpanded} have click listeners but no aria-expanded.\n\n`;
  for (const btn of data.buttonInteractions) {
    msg += `- "${btn.textContent.slice(0, 40)}": `;
    msg += `role=${btn.role ?? 'none'}, `;
    msg += `aria-expanded=${btn.ariaExpanded ?? 'MISSING'}, `;
    msg += `aria-controls=${btn.ariaControls ?? 'MISSING'}, `;
    msg += `hasClick=${btn.hasClickListener}\n`;
  }
  msg += '\n';

  msg += `## TIER 2: Focus Order & Visibility\n`;
  msg += `Total focusable elements: ${s.totalFocusableElements}\n`;
  msg += `Elements without visible focus style: ${s.elementsWithoutVisibleFocus}\n`;
  msg += `Skip navigation link present: ${s.hasSkipLink}\n\n`;
  for (const entry of data.focusOrder.entries.slice(0, 20)) {
    const icon = entry.hasVisibleFocusStyle ? 'VISIBLE' : 'NOT_VISIBLE';
    msg += `[${entry.index}] <${entry.tagName}> "${entry.textContent.slice(0, 30)}" — focus: ${icon}, outline: ${entry.outlineStyle} ${entry.outlineColor}\n`;
  }
  msg += '\n';

  msg += `## TIER 2: Landmark Structure\n`;
  msg += `Total sections: ${s.totalSections}, without accessible name: ${s.sectionsWithoutAccessibleName}\n`;
  msg += `Landmark count: ${data.domSnapshot.landmarkCount}, Heading count: ${data.domSnapshot.headingCount}\n\n`;

  msg += `## TIER 2: Motion & Animation\n`;
  msg += `CSS animations: ${data.motionCheck.cssAnimations.length}\n`;
  msg += `CSS transitions: ${data.motionCheck.cssTransitionCount}\n`;
  msg += `Canvas elements: ${data.motionCheck.canvasElements.length}\n`;
  msg += `prefers-reduced-motion in CSS: ${s.hasReducedMotionQuery}\n`;
  msg += `Canvas without aria-hidden: ${s.canvasElementsWithoutAriaHidden}\n`;
  for (const c of data.motionCheck.canvasElements) {
    msg += `- ${c.selector}: aria-hidden=${c.ariaHidden ?? 'MISSING'}, size=${c.width}x${c.height}\n`;
  }
  msg += '\n';

  msg += `## QUICK FLAGS\n`;
  if (s.navLinksWithLowContrast > 0) msg += `- ${s.navLinksWithLowContrast} nav links fail contrast\n`;
  if (s.buttonsWithoutAriaExpanded > 0) msg += `- ${s.buttonsWithoutAriaExpanded} toggle buttons missing aria-expanded\n`;
  if (s.elementsWithoutVisibleFocus > 0) msg += `- ${s.elementsWithoutVisibleFocus} elements have no visible focus indicator\n`;
  if (!s.hasSkipLink) msg += `- No skip navigation link\n`;
  if (s.sectionsWithoutAccessibleName > 0) msg += `- ${s.sectionsWithoutAccessibleName} sections missing accessible name\n`;
  if (!s.hasReducedMotionQuery) msg += `- No prefers-reduced-motion query\n`;
  if (s.canvasElementsWithoutAriaHidden > 0) msg += `- ${s.canvasElementsWithoutAriaHidden} canvas elements without aria-hidden\n`;

  msg += `\nUse verify_violation for EACH issue above before reporting it. Report ALL issues found — do not skip any.`;

  return msg;
}

export function resetConversation(): void {
  // LangGraph manages its own state per invocation
  // Nothing to reset unless we add checkpointing later
}
