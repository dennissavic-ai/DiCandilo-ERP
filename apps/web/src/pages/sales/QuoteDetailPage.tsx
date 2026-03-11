import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { salesApi, inventoryApi } from '../../services/api';
import {
  ArrowLeft, Plus, Trash2, Send, CheckCircle, XCircle, ArrowRight,
  Save, Clock, AlertCircle,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'badge-gray',
  SENT:      'badge-blue',
  ACCEPTED:  'badge-green',
  DECLINED:  'badge-red',
  EXPIRED:   'badge-orange',
  CONVERTED: 'badge-violet',
};

// Human-readable labels for the approval workflow
const STATUS_LABEL: Record<string, string> = {
  DRAFT:     'Draft',
  SENT:      'Pending Approval',
  ACCEPTED:  'Approved',
  DECLINED:  'Declined',
  EXPIRED:   'Expired',
  CONVERTED: 'Converted to Order',
};

const UOMS = ['EA', 'KG', 'T', 'M', 'LM', 'M2', 'M3', 'PC', 'SET', 'L', 'SHT', 'COIL'];

function fmtMoney(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
}

interface QuoteLine {
  id?: string;
  productId?: string;
  description: string;
  uom: string;
  qty: number;
  unitPrice: number;  // cents
  discountPct: number;
  discount?: number;  // alias from API
}

const BLANK_LINE: QuoteLine = { description: '', uom: 'EA', qty: 1, unitPrice: 0, discountPct: 0 };

