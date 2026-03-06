import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { salesApi, inventoryApi, type SalesQuote } from '../../services/api';
import { ArrowLeft, Plus, Trash2, Send, CheckCircle, XCircle, ArrowRight, Save, FileText } from 'lucide-react';
import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', SENT: 'badge-blue', ACCEPTED: 'badge-green',
  DECLINED: 'badge-red', EXPIRED: 'badge-orange', CONVERTED: 'badge-violet',
};

function fmtMoney(cents: number) { return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}` }

interface QuoteLine {
  id?: string;
  productId?: string;
  description: string;
  uom: string;
  qty: number;
  unitPrice: number;
  discount: number;
}

const BLANK_LINE: QuoteLine = { description: '', uom: 'EA', qty: 1, unitPrice: 0, discount: 0 };

export function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote', id],
    queryFn: () => salesApi.getQuote(id!).then((r) => r.data),
    enabled: !isNew && !!id,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-dd'],
    queryFn: () => inventoryApi.listProducts({ limit: 500, isSold: true }).then((r) => r.data),
  });

  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [notes, setNotes] = useState('');
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [newLine, setNewLine] = useState<QuoteLine>({ ...BLANK_LINE });

  useEffect(() => {
    if (quote) {
      setLines((quote as any).lines ?? []);
      setNotes((quote as any).notes ?? '');
    }
  }, [quote]);

  const saveMutation = useMutation({
    mutationFn: () => salesApi.updateQuoteStatus(id!, 'DRAFT'), // placeholder - would save lines
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quote', id] }),
  });

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

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice * (1 - l.discount / 100), 0);
  const gst      = subtotal * 0.1;
  const total    = subtotal + gst;

  function addLine() {
    setLines((prev) => [...prev, { ...newLine }]);
    setNewLine({ ...BLANK_LINE });
    setAddLineOpen(false);
  }

  function removeLine(i: number) { setLines((prev) => prev.filter((_, j) => j !== i)); }
  function updateLine(i: number, patch: Partial<QuoteLine>) {
    setLines((prev) => prev.map((l, j) => j === i ? { ...l, ...patch } : l));
  }

  const canEdit = !quote || ['DRAFT'].includes((quote as any).status ?? '');

  if (isLoading) return (
    <div className="max-w-[1100px] mx-auto animate-fade-in space-y-4">
      {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded" />)}
    </div>
  );

  const q = quote as any;

  return (
    <div className="max-w-[1100px] mx-auto animate-fade-in">
      {/* Back + header */}
      <div className="flex items-center gap-2 mb-1">
        <button className="btn-ghost btn-sm" onClick={() => navigate('/sales/quotes')}><ArrowLeft size={13} /> Quotes</button>
      </div>
      <div className="page-header mt-2">
        <div>
          <h1 className="page-title">{q?.quoteNumber ?? 'Quote'}</h1>
          <p className="page-subtitle">
            {q?.customer?.name} · {q?.quoteDate ? format(new Date(q.quoteDate), 'dd MMM yyyy') : ''}
            {q?.validUntil ? ` · valid until ${format(new Date(q.validUntil), 'dd MMM yyyy')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={STATUS_BADGE[q?.status] ?? 'badge-gray'}>{q?.status ?? 'DRAFT'}</span>
          {canEdit && (
            <button className="btn-secondary btn-sm" onClick={() => statusMutation.mutate('SENT')} disabled={statusMutation.isPending}>
              <Send size={12} /> Send
            </button>
          )}
          {q?.status === 'SENT' && <>
            <button className="btn-secondary btn-sm" onClick={() => statusMutation.mutate('ACCEPTED')}><CheckCircle size={12} /> Accept</button>
            <button className="btn-secondary btn-sm text-red-600" onClick={() => statusMutation.mutate('DECLINED')}><XCircle size={12} /> Decline</button>
          </>}
          {q?.status === 'ACCEPTED' && (
            <button className="btn-primary btn-sm" onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}>
              <ArrowRight size={12} /> Convert to Order
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Lines */}
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
                  <th className="text-right">Total</th>
                  {canEdit && <th></th>}
                </tr></thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr><td colSpan={7} className="text-center text-sm text-muted-foreground py-8">No lines yet — add items above</td></tr>
                  ) : lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        {canEdit
                          ? <input className="input h-7 text-xs w-full" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                          : <span className="text-sm">{l.description}</span>}
                      </td>
                      <td className="text-right">
                        {canEdit
                          ? <input className="input h-7 text-xs w-16 text-right" type="number" value={l.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} />
                          : l.qty}
                      </td>
                      <td>
                        {canEdit
                          ? <input className="input h-7 text-xs w-12" value={l.uom} onChange={(e) => updateLine(i, { uom: e.target.value })} />
                          : l.uom}
                      </td>
                      <td className="text-right">
                        {canEdit
                          ? <input className="input h-7 text-xs w-20 text-right" type="number" step="0.01" value={(l.unitPrice / 100).toFixed(2)}
                              onChange={(e) => updateLine(i, { unitPrice: Math.round(Number(e.target.value) * 100) })} />
                          : fmtMoney(l.unitPrice)}
                      </td>
                      <td className="text-right">
                        {canEdit
                          ? <input className="input h-7 text-xs w-14 text-right" type="number" value={l.discount} onChange={(e) => updateLine(i, { discount: Number(e.target.value) })} />
                          : `${l.discount}%`}
                      </td>
                      <td className="text-right font-mono text-xs font-semibold tabular-nums">
                        {fmtMoney(Math.round(l.qty * l.unitPrice * (1 - l.discount / 100)))}
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

          {/* Notes */}
          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Notes</span></div>
            <div className="card-body">
              <textarea className="input min-h-[80px] resize-none w-full text-sm" value={notes}
                onChange={(e) => setNotes(e.target.value)} placeholder="Add notes to this quote…"
                readOnly={!canEdit} />
            </div>
          </div>
        </div>

        {/* Sidebar summary */}
        <div className="space-y-4">
          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Summary</span></div>
            <div className="card-body space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono tabular-nums">{fmtMoney(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">GST (10%)</span><span className="font-mono tabular-nums">{fmtMoney(gst)}</span></div>
              <div className="flex justify-between font-bold border-t border-border pt-2 mt-2">
                <span>Total</span><span className="font-mono tabular-nums text-primary-700">{fmtMoney(total)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Details</span></div>
            <div className="card-body space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium">{q?.customer?.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Quote #</span><span className="font-mono">{q?.quoteNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Quote Date</span><span>{q?.quoteDate ? format(new Date(q.quoteDate), 'dd MMM yyyy') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Valid Until</span><span>{q?.validUntil ? format(new Date(q.validUntil), 'dd MMM yyyy') : '—'}</span></div>
            </div>
          </div>

          {canEdit && (
            <button className="btn-primary w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save size={13} /> {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          )}
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
            <select className="select" onChange={(e) => {
              const p = (productsData?.data ?? []).find((pr: any) => pr.id === e.target.value);
              if (p) setNewLine((l) => ({ ...l, productId: p.id, description: p.description, uom: p.uom, unitPrice: p.listPrice }));
            }}>
              <option value="">Select product or enter manually…</option>
              {(productsData?.data ?? []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.code} — {p.description}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Description *</label>
            <input className="input" value={newLine.description} onChange={(e) => setNewLine((l) => ({ ...l, description: e.target.value }))} placeholder="Item description…" />
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
                {['EA','KG','M','M2','M3','LM','PC','SET','L','T'].map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Disc %</label>
              <input type="number" className="input" value={newLine.discount} min={0} max={100}
                onChange={(e) => setNewLine((l) => ({ ...l, discount: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Unit Price (ex GST)</label>
            <input type="number" className="input" step="0.01" value={(newLine.unitPrice / 100).toFixed(2)}
              onChange={(e) => setNewLine((l) => ({ ...l, unitPrice: Math.round(Number(e.target.value) * 100) }))} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
