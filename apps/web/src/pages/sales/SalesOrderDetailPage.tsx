import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { salesApi, accountingApi } from '../../services/api';
import { ArrowLeft, CheckCircle, XCircle, FileText, Truck, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', CONFIRMED: 'badge-blue', IN_PRODUCTION: 'badge-amber',
  READY_TO_SHIP: 'badge-teal', PARTIALLY_SHIPPED: 'badge-yellow',
  SHIPPED: 'badge-green', INVOICED: 'badge-violet', CLOSED: 'badge-green', CANCELLED: 'badge-red',
};

function fmtMoney(cents: number) { return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}` }

const STATUSES = ['DRAFT','CONFIRMED','IN_PRODUCTION','READY_TO_SHIP','PARTIALLY_SHIPPED','SHIPPED','INVOICED','CLOSED','CANCELLED'];

export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: order, isLoading } = useQuery({
    queryKey: ['sales-order', id],
    queryFn: () => salesApi.getOrder(id!).then((r) => r.data),
    enabled: !!id,
  });

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

  const statusMutation = useMutation({
    mutationFn: (status: string) => salesApi.updateOrderStatus(id!, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-order', id] }); setStatusModalOpen(false); },
  });

  const invoiceMutation = useMutation({
    mutationFn: () => accountingApi.createInvoiceFromOrder(id!),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
      setInvoiceModalOpen(false);
      navigate(`/accounting/invoices/${(res.data as any).id}`);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () => salesApi.confirmOrder(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-order', id] }),
  });

  if (isLoading) return (
    <div className="max-w-[1100px] mx-auto animate-fade-in space-y-4">
      {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded" />)}
    </div>
  );

  const o = order as any;
  const lines: any[] = o?.lines ?? [];
  const subtotal = lines.reduce((s: number, l: any) => s + (l.lineTotal ?? 0), 0);
  const gst      = subtotal * 0.1;
  const total    = o?.totalAmount ?? (subtotal + gst);
  const paid     = o?.amountPaid ?? 0;
  const balance  = total - paid;

  const canConfirm = o?.status === 'DRAFT';
  const canInvoice = ['SHIPPED','READY_TO_SHIP'].includes(o?.status ?? '');
  const canCancel  = !['CLOSED','CANCELLED','INVOICED'].includes(o?.status ?? '');

  return (
    <div className="max-w-[1100px] mx-auto animate-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <button className="btn-ghost btn-sm" onClick={() => navigate('/sales/orders')}><ArrowLeft size={13} /> Sales Orders</button>
      </div>

      <div className="page-header mt-2">
        <div>
          <h1 className="page-title">{o?.orderNumber ?? '—'}</h1>
          <p className="page-subtitle">
            {o?.customer?.name} · {o?.orderDate ? format(new Date(o.orderDate), 'dd MMM yyyy') : ''}
            {o?.requiredDate ? ` · required ${format(new Date(o.requiredDate), 'dd MMM yyyy')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={STATUS_BADGE[o?.status] ?? 'badge-gray'}>{o?.status?.replace(/_/g,' ')}</span>
          {canConfirm && (
            <button className="btn-primary btn-sm" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
              <CheckCircle size={12} /> Confirm
            </button>
          )}
          <button className="btn-secondary btn-sm" onClick={() => { setNewStatus(o?.status); setStatusModalOpen(true); }}>
            Update Status
          </button>
          {canInvoice && (
            <button className="btn-secondary btn-sm text-violet-600" onClick={() => setInvoiceModalOpen(true)}>
              <FileText size={12} /> Create Invoice
            </button>
          )}
          {canCancel && (
            <button className="btn-secondary btn-sm text-red-600" onClick={() => statusMutation.mutate('CANCELLED')}>
              <XCircle size={12} /> Cancel
            </button>
          )}
        </div>
      </div>

      {o?.customer?.creditHold && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-700">
          <AlertCircle size={14} /> Customer is on credit hold — check before shipping.
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Lines */}
        <div className="col-span-2 space-y-4">
          <div className="card">
            <div className="card-header">
              <span className="text-sm font-semibold">Order Lines</span>
              <span className="text-xs text-muted-foreground">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="table-container rounded-b-xl">
              <table className="table">
                <thead><tr>
                  <th>#</th><th>Description</th>
                  <th className="text-right">Ordered</th><th className="text-right">Shipped</th>
                  <th>UOM</th><th className="text-right">Unit Price</th><th className="text-right">Line Total</th>
                </tr></thead>
                <tbody>
                  {lines.length === 0
                    ? <tr><td colSpan={7} className="text-center text-sm text-muted-foreground py-10">No lines on this order</td></tr>
                    : lines.map((l: any) => (
                      <tr key={l.id}>
                        <td className="text-xs text-muted-foreground">{l.lineNumber}</td>
                        <td>
                          <div className="font-medium text-sm">{l.description}</div>
                          {l.product?.code && <div className="text-xs text-muted-foreground">{l.product.code}</div>}
                        </td>
                        <td className="text-right font-mono text-xs">{parseFloat(l.qtyOrdered ?? 0).toFixed(2)}</td>
                        <td className="text-right font-mono text-xs">{parseFloat(l.qtyShipped ?? 0).toFixed(2)}</td>
                        <td className="text-xs">{l.uom}</td>
                        <td className="text-right font-mono text-xs">{fmtMoney(l.unitPrice ?? 0)}</td>
                        <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtMoney(l.lineTotal ?? 0)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {o?.notes && (
            <div className="card">
              <div className="card-header"><span className="text-sm font-semibold">Notes</span></div>
              <div className="card-body text-sm text-steel-700 whitespace-pre-wrap">{o.notes}</div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Financials</span></div>
            <div className="card-body space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono tabular-nums">{fmtMoney(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">GST (10%)</span><span className="font-mono tabular-nums">{fmtMoney(gst)}</span></div>
              <div className="flex justify-between font-bold border-t border-border pt-2 mt-1">
                <span>Total</span><span className="font-mono tabular-nums text-primary-700">{fmtMoney(total)}</span>
              </div>
              <div className="flex justify-between text-green-600"><span>Paid</span><span className="font-mono tabular-nums">{fmtMoney(paid)}</span></div>
              <div className={`flex justify-between font-semibold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                <span>Balance</span><span className="font-mono tabular-nums">{fmtMoney(balance)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Order Info</span></div>
            <div className="card-body space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium">{o?.customer?.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Code</span><span className="font-mono">{o?.customer?.code}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Order Date</span><span>{o?.orderDate ? format(new Date(o.orderDate), 'dd MMM yyyy') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Required</span><span>{o?.requiredDate ? format(new Date(o.requiredDate), 'dd MMM yyyy') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Terms</span><span>{o?.customer?.creditTerms ?? 30} days</span></div>
            </div>
          </div>

          {o?.deliveryAddress && (
            <div className="card">
              <div className="card-header"><Truck size={13} /><span className="text-sm font-semibold ml-1">Ship To</span></div>
              <div className="card-body text-xs text-steel-700 space-y-0.5">
                {Object.values(o.deliveryAddress).filter(Boolean).map((v: any, i: number) => (
                  <div key={i}>{v}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal open={statusModalOpen} onClose={() => setStatusModalOpen(false)} title="Update Order Status"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setStatusModalOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={() => statusMutation.mutate(newStatus)} disabled={statusMutation.isPending}>
            {statusMutation.isPending ? 'Updating…' : 'Update'}
          </button>
        </>}>
        <div className="form-group">
          <label className="label">New Status</label>
          <select className="select" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
        </div>
      </Modal>

      <Modal open={invoiceModalOpen} onClose={() => setInvoiceModalOpen(false)} title="Create Invoice"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setInvoiceModalOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={() => invoiceMutation.mutate()} disabled={invoiceMutation.isPending}>
            {invoiceMutation.isPending ? 'Creating…' : 'Create Invoice'}
          </button>
        </>}>
        <p className="text-sm text-steel-700">
          This will create a tax invoice for order <strong>{o?.orderNumber}</strong> totalling <strong>{fmtMoney(total)}</strong> (inc. GST).
        </p>
      </Modal>
    </div>
  );
}
