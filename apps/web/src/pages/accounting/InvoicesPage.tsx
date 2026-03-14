import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountingApi, salesApi, purchasingApi } from '../../services/api';
import { Plus, Search, FileText, DollarSign, AlertCircle, X, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { format, differenceInDays } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const AR_STATUS_BADGE: Record<string, string> = {
  DRAFT:           'badge-gray',
  SENT:            'badge-blue',
  ISSUED:          'badge-blue',
  PARTIALLY_PAID:  'badge-amber',
  PAID:            'badge-green',
  OVERDUE:         'badge-red',
  VOIDED:          'badge-red',
  CANCELLED:       'badge-red',
};

const AP_STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', POSTED: 'badge-blue', PARTIALLY_PAID: 'badge-yellow',
  PAID: 'badge-green', OVERDUE: 'badge-red', CANCELLED: 'badge-gray',
};

function fmtMoney(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
}

const today = new Date().toISOString().split('T')[0];
const BLANK_PAY = { amount: '', reference: '', paymentDate: today, accountCode: '2100' };
const EMPTY_LINE = { description: '', qty: '', unitPrice: '' };

export function InvoicesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'ar' | 'ap'>('ar');

  // AR state
  const [arSearch, setArSearch] = useState('');
  const [arNewOpen, setArNewOpen] = useState(false);
  const [arForm, setArForm] = useState({ customerId: '', invoiceDate: today, dueDate: '', currency: 'AUD', notes: '' });
  const [arLines, setArLines] = useState([{ ...EMPTY_LINE }]);
  const [arFormError, setArFormError] = useState('');

  // AP state
  const [apSearch, setApSearch] = useState('');
  const [apStatusFilter, setApStatusFilter] = useState('');
  const [apPayOpen, setApPayOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [payForm, setPayForm] = useState({ ...BLANK_PAY });
  const [apNewOpen, setApNewOpen] = useState(false);
  const [apForm, setApForm] = useState({ supplierId: '', invoiceNumber: '', invoiceDate: today, dueDate: today, amount: '', notes: '' });

  // AR queries
  const { data: arData, isLoading: arLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => accountingApi.getInvoices({ limit: 100 }).then((r) => r.data),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => salesApi.listCustomers({ limit: 200 }).then((r) => r.data),
    enabled: arNewOpen,
  });

  // AP queries
  const { data: apData, isLoading: apLoading } = useQuery({
    queryKey: ['ap-invoices', apStatusFilter],
    queryFn: () => accountingApi.listAPInvoices({ limit: 200, status: apStatusFilter || undefined }).then((r) => r.data),
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-dd'],
    queryFn: () => purchasingApi.listSuppliers({ limit: 500 }).then((r) => r.data),
  });

  // AR mutations
  const arCreateMutation = useMutation({
    mutationFn: (payload: object) => accountingApi.createInvoice(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setArNewOpen(false);
      resetArForm();
    },
    onError: (err: any) => {
      setArFormError(err?.response?.data?.message ?? 'Failed to create invoice.');
    },
  });

  // AP mutations
  const apPayMutation = useMutation({
    mutationFn: () => accountingApi.recordAPPayment(selectedInvoice!.id, {
      ...payForm,
      amount: Math.round(parseFloat(payForm.amount) * 100),
      paymentDate: new Date(payForm.paymentDate).toISOString(),
      method: 'BANK_TRANSFER',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ap-invoices'] }); setApPayOpen(false); },
  });

  const apCreateMutation = useMutation({
    mutationFn: () => accountingApi.createAPInvoice({
      supplierId: apForm.supplierId,
      invoiceNumber: apForm.invoiceNumber,
      invoiceDate: new Date(apForm.invoiceDate).toISOString(),
      dueDate: new Date(apForm.dueDate).toISOString(),
      totalAmount: Math.round(parseFloat(apForm.amount) * 100),
      notes: apForm.notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ap-invoices'] });
      setApNewOpen(false);
      setApForm({ supplierId: '', invoiceNumber: '', invoiceDate: today, dueDate: today, amount: '', notes: '' });
    },
  });

  function resetArForm() {
    setArForm({ customerId: '', invoiceDate: today, dueDate: '', currency: 'AUD', notes: '' });
    setArLines([{ ...EMPTY_LINE }]);
    setArFormError('');
  }

  function handleArSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!arForm.customerId) { setArFormError('Customer is required.'); return; }
    if (arLines.some(l => !l.description || !l.qty || !l.unitPrice)) {
      setArFormError('All lines require description, qty, and unit price.'); return;
    }
    setArFormError('');
    arCreateMutation.mutate({
      customerId: arForm.customerId,
      invoiceDate: arForm.invoiceDate ? new Date(arForm.invoiceDate).toISOString() : undefined,
      dueDate: arForm.dueDate ? new Date(arForm.dueDate).toISOString() : undefined,
      currency: arForm.currency,
      notes: arForm.notes || undefined,
      lines: arLines.map(l => ({
        description: l.description,
        qty: parseFloat(l.qty),
        unitPrice: Math.round(parseFloat(l.unitPrice) * 100),
      })),
    });
  }

  const arInvoices = (arData?.data ?? []).filter((inv: any) =>
    !arSearch ||
    inv.invoiceNumber?.toLowerCase().includes(arSearch.toLowerCase()) ||
    inv.customer?.name?.toLowerCase().includes(arSearch.toLowerCase()),
  );

  const apInvoices: any[] = ((apData as any)?.data ?? []).filter((inv: any) =>
    !apSearch ||
    inv.invoiceNumber?.toLowerCase().includes(apSearch.toLowerCase()) ||
    inv.supplier?.name?.toLowerCase().includes(apSearch.toLowerCase()),
  );

  const totalOutstanding = apInvoices.filter((i) => !['PAID','CANCELLED'].includes(i.status))
    .reduce((s, i) => s + (Number(i.totalAmount) - Number(i.amountPaid)), 0);
  const overdue = apInvoices.filter((i) => i.status === 'OVERDUE' || (i.dueDate && new Date(i.dueDate) < new Date() && !['PAID','CANCELLED'].includes(i.status))).length;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">AR & AP invoice management</p>
        </div>
        <div className="flex gap-2">
          {tab === 'ar' && (
            <button className="btn-primary btn-sm" onClick={() => setArNewOpen(true)}><Plus size={13} /> New Invoice</button>
          )}
          {tab === 'ap' && (
            <button className="btn-primary btn-sm" onClick={() => setApNewOpen(true)}><Plus size={13} /> New AP Invoice</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-border">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'ar' ? 'border-primary-600 text-primary-700' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('ar')}
        >
          AR Invoices
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'ap' ? 'border-primary-600 text-primary-700' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('ap')}
        >
          Accounts Payable
        </button>
      </div>

      {/* ── AR TAB ── */}
      {tab === 'ar' && (
        <>
          <div className="card mb-4">
            <div className="card-body py-3">
              <div className="relative max-w-sm">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
                <input
                  className="input pl-8 h-9 text-sm"
                  placeholder="Search by invoice # or customer…"
                  value={arSearch}
                  onChange={(e) => setArSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="table-container rounded-xl">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Balance Due</th>
                    <th>Invoice Date</th>
                    <th>Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {arLoading
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i}>{Array.from({ length: 7 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-24" /></td>)}</tr>
                      ))
                    : arInvoices.map((inv: any) => (
                        <tr key={inv.id} className="cursor-pointer">
                          <td className="font-mono text-xs font-semibold text-primary-700">{inv.invoiceNumber}</td>
                          <td className="font-medium text-foreground">{inv.customer?.name ?? '—'}</td>
                          <td><span className={AR_STATUS_BADGE[inv.status] ?? 'badge-gray'}>{inv.status}</span></td>
                          <td className="text-right font-mono text-sm tabular-nums">{fmtMoney(inv.totalAmount ?? 0)}</td>
                          <td className="text-right font-mono text-sm font-semibold tabular-nums text-red-600">{fmtMoney(inv.balanceDue ?? 0)}</td>
                          <td className="text-xs text-steel-500">{inv.invoiceDate ? format(new Date(inv.invoiceDate), 'dd MMM yyyy') : '—'}</td>
                          <td className="text-xs">{inv.dueDate ? format(new Date(inv.dueDate), 'dd MMM yyyy') : '—'}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {!arLoading && arInvoices.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon"><FileText size={22} /></div>
                <p className="text-sm font-medium text-foreground">No invoices found</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── AP TAB ── */}
      {tab === 'ap' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Outstanding', value: fmtMoney(totalOutstanding), color: 'text-foreground' },
              { label: 'Overdue', value: overdue, color: overdue > 0 ? 'text-red-600' : 'text-foreground' },
              { label: 'Open Invoices', value: apInvoices.filter((i) => !['PAID','CANCELLED'].includes(i.status)).length, color: 'text-blue-600' },
              { label: 'Total Invoices', value: apInvoices.length, color: 'text-foreground' },
            ].map((s) => (
              <div key={s.label} className="stat-card">
                <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="card mb-4">
            <div className="card-body py-3 flex items-center gap-3">
              <div className="relative max-w-sm flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
                <input className="input pl-8 h-9 text-sm" placeholder="Search by invoice # or supplier…" value={apSearch} onChange={(e) => setApSearch(e.target.value)} />
              </div>
              <select className="input h-9 text-xs w-40" value={apStatusFilter} onChange={(e) => setApStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {['DRAFT','POSTED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED'].map((s) => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
              </select>
            </div>
          </div>

          <div className="card">
            <div className="table-container rounded-xl">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice #</th><th>Supplier</th><th>Status</th>
                    <th className="text-right">Amount</th><th className="text-right">Balance Due</th>
                    <th>Invoice Date</th><th>Due Date</th><th>Overdue</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {apLoading
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i}>{Array.from({ length: 9 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                      ))
                    : apInvoices.map((inv) => {
                        const balanceDue = Number(inv.totalAmount) - Number(inv.amountPaid);
                        const daysOverdue = inv.dueDate && !['PAID','CANCELLED'].includes(inv.status) ? differenceInDays(new Date(), new Date(inv.dueDate)) : 0;
                        return (
                          <tr key={inv.id}>
                            <td className="font-mono text-xs font-semibold text-primary-700">{inv.invoiceNumber}</td>
                            <td className="font-medium">{inv.supplier?.name ?? '—'}</td>
                            <td><span className={AP_STATUS_BADGE[inv.status] ?? 'badge-gray'}>{inv.status?.replace(/_/g,' ')}</span></td>
                            <td className="text-right font-mono text-sm tabular-nums">{fmtMoney(inv.totalAmount ?? 0)}</td>
                            <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtMoney(balanceDue)}</td>
                            <td className="text-xs text-steel-500">{inv.invoiceDate ? format(new Date(inv.invoiceDate), 'dd MMM yyyy') : '—'}</td>
                            <td className="text-xs">{inv.dueDate ? format(new Date(inv.dueDate), 'dd MMM yyyy') : '—'}</td>
                            <td>
                              {daysOverdue > 0 && (
                                <span className="flex items-center gap-1 text-red-600 text-xs font-medium">
                                  <AlertCircle size={11} /> {daysOverdue}d
                                </span>
                              )}
                            </td>
                            <td>
                              {!['PAID','CANCELLED'].includes(inv.status) && (
                                <button className="btn-secondary btn-sm" onClick={() => {
                                  setSelectedInvoice(inv);
                                  setPayForm({ ...BLANK_PAY, amount: (balanceDue / 100).toFixed(2) });
                                  setApPayOpen(true);
                                }}>
                                  <DollarSign size={11} /> Pay
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
            {!apLoading && apInvoices.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon"><DollarSign size={22} /></div>
                <p className="text-sm font-medium">No AP invoices found</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── AR: New Invoice Modal ── */}
      {arNewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-base">New Invoice</h2>
              <button onClick={() => { setArNewOpen(false); resetArForm(); }} className="text-steel-400 hover:text-foreground"><X size={16} /></button>
            </div>
            <form onSubmit={handleArSubmit} className="px-5 py-4 space-y-4">
              {arFormError && <p className="text-sm text-red-600">{arFormError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Customer *</label>
                  <select className="input" value={arForm.customerId} onChange={e => setArForm(f => ({ ...f, customerId: e.target.value }))}>
                    <option value="">Select customer…</option>
                    {(customersData?.data ?? []).map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Currency</label>
                  <select className="input" value={arForm.currency} onChange={e => setArForm(f => ({ ...f, currency: e.target.value }))}>
                    <option value="AUD">AUD</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="NZD">NZD</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Invoice Date</label>
                  <input className="input" type="date" value={arForm.invoiceDate} onChange={e => setArForm(f => ({ ...f, invoiceDate: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Due Date</label>
                  <input className="input" type="date" value={arForm.dueDate} onChange={e => setArForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="form-label">Notes</label>
                <textarea className="input" rows={2} value={arForm.notes} onChange={e => setArForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="form-label mb-0">Line Items</label>
                  <button type="button" className="btn-secondary btn-sm text-xs" onClick={() => setArLines(l => [...l, { ...EMPTY_LINE }])}>
                    <Plus size={11} /> Add Line
                  </button>
                </div>
                <div className="space-y-2">
                  {arLines.map((line, i) => (
                    <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_80px_100px_32px] gap-2 items-center">
                      <input className="input text-sm" placeholder="Description" value={line.description}
                        onChange={e => setArLines(ls => ls.map((l, j) => j === i ? { ...l, description: e.target.value } : l))} />
                      <input className="input text-sm" type="number" placeholder="Qty" value={line.qty}
                        onChange={e => setArLines(ls => ls.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))} />
                      <input className="input text-sm" type="number" step="0.01" placeholder="Unit $" value={line.unitPrice}
                        onChange={e => setArLines(ls => ls.map((l, j) => j === i ? { ...l, unitPrice: e.target.value } : l))} />
                      <button type="button" className="text-steel-400 hover:text-red-500 flex-shrink-0"
                        onClick={() => setArLines(ls => ls.filter((_, j) => j !== i))}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => { setArNewOpen(false); resetArForm(); }}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" disabled={arCreateMutation.isPending}>
                  {arCreateMutation.isPending ? 'Creating…' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── AP: Pay Modal ── */}
      <Modal open={apPayOpen} onClose={() => setApPayOpen(false)} title={`Pay Invoice — ${selectedInvoice?.invoiceNumber}`}
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setApPayOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!payForm.amount || apPayMutation.isPending} onClick={() => apPayMutation.mutate()}>
            {apPayMutation.isPending ? 'Recording…' : 'Record Payment'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="p-3 bg-steel-50 rounded border border-border text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Supplier</span><span className="font-medium">{selectedInvoice?.supplier?.name}</span></div>
            <div className="flex justify-between mt-1">
              <span className="text-muted-foreground">Balance Due</span>
              <span className="font-mono font-bold text-primary-700">
                {fmtMoney(selectedInvoice ? Number(selectedInvoice.totalAmount) - Number(selectedInvoice.amountPaid) : 0)}
              </span>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Amount</label>
            <input type="number" className="input" step="0.01" value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Payment Date</label>
              <input type="date" className="input" value={payForm.paymentDate}
                onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Reference</label>
              <input className="input" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="Cheque #, EFT ref…" />
            </div>
          </div>
        </div>
      </Modal>

      {/* ── AP: New AP Invoice Modal ── */}
      <Modal open={apNewOpen} onClose={() => setApNewOpen(false)} title="New AP Invoice"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setApNewOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!apForm.supplierId || !apForm.amount || apCreateMutation.isPending} onClick={() => apCreateMutation.mutate()}>
            {apCreateMutation.isPending ? 'Creating…' : 'Create AP Invoice'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Supplier *</label>
            <select className="select" value={apForm.supplierId} onChange={(e) => setApForm({ ...apForm, supplierId: e.target.value })}>
              <option value="">Select supplier…</option>
              {(suppliersData?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Invoice Number *</label>
              <input className="input" value={apForm.invoiceNumber} onChange={(e) => setApForm({ ...apForm, invoiceNumber: e.target.value })} placeholder="Supplier's invoice number…" />
            </div>
            <div className="form-group">
              <label className="label">Amount (inc. GST) *</label>
              <input type="number" className="input" step="0.01" value={apForm.amount}
                onChange={(e) => setApForm({ ...apForm, amount: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Invoice Date</label>
              <input type="date" className="input" value={apForm.invoiceDate} onChange={(e) => setApForm({ ...apForm, invoiceDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Due Date</label>
              <input type="date" className="input" value={apForm.dueDate} onChange={(e) => setApForm({ ...apForm, dueDate: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea className="input min-h-[70px] resize-none" value={apForm.notes}
              onChange={(e) => setApForm({ ...apForm, notes: e.target.value })} placeholder="Optional notes…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
