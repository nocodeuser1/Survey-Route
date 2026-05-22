import { useState, useRef, useEffect, useMemo } from 'react';
import { MessageSquare, X, Send, Loader2, Sparkles, Zap, Brain, Edit2, History } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';
import { supabase, Facility } from '../lib/supabase';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

/**
 * Persisted session — a snapshot of a previous conversation the user can
 * pick back up. Stored in localStorage; we keep at most HISTORY_MAX of them.
 */
interface ChatSession {
  id: string;
  savedAt: number;
  title: string;
  messages: ChatMessage[];
}

const HISTORY_KEY = 'ai-assistant-history-v1';
const HISTORY_MAX = 2;

function loadHistory(): ChatSession[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s: any) =>
          s &&
          typeof s.id === 'string' &&
          typeof s.savedAt === 'number' &&
          typeof s.title === 'string' &&
          Array.isArray(s.messages),
      )
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(history: ChatSession[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)));
  } catch {
    /* ignore quota errors */
  }
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (firstUser?.content) {
    const trimmed = firstUser.content.trim();
    return trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
  }
  return 'Chat';
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  return `${days}d ago`;
}

const SUGGESTED_PROMPTS = [
  'How many SPCC plans are due this year?',
  'Which facilities are overdue for an annual inspection?',
  'What facilities have no PE stamp date yet?',
  'Show me facilities due for 5-year recertification in the next 90 days.',
];

interface AIAssistantBubbleProps {
  /** Account's facilities — used to linkify bold mentions in AI replies. */
  facilities?: Facility[];
  /** Called when the user clicks a linkified facility mention. */
  onOpenFacility?: (facility: Facility) => void;
  /** When true, the bubble's window-level Escape handler no-ops. The parent
   *  uses this when a top-level modal owned by the AI flow (e.g. the
   *  facility-detail modal opened by clicking a linkified mention) is
   *  visible — Esc should close the modal in front, not the bubble behind. */
  escapeDisabled?: boolean;
}

const PANEL_WIDTH_KEY = 'ai-assistant-panel-width';
const PANEL_WIDTH_MIN = 320;
const PANEL_WIDTH_MAX = 900;
const PANEL_WIDTH_DEFAULT = 420;

function loadPanelWidth(): number {
  try {
    const raw = localStorage.getItem(PANEL_WIDTH_KEY);
    if (!raw) return PANEL_WIDTH_DEFAULT;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return PANEL_WIDTH_DEFAULT;
    return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, n));
  } catch {
    return PANEL_WIDTH_DEFAULT;
  }
}

