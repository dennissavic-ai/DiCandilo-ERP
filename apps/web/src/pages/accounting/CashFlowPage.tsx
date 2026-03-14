import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountingApi } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Plus, Trash2, TrendingUp, TrendingDown, Wallet, CheckCircle, XCircle } from 'lucide-react';

function fmtCurrency(cents: number, signed = false) {
  const abs = Math.abs(cents) / 100;
  const s = abs.toLocaleString('en-AU', { minimumFractionDigits: 2 });
  if (signed) return cents >= 0 ? `+$${s}` : `-$${s}`;
  return `$${s}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Cash Flow SVG Chart ────────────────────────────────────────────────────────

interface CashFlowPoint {
  date: string;
  label: string;
  running: number;
  inflow: number;
  outflow: number;
}

function CashFlowChart({ points }: { points: CashFlowPoint[] }) {
  if (points.length < 2) return (
    <div className="h-48 flex items-center justify-center text-sm text-steel-400">
      Set a bank balance to generate the forecast chart
    </div>
  );

  const W = 680, H = 180, PAD_L = 72, PAD_B = 32, PAD_T = 20, PAD_R = 16;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const minVal = Math.min(...points.map((p) => p.running), 0);
  const maxVal = Math.max(...points.map((p) => p.running), 0);
  const range  = Math.max(maxVal - minVal, 1);

  const today = new Date().getTime();
  const dates = points.map((p) => new Date(p.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const dateRange = Math.max(maxDate - minDate, 1);

  function cx(d: string) { return PAD_L + ((new Date(d).getTime() - minDate) / dateRange) * chartW; }
  function cy(v: number) { return PAD_T + chartH - ((v - minVal) / range) * chartH; }

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${cx(p.date)} ${cy(p.running)}`).join(' ');
  const zeroY = cy(0);

  // Today line
  const todayX = PAD_L + ((today - minDate) / dateRange) * chartW;

  const ticks = [-2, -1, 0, 1, 2].map((t) => ({
    val: minVal + ((t + 2) / 4) * range,
    y:   PAD_T + chartH - ((t + 2) / 4) * chartH,
  }));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: '480px', height: '180px' }}>
        {/* Zero line */}
        <line x1={PAD_L} y1={zeroY} x2={W - PAD_R} y2={zeroY} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 2" />

        {/* Grid + Y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={t.y} x2={W - PAD_R} y2={t.y} stroke="#f1f5f9" strokeWidth="1" />
            <text x={PAD_L - 6} y={t.y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">
              {t.val >= 0 ? `$${(t.val / 100000).toFixed(0)}K` : `-$${(-t.val / 100000).toFixed(0)}K`}
            </text>
          </g>
        ))}

        {/* Today marker */}
        {todayX >= PAD_L && todayX <= W - PAD_R && (
          <line x1={todayX} y1={PAD_T} x2={todayX} y2={H - PAD_B} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 3" />
        )}

        {/* Area fill (positive = green, negative = red) */}
        {points.length >= 2 && (
          <>
            {/* positive fill */}
            <path
              d={`${linePath} L ${cx(points[points.length - 1].date)} ${zeroY} L ${cx(points[0].date)} ${zeroY} Z`}
              fill="#22c55e"
              fillOpacity="0.08"
            />
          </>
        )}

        {/* Main line */}
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" />

        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={cx(p.date)} cy={cy(p.running)} r="3"
            fill={p.inflow > 0 ? '#22c55e' : p.outflow < 0 ? '#ef4444' : '#3b82f6'}
          />
        ))}

        {/* X-axis labels — only show a few to avoid overlap */}
        {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 6)) === 0 || i === points.length - 1).map((p, i) => (
          <text key={i} x={cx(p.date)} y={H - 6} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {fmtDate(p.date)}
          </text>
        ))}
      </svg>

      <div className="flex items-center gap-4 mt-2 px-2">
        <span className="flex items-center gap-1.5 text-xs text-steel-500"><span className="w-4 h-0.5 bg-blue-500 inline-block rounded" />Running Balance</span>
        <span className="flex items-center gap-1.5 text-xs text-steel-500"><span className="w-4 h-0.5 bg-red-400 border-dashed border inline-block" />Break-even</span>
        <span className="flex items-center gap-1.5 text-xs text-steel-500"><span className="w-4 h-0.5 bg-amber-400 border-dashed border inline-block" />Today</span>
      </div>
    </div>
  );
}

// ── Balance modal ─────────────────────────────────────────────────────────────

function SetBalanceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount]   = useState('');
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote]       = useState('Opening bank balance');
  const [msg, setMsg]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () => accountingApi.addCashFlowEntry({
      entryDate: new Date(date).toISOString(),
      type: 'OPENING_BALANCE',
      amount: Math.round(parseFloat(amount) * 100),
      description: note,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashflow'] });
      setMsg({ type: 'ok', text: 'Balance saved.' });
      setTimeout(onClose, 1200);
    },
    onError: (e: any) => setMsg({ type: 'err', text: e?.response?.data?.message ?? 'Failed to save.' }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="font-semibold text-steel-900 mb-4">Set Bank Balance</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Balance Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Bank Balance ($)</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Note</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
        </div>

        {msg && (
          <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {msg.type === 'ok' ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {msg.text}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="button" onClick={() => mutate()} disabled={isPending || !amount}
            className="btn-primary flex-1">{isPending ? 'Saving…' : 'Save Balance'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Add manual entry modal ────────────────────────────────────────────────────

function AddEntryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType]   = useState<'MANUAL_INCOME' | 'MANUAL_EXPENSE'>('MANUAL_INCOME');
  const [amount, setAmount] = useState('');
  const [date, setDate]   = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc]   = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => accountingApi.addCashFlowEntry({
      entryDate: new Date(date).toISOString(),
      type,
      amount: Math.round(parseFloat(amount) * 100),
      description: desc,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cashflow'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="font-semibold text-steel-900 mb-4">Add Manual Entry</h3>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(['MANUAL_INCOME', 'MANUAL_EXPENSE'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  type === t
                    ? t === 'MANUAL_INCOME' ? 'bg-green-600 text-white border-green-600' : 'bg-red-500 text-white border-red-500'
                    : 'border-steel-200 text-steel-600 hover:bg-steel-50'
                }`}>
                {t === 'MANUAL_INCOME' ? '+ Income' : '- Expense'}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Amount ($)</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Description</label>
            <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Payroll, Rent…"
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="button" onClick={() => mutate()} disabled={isPending || !amount}
            className="btn-primary flex-1">{isPending ? 'Saving…' : 'Add Entry'}</button>
        </div>
      </div>
    </div>
  );
}

// ── CashFlowPage ──────────────────────────────────────────────────────────────

interface CashFlowData {
  openingBalance: { amount: number; date: string } | null;
  manualEntries: { id: string; entryDate: string; type: string; amount: number; description?: string }[];
  arInvoices: { id: string; invoiceNumber: string; dueDate: string; amount: number; customer?: string; status: string }[];
  apInvoices: { id: string; invoiceNumber: string; dueDate: string; amount: number; supplier?: string; status: string }[];
}

export function CashFlowPage() {
  const qc = useQueryClient();
  const [showBalance, setShowBalance] = useState(false);
  const [showEntry, setShowEntry]     = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['cashflow'],
    queryFn: () => accountingApi.getCashFlow().then((r) => r.data as { data: CashFlowData }),
  });

  const { mutate: deleteEntry } = useMutation({
    mutationFn: (id: string) => accountingApi.deleteCashFlowEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cashflow'] }),
  });

  const d = data?.data;

  // Build forecast points: start from opening balance, layer AR/AP/manual by date
  const forecastPoints: CashFlowPoint[] = [];
  if (d) {
    type Event = { date: string; amount: number; label: string };
    const events: Event[] = [];

    if (d.openingBalance) {
      events.push({ date: d.openingBalance.date, amount: d.openingBalance.amount, label: 'Opening Balance' });
    }
    for (const e of d.manualEntries) {
      events.push({ date: e.entryDate, amount: e.amount, label: e.description ?? e.type });
    }
    for (const inv of d.arInvoices) {
      events.push({ date: inv.dueDate, amount: inv.amount, label: `AR: ${inv.invoiceNumber}` });
    }
    for (const inv of d.apInvoices) {
      events.push({ date: inv.dueDate, amount: inv.amount, label: `AP: ${inv.invoiceNumber}` });
    }

    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    for (const e of events) {
      running += e.amount;
      forecastPoints.push({
        date: e.date,
        label: e.label,
        running,
        inflow: e.amount > 0 ? e.amount : 0,
        outflow: e.amount < 0 ? e.amount : 0,
      });
    }
  }

  const runningBalance = forecastPoints.length > 0 ? forecastPoints[forecastPoints.length - 1].running : null;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Cash Flow Forecast"
        subtitle="Bank balance + AR/AP due dates + manual adjustments"
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowBalance(true)} className="btn-secondary btn-sm flex items-center gap-1.5">
              <Wallet size={13} /> Set Bank Balance
            </button>
            <button type="button" onClick={() => setShowEntry(true)} className="btn-primary btn-sm flex items-center gap-1.5">
              <Plus size={13} /> Add Entry
            </button>
          </div>
        }
      />

      {showBalance && <SetBalanceModal onClose={() => setShowBalance(false)} />}
      {showEntry   && <AddEntryModal   onClose={() => setShowEntry(false)} />}

      {/* Summary stats */}
      {!isLoading && d && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <div className="card card-body flex items-center gap-3">
            <Wallet size={18} className="text-blue-600" />
            <div>
              <div className="text-base font-bold text-steel-900">
                {d.openingBalance ? fmtCurrency(d.openingBalance.amount) : '—'}
              </div>
              <div className="text-xs text-steel-400">
                {d.openingBalance ? `Balance at ${fmtDate(d.openingBalance.date)}` : 'No balance set'}
              </div>
            </div>
          </div>
          <div className="card card-body flex items-center gap-3">
            <TrendingUp size={18} className="text-green-600" />
            <div>
              <div className="text-base font-bold text-green-700">
                +{fmtCurrency(d.arInvoices.reduce((s, i) => s + i.amount, 0))}
              </div>
              <div className="text-xs text-steel-400">{d.arInvoices.length} AR invoices due</div>
            </div>
          </div>
          <div className="card card-body flex items-center gap-3">
            <TrendingDown size={18} className="text-red-500" />
            <div>
              <div className="text-base font-bold text-red-600">
                {fmtCurrency(d.apInvoices.reduce((s, i) => s + i.amount, 0), true)}
              </div>
              <div className="text-xs text-steel-400">{d.apInvoices.length} AP invoices due</div>
            </div>
          </div>
        </div>
      )}

      {/* Forecast chart */}
      <div className="card mb-5">
        <div className="card-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-steel-500" />
            <h3 className="font-semibold">Rolling Cash Position</h3>
          </div>
          {runningBalance != null && (
            <span className={`text-sm font-bold ${runningBalance >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              Forecast: {fmtCurrency(runningBalance, true)}
            </span>
          )}
        </div>
        <div className="card-body">
          {isLoading
            ? <div className="h-48 skeleton rounded" />
            : <CashFlowChart points={forecastPoints} />
          }
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* AR invoices */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <TrendingUp size={14} className="text-green-600" />
            <h3 className="font-semibold text-sm">Incoming — AR Due</h3>
          </div>
          <div className="card-body p-0">
            <table className="table text-xs">
              <thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {isLoading ? Array.from({length:4}).map((_,i) => <tr key={i}><td colSpan={4}><div className="skeleton h-4 m-1" /></td></tr>)
                  : (d?.arInvoices ?? []).map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-mono font-semibold text-primary-700">{inv.invoiceNumber}</td>
                      <td className="text-steel-700 truncate max-w-[120px]">{inv.customer}</td>
                      <td className="text-steel-500">{fmtDate(inv.dueDate)}</td>
                      <td className="text-right font-mono font-semibold text-green-700">+{fmtCurrency(inv.amount)}</td>
                    </tr>
                  ))}
                {!isLoading && !d?.arInvoices?.length && <tr><td colSpan={4} className="text-center py-4 text-steel-300">No AR invoices</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* AP + manual */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <TrendingDown size={14} className="text-red-500" />
            <h3 className="font-semibold text-sm">Outgoing — AP Due + Manual</h3>
            <button type="button" onClick={() => setShowEntry(true)} className="ml-auto text-xs text-primary-600 hover:underline">+ Add</button>
          </div>
          <div className="card-body p-0">
            <table className="table text-xs">
              <thead><tr><th>Description</th><th>Date</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>
                {isLoading ? Array.from({length:4}).map((_,i) => <tr key={i}><td colSpan={4}><div className="skeleton h-4 m-1" /></td></tr>)
                  : [
                      ...(d?.apInvoices ?? []).map((inv) => ({
                        id: inv.id, desc: `${inv.invoiceNumber} — ${inv.supplier}`,
                        date: inv.dueDate, amount: inv.amount, manual: false,
                      })),
                      ...(d?.manualEntries ?? [])
                        .filter((e) => e.type !== 'OPENING_BALANCE')
                        .map((e) => ({
                          id: e.id, desc: e.description ?? e.type,
                          date: e.entryDate, amount: e.amount, manual: true,
                        })),
                    ]
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map((row) => (
                      <tr key={row.id}>
                        <td className="text-steel-700 truncate max-w-[140px]">{row.desc}</td>
                        <td className="text-steel-500">{fmtDate(row.date)}</td>
                        <td className={`text-right font-mono font-semibold ${row.amount >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {fmtCurrency(row.amount, true)}
                        </td>
                        <td>
                          {row.manual && (
                            <button type="button" onClick={() => deleteEntry(row.id)} className="text-steel-300 hover:text-red-500 transition-colors">
                              <Trash2 size={11} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                }
                {!isLoading && !(d?.apInvoices?.length) && !(d?.manualEntries?.filter(e => e.type !== 'OPENING_BALANCE').length) && (
                  <tr><td colSpan={4} className="text-center py-4 text-steel-300">No outgoing items</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
