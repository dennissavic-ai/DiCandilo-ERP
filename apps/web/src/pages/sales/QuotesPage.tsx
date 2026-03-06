import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi, type SalesQuote } from '../../services/api';
import { Plus, Search, ClipboardList, ArrowRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'badge-gray',
  SENT:      'badge-blue',
  ACCEPTED:  'badge-green',
  DECLINED:  'badge-red',
  EXPIRED:   'badge-orange',
  CONVERTED: 'badge-violet',
};

function fmtCurrency(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(2)}`;
}

const todayStr = new Date().toISOString().split('T')[0];
const validUntilStr = addDays(new Date(), 30).toISOString().split('T')[0];

export function QuotesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ customerId: '', quoteDate: todayStr, validUntil: validUntilStr, notes: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['quotes', statusFilter],
    queryFn: () => salesApi.listQuotes({ limit: 200, status: statusFilter || undefined }).then((r) => r.data),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers-dd'],
    queryFn: () => salesApi.listCustomers({ limit: 500 }).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => salesApi.createQuote({ ...form, lines: [] }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      setNewOpen(false);
      setForm({ customerId: '', quoteDate: todayStr, validUntil: validUntilStr, notes: '' });
      navigate(`/sales/quotes/${res.data.id}`);
    },
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
      <div className="page-header">
        <div>
          <h1 className="page-title">Quotes</h1>
          <p className="page-subtitle">{data?.meta?.total ?? 0} total · {openCount} open · {fmtCurrency(totalValue)} pipeline</p>
        </div>
        <div className="flex gap-2">
          <select className="input h-9 text-xs w-36" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['DRAFT','SENT','ACCEPTED','DECLINED','EXPIRED','CONVERTED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="btn-primary btn-sm" onClick={() => setNewOpen(true)}><Plus size={13} /> New Quote</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Open Quotes',    value: openCount,               color: 'text-blue-600' },
          { label: 'Pipeline Value', value: fmtCurrency(totalValue), color: 'text-foreground' },
          { label: 'Accepted',       value: accepted,                color: 'text-green-600' },
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
                <th>Quote Date</th>
                <th>Valid Until</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 7 }).map((__, j) => (
                      <td key={j}><div className="skeleton h-4 w-20" /></td>
                    ))}</tr>
                  ))
                : quotes.map((q) => (
                    <tr key={q.id} className="cursor-pointer" onClick={() => navigate(`/sales/quotes/${q.id}`)}>
                      <td className="font-mono text-xs font-semibold text-primary-700">{q.quoteNumber}</td>
                      <td className="font-medium">{q.customer?.name ?? '—'}</td>
                      <td><span className={STATUS_BADGE[q.status] ?? 'badge-gray'}>{q.status}</span></td>
                      <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtCurrency(q.totalAmount ?? 0)}</td>
                      <td className="text-xs text-steel-500">{q.quoteDate ? format(new Date(q.quoteDate), 'dd MMM yyyy') : '—'}</td>
                      <td className="text-xs">
                        {q.validUntil ? (
                          <span className={new Date(q.validUntil) < new Date() && q.status !== 'CONVERTED' ? 'text-red-500 font-medium' : ''}>
                            {format(new Date(q.validUntil), 'dd MMM yyyy')}
                          </span>
                        ) : '—'}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {q.status === 'ACCEPTED' && (
                          <button className="btn-secondary btn-sm" onClick={() => convertMutation.mutate(q.id)}
                            disabled={convertMutation.isPending}>
                            <ArrowRight size={11} /> Convert
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
            <button className="btn-primary btn-sm mt-3" onClick={() => setNewOpen(true)}><Plus size={12} /> Create first quote</button>
          </div>
        )}
      </div>

      {/* New Quote Modal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New Quote"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setNewOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!form.customerId || createMutation.isPending}
            onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Creating…' : 'Create Quote'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Customer *</label>
            <select className="select" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">Select customer…</option>
              {(customersData?.data ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Quote Date</label>
              <input type="date" className="input" value={form.quoteDate}
                onChange={(e) => setForm({ ...form, quoteDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Valid Until</label>
              <input type="date" className="input" value={form.validUntil}
                onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea className="input min-h-[80px] resize-none" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Internal notes…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
