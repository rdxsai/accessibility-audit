import React, { useState, useEffect, useRef } from 'react';

// ──────────────────────────────────────────────
// Side panel — the user-facing UI.
//
// Three states:
//   1. Setup — no API key configured yet
//   2. Ready — key set, waiting for user action
//   3. Chat — conversation with the agent
//
// The scan flow:
//   User clicks "Scan Page" or types a message
//   → sends CHAT_MESSAGE to service worker
//   → agent runs tools, streams response back
//   → we listen for CHAT_RESPONSE messages
//   → display in the chat view
// ──────────────────────────────────────────────

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
}

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Check if API key is already stored
  useEffect(() => {
    chrome.storage.local.get('openai_api_key', (result) => {
      if (result.openai_api_key) {
        setHasKey(true);
      }
    });
  }, []);

  // Listen for streamed responses from the agent
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'CHAT_RESPONSE') {
        setChat((prev) => {
          // If the last entry is from assistant and not done, append
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && !message.payload.done) {
            return [
              ...prev.slice(0, -1),
              { role: 'assistant', text: last.text + message.payload.text },
            ];
          }
          // Otherwise add new assistant entry
          if (last?.role === 'assistant') {
            // Replace the placeholder with final text
            return [
              ...prev.slice(0, -1),
              { role: 'assistant', text: message.payload.text },
            ];
          }
          return [...prev, { role: 'assistant', text: message.payload.text }];
        });
        if (message.payload.done) {
          setLoading(false);
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const saveApiKey = () => {
    if (!apiKey.trim()) return;
    chrome.runtime.sendMessage({
      type: 'SET_API_KEY',
      payload: { key: apiKey.trim() },
    });
    setHasKey(true);
  };

  const sendMessage = (text: string) => {
    if (!text.trim() || loading) return;

    setChat((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    setLoading(true);

    chrome.runtime.sendMessage({
      type: 'CHAT_MESSAGE',
      payload: { text },
    });
  };

  const handleScan = () => {
    sendMessage('Scan this page for accessibility violations. Run both the automated axe-core scan and your manual review.');
  };

  // ─── Setup screen ──────────────────────────
  if (!hasKey) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-5 flex flex-col justify-center">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-amber-400">WCAG Scout</h1>
          <p className="text-sm text-gray-400 mt-1">AI Accessibility Scanner</p>
        </div>

        <div className="space-y-3">
          <label className="block text-sm text-gray-300">
            OpenAI API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
            placeholder="sk-..."
            className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={saveApiKey}
            className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
          >
            Save & Start
          </button>
          <p className="text-xs text-gray-500">
            Get a key from{' '}
            <span className="text-amber-500">platform.openai.com/api-keys</span>
          </p>
        </div>
      </div>
    );
  }

  // ─── Main chat screen ──────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h1 className="text-base font-bold text-amber-400">WCAG Scout</h1>
          <p className="text-xs text-gray-500">AI Accessibility Scanner</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="rounded-md px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            title="Settings"
          >
            {showSettings ? 'Close' : 'Key'}
          </button>
          <button
            onClick={handleScan}
            disabled={loading}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? 'Scanning...' : 'Scan Page'}
          </button>
        </div>
      </header>

      {/* Inline settings panel */}
      {showSettings && (
        <div className="px-4 py-3 border-b border-gray-800 bg-gray-900 space-y-2">
          <label className="block text-xs text-gray-400">OpenAI API Key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  saveApiKey();
                  setShowSettings(false);
                }
              }}
              placeholder="sk-..."
              className="flex-1 rounded-md bg-gray-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={() => {
                saveApiKey();
                setShowSettings(false);
              }}
              className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-amber-400"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {chat.length === 0 && !loading && (
          <div className="text-center mt-12 space-y-3">
            <p className="text-sm text-gray-500">
              Click <strong className="text-amber-400">Scan Page</strong> to run a full audit, or ask a question below.
            </p>
            <div className="space-y-2">
              {[
                'Scan this page for accessibility issues',
                'Check the color contrast on this page',
                'Are there any missing ARIA attributes?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => sendMessage(suggestion)}
                  className="block w-full text-left rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-300"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {chat.map((entry, i) => (
          <div key={i} className={entry.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={`rounded-lg px-3 py-2 text-sm max-w-[90%] ${
                entry.role === 'user'
                  ? 'bg-amber-500/20 text-amber-100'
                  : 'bg-gray-800 text-gray-200'
              }`}
            >
              {entry.role === 'assistant' ? (
                <div className="whitespace-pre-wrap leading-relaxed">{entry.text}</div>
              ) : (
                <p>{entry.text}</p>
              )}
            </div>
          </div>
        ))}

        {loading && chat[chat.length - 1]?.role === 'user' && (
          <div className="flex items-center gap-2 text-gray-500 text-xs">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Analyzing page...
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input area */}
      <div className="px-4 py-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ask about accessibility..."
            disabled={loading}
            className="flex-1 rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-500 disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
