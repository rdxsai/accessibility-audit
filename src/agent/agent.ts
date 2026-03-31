import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { SYSTEM_PROMPT } from './prompt';
import { toolDeclarations } from './tools';
import { executeTool } from './executor';

// ──────────────────────────────────────────────
// Agent — OpenAI gpt-4o-mini powered accessibility reviewer.
//
// Same loop as before, different SDK:
//   1. Send messages + tools to OpenAI
//   2. If response has tool_calls → execute them, append results
//   3. Repeat until response has text content (no tool_calls)
//   4. Send final text to side panel
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

// Conversation history — OpenAI format
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
      dangerouslyAllowBrowser: true, // Required for Chrome extension context
    });

    // Add user message to history
    conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    let loopCount = 0;
    const MAX_LOOPS = 25;

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      console.log(`[Agent] Loop ${loopCount}/${MAX_LOOPS}`);

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
        onChunk('Error: Empty response from OpenAI. Try again.', true);
        return;
      }

      // Check if the model wants to call tools
      const toolCalls = message.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        // Add assistant message (with tool calls) to history
        conversationHistory.push(message);

        // Execute each tool call and append results
        for (const toolCall of toolCalls) {
          // Narrow to function tool calls (vs custom tool calls)
          if (toolCall.type !== 'function') continue;

          const name = toolCall.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            args = {};
          }

          console.log(`[Agent] Calling tool: ${name}`, args);

          let toolResult: unknown;
          try {
            toolResult = await executeTool(name, args, tabId);
            console.log(`[Agent] Tool ${name} returned`, typeof toolResult);
          } catch (toolError: any) {
            console.error(`[Agent] Tool ${name} failed:`, toolError);
            toolResult = { error: `Tool failed: ${toolError.message || toolError}` };
          }

          // OpenAI requires tool results as separate messages
          // with role: "tool" and the matching tool_call_id
          conversationHistory.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        // Continue loop — model will process tool results
        continue;
      }

      // No tool calls — model responded with text
      const fullText = message.content || '';

      conversationHistory.push({
        role: 'assistant',
        content: fullText,
      });

      onChunk(fullText, true);
      return;
    }

    onChunk('Error: Agent exceeded maximum tool call iterations. Try a simpler query.', true);
  } catch (error: any) {
    console.error('[Agent] Unexpected error:', error);
    onChunk(`Error: ${error.message || 'Something went wrong.'}`, true);
  }
}

export function resetConversation(): void {
  conversationHistory.length = 0;
}
