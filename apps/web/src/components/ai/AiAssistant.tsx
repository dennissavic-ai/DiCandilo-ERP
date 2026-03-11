import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, X, Send, Loader2, ChevronDown,
  Search, BarChart2, FileText, Package, AlertCircle, Plus,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolActivity {
  tool: string;
  callMsg: string;
  resultMsg?: string;
}

interface ChatAction {
  action: string;
  label: string;
  path: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolActivity: ToolActivity[];
  actions: ChatAction[];
  isError?: boolean;
}

type SseEvent =
  | { type: 'tool';        tool: string; message: string }
  | { type: 'tool_result'; tool: string; message: string }
  | { type: 'action';      action: string; data: Record<string, string>; message: string }
  | { type: 'done';        text: string }
  | { type: 'error';       message: string };

// ── Action helpers ─────────────────────────────────────────────────────────────

function actionToCard(action: string, data: Record<string, string>): ChatAction | null {
  if (action === 'quote_created')
    return { action, label: `Open Quote ${data.quoteNumber}`, path: `/sales/quotes/${data.quoteId}` };
  if (action === 'so_created')
    return { action, label: `Open Order ${data.orderNumber}`, path: `/sales/orders/${data.orderId}` };
  return null;
}

// ── Tool icon ─────────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ElementType> = {
  search_customers:     Search,
  get_customer_summary: Search,
  search_products:      Package,
  check_stock:          Package,
  search_quotes:        FileText,
  search_sales_orders:  FileText,
  list_overdue_invoices:AlertCircle,
  get_business_snapshot:BarChart2,
  create_quote:         Plus,
};

// ── Starter suggestions ───────────────────────────────────────────────────────

const STARTERS = [
  'What quotes are open right now?',
  'Show me overdue invoices',
  'Check stock for 6mm HR plate',
  "What's the AR balance for Apex Construction?",
];

// ── Component ─────────────────────────────────────────────────────────────────

