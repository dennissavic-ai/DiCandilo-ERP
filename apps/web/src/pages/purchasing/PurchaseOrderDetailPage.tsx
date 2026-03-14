import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { purchasingApi, inventoryApi } from '../../services/api';
import { ArrowLeft, CheckCircle, Send, Package, Plus, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', SUBMITTED: 'badge-blue', APPROVED: 'badge-teal',
  PARTIALLY_RECEIVED: 'badge-yellow', RECEIVED: 'badge-green', CANCELLED: 'badge-red',
};

function fmtMoney(cents: number) { return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}` }

interface POLine { productId: string; description: string; uom: string; qtyOrdered: number; unitCost: number; }
const BLANK_LINE: POLine = { productId: '', description: '', uom: 'EA', qtyOrdered: 1, unitCost: 0 };

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: po, isLoading } = useQuery({
    queryKey: ['po', id],
    queryFn: () => purchasingApi.getOrder(id!).then((r) => r.data),
    enabled: !!id,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-dd'],
    queryFn: () => inventoryApi.listProducts({ limit: 500, isBought: true }).then((r) => r.data),
  });

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveLines, setReceiveLines] = useState<Array<{ purchaseOrderLineId: string; qtyReceived: number; locationId: string }>>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [newLine, setNewLine] = useState<POLine>({ ...BLANK_LINE });

  useEffect(() => {
    inventoryApi.listLocations().then((r) => setLocations(r.data as any));
  }, []);

  const submitMutation = useMutation({
    mutationFn: () => purchasingApi.submitOrder(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['po', id] }),
  });

  const approveMutation = useMutation({
    mutationFn: () => purchasingApi.approveOrder(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['po', id] }),
  });

  const receiveMutation = useMutation({
    mutationFn: () => purchasingApi.createReceipt(id!, { lines: receiveLines }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['po', id] }); setReceiveOpen(false); },
  });

  if (isLoading) return (
    <div className="max-w-[1100px] mx-auto animate-fade-in space-y-4">
      {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded" />)}
    </div>
  );

  const p = po as any;
  const lines: any[] = p?.lines ?? [];
  const total = p?.totalCost ?? lines.reduce((s: number, l: any) => s + (l.lineTotal ?? 0), 0);

  const canSubmit = p?.status === 'DRAFT';
  const canApprove = p?.status === 'SUBMITTED';
  const canReceive = ['APPROVED', 'PARTIALLY_RECEIVED'].includes(p?.status ?? '');

  function openReceive() {
    const defaultLocationId = locations[0]?.id ?? '';
    setReceiveLines(lines.map((l: any) => ({
      purchaseOrderLineId: l.id,
      qtyReceived: parseFloat(l.qtyOrdered ?? 0) - parseFloat(l.qtyReceived ?? 0),
      locationId: defaultLocationId,
    })));
    setReceiveOpen(true);
  }

  return (
    <div className="max-w-[1100px] mx-auto animate-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <button className="btn-ghost btn-sm" onClick={() => navigate('/purchasing/orders')}><ArrowLeft size={13} /> Purchase Orders</button>
      </div>

      <div className="page-header mt-2">
        <div>
          <h1 className="page-title">{p?.poNumber ?? '—'}</h1>
          <p className="page-subtitle">
            {p?.supplier?.name} · {p?.orderDate ? format(new Date(p.orderDate), 'dd MMM yyyy') : ''}
            {p?.expectedDate ? ` · expected ${format(new Date(p.expectedDate), 'dd MMM yyyy')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={STATUS_BADGE[p?.status] ?? 'badge-gray'}>{p?.status?.replace(/_/g, ' ')}</span>
          {canSubmit && (
            <button className="btn-secondary btn-sm" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
              <Send size={12} /> Submit
            </button>
          )}
          {canApprove && (
            <button className="btn-primary btn-sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
              <CheckCircle size={12} /> Approve
            </button>
          )}
          {canReceive && (
            <button className="btn-amber btn-sm" onClick={openReceive}>
              <Package size={12} /> Receive Stock
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <div className="card-header">
              <span className="text-sm font-semibold">Lines</span>
              {canSubmit && (
                <button className="btn-secondary btn-sm" onClick={() => setAddLineOpen(true)}><Plus size={12} /> Add Line</button>
              )}
            </div>
            <div className="table-container rounded-b-xl">
              <table className="table">
                <thead><tr>
                  <th>Product</th><th>Description</th>
                  <th className="text-right">Ordered</th><th className="text-right">Received</th>
                  <th>UOM</th><th className="text-right">Unit Cost</th><th className="text-right">Line Total</th>
                </tr></thead>
                <tbody>
                  {lines.length === 0
                    ? <tr><td colSpan={7} className="text-center text-sm text-muted-foreground py-10">No lines yet</td></tr>
                    : lines.map((l: any, i: number) => (
                      <tr key={l.id ?? i}>
                        <td className="font-mono text-xs">{l.product?.code ?? '—'}</td>
                        <td className="text-sm">{l.description}</td>
                        <td className="text-right font-mono text-xs">{parseFloat(l.qtyOrdered ?? 0).toFixed(2)}</td>
                        <td className="text-right font-mono text-xs">{parseFloat(l.qtyReceived ?? 0).toFixed(2)}</td>
                        <td className="text-xs">{l.uom}</td>
                        <td className="text-right font-mono text-xs">{fmtMoney(l.unitCost ?? 0)}</td>
                        <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtMoney(l.lineTotal ?? 0)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {p?.notes && (
            <div className="card">
              <div className="card-header"><span className="text-sm font-semibold">Notes</span></div>
              <div className="card-body text-sm text-steel-700 whitespace-pre-wrap">{p.notes}</div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Summary</span></div>
            <div className="card-body space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Lines</span><span>{lines.length}</span></div>
              <div className="flex justify-between font-bold border-t border-border pt-2">
                <span>Total Cost</span><span className="font-mono tabular-nums text-primary-700">{fmtMoney(total)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">PO Info</span></div>
            <div className="card-body space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Supplier</span><span className="font-medium">{p?.supplier?.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">PO #</span><span className="font-mono">{p?.poNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Order Date</span><span>{p?.orderDate ? format(new Date(p.orderDate), 'dd MMM yyyy') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Expected</span><span>{p?.expectedDate ? format(new Date(p.expectedDate), 'dd MMM yyyy') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Currency</span><span>{p?.supplier?.currencyCode ?? 'AUD'}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Receive Modal */}
      <Modal open={receiveOpen} onClose={() => setReceiveOpen(false)} title="Receive Stock" size="xl"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setReceiveOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={() => receiveMutation.mutate()} disabled={receiveMutation.isPending}>
            {receiveMutation.isPending ? 'Receiving…' : 'Receive'}
          </button>
        </>}>
        <div className="space-y-3">
          {receiveLines.map((rl, i) => {
            const line = lines.find((l: any) => l.id === rl.purchaseOrderLineId) as any;
            return (
              <div key={i} className="grid grid-cols-3 gap-3 p-3 bg-steel-50 rounded border border-border">
                <div>
                  <div className="text-xs font-medium">{line?.description}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Ordered: {parseFloat(line?.qtyOrdered ?? 0).toFixed(2)} · Received: {parseFloat(line?.qtyReceived ?? 0).toFixed(2)}</div>
                </div>
                <div className="form-group">
                  <label className="label text-xs">Qty Receiving</label>
                  <input type="number" className="input h-8 text-xs" min={0} step={0.001} value={rl.qtyReceived}
                    onChange={(e) => setReceiveLines((prev) => prev.map((r, j) => j === i ? { ...r, qtyReceived: Number(e.target.value) } : r))} />
                </div>
                <div className="form-group">
                  <label className="label text-xs">Location</label>
                  <select className="select h-8 text-xs" value={rl.locationId}
                    onChange={(e) => setReceiveLines((prev) => prev.map((r, j) => j === i ? { ...r, locationId: e.target.value } : r))}>
                    <option value="">Select…</option>
                    {locations.map((loc: any) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Add Line Modal */}
      <Modal open={addLineOpen} onClose={() => setAddLineOpen(false)} title="Add PO Line"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => { setAddLineOpen(false); setNewLine({ ...BLANK_LINE }); }}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!newLine.productId || !newLine.description} onClick={() => {
            purchasingApi.addLine(id!, {
              productId: newLine.productId,
              description: newLine.description,
              uom: newLine.uom,
              qtyOrdered: newLine.qtyOrdered,
              unitPrice: newLine.unitCost,
            }).then(() => {
              qc.invalidateQueries({ queryKey: ['po', id] });
              setAddLineOpen(false);
              setNewLine({ ...BLANK_LINE });
            });
          }}>Add</button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Product</label>
            <select className="input" value={newLine.productId} onChange={(e) => {
              const p = (productsData?.data ?? []).find((pr: any) => pr.id === e.target.value);
              if (p) setNewLine((l) => ({ ...l, productId: p.id, description: p.description, uom: p.uom }));
              else setNewLine((l) => ({ ...l, productId: '' }));
            }}>
              <option value="">Select product…</option>
              {(productsData?.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.description}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Description *</label>
            <input className="input" value={newLine.description} onChange={(e) => setNewLine((l) => ({ ...l, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="form-group">
              <label className="label">Qty</label>
              <input type="number" className="input" value={newLine.qtyOrdered} min={0.001}
                onChange={(e) => setNewLine((l) => ({ ...l, qtyOrdered: Number(e.target.value) }))} />
            </div>
            <div className="form-group">
              <label className="label">UOM</label>
              <select className="input" value={newLine.uom} onChange={(e) => setNewLine((l) => ({ ...l, uom: e.target.value }))}>
                {['EA', 'KG', 'M', 'M2', 'M3', 'LM', 'PC', 'SET', 'L', 'T'].map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Unit Cost</label>
              <input type="number" className="input" step="0.01" value={(newLine.unitCost / 100).toFixed(2)}
                onChange={(e) => setNewLine((l) => ({ ...l, unitCost: Math.round(Number(e.target.value) * 100) }))} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
