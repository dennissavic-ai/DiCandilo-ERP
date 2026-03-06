import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountingApi, purchasingApi } from '../../services/api';
import { Plus, Search, DollarSign, AlertCircle, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { format, differenceInDays } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', POSTED: 'badge-blue', PARTIALLY_PAID: 'badge-yellow',
  PAID: 'badge-green', OVERDUE: 'badge-red', CANCELLED: 'badge-gray',
};

function fmtMoney(cents: number) { return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}` }

const today = new Date().toISOString().split('T')[0];
const BLANK_PAY = { amount: '', reference: '', paymentDate: today, accountCode: '2100' };

export function AccountsPayablePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [payForm, setPayForm] = useState({ ...BLANK_PAY });
  const [newAPOpen, setNewAPOpen] = useState(false);
  const [newForm, setNewForm] = useState({ supplierId: '', invoiceRef: '', invoiceDate: today, dueDate: today, amount: '', notes: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['ap-invoices', statusFilter],
    queryFn: () => accountingApi.listAPInvoices({ limit: 200, status: statusFilter || undefined }).then((r) => r.data),
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-dd'],
    queryFn: () => purchasingApi.listSuppliers({ limit: 500 }).then((r) => r.data),
  });

  const payMutation = useMutation({
    mutationFn: () => accountingApi.recordAPPayment(selectedInvoice!.id, payForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ap-invoices'] }); setPayOpen(false); },
  });

  const createMutation = useMutation({
    mutationFn: () => accountingApi.createAPInvoice(newForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ap-invoices'] }); setNewAPOpen(false); setNewForm({ supplierId: '', invoiceRef: '', invoiceDate: today, dueDate: today, amount: '', notes: '' }); },
  });

  const invoices: any[] = ((data as any)?.data ?? []).filter((inv: any) =>
    !search ||
    inv.invoiceRef?.toLowerCase().includes(search.toLowerCase()) ||
    inv.supplier?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const totalOutstanding = invoices.filter((i) => !['PAID','CANCELLED'].includes(i.status)).reduce((s, i) => s + (i.balanceDue ?? 0), 0);
  const overdue = invoices.filter((i) => i.status === 'OVERDUE' || (i.dueDate && new Date(i.dueDate) < new Date() && !['PAID','CANCELLED'].includes(i.status))).length;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounts Payable</h1>
          <p className="page-subtitle">{invoices.length} invoices · {fmtMoney(totalOutstanding)} outstanding</p>
        </div>
        <div className="flex gap-2">
          <select className="input h-9 text-xs w-36" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['DRAFT','POSTED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED'].map((s) => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
          <button className="btn-primary btn-sm" onClick={() => setNewAPOpen(true)}><Plus size={13} /> New AP Invoice</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Outstanding', value: fmtMoney(totalOutstanding), color: 'text-foreground' },
          { label: 'Overdue', value: overdue, color: overdue > 0 ? 'text-red-600' : 'text-foreground' },
          { label: 'Open Invoices', value: invoices.filter((i) => !['PAID','CANCELLED'].includes(i.status)).length, color: 'text-blue-600' },
          { label: 'Total Invoices', value: invoices.length, color: 'text-foreground' },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input className="input pl-8 h-9 text-sm" placeholder="Search by invoice ref or supplier…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice Ref</th><th>Supplier</th><th>Status</th>
                <th className="text-right">Amount</th><th className="text-right">Balance Due</th>
                <th>Invoice Date</th><th>Due Date</th><th>Overdue</th><th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 9 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                  ))
                : invoices.map((inv) => {
                    const daysOverdue = inv.dueDate && !['PAID','CANCELLED'].includes(inv.status) ? differenceInDays(new Date(), new Date(inv.dueDate)) : 0;
                    return (
                      <tr key={inv.id}>
                        <td className="font-mono text-xs font-semibold text-primary-700">{inv.invoiceRef ?? inv.invoiceNumber}</td>
                        <td className="font-medium">{inv.supplier?.name ?? '—'}</td>
                        <td><span className={STATUS_BADGE[inv.status] ?? 'badge-gray'}>{inv.status?.replace(/_/g,' ')}</span></td>
                        <td className="text-right font-mono text-sm tabular-nums">{fmtMoney(inv.totalAmount ?? 0)}</td>
                        <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtMoney(inv.balanceDue ?? 0)}</td>
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
                              setPayForm({ ...BLANK_PAY, amount: ((inv.balanceDue ?? 0) / 100).toFixed(2) });
                              setPayOpen(true);
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
        {!isLoading && invoices.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><DollarSign size={22} /></div>
            <p className="text-sm font-medium">No AP invoices found</p>
          </div>
        )}
      </div>

      {/* Pay Modal */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={`Pay Invoice — ${selectedInvoice?.invoiceRef ?? selectedInvoice?.invoiceNumber}`}
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setPayOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!payForm.amount || payMutation.isPending} onClick={() => payMutation.mutate()}>
            {payMutation.isPending ? 'Recording…' : 'Record Payment'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="p-3 bg-steel-50 rounded border border-border text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Supplier</span><span className="font-medium">{selectedInvoice?.supplier?.name}</span></div>
            <div className="flex justify-between mt-1"><span className="text-muted-foreground">Balance Due</span><span className="font-mono font-bold text-primary-700">{fmtMoney(selectedInvoice?.balanceDue ?? 0)}</span></div>
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

      {/* New AP Invoice Modal */}
      <Modal open={newAPOpen} onClose={() => setNewAPOpen(false)} title="New AP Invoice"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setNewAPOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!newForm.supplierId || !newForm.amount || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Creating…' : 'Create AP Invoice'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Supplier *</label>
            <select className="select" value={newForm.supplierId} onChange={(e) => setNewForm({ ...newForm, supplierId: e.target.value })}>
              <option value="">Select supplier…</option>
              {(suppliersData?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Invoice Ref *</label>
              <input className="input" value={newForm.invoiceRef} onChange={(e) => setNewForm({ ...newForm, invoiceRef: e.target.value })} placeholder="Supplier's invoice number…" />
            </div>
            <div className="form-group">
              <label className="label">Amount (inc. GST) *</label>
              <input type="number" className="input" step="0.01" value={newForm.amount}
                onChange={(e) => setNewForm({ ...newForm, amount: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Invoice Date</label>
              <input type="date" className="input" value={newForm.invoiceDate} onChange={(e) => setNewForm({ ...newForm, invoiceDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Due Date</label>
              <input type="date" className="input" value={newForm.dueDate} onChange={(e) => setNewForm({ ...newForm, dueDate: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea className="input min-h-[70px] resize-none" value={newForm.notes}
              onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} placeholder="Optional notes…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
