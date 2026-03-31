import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { SYSTEM_PROMPT } from './prompt';
import { executeMcpTool } from './executor';
import { collectPageAuditData, type PageAuditData } from './collector';

// ──────────────────────────────────────────────
// Agent — direct OpenAI calls, no framework overhead.
//
// Architecture:
//   Stage 1-3: collector gathers all data deterministically
//   Stage 4: send data to gpt-4o, handle tool calls manually
//
// We removed LangGraph because:
//   - It added 1MB to the bundle
//   - createReactAgent's loop was hanging in the extension
//   - For a simple tool-call loop, direct API is more reliable
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
    const client = new OpenAI({
      apiKey: key,
      dangerouslyAllowBrowser: true,
    });

    const isScanRequest = /scan|audit|check|review|accessibility|violations/i.test(userMessage);

    let inputMessage: string;

    if (isScanRequest) {
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
      console.log('[Agent] Data message:', inputMessage.length, 'chars');
    } else {
      inputMessage = userMessage;
    }

    // ─── Simple tool-call loop ─────────────────
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: inputMessage },
    ];

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'verify_violation',
          description: 'Verify a finding against WCAG 2.2 spec. Returns mapped criteria and techniques.',
          parameters: {
            type: 'object',
            properties: {
              finding: { type: 'string', description: 'Description of the issue.' },
              sc_id: { type: 'string', description: 'WCAG SC ID, e.g. "1.4.3".' },
              element_context: { type: 'string', description: 'Affected element selector or HTML.' },
            },
            required: ['finding'],
          },
        },
      },
    ];

    let loopCount = 0;
    const MAX_LOOPS = 5;

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      console.log(`[Agent] API call ${loopCount}/${MAX_LOOPS}`);

      const t0 = Date.now();
      let response;
      try {
        response = await client.chat.completions.create({
          model: 'gpt-4o',
          messages,
          tools,
          tool_choice: loopCount === 1 ? 'auto' : 'auto',
        });
      } catch (apiError: any) {
        console.error('[Agent] API error:', apiError.message);
        onChunk(`Error: ${apiError.message}`, true);
        return;
      }
      console.log(`[Agent] Response in ${Date.now() - t0}ms, finish=${response.choices[0].finish_reason}`);

      const msg = response.choices[0].message;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Add assistant message with tool calls
        messages.push(msg);

        console.log(`[Agent] ${msg.tool_calls.length} tool calls`);

        // Execute all tool calls in parallel
        const results = await Promise.all(
          msg.tool_calls.map(async (tc) => {
            if (tc.type !== 'function') return { id: tc.id, result: '{}' };
            const args = JSON.parse(tc.function.arguments || '{}');
            const result = await executeMcpTool(tc.function.name, args);
            return { id: tc.id, result: JSON.stringify(result) };
          })
        );

        // Add all tool results
        for (const r of results) {
          messages.push({
            role: 'tool',
            tool_call_id: r.id,
            content: r.result,
          });
        }

        continue;
      }

      // No tool calls — final response
      const text = msg.content || '';
      console.log(`[Agent] Final response: ${text.length} chars`);
      onChunk(text, true);
      return;
    }

    onChunk('Error: Agent exceeded max iterations.', true);
  } catch (error: any) {
    console.error('[Agent] Error:', error);
    onChunk(`Error: ${error.message}`, true);
  }
}

// ──────────────────────────────────────────────
// Build data message from Stage 1 + Stage 2 results
// ──────────────────────────────────────────────

