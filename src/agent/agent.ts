import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { SYSTEM_PROMPT } from './prompt';
import { toolDeclarations } from './tools';
import { executeTool } from './executor';
import { collectPageAuditData, type PageAuditData } from './collector';

// ──────────────────────────────────────────────
// Agent — two-phase architecture:
//
//   Phase 1 (DETERMINISTIC): The collector runs ALL browser
//   tools programmatically. No LLM involved. Every nav link,
//   every button, every landmark is inspected. Nothing skipped.
//
//   Phase 2 (LLM): The collected data is sent to gpt-4o in
//   one shot. The LLM analyzes it, identifies issues, and
//   calls verify_violation to confirm each one against WCAG.
//
// Why this is better:
//   - Data collection never skips steps (it's code, not hope)
//   - LLM gets the complete picture (not partial tool results)
//   - LLM only does what it's good at (analysis, not orchestration)
//   - Fewer API calls (1-3 instead of 10-15)
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

const conversationHistory: ChatCompletionMessageParam[] = [];

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
    const client = new OpenAI({
      apiKey: key,
      dangerouslyAllowBrowser: true,
    });

    // Detect if this is a scan request (vs a follow-up question)
    const isScanRequest = /scan|audit|check|review|accessibility|violations/i.test(userMessage);

    if (isScanRequest) {
      // ─── Phase 1: Deterministic data collection ──
      onChunk('', false); // clear any previous state

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

      // ─── Phase 2: LLM analysis ──────────────────
      // Build a comprehensive data message for the LLM
      const dataMessage = buildDataMessage(auditData);

      conversationHistory.push({
        role: 'user',
        content: dataMessage,
      });
    } else {
      // Follow-up question — just add to conversation
      conversationHistory.push({
        role: 'user',
        content: userMessage,
      });
    }

    // ─── LLM loop (for verification tool calls) ──
    let loopCount = 0;
    const MAX_LOOPS = 15;

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      console.log(`[Agent] Analysis loop ${loopCount}/${MAX_LOOPS}`);

      let response;
      try {
        response = await client.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...conversationHistory,
          ],
          tools: toolDeclarations,
          tool_choice: 'auto',
        });
      } catch (apiError: any) {
        console.error('[Agent] OpenAI API error:', apiError);
        onChunk(`Error calling OpenAI API: ${apiError.message || apiError}`, true);
        return;
      }

      const message = response.choices[0]?.message;
      if (!message) {
        onChunk('Error: Empty response from OpenAI.', true);
        return;
      }

      const toolCalls = message.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        conversationHistory.push(message);

        for (const toolCall of toolCalls) {
          if (toolCall.type !== 'function') continue;

          const name = toolCall.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            args = {};
          }

          console.log(`[Agent] Verification tool: ${name}`, args);

          let toolResult: unknown;
          try {
            toolResult = await executeTool(name, args, tabId);
          } catch (toolError: any) {
            toolResult = { error: `Tool failed: ${toolError.message}` };
          }

          conversationHistory.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        continue;
      }

      // Final text response
      const fullText = message.content || '';
      conversationHistory.push({
        role: 'assistant',
        content: fullText,
      });

      onChunk(fullText, true);
      return;
    }

    onChunk('Error: Agent exceeded maximum iterations.', true);
  } catch (error: any) {
    console.error('[Agent] Unexpected error:', error);
    onChunk(`Error: ${error.message || 'Something went wrong.'}`, true);
  }
}

// ──────────────────────────────────────────────
// Build the data message sent to the LLM.
//
// This is a structured text summary of ALL collected data.
// The LLM reads this and identifies issues — it doesn't
// need to call browser tools because we already called them.
// ──────────────────────────────────────────────

function buildDataMessage(data: PageAuditData): string {
  const s = data.summary;

  let msg = `I've scanned the page at ${data.url}. Here is the COMPLETE audit data. Analyze ALL of it and produce a full accessibility report.\n\n`;

  // ─── axe-core violations ───
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

  // ─── Nav link contrast ───
  msg += `## TIER 2: Navigation Link Contrast\n`;
  msg += `Checked ${s.totalNavLinks} nav links. ${s.navLinksWithLowContrast} have contrast below 4.5:1.\n\n`;
  for (const style of data.navLinkStyles) {
    const flag = style.contrastRatio !== null && style.contrastRatio < 4.5 ? ' ⚠️ FAILS' : ' ✓';
    msg += `- ${style.selector}: color=${style.color}, bg=${style.backgroundColor}, contrast=${style.contrastRatio ?? 'unknown'}:1, fontSize=${style.fontSize}${flag}\n`;
  }
  msg += '\n';

  // ─── Button ARIA states ───
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

  // ─── Focus order ───
  msg += `## TIER 2: Focus Order & Visibility\n`;
  msg += `Total focusable elements: ${s.totalFocusableElements}\n`;
  msg += `Elements without visible focus style: ${s.elementsWithoutVisibleFocus}\n`;
  msg += `Skip navigation link present: ${s.hasSkipLink}\n\n`;
  for (const entry of data.focusOrder.entries.slice(0, 20)) {
    const icon = entry.hasVisibleFocusStyle ? '✓' : '✗';
    msg += `${icon} [${entry.index}] <${entry.tagName}> "${entry.textContent.slice(0, 30)}" — outline: ${entry.outlineStyle} ${entry.outlineColor}\n`;
  }
  msg += '\n';

  // ─── Landmarks ───
  msg += `## TIER 2: Landmark Structure\n`;
  msg += `Total sections: ${s.totalSections}, without accessible name: ${s.sectionsWithoutAccessibleName}\n`;
  msg += `Landmark count: ${data.domSnapshot.landmarkCount}, Heading count: ${data.domSnapshot.headingCount}\n\n`;

  // ─── Motion ───
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

  // ─── Summary flags ───
  msg += `## QUICK FLAGS\n`;
  if (s.navLinksWithLowContrast > 0) msg += `⚠️ ${s.navLinksWithLowContrast} nav links fail contrast\n`;
  if (s.buttonsWithoutAriaExpanded > 0) msg += `⚠️ ${s.buttonsWithoutAriaExpanded} toggle buttons missing aria-expanded\n`;
  if (s.elementsWithoutVisibleFocus > 0) msg += `⚠️ ${s.elementsWithoutVisibleFocus} elements have no visible focus indicator\n`;
  if (!s.hasSkipLink) msg += `⚠️ No skip navigation link\n`;
  if (s.sectionsWithoutAccessibleName > 0) msg += `⚠️ ${s.sectionsWithoutAccessibleName} sections missing accessible name\n`;
  if (!s.hasReducedMotionQuery) msg += `⚠️ No prefers-reduced-motion query\n`;
  if (s.canvasElementsWithoutAriaHidden > 0) msg += `⚠️ ${s.canvasElementsWithoutAriaHidden} canvas elements without aria-hidden\n`;

  msg += `\nUse verify_violation for EACH issue above before reporting it. Report ALL issues found — do not skip any.`;

  return msg;
}

export function resetConversation(): void {
  conversationHistory.length = 0;
}