export function AiAssistant() {
  const [open,    setOpen]    = useState(false);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Streaming state — tool activity accumulating for the current turn
  const [activity,  setActivity]  = useState<ToolActivity[]>([]);
  const [pendingActions, setPendingActions] = useState<ChatAction[]>([]);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const navigate   = useNavigate();

  // Scroll to bottom whenever messages or activity change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activity, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput('');

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: 'user', text: trimmed,
      toolActivity: [], actions: [],
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setActivity([]);
    setPendingActions([]);

    // Build full history to send (user + assistant text only)
    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.text }));

    let streamActivity: ToolActivity[] = [];
    let streamActions:  ChatAction[]   = [];
    let finalText = '';

    try {
      const token = useAuthStore.getState().accessToken ?? '';
      const res = await fetch('/api/v1/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) throw new Error(await res.text() || 'Request failed');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt: SseEvent;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === 'tool') {
            streamActivity = [...streamActivity, { tool: evt.tool, callMsg: evt.message }];
            setActivity([...streamActivity]);
          } else if (evt.type === 'tool_result') {
            streamActivity = streamActivity.map((a, i) =>
              i === streamActivity.length - 1 ? { ...a, resultMsg: evt.message } : a,
            );
            setActivity([...streamActivity]);
          } else if (evt.type === 'action') {
            const card = actionToCard(evt.action, evt.data);
            if (card) { streamActions = [...streamActions, card]; setPendingActions([...streamActions]); }
          } else if (evt.type === 'done') {
            finalText = evt.text || '';
          } else if (evt.type === 'error') {
            throw new Error(evt.message);
          }
        }
      }

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: finalText || '(no response)',
          toolActivity: streamActivity, actions: streamActions },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant',
          text: err instanceof Error ? err.message : 'Something went wrong.',
          toolActivity: streamActivity, actions: [], isError: true },
      ]);
    } finally {
      setLoading(false);
      setActivity([]);
      setPendingActions([]);
    }
  }, [loading, messages]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-xl
          text-sm font-semibold text-white transition-all duration-200
          bg-gradient-to-br from-primary-600 to-primary-800 hover:from-primary-500 hover:to-primary-700
          ${open ? 'opacity-0 pointer-events-none scale-90' : 'opacity-100 scale-100'}`}
      >
        <Sparkles size={15} />
        Ask AI
      </button>

      {/* Chat panel */}
      <div className={`fixed bottom-6 right-6 z-50 flex flex-col w-[380px] rounded-2xl shadow-2xl border border-border bg-background
        transition-all duration-300 origin-bottom-right
        ${open ? 'opacity-100 scale-100 h-[560px]' : 'opacity-0 scale-90 h-0 pointer-events-none'}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border rounded-t-2xl
          bg-gradient-to-r from-primary-700 to-primary-900">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
              <Sparkles size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-none">ERP Assistant</p>
              <p className="text-[10px] text-primary-200 mt-0.5">Powered by Claude</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button onClick={() => setMessages([])}
                className="text-white/60 hover:text-white text-[10px] px-2 py-1 rounded hover:bg-white/10 transition-colors">
                Clear
              </button>
            )}
            <button onClick={() => setOpen(false)}
              className="text-white/60 hover:text-white p-1 rounded hover:bg-white/10 transition-colors">
              <ChevronDown size={16} />
            </button>
          </div>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
          {messages.length === 0 && !loading && (
            <div className="space-y-3 pt-2">
              <p className="text-xs text-muted-foreground text-center">
                Ask me anything about your business, or take action.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="text-left text-[11px] text-foreground/70 hover:text-foreground
                      bg-muted/40 hover:bg-muted/80 rounded-lg px-3 py-2 transition-colors leading-snug">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {/* Tool activity pills (assistant only) */}
              {msg.role === 'assistant' && msg.toolActivity.length > 0 && (
                <div className="w-full space-y-1 mb-1">
                  {msg.toolActivity.map((a, i) => (
                    <ToolPill key={i} activity={a} />
                  ))}
                </div>
              )}

              {/* Bubble */}
              <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                ${msg.role === 'user'
                  ? 'bg-primary-700 text-white rounded-br-sm'
                  : msg.isError
                    ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
                    : 'bg-muted/50 text-foreground rounded-bl-sm border border-border'}`}>
                <MessageText text={msg.text} />
              </div>

              {/* Action buttons */}
              {msg.actions.map((act) => (
                <button key={act.path}
                  onClick={() => { navigate(act.path); setOpen(false); }}
                  className="text-[11px] font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100
                    border border-primary-200 rounded-full px-3 py-1 transition-colors flex items-center gap-1.5">
                  <FileText size={10} />
                  {act.label}
                </button>
              ))}
            </div>
          ))}

          {/* Streaming state */}
          {loading && (
            <div className="flex flex-col items-start gap-1.5">
              {activity.length > 0 && (
                <div className="w-full space-y-1 mb-1">
                  {activity.map((a, i) => <ToolPill key={i} activity={a} />)}
                </div>
              )}
              {pendingActions.map((act) => (
                <button key={act.path}
                  onClick={() => { navigate(act.path); setOpen(false); }}
                  className="text-[11px] font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100
                    border border-primary-200 rounded-full px-3 py-1 transition-colors flex items-center gap-1.5">
                  <FileText size={10} />
                  {act.label}
                </button>
              ))}
              <div className="bg-muted/50 border border-border rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2">
                <Loader2 size={13} className="animate-spin text-primary-600" />
                <span className="text-xs text-muted-foreground">Thinking…</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border px-3 py-2.5 flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground
              resize-none outline-none py-1.5 max-h-32 overflow-y-auto leading-snug"
            placeholder="Message ERP Assistant…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="shrink-0 w-8 h-8 rounded-full bg-primary-700 hover:bg-primary-600
              disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            {loading
              ? <Loader2 size={13} className="animate-spin text-white" />
              : <Send size={13} className="text-white" />}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ToolPill({ activity }: { activity: ToolActivity }) {
  const Icon = TOOL_ICONS[activity.tool] ?? Search;
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-primary-700 bg-primary-50/80 rounded-lg px-2.5 py-1">
      <Icon size={10} className="shrink-0" />
      <span className="truncate">{activity.callMsg}</span>
      {activity.resultMsg && (
        <span className="text-primary-400 shrink-0">· {activity.resultMsg}</span>
      )}
    </div>
  );
}

function MessageText({ text }: { text: string }) {
  // Render newlines as line breaks
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i}>{line}{i < text.split('\n').length - 1 && <br />}</span>
      ))}
    </>
  );
}
