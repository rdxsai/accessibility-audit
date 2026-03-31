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

  let msg = `Page: ${data.url}\nReport EVERY element individually. Do NOT summarize as "several" or "multiple".\n\n`;

  // ─── Stage 1: axe-core (every element listed) ───
  msg += `## STAGE 1: axe-core (${data.axeViolations.length} rule violations)\n`;
  for (const v of data.axeViolations) {
    msg += `\n### [${v.impact}] ${v.id}: ${v.description}\n`;
    msg += `WCAG: ${v.wcagTags.join(', ')}\n`;
    msg += `${v.nodes.length} elements:\n`;
    for (const n of v.nodes) {
      msg += `  - selector: ${n.target.join(' > ')}\n`;
      msg += `    html: ${n.html.slice(0, 200)}\n`;
      msg += `    reason: ${n.failureSummary.split('\n')[0]}\n`;
    }
  }

  // ─── Stage 2a: Contrast (every failure) ───
  msg += `\n## STAGE 2a: Contrast — ${s2.contrast.failures.length} failing elements (${s2.contrast.totalTextElements} scanned)\n`;
  for (const f of s2.contrast.failures) {
    msg += `  - selector: ${f.selector}\n`;
    msg += `    text: "${f.text}"\n`;
    msg += `    ratio: ${f.contrastRatio}:1 (required: ${f.requiredRatio}:1)\n`;
    msg += `    fg: ${f.fgColor}, bg: ${f.bgColor}, size: ${f.fontSize}, weight: ${f.fontWeight}\n`;
  }

  // ─── Stage 2b: ARIA (every element) ───
  msg += `\n## STAGE 2b: ARIA\n`;
  msg += `### Buttons — ${s2.aria.buttonsWithIssues.length} of ${s2.aria.totalButtons} have issues:\n`;
  for (const b of s2.aria.buttonsWithIssues) {
    msg += `  - selector: ${b.selector}\n`;
    msg += `    element: ${b.element}\n`;
    msg += `    issue: ${b.details}\n`;
    msg += `    aria-expanded: ${b.ariaExpanded ?? 'MISSING'}, aria-controls: ${b.ariaControls ?? 'MISSING'}\n`;
  }
  msg += `### Sections — ${s2.aria.sectionsWithIssues.length} of ${s2.aria.totalSections} without accessible name:\n`;
  for (const s of s2.aria.sectionsWithIssues) {
    msg += `  - selector: ${s.selector}\n`;
    msg += `    element: ${s.element}\n`;
  }
  msg += `### Decorative — ${s2.aria.decorativeWithIssues.length} not hidden from AT:\n`;
  for (const d of s2.aria.decorativeWithIssues) {
    msg += `  - selector: ${d.selector}\n`;
    msg += `    element: ${d.element}\n`;
    msg += `    issue: ${d.details}\n`;
  }
  if (s2.aria.inputsWithIssues.length) {
    msg += `### Inputs — ${s2.aria.inputsWithIssues.length} without labels:\n`;
    for (const i of s2.aria.inputsWithIssues) {
      msg += `  - selector: ${i.selector}\n`;
      msg += `    element: ${i.element}\n`;
      msg += `    issue: ${i.details}\n`;
    }
  }

  if (s2.aria.viewportIssues.length) {
    msg += `### Viewport — ${s2.aria.viewportIssues.length} issues:\n`;
    for (const v of s2.aria.viewportIssues) {
      msg += `  - content="${v.content}"\n`;
      msg += `    issue: ${v.issue}\n`;
    }
  }

  // ─── Stage 2c: Motion ───
  msg += `\n## STAGE 2c: Motion\n`;
  msg += `prefers-reduced-motion: CSS=${s2.motion.hasReducedMotionCSS}, JS=${s2.motion.hasReducedMotionJS}\n`;
  for (const a of s2.motion.cssAnimations) {
    msg += `  - animation: ${a.selector} — ${a.animationName} (${a.duration}, iterations: ${a.iterationCount})\n`;
  }
  for (const c of s2.motion.canvasElements) {
    msg += `  - canvas: ${c.selector} — aria-hidden=${c.ariaHidden ?? 'MISSING'}, ${c.width}x${c.height}\n`;
  }

  // ─── Stage 2d: Focus (every element) ───
  msg += `\n## STAGE 2d: Focus\n`;
  msg += `Skip link: ${s2.focus.skipLink.exists}`;
  if (s2.focus.skipLink.exists) {
    msg += ` (${s2.focus.skipLink.selector}, target exists: ${s2.focus.skipLink.targetExists})`;
  }
  msg += `\n`;
  if (s2.focus.noFocusStyle.length) {
    msg += `### No focus indicator — ${s2.focus.noFocusStyle.length} elements:\n`;
    for (const f of s2.focus.noFocusStyle) {
      msg += `  - selector: ${f.selector}\n`;
      msg += `    element: <${f.tagName}> "${f.textContent}"\n`;
      msg += `    bg: ${f.backgroundColor}\n`;
    }
  }
  if (s2.focus.insufficientContrast.length) {
    msg += `### Insufficient focus indicator contrast — ${s2.focus.insufficientContrast.length} elements:\n`;
    for (const f of s2.focus.insufficientContrast) {
      msg += `  - selector: ${f.selector} — indicator contrast: ${f.indicatorContrast}:1 (need 3:1)\n`;
    }
  }
  if (s2.focus.thinOutline.length) {
    msg += `### Thin outline (< 2px) — ${s2.focus.thinOutline.length} elements:\n`;
    for (const f of s2.focus.thinOutline) {
      msg += `  - selector: ${f.selector} — ${f.outlineWidthPx}px outline\n`;
    }
  }
  msg += `Good focus styles: ${s2.focus.goodFocusStyle} elements\n`;
  msg += `:focus-visible CSS rules: ${s2.focus.focusVisibleRuleCount}, :focus rules: ${s2.focus.focusRuleCount}\n`;

  // ─── Stage 2e: Target size (every element) ───
  msg += `\n## STAGE 2e: Target Size\n`;
  if (s2.targetSize.failuresBelow24.length) {
    msg += `### Below 24px (critical) — ${s2.targetSize.failuresBelow24.length} elements:\n`;
    for (const t of s2.targetSize.failuresBelow24) {
      msg += `  - selector: ${t.selector} — ${t.element} — ${t.width}x${t.height}px\n`;
    }
  }
  msg += `### Below 44px — ${s2.targetSize.failuresBelow44.length} elements:\n`;
  for (const t of s2.targetSize.failuresBelow44) {
    msg += `  - selector: ${t.selector} — ${t.element} — ${t.width}x${t.height}px\n`;
  }

  // ─── Totals ───
  const totalElements =
    data.axeViolations.reduce((sum, v) => sum + v.nodes.length, 0) +
    s2.contrast.failures.length +
    s2.aria.buttonsWithIssues.length +
    s2.aria.sectionsWithIssues.length +
    s2.aria.decorativeWithIssues.length +
    s2.aria.inputsWithIssues.length +
    s2.focus.noFocusStyle.length +
    s2.focus.insufficientContrast.length +
    s2.targetSize.failuresBelow44.length +
    s2.targetSize.failuresBelow24.length +
    (!s2.focus.skipLink.exists ? 1 : 0) +
    (!s2.motion.hasReducedMotionCSS && !s2.motion.hasReducedMotionJS ? 1 : 0) +
    s2.aria.viewportIssues.length;

  msg += `\n## TOTALS: ${totalElements} element-level issues found.\n`;
  msg += `Verify each issue TYPE once (not per element). List EVERY element individually in the report. Do not summarize.\n`;
  return msg;
}

export function resetConversation(): void {}
