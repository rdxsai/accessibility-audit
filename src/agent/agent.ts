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
// How it works:
//   1. User sends a message (or triggers a scan)
//   2. We send the message + tool declarations to Gemini
//   3. Gemini either responds with text OR requests tool calls
//   4. If tool calls: execute them, send results back to Gemini
//   5. Repeat until Gemini responds with final text
//   6. Send the response back to the side panel
// ──────────────────────────────────────────────

let apiKey: string | null = null;

export function setApiKey(key: string): void {
  apiKey = key;
}

export async function getApiKey(): Promise<string | null> {
  if (apiKey) return apiKey;
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

  try {
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
    const MAX_LOOPS = 25; // 7-step checklist needs many tool calls

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      console.log(`[Agent] Loop ${loopCount}/${MAX_LOOPS}`);

      let result;
      try {
        result = await model.generateContent({
          contents: conversationHistory,
        });
      } catch (apiError: any) {
        console.error('[Agent] Gemini API error:', apiError);
        onChunk(`Error calling Gemini API: ${apiError.message || apiError}`, true);
        return;
      }

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts ?? [];

      if (parts.length === 0) {
        console.warn('[Agent] Empty response from Gemini');
        onChunk('Error: Received empty response from Gemini. The model may be overloaded — try again.', true);
        return;
      }

      // Check if Gemini wants to call tools
      const functionCalls = parts.filter(
        (p): p is Part & { functionCall: FunctionCall } => !!p.functionCall
      );

      if (functionCalls.length > 0) {
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

          try {
            const toolResult = await executeTool(
              name,
              (args ?? {}) as Record<string, unknown>,
              tabId
            );
            console.log(`[Agent] Tool ${name} returned`, typeof toolResult);

            toolResults.push({
              functionResponse: {
                name,
                response: { result: toolResult },
              },
            });
          } catch (toolError: any) {
            console.error(`[Agent] Tool ${name} failed:`, toolError);
            toolResults.push({
              functionResponse: {
                name,
                response: { error: `Tool failed: ${toolError.message || toolError}` },
              },
            });
          }
        }

        // Send tool results back to Gemini
        conversationHistory.push({
          role: 'user',
          parts: toolResults,
        });

        // Continue loop — Gemini will process tool results
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

      onChunk(fullText, true);
      return;
    }

    // Safety: hit max loops
    onChunk('Error: Agent exceeded maximum tool call iterations. Try a simpler query.', true);
  } catch (error: any) {
    console.error('[Agent] Unexpected error:', error);
    onChunk(`Error: ${error.message || 'Something went wrong. Check the console for details.'}`, true);
  }
}

export function resetConversation(): void {
  conversationHistory.length = 0;
}
