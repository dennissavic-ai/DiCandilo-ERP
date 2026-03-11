import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi, type SalesQuote, type Product } from '../../services/api';
import { Plus, Search, ClipboardList, ArrowRight, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { ProductSearchCombobox } from '../../components/ui/ProductSearchCombobox';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'badge-gray',
  SENT:      'badge-blue',
  ACCEPTED:  'badge-green',
  DECLINED:  'badge-red',
  EXPIRED:   'badge-orange',
  CONVERTED: 'badge-violet',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT:     'Draft',
  SENT:      'Pending Approval',
  ACCEPTED:  'Approved',
  DECLINED:  'Declined',
  EXPIRED:   'Expired',
  CONVERTED: 'Converted',
};

const CURRENCIES = ['AUD', 'USD', 'NZD', 'EUR', 'GBP', 'SGD', 'JPY', 'CAD'];
const UOMS       = ['EA', 'KG', 'T', 'M', 'LM', 'M2', 'M3', 'PC', 'SET', 'L', 'SHT', 'COIL'];

function fmtCurrency(cents: number, code = 'AUD') {
  const d = cents / 100;
  if (d >= 1_000_000) return `${code} $${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000)     return `${code} $${(d / 1_000).toFixed(0)}K`;
  return `${code} $${d.toFixed(2)}`;
}

function toDateTimeStr(dateStr: string) {
  return dateStr ? `${dateStr}T00:00:00.000Z` : undefined;
}

const todayStr      = new Date().toISOString().split('T')[0];
const validUntilStr = addDays(new Date(), 30).toISOString().split('T')[0];

interface DraftLine {
  _key: number;
  _product?: Product | null;  // UI state for combobox
  _priceStr?: string;         // raw string while unit price is being edited
  productId?: string;
  description: string;
  uom: string;
  qty: number;
  unitPrice: number; // cents
  discountPct: number;
}

let _lineKey = 0;
function blankLine(): DraftLine {
  return { _key: ++_lineKey, description: '', uom: 'EA', qty: 1, unitPrice: 0, discountPct: 0 };
}

function lineTotal(l: DraftLine) {
  return Math.round(l.qty * l.unitPrice * (1 - l.discountPct / 100));
}

// ── Create Quote Modal ──────────────────────────────────────────────────────

function CreateQuoteModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [customerId, setCustomerId] = useState('');
  const [quoteDate,  setQuoteDate]  = useState(todayStr);
  const [validUntil, setValidUntil] = useState(validUntilStr);
  const [currency,   setCurrency]   = useState('AUD');
  const [discount,   setDiscount]   = useState(0);   // flat cents
  const [taxPct,     setTaxPct]     = useState(10);  // percent, e.g. 10 = GST
  const [notes,      setNotes]      = useState('');
  const [terms,      setTerms]      = useState('');
  const [lines,      setLines]      = useState<DraftLine[]>([blankLine()]);
  const [error,      setError]      = useState('');

  // Product picker state per row
  const [prodSearch, setProdSearch] = useState('');

  const { data: customersData } = useQuery({
    queryKey: ['customers-dd'],
    queryFn: () => salesApi.listCustomers({ limit: 500 }).then((r) => r.data),
  });

  const customers: any[] = customersData?.data ?? [];

  const subtotal    = lines.reduce((s, l) => s + lineTotal(l), 0);
  const taxAmount   = Math.round(subtotal * taxPct / 100);
  const grandTotal  = subtotal - discount + taxAmount;

  function addLine() { setLines((ls) => [...ls, blankLine()]); }
  function removeLine(key: number) {
    setLines((ls) => ls.length === 1 ? ls : ls.filter((l) => l._key !== key));
  }
  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => l._key === key ? { ...l, ...patch } : l));
  }
  function pickProduct(key: number, p: Product | null) {
    if (!p) {
      updateLine(key, { _product: null, productId: undefined });
      return;
    }
    updateLine(key, {
      _product: p,
      productId: p.id,
      description: p.description ?? '',
      uom: p.uom ?? 'EA',
      unitPrice: p.listPrice ?? 0,
    });
  }

  const { mutate, isPending } = useMutation({
    mutationFn: (payload: object) => salesApi.createQuote(payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      onClose();
      navigate(`/sales/quotes/${(res.data as any).id}`);
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? err?.message ?? 'Failed to create quote');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!customerId) { setError('Please select a customer.'); return; }
    if (lines.some((l) => !l.description.trim())) { setError('All line items need a description.'); return; }

    mutate({
      customerId,
      validUntil: toDateTimeStr(validUntil),
      currencyCode: currency,
      discountAmount: discount,
      taxAmount,
      terms: terms || undefined,
      notes:  notes  || undefined,
      lines: lines.map((l) => ({
        productId:   l.productId,
        description: l.description,
        uom:         l.uom,
        qty:         l.qty,
        unitPrice:   l.unitPrice,
        discountPct: l.discountPct,
      })),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">New Quote</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* ── Header fields ── */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="form-label">Customer <span className="text-red-500">*</span></label>
                <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)} autoFocus>
                  <option value="">Select customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Quote Date</label>
                <input type="date" className="input" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Valid Until</label>
                <input type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Currency</label>
                <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Payment Terms</label>
                <select className="input" value={terms} onChange={(e) => setTerms(e.target.value)}>
                  <option value="">Select…</option>
                  {['Net 7', 'Net 14', 'Net 30', 'Net 60', 'COD', 'Prepaid', 'EOM'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Line Items ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Line Items</span>
                <button type="button" className="btn-secondary btn-sm" onClick={addLine}>
                  <Plus size={12} /> Add Line
                </button>
              </div>

              {/* Header row */}
              <div className="grid text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 pb-1"
                style={{ gridTemplateColumns: '1fr 72px 96px 108px 72px 96px 32px' }}>
                <span>Product / Description</span>
                <span className="text-right">Qty</span>
                <span className="pl-1">UOM</span>
                <span className="text-right">Unit Price</span>
                <span className="text-right">Disc %</span>
                <span className="text-right">Line Total</span>
                <span />
              </div>

              <div className="border border-border rounded-lg divide-y divide-border">
                {lines.map((l) => (
                  <div key={l._key}
                    className="grid items-center gap-x-2 px-2 py-2"
                    style={{ gridTemplateColumns: '1fr 72px 96px 108px 72px 96px 32px' }}
                  >
                    {/* Product / Description */}
                    <div className="space-y-1 min-w-0">
                      <ProductSearchCombobox
                        value={l._product ?? null}
                        onChange={(p) => pickProduct(l._key, p)}
                        placeholder="Search products…"
                      />
                      <input
                        className="input h-7 text-xs w-full"
                        placeholder="Description *"
                        value={l.description}
                        onChange={(e) => updateLine(l._key, { description: e.target.value })}
                      />
                    </div>
                    {/* Qty — integers only */}
                    <input
                      type="number" min={1} step={1}
                      className="input h-8 text-xs text-right w-full"
                      value={l.qty}
                      onChange={(e) => updateLine(l._key, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                    />
                    {/* UOM */}
                    <select
                      className="input h-8 text-xs w-full"
                      value={l.uom}
                      onChange={(e) => updateLine(l._key, { uom: e.target.value })}
                    >
                      {UOMS.map((u) => <option key={u}>{u}</option>)}
                    </select>
                    {/* Unit Price — use string state while editing to avoid cursor-jump */}
                    <input
                      type="number" min={0} step={0.01}
                      className="input h-8 text-xs text-right w-full"
                      value={l._priceStr ?? (l.unitPrice / 100).toFixed(2)}
                      onChange={(e) => updateLine(l._key, { _priceStr: e.target.value })}
                      onBlur={(e) => {
                        const cents = Math.round(Math.max(0, parseFloat(e.target.value) || 0) * 100);
                        updateLine(l._key, { unitPrice: cents, _priceStr: undefined });
                      }}
                    />
                    {/* Discount % — whole numbers only */}
                    <input
                      type="number" min={0} max={100} step={1}
                      className="input h-8 text-xs text-right w-full"
                      value={l.discountPct}
                      onChange={(e) => updateLine(l._key, { discountPct: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) })}
                    />
                    {/* Line Total */}
                    <div className="text-right text-xs font-mono font-semibold tabular-nums">
                      ${(lineTotal(l) / 100).toFixed(2)}
                    </div>
                    {/* Remove */}
                    <button type="button" className="btn-ghost p-1 text-red-400 hover:text-red-600 justify-self-center"
                      onClick={() => removeLine(l._key)} disabled={lines.length === 1}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Totals ── */}
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <label className="form-label">Notes</label>
                  <textarea className="input min-h-[72px] resize-none text-sm" value={notes}
                    onChange={(e) => setNotes(e.target.value)} placeholder="Customer-facing notes…" />
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-mono">{currency} ${(subtotal / 100).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground shrink-0">Discount (flat)</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">$</span>
                    <input
                      type="number" min={0} step={0.01}
                      className="input h-7 text-xs text-right w-24"
                      value={(discount / 100).toFixed(2)}
                      onChange={(e) => setDiscount(Math.round(Number(e.target.value) * 100))}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground shrink-0">Tax %</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={0} max={100} step={0.1}
                      className="input h-7 text-xs text-right w-20"
                      value={taxPct}
                      onChange={(e) => setTaxPct(Number(e.target.value))}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Tax amount</span>
                  <span className="font-mono">{currency} ${(taxAmount / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold border-t border-border pt-2">
                  <span>Total</span>
                  <span className="font-mono text-primary-700">{currency} ${(grandTotal / 100).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30">
            <p className="text-xs text-muted-foreground">Quote will be saved as <strong>Draft</strong> — submit for supervisor approval when ready.</p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary btn-sm" disabled={isPending}>
                {isPending ? 'Creating…' : 'Create Draft Quote'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── QuotesPage ──────────────────────────────────────────────────────────────

export function QuotesPage() {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const [search,      setSearch]      = useState('');
  const [statusFilter,setStatusFilter] = useState('');
  const [modalOpen,   setModalOpen]   = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['quotes', statusFilter],
    queryFn: () => salesApi.listQuotes({ limit: 200, status: statusFilter || undefined }).then((r) => r.data),
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => salesApi.convertQuote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });

  const quotes: SalesQuote[] = (data?.data ?? []).filter((q: SalesQuote) =>
    !search ||
    q.quoteNumber?.toLowerCase().includes(search.toLowerCase()) ||
    q.customer?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const totalValue = quotes.reduce((s, q) => s + (q.totalAmount ?? 0), 0);
  const openCount  = quotes.filter((q) => ['DRAFT', 'SENT'].includes(q.status)).length;
  const accepted   = quotes.filter((q) => q.status === 'ACCEPTED').length;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      {modalOpen && <CreateQuoteModal onClose={() => setModalOpen(false)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Quotes</h1>
          <p className="page-subtitle">{data?.meta?.total ?? 0} total · {openCount} open · {fmtCurrency(totalValue)} pipeline</p>
        </div>
        <div className="flex gap-2 items-center">
          <select className="input h-9 text-xs w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
          <button className="btn-primary btn-sm" onClick={() => setModalOpen(true)}><Plus size={13} /> New Quote</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Open / Pending', value: openCount,               color: 'text-blue-600' },
          { label: 'Pipeline Value', value: fmtCurrency(totalValue), color: 'text-foreground' },
          { label: 'Approved',       value: accepted,                color: 'text-green-600' },
          { label: 'Total',          value: data?.meta?.total ?? 0,  color: 'text-foreground' },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input className="input pl-8 h-9 text-sm" placeholder="Search by quote # or customer…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Customer</th>
                <th>Status</th>
                <th className="text-right">Value</th>
                <th>Currency</th>
                <th>Quote Date</th>
                <th>Valid Until</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 8 }).map((__, j) => (
                      <td key={j}><div className="skeleton h-4 w-20" /></td>
                    ))}</tr>
                  ))
                : quotes.map((q) => (
                    <tr key={q.id} className="cursor-pointer" onClick={() => navigate(`/sales/quotes/${q.id}`)}>
                      <td className="font-mono text-xs font-semibold text-primary-700">{q.quoteNumber}</td>
                      <td className="font-medium">{q.customer?.name ?? '—'}</td>
                      <td>
                        <span className={STATUS_BADGE[q.status] ?? 'badge-gray'}>
                          {STATUS_LABEL[q.status] ?? q.status}
                        </span>
                      </td>
                      <td className="text-right font-mono text-sm font-semibold tabular-nums">
                        ${((q.totalAmount ?? 0) / 100).toFixed(2)}
                      </td>
                      <td className="text-xs text-steel-500">{(q as any).currencyCode ?? 'AUD'}</td>
                      <td className="text-xs text-steel-500">{q.quoteDate ? format(new Date(q.quoteDate), 'dd MMM yyyy') : '—'}</td>
                      <td className="text-xs">
                        {q.validUntil ? (
                          <span className={new Date(q.validUntil) < new Date() && !['CONVERTED','DECLINED'].includes(q.status) ? 'text-red-500 font-medium' : ''}>
                            {format(new Date(q.validUntil), 'dd MMM yyyy')}
                          </span>
                        ) : '—'}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {q.status === 'ACCEPTED' && (
                          <button className="btn-secondary btn-sm" onClick={() => convertMutation.mutate(q.id)}
                            disabled={convertMutation.isPending}>
                            <ArrowRight size={11} /> Convert to Order
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && quotes.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><ClipboardList size={22} /></div>
            <p className="text-sm font-medium">No quotes found</p>
            <button className="btn-primary btn-sm mt-3" onClick={() => setModalOpen(true)}><Plus size={12} /> Create first quote</button>
          </div>
        )}
      </div>
    </div>
  );
}