export default function AIAssistantBubble({
  facilities = [],
  onOpenFacility,
  escapeDisabled = false,
}: AIAssistantBubbleProps = {}) {
  const { currentAccount } = useAccount();

  // Lower-cased name → facility lookup for fast linkification of bold mentions
  // in assistant messages. Covers facility.name plus matched_facility_name
  // (the alias used by some legacy / Camino-imported rows).
  const facilityByName = useMemo(() => {
    const map = new Map<string, Facility>();
    for (const f of facilities) {
      if (f.name) map.set(f.name.trim().toLowerCase(), f);
      if (f.matched_facility_name) {
        const alias = f.matched_facility_name.trim().toLowerCase();
        if (alias && !map.has(alias)) map.set(alias, f);
      }
    }
    return map;
  }, [facilities]);
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

  // Persisted panel width (px). User drags the left-edge handle to resize.
  const [panelWidth, setPanelWidth] = useState<number>(() => loadPanelWidth());
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  function onResizeDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeStartRef.current = { startX: e.clientX, startWidth: panelWidth };
  }
  function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizeStartRef.current) return;
    // Dragging LEFT grows the panel (the panel is anchored to bottom-right).
    const delta = resizeStartRef.current.startX - e.clientX;
    const next = Math.max(
      PANEL_WIDTH_MIN,
      Math.min(PANEL_WIDTH_MAX, resizeStartRef.current.startWidth + delta),
    );
    setPanelWidth(next);
  }
  function onResizeUp() {
    if (!resizeStartRef.current) return;
    resizeStartRef.current = null;
    try { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth)); } catch { /* ignore */ }
  }

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

  // Escape minimizes the panel. Registered globally (window-level) so
  // it works no matter where focus is — input field, message body, or
  // an unfocused panel. Only listens while the bubble is open so we
  // don't intercept Escape for the rest of the app (modals, dropdowns,
  // etc. have their own Escape handling).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Skip when a child modal is in front (e.g. the AI-opened facility
      // detail modal). Esc belongs to that modal first; the bubble should
      // only close when it's the topmost element on screen.
      if (escapeDisabled) return;
      e.stopPropagation();
      setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, escapeDisabled]);

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

    // Hoisted so the catch can tell apart user-cancel (silent) from
    // the watchdog timeout (show message) — both surface as AbortError
    // and only this flag distinguishes them.
    let didTimeOut = false;

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

      // Hard-cap the round trip so a true upstream hang surfaces as a
      // clean error instead of letting the user stare at "Thinking…"
      // forever. 75s comfortably covers Pro reasoning over a
      // multi-hundred-facility snapshot; Flash should land in well
      // under 10s. We distinguish a timeout abort from a user-cancel
      // abort via the hoisted `didTimeOut` flag so the catch handler
      // can render the appropriate message.
      const timeoutId = window.setTimeout(() => {
        didTimeOut = true;
        controller.abort();
      }, 75_000);

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
        clearTimeout(timeoutId);
        throw new Error(errBody.error ?? `HTTP ${response.status}`);
      }
      if (!response.body) {
        clearTimeout(timeoutId);
        throw new Error('No response body');
      }

      // Parse SSE: each `data: {...}\n\n` chunk is a partial event.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      // Capture any structured error event emitted by the server. Don't
      // throw inside the chunk loop — the inner try-catch around
      // JSON.parse would swallow it. Surface AFTER the stream completes
      // so partial text up to the error point still renders.
      let serverError: string | null = null;

      try {
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
            let payload: { type?: string; text?: string; error?: string };
            try {
              payload = JSON.parse(line.slice(6));
            } catch (parseErr) {
              console.error('[AIAssistant] Failed to parse SSE chunk:', line, parseErr);
              continue;
            }
            if (payload.type === 'text' && payload.text) {
              assistantText += payload.text;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: 'assistant', content: assistantText };
                return copy;
              });
            } else if (payload.type === 'error') {
              serverError = payload.error ?? 'Assistant returned an error';
            }
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }

      if (serverError) throw new Error(serverError);
      if (!assistantText) {
        throw new Error('The assistant returned no response. Please try again or switch models.');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (!didTimeOut) return; // user cancelled via X — silent
        // Fall through with a timeout message so the user sees why.
        err = new Error('The assistant timed out after 75s. Try again — Flash should be much faster.');
      }
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

  // ─── Session history ───────────────────────────────────────────────────
  // Up to HISTORY_MAX previous conversations live in localStorage so the
  // user can pop back to them after starting a new chat. handleClear and
  // loadSession both archive the current chat (if non-empty) before
  // discarding/replacing it.
  const [history, setHistory] = useState<ChatSession[]>(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);

  // Close the history dropdown on outside click.
  useEffect(() => {
    if (!showHistory) return;
    const onClick = (e: MouseEvent) => {
      if (!historyMenuRef.current?.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    // Defer one tick so the click that opened it doesn't immediately close it.
    const id = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onClick);
    };
  }, [showHistory]);

  const archiveCurrentToHistory = (): ChatSession[] => {
    if (messages.length === 0) return history;
    const session: ChatSession = {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      savedAt: Date.now(),
      title: deriveTitle(messages),
      messages,
    };
    const next = [session, ...history].slice(0, HISTORY_MAX);
    setHistory(next);
    saveHistory(next);
    return next;
  };

  const loadSession = (sessionId: string) => {
    const target = history.find((s) => s.id === sessionId);
    if (!target) return;
    // Archive current first so it's not lost when we replace it.
    const archived = archiveCurrentToHistory();
    // Drop the loaded session from history — it's now the active chat.
    const next = archived.filter((s) => s.id !== sessionId);
    setHistory(next);
    saveHistory(next);
    setMessages(target.messages);
    setError(null);
    setInput('');
    setShowHistory(false);
  };

  const handleClear = () => {
    archiveCurrentToHistory();
    setMessages([]);
    setError(null);
    setInput('');
  };

  /**
   * "Edit + fork from here" for user prompts. Pops the chosen message
   * back into the composer, truncates the conversation at that point
   * (drops the message itself plus everything after — including the
   * assistant's reply to it), and focuses the input. Hitting Send
   * then re-runs from that exact point with the edited prompt,
   * effectively forking the conversation without losing the earlier
   * turns. Disabled while a stream is in flight so we don't shred
   * state mid-response.
   */
  const editAndForkFrom = (messageIndex: number) => {
    if (isStreaming) return;
    const target = messages[messageIndex];
    if (!target || target.role !== 'user') return;
    setMessages(messages.slice(0, messageIndex));
    setInput(target.content);
    setError(null);
    // setTimeout so the new value is in the DOM before focusing,
    // otherwise the cursor lands at position 0 on some browsers.
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(target.content.length, target.content.length);
    }, 0);
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
        <div
          className="fixed bottom-5 right-5 z-40 h-[min(640px,calc(100vh-2.5rem))] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]"
          style={{ width: `min(${panelWidth}px, calc(100vw - 2.5rem))` }}
        >
          {/* Left-edge resize handle. Drag to expand the panel toward the
              left; cursor flips to ew-resize on hover so it's discoverable.
              Width persisted to localStorage on release. */}
          <div
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors z-10"
            title="Drag to resize"
            aria-label="Resize AI assistant panel"
          />

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
                {history.length > 0 && (
                  <div className="relative" ref={historyMenuRef}>
                    <button
                      onClick={() => setShowHistory((v) => !v)}
                      title={`${history.length} saved chat${history.length === 1 ? '' : 's'}`}
                      className="text-xs px-2 py-1 rounded hover:bg-white/15 transition-colors inline-flex items-center gap-1"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">History</span>
                      <span className="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-white/20 text-[10px] font-semibold">
                        {history.length}
                      </span>
                    </button>
                    {showHistory && (
                      <div className="absolute right-0 mt-1 w-72 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-20 overflow-hidden">
                        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          Previous chats
                        </div>
                        <ul className="max-h-72 overflow-y-auto">
                          {history.map((s) => (
                            <li key={s.id}>
                              <button
                                onClick={() => loadSession(s.id)}
                                className="w-full px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex flex-col gap-0.5"
                              >
                                <span className="text-sm font-medium truncate">{s.title}</span>
                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                  {formatRelativeTime(s.savedAt)} · {s.messages.length} message{s.messages.length === 1 ? '' : 's'}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <p className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700">
                          Loading a chat archives the current one (kept up to {HISTORY_MAX} total).
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {messages.length > 0 && (
                  <button
                    onClick={handleClear}
                    title="Save current chat to history and start a new one"
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
                  className={`group flex items-center gap-1.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {/* Edit-and-fork affordance for past user prompts.
                      Sits left of the bubble (since user messages are
                      right-aligned), hidden until row-hover so it
                      doesn't crowd the conversation. Clicking pops
                      the prompt back into the composer and truncates
                      the conversation at that point — see
                      editAndForkFrom. */}
                  {msg.role === 'user' && msg.content && (
                    <button
                      type="button"
                      onClick={() => editAndForkFrom(i)}
                      disabled={isStreaming}
                      title="Edit and resend from here (forks the conversation)"
                      aria-label="Edit this prompt and resend"
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <div
                    className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-md whitespace-pre-wrap'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-md'
                    }`}
                  >
                    {msg.content ? (
                      msg.role === 'assistant' ? (
                        <AIMarkdown
                          source={msg.content}
                          facilityByName={facilityByName}
                          onOpenFacility={onOpenFacility}
                        />
                      ) : (
                        msg.content
                      )
                    ) : (
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

/* ────────────────────────────────────────────────────────────────────────
 * Markdown renderer for assistant replies.
 *
 * Renders GFM-flavored markdown with Tailwind classes tuned to the chat
 * bubble's typography (compact spacing, readable line height, theme-aware
 * colors). The `strong` component is overridden: if the bolded text matches
 * one of the user's facilities by name (case-insensitive), it's rendered
 * as a clickable pill that opens the facility detail modal via the
 * parent-provided onOpenFacility callback. Bold text that doesn't match a
 * known facility renders as plain emphasized text.
 * ──────────────────────────────────────────────────────────────────────── */
interface AIMarkdownProps {
  source: string;
  facilityByName: Map<string, Facility>;
  onOpenFacility?: (facility: Facility) => void;
}

function AIMarkdown({ source, facilityByName, onOpenFacility }: AIMarkdownProps) {
  // Flatten React children to a plain string so we can do a case-insensitive
  // lookup against the facility name map.
  const childrenToString = (children: unknown): string => {
    if (typeof children === 'string') return children;
    if (typeof children === 'number') return String(children);
    if (Array.isArray(children)) return children.map(childrenToString).join('');
    if (children && typeof children === 'object' && 'props' in (children as any)) {
      return childrenToString((children as any).props.children);
    }
    return '';
  };

  return (
    <div className="ai-markdown space-y-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Paragraphs — keep them tight inside the bubble
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,

          // Bold — linkify to facility detail when text matches a facility name.
          // Rendered as a plain inline <span role="button"> rather than a real
          // <button>: native <button>s don't word-wrap their content cleanly,
          // and inline-flex was forcing a block break before (Due: …) AND
          // center-aligning the wrapped second line. A span wraps naturally
          // with the surrounding markdown text.
          strong: ({ children }) => {
            const text = childrenToString(children).trim();
            const match = facilityByName.get(text.toLowerCase());
            if (match && onOpenFacility) {
              return (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenFacility(match)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenFacility(match);
                    }
                  }}
                  className="font-semibold text-blue-600 dark:text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 hover:decoration-blue-500 transition-colors cursor-pointer"
                  title={`Open ${match.name}`}
                >
                  {children}
                </span>
              );
            }
            return <strong className="font-semibold text-gray-900 dark:text-white">{children}</strong>;
          },

          // Italic
          em: ({ children }) => <em className="italic">{children}</em>,

          // Lists — themed bullets/numbers, tighter spacing than the default
          ul: ({ children }) => (
            <ul className="list-disc list-outside pl-5 space-y-1 marker:text-gray-400 dark:marker:text-gray-500">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside pl-5 space-y-1 marker:text-gray-400 dark:marker:text-gray-500">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            // [&>p]:my-0 keeps tight spacing inside list items when the AI
            // emits a "loose" markdown list (blank lines between items) —
            // CommonMark wraps each item's content in <p> tags, and the
            // browser's default 1em paragraph margin makes single bullet
            // lines look like they have two line breaks of padding.
            <li className="leading-relaxed [&>p]:my-0">{children}</li>
          ),

          // Headings — keep them small inside the bubble so they don't dwarf the body
          h1: ({ children }) => <h3 className="text-base font-bold text-gray-900 dark:text-white mt-3 mb-1">{children}</h3>,
          h2: ({ children }) => <h4 className="text-sm font-bold text-gray-900 dark:text-white mt-3 mb-1">{children}</h4>,
          h3: ({ children }) => <h5 className="text-sm font-semibold text-gray-900 dark:text-white mt-2 mb-1">{children}</h5>,
          h4: ({ children }) => <h6 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mt-2 mb-1">{children}</h6>,

          // Inline + block code
          code: ({ inline, children, ...rest }: any) =>
            inline ? (
              <code
                {...rest}
                className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-[0.8em] font-mono"
              >
                {children}
              </code>
            ) : (
              <code {...rest} className="block text-xs font-mono whitespace-pre">
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-gray-100 dark:bg-gray-900 p-3 text-xs leading-snug border border-gray-200 dark:border-gray-700">
              {children}
            </pre>
          ),

          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-blue-300 dark:border-blue-600 pl-3 italic text-gray-600 dark:text-gray-300">
              {children}
            </blockquote>
          ),

          // Links — open in new tab, themed underline
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 underline decoration-blue-400/40 hover:decoration-blue-500"
            >
              {children}
            </a>
          ),

          // Tables — basic styling so anything Claude formats as a table reads cleanly
          table: ({ children }) => (
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200">{children}</thead>
          ),
          th: ({ children }) => <th className="px-2 py-1.5 text-left font-semibold border-b border-gray-200 dark:border-gray-700">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1.5 border-b border-gray-100 dark:border-gray-700/50">{children}</td>,

          // Horizontal rule
          hr: () => <hr className="border-gray-200 dark:border-gray-700 my-2" />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