export function QuoteDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const qc        = useQueryClient();

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote', id],
    queryFn: () => salesApi.getQuote(id!).then((r) => r.data),
    enabled: !!id,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-dd'],
    queryFn: () => inventoryApi.listProducts({ limit: 500 }).then((r) => r.data),
  });
  const products: any[] = productsData?.data ?? [];

  const [lines,       setLines]       = useState<QuoteLine[]>([]);
  const [notes,       setNotes]       = useState('');
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [newLine,     setNewLine]     = useState<QuoteLine>({ ...BLANK_LINE });

  useEffect(() => {
    if (quote) {
      const q = quote as any;
      setLines((q.lines ?? []).map((l: any) => ({
        ...l,
        discountPct: l.discountPct ?? l.discount ?? 0,
      })));
      setNotes(q.notes ?? '');
    }
  }, [quote]);

  const statusMutation = useMutation({
    mutationFn: (status: string) => salesApi.updateQuoteStatus(id!, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quote', id] }),
  });

  const convertMutation = useMutation({
    mutationFn: () => salesApi.convertQuote(id!),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quote', id] });
      navigate(`/sales/orders/${(res.data as any).id}`);
    },
  });

  const q = quote as any;
  const status: string = q?.status ?? 'DRAFT';
  const canEdit = status === 'DRAFT';

  // Totals computed from local lines state
  function lineTotal(l: QuoteLine) {
    return Math.round(l.qty * l.unitPrice * (1 - (l.discountPct ?? 0) / 100));
  }
  const subtotal   = lines.reduce((s, l) => s + lineTotal(l), 0);
  const discountAmt = Number(q?.discountAmount ?? 0);
  const taxAmt      = Number(q?.taxAmount ?? 0);
  const total       = subtotal - discountAmt + taxAmt;
  const currency    = q?.currencyCode ?? 'AUD';

  function addLine() {
    setLines((prev) => [...prev, { ...newLine }]);
    setNewLine({ ...BLANK_LINE });
    setAddLineOpen(false);
  }
  function removeLine(i: number) { setLines((prev) => prev.filter((_, j) => j !== i)); }
  function updateLine(i: number, patch: Partial<QuoteLine>) {
    setLines((prev) => prev.map((l, j) => j === i ? { ...l, ...patch } : l));
  }
  function pickProduct(productId: string) {
    const p = products.find((pr) => pr.id === productId);
    if (!p) return;
    setNewLine((l) => ({ ...l, productId: p.id, description: p.description ?? p.name ?? '', uom: p.uom ?? 'EA', unitPrice: p.listPrice ?? 0 }));
  }

  if (isLoading) return (
    <div className="max-w-[1100px] mx-auto animate-fade-in space-y-4">
      {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded" />)}
    </div>
  );

  return (
    <div className="max-w-[1100px] mx-auto animate-fade-in">
      {/* Back */}
      <div className="flex items-center gap-2 mb-1">
        <button className="btn-ghost btn-sm" onClick={() => navigate('/sales/quotes')}><ArrowLeft size={13} /> Quotes</button>
      </div>

      {/* Page header */}
      <div className="page-header mt-2">
        <div>
          <h1 className="page-title">{q?.quoteNumber ?? 'Quote'}</h1>
          <p className="page-subtitle">
            {q?.customer?.name}
            {q?.quoteDate ? ` · ${format(new Date(q.quoteDate), 'dd MMM yyyy')}` : ''}
            {q?.validUntil ? ` · valid until ${format(new Date(q.validUntil), 'dd MMM yyyy')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={STATUS_BADGE[status] ?? 'badge-gray'}>{STATUS_LABEL[status] ?? status}</span>

          {/* DRAFT: can submit for approval */}
          {status === 'DRAFT' && (
            <button
              className="btn-secondary btn-sm"
              onClick={() => statusMutation.mutate('SENT')}
              disabled={statusMutation.isPending || lines.length === 0}
              title={lines.length === 0 ? 'Add at least one line item before submitting' : ''}
            >
              <Send size={12} /> Submit for Approval
            </button>
          )}

          {/* SENT (Pending Approval): supervisor actions */}
          {status === 'SENT' && (
            <>
              <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                <Clock size={11} /> Awaiting supervisor approval
              </div>
              <button className="btn-secondary btn-sm text-green-600 border-green-300 hover:bg-green-50"
                onClick={() => statusMutation.mutate('ACCEPTED')} disabled={statusMutation.isPending}>
                <CheckCircle size={12} /> Approve
              </button>
              <button className="btn-secondary btn-sm text-red-600 border-red-300 hover:bg-red-50"
                onClick={() => statusMutation.mutate('DECLINED')} disabled={statusMutation.isPending}>
                <XCircle size={12} /> Reject
              </button>
            </>
          )}

          {/* DECLINED: can revert to draft */}
          {status === 'DECLINED' && (
            <button className="btn-secondary btn-sm"
              onClick={() => statusMutation.mutate('DRAFT')} disabled={statusMutation.isPending}>
              Revert to Draft
            </button>
          )}

          {/* ACCEPTED: convert to sales order */}
          {status === 'ACCEPTED' && (
            <button className="btn-primary btn-sm" onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}>
              <ArrowRight size={12} /> Convert to Order
            </button>
          )}
        </div>
      </div>

      {/* Declined banner */}
      {status === 'DECLINED' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-4 py-3 mb-4">
          <AlertCircle size={14} />
          This quote was rejected. Revert it to Draft to make changes and resubmit for approval.
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* ── Lines + Notes ── */}
        <div className="col-span-2 space-y-4">
          <div className="card">
            <div className="card-header">
              <span className="text-sm font-semibold">Line Items</span>
              {canEdit && (
                <button className="btn-secondary btn-sm" onClick={() => setAddLineOpen(true)}><Plus size={12} /> Add Line</button>
              )}
            </div>
            <div className="table-container rounded-b-xl">
              <table className="table">
                <thead><tr>
                  <th>Description</th>
                  <th className="text-right">Qty</th>
                  <th>UOM</th>
                  <th className="text-right">Unit Price</th>
                  <th className="text-right">Disc %</th>
                  <th className="text-right">Line Total</th>
                  {canEdit && <th></th>}
                </tr></thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr><td colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                      No lines yet — add items above
                    </td></tr>
                  ) : lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        {canEdit
                          ? <input className="input h-7 text-xs w-full" value={l.description}
                              onChange={(e) => updateLine(i, { description: e.target.value })} />
                          : <span className="text-sm">{l.description}</span>}
                      </td>
                      <td className="text-right">
                        {canEdit
                          ? <input className="input h-7 text-xs w-16 text-right" type="number" value={l.qty}
                              onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} />
                          : l.qty}
                      </td>
                      <td>
                        {canEdit
                          ? <select className="input h-7 text-xs" value={l.uom} onChange={(e) => updateLine(i, { uom: e.target.value })}>
                              {UOMS.map((u) => <option key={u}>{u}</option>)}
                            </select>
                          : l.uom}
                      </td>
                      <td className="text-right">
                        {canEdit
                          ? <input className="input h-7 text-xs w-20 text-right" type="number" step="0.01"
                              value={(l.unitPrice / 100).toFixed(2)}
                              onChange={(e) => updateLine(i, { unitPrice: Math.round(Number(e.target.value) * 100) })} />
                          : fmtMoney(l.unitPrice)}
                      </td>
                      <td className="text-right">
                        {canEdit
                          ? <input className="input h-7 text-xs w-14 text-right" type="number" min={0} max={100}
                              value={l.discountPct ?? 0}
                              onChange={(e) => updateLine(i, { discountPct: Number(e.target.value) })} />
                          : `${l.discountPct ?? 0}%`}
                      </td>
                      <td className="text-right font-mono text-xs font-semibold tabular-nums">
                        {fmtMoney(lineTotal(l))}
                      </td>
                      {canEdit && (
                        <td><button className="btn-ghost btn-sm text-red-500 p-1" onClick={() => removeLine(i)}><Trash2 size={12} /></button></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Notes</span></div>
            <div className="card-body">
              <textarea className="input min-h-[80px] resize-none w-full text-sm"
                value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes to this quote…" readOnly={!canEdit} />
            </div>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-4">
          {/* Summary */}
          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Summary</span></div>
            <div className="card-body space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono tabular-nums">{fmtMoney(subtotal)}</span>
              </div>
              {discountAmt > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span>
                  <span className="font-mono tabular-nums">−{fmtMoney(discountAmt)}</span>
                </div>
              )}
              {taxAmt > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="font-mono tabular-nums">{fmtMoney(taxAmt)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t border-border pt-2 mt-2">
                <span>Total ({currency})</span>
                <span className="font-mono tabular-nums text-primary-700">{fmtMoney(total)}</span>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Details</span></div>
            <div className="card-body space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium">{q?.customer?.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Quote #</span><span className="font-mono">{q?.quoteNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Currency</span><span>{currency}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Quote Date</span><span>{q?.quoteDate ? format(new Date(q.quoteDate), 'dd MMM yyyy') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Valid Until</span><span>{q?.validUntil ? format(new Date(q.validUntil), 'dd MMM yyyy') : '—'}</span></div>
              {q?.terms && <div className="flex justify-between"><span className="text-muted-foreground">Terms</span><span>{q.terms}</span></div>}
            </div>
          </div>

          {/* Workflow info card */}
          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Approval Workflow</span></div>
            <div className="card-body space-y-2 text-xs">
              {[
                { s: 'DRAFT',    label: 'Draft',            desc: 'Being prepared' },
                { s: 'SENT',     label: 'Pending Approval', desc: 'Awaiting supervisor' },
                { s: 'ACCEPTED', label: 'Approved',         desc: 'Ready to convert' },
                { s: 'CONVERTED',label: 'Converted',        desc: 'Sales order created' },
              ].map(({ s, label, desc }) => (
                <div key={s} className={`flex items-center gap-2 ${status === s ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${status === s ? 'bg-primary-600' : 'bg-border'}`} />
                  <span>{label}</span>
                  {status === s && <span className="text-muted-foreground font-normal">— {desc}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Add Line Modal */}
      <Modal open={addLineOpen} onClose={() => setAddLineOpen(false)} title="Add Line Item"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setAddLineOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={addLine} disabled={!newLine.description}>Add Line</button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Product (optional)</label>
            <select className="select" onChange={(e) => pickProduct(e.target.value)}>
              <option value="">Select product or enter manually…</option>
              {products.map((p: any) => (
                <option key={p.id} value={p.id}>{p.code} — {p.description ?? p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Description *</label>
            <input className="input" value={newLine.description}
              onChange={(e) => setNewLine((l) => ({ ...l, description: e.target.value }))}
              placeholder="Item description…" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="form-group">
              <label className="label">Qty</label>
              <input type="number" className="input" value={newLine.qty} min={0.01} step={0.01}
                onChange={(e) => setNewLine((l) => ({ ...l, qty: Number(e.target.value) }))} />
            </div>
            <div className="form-group">
              <label className="label">UOM</label>
              <select className="select" value={newLine.uom} onChange={(e) => setNewLine((l) => ({ ...l, uom: e.target.value }))}>
                {UOMS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Disc %</label>
              <input type="number" className="input" value={newLine.discountPct} min={0} max={100}
                onChange={(e) => setNewLine((l) => ({ ...l, discountPct: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Unit Price (ex tax)</label>
            <input type="number" className="input" step="0.01"
              value={(newLine.unitPrice / 100).toFixed(2)}
              onChange={(e) => setNewLine((l) => ({ ...l, unitPrice: Math.round(Number(e.target.value) * 100) }))} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
