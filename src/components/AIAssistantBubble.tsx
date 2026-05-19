import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, Sparkles, Zap, Brain } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';
import { supabase } from '../lib/supabase';

/**
 * Model picker — must match the server-side ALLOWED_MODELS allowlist in
 * supabase/functions/ai-assistant/index.ts. Anything not in this list
 * gets rejected at the request boundary.
 *
 *   pro:   gemini-3.1-pro       — smarter, slower, dynamic thinking budget
 *   flash: gemini-3.1-flash     — fast + cheap; default
 *
 * Persisted to localStorage so the user's choice survives reloads.
 */
type ModelId = 'gemini-3.1-pro' | 'gemini-3.1-flash';
const MODEL_OPTIONS: { id: ModelId; label: string; sub: string; icon: typeof Zap }[] = [
  { id: 'gemini-3.1-flash', label: 'Flash', sub: 'Fast / cheap', icon: Zap },
  { id: 'gemini-3.1-pro',   label: 'Pro',   sub: 'Best reasoning', icon: Brain },
];
const MODEL_STORAGE_KEY = 'ai-assistant-model';

function loadModel(): ModelId {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored && MODEL_OPTIONS.some((m) => m.id === stored)) return stored as ModelId;
  } catch {
    // localStorage unavailable — fall back to default.
  }
  return 'gemini-3.1-flash';
}

/**
 * Floating AI assistant bubble. Lives in the bottom-right corner of the app
 * and lets the user ask natural-language questions about their facility data
 * — counts, due dates, status rollups, etc. ("how many SPCCs are due this
 * year", "which facilities are overdue for inspection").
 *
 * Architecture:
 *  - Calls the `ai-assistant` Supabase Edge Function with the user's JWT +
 *    the active accountId. The function loads a compact snapshot of the
 *    account's facilities, hands it to Claude with an SPCC-aware system
 *    prompt, and streams the answer back as Server-Sent Events.
 *  - Conversation state is local-only (per-session). No persistence yet.
 *  - The big system prompt (compliance facts + facility snapshot) is
 *    prompt-cached on the server side, so multi-turn chats are cheap.
 */

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_PROMPTS = [
  'How many SPCC plans are due this year?',
  'Which facilities are overdue for an annual inspection?',
  'What facilities have no PE stamp date yet?',
  'Show me facilities due for 5-year recertification in the next 90 days.',
];

export default function AIAssistantBubble() {
  const { currentAccount } = useAccount();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModelState] = useState<ModelId>(() => loadModel());
  const setModel = (next: ModelId) => {
    setModelState(next);
    try { localStorage.setItem(MODEL_STORAGE_KEY, next); } catch { /* ignore */ }
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to the bottom whenever a new chunk arrives or the user posts.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Cancel any in-flight stream when the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;
    if (!currentAccount) {
      setError('No account loaded — try again in a moment.');
      return;
    }

    setError(null);
    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setIsStreaming(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not signed in');

      // Read the URL from the build-time env var rather than digging into
      // the supabase client's private `supabaseUrl` field — that field is
      // safe in dev but can get renamed by minification in production
      // builds, leaving the fetch URL as `undefined/functions/v1/...` and
      // surfacing as a "Failed to fetch" TypeError.
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      if (!supabaseUrl) throw new Error('Supabase URL not configured');
      const url = `${supabaseUrl}/functions/v1/ai-assistant`;

      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountId: currentAccount.id,
          messages: nextMessages,
          model,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errBody.error ?? `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('No response body');

      // Parse SSE: each `data: {...}\n\n` chunk is a partial event.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on the SSE delimiter; keep any incomplete tail in the buffer.
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const line = event.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'text') {
              assistantText += payload.text;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: 'assistant', content: assistantText };
                return copy;
              });
            } else if (payload.type === 'error') {
              throw new Error(payload.error);
            }
          } catch (parseErr) {
            console.error('[AIAssistant] Failed to parse SSE chunk:', line, parseErr);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      let msg = err instanceof Error ? err.message : 'Something went wrong';
      // The browser surfaces network-level fetch failures as "Failed to fetch".
      // That happens before any HTTP response — usually because the function
      // isn't deployed, GEMINI_API_KEY isn't set, or CORS preflight failed.
      // Replace the unhelpful default with a setup-aware message.
      if (msg === 'Failed to fetch') {
        msg = "Couldn't reach the assistant service. Make sure the ai-assistant Edge Function is deployed and GEMINI_API_KEY is set in Supabase secrets.";
      }
      console.error('[AIAssistant] Request failed:', err);
      setError(msg);
      // Drop the empty assistant placeholder we optimistically added.
      setMessages((prev) => prev.filter((m, i) => !(i === prev.length - 1 && m.role === 'assistant' && !m.content)));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
    setInput('');
  };

  return (
    <>
      {/* Floating launcher bubble */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open AI assistant"
          title="Ask about your facilities"
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-xl hover:shadow-2xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 group"
        >
          <Sparkles className="w-6 h-6" />
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full ring-2 ring-white animate-pulse" />
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-40 w-[min(420px,calc(100vw-2.5rem))] h-[min(640px,calc(100vh-2.5rem))] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-600 to-blue-700 text-white flex flex-col gap-2 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm leading-tight">Survey-Route Assistant</p>
                  <p className="text-[11px] text-blue-100 leading-tight truncate">Ask about your facilities, dates, and statuses</p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {messages.length > 0 && (
                  <button
                    onClick={handleClear}
                    title="Clear conversation"
                    className="text-xs px-2 py-1 rounded hover:bg-white/15 transition-colors"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="Close assistant"
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            {/* Model selector. Segmented control matches the rest of the
                app's "small pill toggle" pattern (e.g. the SPCC mode
                toggle in the Facilities header). Disabled while a stream
                is in flight — switching mid-response would orphan the
                stream. Choice persists to localStorage. */}
            <div
              role="radiogroup"
              aria-label="AI model"
              className="inline-flex self-start rounded-lg bg-white/15 p-0.5 text-[11px]"
            >
              {MODEL_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = model === opt.id;
                return (
                  <button
                    key={opt.id}
                    role="radio"
                    aria-checked={active}
                    disabled={isStreaming}
                    onClick={() => setModel(opt.id)}
                    title={`${opt.label} — ${opt.sub}`}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      active
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-blue-100 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50 dark:bg-gray-900/50">
            {messages.length === 0 ? (
              <div className="text-center py-8">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 mb-3">
                  <MessageSquare className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">How can I help?</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 max-w-[280px] mx-auto">
                  Ask about SPCC due dates, recertifications, inspections, or any account-wide rollup.
                </p>
                <div className="space-y-1.5">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      className="block w-full text-left text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-700 dark:text-gray-200 transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-md'
                    }`}
                  >
                    {msg.content || (
                      <span className="inline-flex items-center gap-1.5 text-gray-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Thinking…
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* Composer */}
          <form onSubmit={handleSubmit} className="px-3 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder="Ask about your facilities…"
                rows={1}
                disabled={isStreaming}
                className="flex-1 resize-none px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 max-h-32"
                style={{ minHeight: '38px' }}
              />
              <button
                type="submit"
                disabled={!input.trim() || isStreaming}
                aria-label="Send message"
                className="w-[38px] h-[38px] flex-shrink-0 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