function buildDataMessage(data: PageAuditData): string {
  const s2 = data.stage2;

  if (!s2?.contrast || !s2?.aria || !s2?.focus || !s2?.motion || !s2?.targetSize) {
    console.error('[Agent] Stage 2 data missing:', s2);
    return `Page: ${data.url}\n\nStage 2 audits returned no data. axe-core found:\n${JSON.stringify(data.axeViolations, null, 2)}\n\nReport axe-core violations only.`;
  }

  let msg = `Page: ${data.url}\n\n`;

  msg += `## STAGE 1: axe-core (${data.axeViolations.length} violations)\n`;
  for (const v of data.axeViolations) {
    msg += `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} elements, ${v.wcagTags.join(',')})\n`;
    for (const n of v.nodes.slice(0, 3)) msg += `  ${n.target.join(' > ')}: ${n.html.slice(0, 120)}\n`;
  }

  msg += `\n## STAGE 2a: Contrast — ${s2.contrast.failures.length} failures\n`;
  for (const f of s2.contrast.failures) msg += `FAIL: "${f.text}" ratio=${f.contrastRatio}:1 (need ${f.requiredRatio}:1) fg=${f.fgColor} bg=${f.bgColor} size=${f.fontSize}\n`;

  msg += `\n## STAGE 2b: ARIA\n`;
  msg += `Buttons: ${s2.aria.buttonsWithIssues.length} issues\n`;
  for (const b of s2.aria.buttonsWithIssues) msg += `  ${b.element}: ${b.details}\n`;
  msg += `Sections: ${s2.aria.sectionsWithIssues.length} without name\n`;
  for (const s of s2.aria.sectionsWithIssues) msg += `  ${s.element}\n`;
  msg += `Decorative: ${s2.aria.decorativeWithIssues.length} not hidden\n`;
  for (const d of s2.aria.decorativeWithIssues) msg += `  ${d.element}: ${d.details}\n`;
  if (s2.aria.inputsWithIssues.length) {
    msg += `Inputs: ${s2.aria.inputsWithIssues.length} without labels\n`;
    for (const i of s2.aria.inputsWithIssues) msg += `  ${i.element}: ${i.details}\n`;
  }

  msg += `\n## STAGE 2c: Motion\n`;
  msg += `prefers-reduced-motion: CSS=${s2.motion.hasReducedMotionCSS} JS=${s2.motion.hasReducedMotionJS}\n`;
  for (const a of s2.motion.cssAnimations) msg += `Animation: ${a.selector} ${a.animationName}\n`;
  for (const c of s2.motion.canvasElements) msg += `Canvas: ${c.selector} aria-hidden=${c.ariaHidden ?? 'MISSING'}\n`;

  msg += `\n## STAGE 2d: Focus\n`;
  msg += `Skip link: ${s2.focus.skipLink.exists}\n`;
  msg += `No focus style: ${s2.focus.noFocusStyle.length} elements\n`;
  for (const f of s2.focus.noFocusStyle) msg += `  <${f.tagName}> "${f.textContent}"\n`;
  msg += `Insufficient contrast: ${s2.focus.insufficientContrast.length}\n`;
  msg += `Thin outline: ${s2.focus.thinOutline.length}\n`;
  msg += `:focus-visible rules: ${s2.focus.focusVisibleRuleCount}\n`;

  msg += `\n## STAGE 2e: Target Size — ${s2.targetSize.failuresBelow44.length} below 44px\n`;
  for (const t of s2.targetSize.failuresBelow44.slice(0, 10)) msg += `  ${t.element} ${t.width}x${t.height}px\n`;
  if (s2.targetSize.failuresBelow24.length) {
    msg += `Critical (below 24px): ${s2.targetSize.failuresBelow24.length}\n`;
    for (const t of s2.targetSize.failuresBelow24) msg += `  ${t.element} ${t.width}x${t.height}px\n`;
  }

  msg += `\n## FLAGS\n`;
  if (s2.contrast.failures.length) msg += `- ${s2.contrast.failures.length} contrast failures\n`;
  if (s2.aria.buttonsWithIssues.length) msg += `- ${s2.aria.buttonsWithIssues.length} buttons missing ARIA\n`;
  if (s2.aria.sectionsWithIssues.length) msg += `- ${s2.aria.sectionsWithIssues.length} sections without name\n`;
  if (s2.aria.decorativeWithIssues.length) msg += `- ${s2.aria.decorativeWithIssues.length} decorative not hidden\n`;
  if (!s2.focus.skipLink.exists) msg += `- No skip link\n`;
  if (s2.focus.noFocusStyle.length) msg += `- ${s2.focus.noFocusStyle.length} no focus indicator\n`;
  if (!s2.motion.hasReducedMotionCSS && !s2.motion.hasReducedMotionJS) msg += `- No prefers-reduced-motion\n`;
  if (s2.targetSize.failuresBelow44.length) msg += `- ${s2.targetSize.failuresBelow44.length} targets below 44px\n`;

  msg += `\nVerify each issue. Report ALL. Deduplicate Stage 1 + Stage 2 overlaps. Group by severity.`;
  return msg;
}

export function resetConversation(): void {}
