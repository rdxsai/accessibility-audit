import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionCall,
} from '@google/generative-ai';
import { SYSTEM_PROMPT } from './prompt';
import { toolDeclarations } from './tools';
import { executeTool } from './executor';

// ──────────────────────────────────────────────
// Agent — the Gemini-powered accessibility reviewer.
//
// This is ~80 lines of core logic. No framework needed.
//
// How it works:
//   1. User sends a message (or triggers a scan)
//   2. We send the message + tool declarations to Gemini
//   3. Gemini either responds with text OR requests tool calls
//   4. If tool calls: execute them, send results back to Gemini
//   5. Repeat until Gemini responds with final text
//   6. Stream the response back to the side panel
//
// The tool-call loop is the key insight:
//   Gemini says "I want to call scan_page"
//   → we run scan_page → send results back
//   → Gemini says "now I want get_computed_styles for .nav-link"
//   → we run that → send results back
//   → Gemini says "and verify_violation for this finding"
//   → we run that → send results back
//   → Gemini finally responds with the full analysis text
// ──────────────────────────────────────────────

let apiKey: string | null = null;

export function setApiKey(key: string): void {
  apiKey = key;
}

export async function getApiKey(): Promise<string | null> {
  if (apiKey) return apiKey;
  // Try loading from extension storage
  const stored = await chrome.storage.local.get('gemini_api_key');
  if (stored.gemini_api_key) {
    apiKey = stored.gemini_api_key;
    return apiKey;
  }
  return null;
}

// Conversation history — persists across messages within a tab session
const conversationHistory: Content[] = [];

export async function runAgent(
  userMessage: string,
  tabId: number,
  onChunk: (text: string, done: boolean) => void
): Promise<void> {
  const key = await getApiKey();
  if (!key) {
    onChunk('Error: No Gemini API key configured. Set it in the extension settings.', true);
    return;
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: toolDeclarations }],
  });

  // Add user message to history
  conversationHistory.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  // Start the agent loop
  let loopCount = 0;
  const MAX_LOOPS = 15; // Safety limit — prevent infinite tool-call loops

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    const result = await model.generateContent({
      contents: conversationHistory,
    });

    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts ?? [];

    // Check if Gemini wants to call tools
    const functionCalls = parts.filter(
      (p): p is Part & { functionCall: FunctionCall } => !!p.functionCall
    );

    if (functionCalls.length > 0) {
      // Gemini requested tool calls — execute them all
      // Add Gemini's response (with function calls) to history
      conversationHistory.push({
        role: 'model',
        parts,
      });

      // Execute each tool call and collect results
      const toolResults: Part[] = [];

      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        console.log(`[Agent] Calling tool: ${name}`, args);

        const toolResult = await executeTool(name, (args ?? {}) as Record<string, unknown>, tabId);

        toolResults.push({
          functionResponse: {
            name,
            response: { result: toolResult },
          },
        });
      }

      // Send tool results back to Gemini
      conversationHistory.push({
        role: 'user',
        parts: toolResults,
      });

      // Loop continues — Gemini will process tool results
      // and either call more tools or respond with text
      continue;
    }

    // No tool calls — Gemini is responding with text
    const textParts = parts.filter((p) => p.text);
    const fullText = textParts.map((p) => p.text).join('');

    // Add model response to history
    conversationHistory.push({
      role: 'model',
      parts: [{ text: fullText }],
    });

    // Send to side panel
    onChunk(fullText, true);
    return;
  }

  // Safety: hit max loops
  onChunk('Error: Agent exceeded maximum tool call iterations.', true);
}

// Reset conversation (e.g., when user navigates to a new page)
export function resetConversation(): void {
  conversationHistory.length = 0;
}
