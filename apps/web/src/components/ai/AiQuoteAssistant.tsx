import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, Send, Loader2, CheckCircle2, AlertCircle, Search, FileText, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

type EventType = 'status' | 'thinking' | 'tool' | 'tool_result' | 'done' | 'error';

interface StreamEvent {
  type: EventType;
  message?: string;
  tool?: string;
  quoteId?: string;
  quoteNumber?: string;
  data?: unknown;
}

const TOOL_LABEL: Record<string, string> = {
  search_customers: 'Searching customers',
  search_products:  'Searching products',
  create_quote:     'Creating quote',
};

const TOOL_ICON: Record<string, typeof Search> = {
  search_customers: Search,
  search_products:  Search,
  create_quote:     FileText,
};

const EXAMPLE_PROMPTS = [
  'Quote for Apex Construction — 20 sheets of 6mm HR plate 2400×1200, and 10m of 100×100×6 RHS',
  'Price up 500kg of 6061-T6 aluminium flat bar 3mm × 50mm for Pacific Steel',
  'Create a quote for BHP Billiton: 2 coils of 2mm galvanised steel, 50 linear metres of 75×50×5 RHS',
];

export function AiQuoteAssistant() {
  const [open, setOpen]         = useState(false);
  const [prompt, setPrompt]     = useState('');
  const [running, setRunning]   = useState(false);
  const [events, setEvents]     = useState<StreamEvent[]>([]);
  const [result, setResult]     = useState<{ quoteId: string; quoteNumber: string } | null>(null);
  const logRef  = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  function reset() {
    setEvents([]);
    setResult(null);
    setPrompt('');
  }

  async function submit() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setEvents([]);
    setResult(null);

    try {
      // Use fetch directly so we can stream the SSE response from a POST
      const token = useAuthStore.getState().accessToken ?? '';
      const res = await fetch('/api/v1/ai/quote-assistant', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            Authorization:   `Bearer ${token}`,
          },
          body: JSON.stringify({ prompt }),
        },
      );

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || 'Request failed');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt: StreamEvent = JSON.parse(line.slice(6));
            setEvents((prev) => [...prev, evt]);
            if (evt.type === 'done' && evt.quoteId && evt.quoteNumber) {
              setResult({ quoteId: evt.quoteId, quoteNumber: evt.quoteNumber });
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (err) {
      setEvents((prev) => [...prev, { type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }]);
    } finally {
      setRunning(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-secondary btn-sm gap-2 text-primary-700 border-primary-200 hover:bg-primary-50"
      >
        <Sparkles size={13} className="text-primary-600" />
        AI Assistant
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
              <Sparkles size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">AI Quote Assistant</p>
              <p className="text-[11px] text-muted-foreground">Describe the order in plain English</p>
            </div>
          </div>
          <button
            onClick={() => { setOpen(false); reset(); }}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col flex-1 min-h-0 px-5 py-4 gap-4">

          {/* Prompt input */}
          {!running && !result && (
            <div className="space-y-2">
              <textarea
                className="input text-sm min-h-[88px] resize-none w-full"
                placeholder="e.g. Quote for Apex Construction — 10 sheets 6mm HR plate 2400×1200 and 5m of 100×50×5 RHS"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
                autoFocus
              />
              {!prompt && (
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Try an example</p>
                  {EXAMPLE_PROMPTS.map((ex) => (
                    <button key={ex} onClick={() => setPrompt(ex)}
                      className="w-full text-left text-[11px] text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/60 rounded-md px-3 py-1.5 truncate transition-colors">
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Event log */}
          {events.length > 0 && (
            <div ref={logRef} className="flex-1 overflow-y-auto space-y-1.5 min-h-0 pr-1">
              {events.map((evt, i) => <LogEntry key={i} evt={evt} />)}
            </div>
          )}

          {/* Success result */}
          {result && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={20} className="text-green-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-900">Quote {result.quoteNumber} created</p>
                  <p className="text-xs text-green-700 mt-0.5">Saved as draft — open to review and submit</p>
                </div>
              </div>
              <button
                onClick={() => { navigate(`/sales/quotes/${result.quoteId}`); setOpen(false); reset(); }}
                className="btn-primary btn-sm shrink-0 gap-1"
              >
                Open <ArrowRight size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
          {result ? (
            <button onClick={reset} className="btn-ghost btn-sm text-muted-foreground">
              Start over
            </button>
          ) : (
            <p className="text-[11px] text-muted-foreground">⌘↵ to submit</p>
          )}
          {!result && (
            <button
              onClick={submit}
              disabled={!prompt.trim() || running}
              className="btn-primary btn-sm gap-2 min-w-[100px]"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {running ? 'Working…' : 'Create Quote'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

function LogEntry({ evt }: { evt: StreamEvent }) {
  const ToolIcon = evt.tool ? TOOL_ICON[evt.tool] ?? FileText : null;

  if (evt.type === 'error') {
    return (
      <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 rounded-md px-3 py-2">
        <AlertCircle size={13} className="shrink-0 mt-0.5" />
        <span>{evt.message}</span>
      </div>
    );
  }
  if (evt.type === 'done') {
    return (
      <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-md px-3 py-2">
        <CheckCircle2 size={13} className="shrink-0" />
        <span className="font-medium">{evt.message}</span>
      </div>
    );
  }
  if (evt.type === 'tool') {
    return (
      <div className="flex items-center gap-2 text-xs text-primary-700 bg-primary-50 rounded-md px-3 py-1.5">
        {ToolIcon && <ToolIcon size={12} className="shrink-0" />}
        <span>{TOOL_LABEL[evt.tool ?? ''] ?? evt.tool} — <span className="font-medium">{evt.message?.split(': ')[1]}</span></span>
      </div>
    );
  }
  if (evt.type === 'tool_result') {
    return (
      <div className="text-xs text-muted-foreground pl-5 pb-0.5">
        {evt.message}
      </div>
    );
  }
  if (evt.type === 'thinking') {
    return (
      <div className="text-xs text-foreground/70 italic bg-muted/30 rounded-md px-3 py-1.5 leading-relaxed">
        {evt.message}
      </div>
    );
  }
  // status
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 size={11} className="animate-spin shrink-0" />
      <span>{evt.message}</span>
    </div>
  );
}
