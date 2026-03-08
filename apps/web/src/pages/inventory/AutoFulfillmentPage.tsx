import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Plus, Pencil, Trash2, CheckCircle, XCircle,
  AlertTriangle, ShoppingCart, Zap, Clock, ExternalLink,
} from 'lucide-react';
import {
  fulfillmentApi, inventoryApi, purchasingApi,
  AutoFulfillmentRule, Product, Supplier,
} from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { DataTable, Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatQty(val: string | number): string {
  return parseFloat(String(val)).toFixed(4).replace(/\.?0+$/, '');
}

// ── Rule Form ─────────────────────────────────────────────────────────────────

interface RuleFormData {
  productId: string;
  supplierId: string;
  reorderPoint: string;
  reorderQty: string;
  unitPrice: string;
  leadTimeDays: string;
  notes: string;
  isActive: boolean;
}

const DEFAULT_FORM: RuleFormData = {
  productId: '',
  supplierId: '',
  reorderPoint: '',
  reorderQty: '',
  unitPrice: '',
  leadTimeDays: '',
  notes: '',
  isActive: true,
};

interface RuleModalProps {
  open: boolean;
  onClose: () => void;
  initial?: AutoFulfillmentRule | null;
}

function RuleModal({ open, onClose, initial }: RuleModalProps) {
  const qc = useQueryClient();
  const isEditing = Boolean(initial);

  const [form, setForm] = useState<RuleFormData>(() =>
    initial
      ? {
          productId:    initial.productId,
          supplierId:   initial.supplierId,
          reorderPoint: formatQty(initial.reorderPoint),
          reorderQty:   formatQty(initial.reorderQty),
          unitPrice:    centsToDisplay(initial.unitPrice),
          leadTimeDays: initial.leadTimeDays != null ? String(initial.leadTimeDays) : '',
          notes:        initial.notes ?? '',
          isActive:     initial.isActive,
        }
      : DEFAULT_FORM,
  );

  const [error, setError] = useState<string | null>(null);

  // Products and suppliers for selects
  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => inventoryApi.listProducts({ limit: 500 }).then((r) => r.data.data),
    enabled: open,
  });
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-all'],
    queryFn: () => purchasingApi.listSuppliers({ limit: 500 }).then((r) => r.data.data),
    enabled: open,
  });

  const products: Product[] = productsData ?? [];
  const suppliers: Supplier[] = suppliersData ?? [];

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => {
      const payload = {
        productId:    form.productId,
        supplierId:   form.supplierId,
        reorderPoint: parseFloat(form.reorderPoint),
        reorderQty:   parseFloat(form.reorderQty),
        unitPrice:    form.unitPrice ? parseFloat(form.unitPrice) : 0,
        leadTimeDays: form.leadTimeDays ? parseInt(form.leadTimeDays, 10) : null,
        notes:        form.notes || null,
        isActive:     form.isActive,
      };
      return isEditing && initial
        ? fulfillmentApi.updateRule(initial.id, payload)
        : fulfillmentApi.createRule(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fulfillment-rules'] });
      onClose();
      setForm(DEFAULT_FORM);
      setError(null);
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'Failed to save rule.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.productId) { setError('Please select a product.'); return; }
    if (!form.supplierId) { setError('Please select a supplier.'); return; }
    if (!form.reorderPoint || isNaN(parseFloat(form.reorderPoint))) { setError('Enter a valid reorder point.'); return; }
    if (!form.reorderQty   || isNaN(parseFloat(form.reorderQty)))   { setError('Enter a valid reorder quantity.'); return; }
    save();
  }

  const selectedProduct = products.find((p) => p.id === form.productId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit Fulfillment Rule' : 'New Fulfillment Rule'}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">
            Cancel
          </button>
          <button
            type="submit"
            form="rule-form"
            disabled={isPending}
            className="btn-primary btn-sm"
          >
            {isPending ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                Saving…
              </span>
            ) : (
              isEditing ? 'Save Changes' : 'Create Rule'
            )}
          </button>
        </>
      }
    >
      <form id="rule-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
            <XCircle size={14} />
            {error}
          </div>
        )}

        {/* Product */}
        <div>
          <label className="block text-xs font-medium text-steel-600 mb-1">
            Product <span className="text-red-500">*</span>
          </label>
          <select
            value={form.productId}
            onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
            disabled={isEditing}
            className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900 disabled:bg-steel-50 disabled:text-steel-400"
          >
            <option value="">— Select product —</option>
            {products.filter((p) => p.isActive && p.isBought).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.description}
              </option>
            ))}
          </select>
          {isEditing && (
            <p className="text-xs text-steel-400 mt-1">Product cannot be changed on an existing rule.</p>
          )}
        </div>

        {/* Supplier */}
        <div>
          <label className="block text-xs font-medium text-steel-600 mb-1">
            Preferred Supplier <span className="text-red-500">*</span>
          </label>
          <select
            value={form.supplierId}
            onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900"
          >
            <option value="">— Select supplier —</option>
            {suppliers.filter((s) => s.isActive).map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Reorder thresholds */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">
              Reorder Point{selectedProduct ? ` (${selectedProduct.uom})` : ''} <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={form.reorderPoint}
              onChange={(e) => setForm((f) => ({ ...f, reorderPoint: e.target.value }))}
              placeholder="e.g. 100"
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900 placeholder-steel-400"
            />
            <p className="text-xs text-steel-400 mt-1">Create PO when stock falls below this quantity.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">
              Order Quantity{selectedProduct ? ` (${selectedProduct.uom})` : ''} <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={form.reorderQty}
              onChange={(e) => setForm((f) => ({ ...f, reorderQty: e.target.value }))}
              placeholder="e.g. 500"
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900 placeholder-steel-400"
            />
            <p className="text-xs text-steel-400 mt-1">Quantity to put on the draft PO.</p>
          </div>
        </div>

        {/* Unit price + lead time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Est. Unit Price ($)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.unitPrice}
              onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
              placeholder="0.00"
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900 placeholder-steel-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Lead Time (days)</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.leadTimeDays}
              onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: e.target.value }))}
              placeholder="e.g. 14"
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900 placeholder-steel-400"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-steel-600 mb-1">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            placeholder="Optional internal notes…"
            className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900 placeholder-steel-400 resize-none"
          />
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.isActive}
            onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 ${
              form.isActive ? 'bg-primary-600' : 'bg-steel-200'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                form.isActive ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`}
            />
          </button>
          <span className="text-sm text-steel-700">Rule active</span>
        </div>
      </form>
    </Modal>
  );
}

// ── Delete Confirm Modal ───────────────────────────────────────────────────────

function DeleteModal({ rule, onClose }: { rule: AutoFulfillmentRule; onClose: () => void }) {
  const qc = useQueryClient();
  const { mutate: del, isPending } = useMutation({
    mutationFn: () => fulfillmentApi.deleteRule(rule.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fulfillment-rules'] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Remove Rule"
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">Cancel</button>
          <button
            type="button"
            onClick={() => del()}
            disabled={isPending}
            className="btn-danger btn-sm"
          >
            {isPending ? 'Removing…' : 'Remove'}
          </button>
        </>
      }
    >
      <p className="text-sm text-steel-600">
        Remove the auto-fulfillment rule for{' '}
        <span className="font-semibold text-steel-900">{rule.product.code}</span>?{' '}
        The product will no longer be monitored for automatic restocking.
      </p>
    </Modal>
  );
}

// ── Rules Tab ─────────────────────────────────────────────────────────────────

function RulesTab() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AutoFulfillmentRule | null>(null);
  const [deleting, setDeleting] = useState<AutoFulfillmentRule | null>(null);
  const [runResult, setRunResult] = useState<{ posCreated: number; checked: number } | null>(null);

  const { data: rules, isLoading } = useQuery({
    queryKey: ['fulfillment-rules'],
    queryFn: () => fulfillmentApi.listRules().then((r) => r.data as AutoFulfillmentRule[]),
  });

  const { mutate: runCheck, isPending: isRunning } = useMutation({
    mutationFn: () => fulfillmentApi.runCheck(),
    onSuccess: (res) => {
      const result = res.data as any;
      setRunResult({ posCreated: result.posCreated, checked: result.checked });
      qc.invalidateQueries({ queryKey: ['fulfillment-recent-pos'] });
      setTimeout(() => setRunResult(null), 8000);
    },
  });

  const columns: Column<AutoFulfillmentRule>[] = [
    {
      header: 'Product',
      cell: (r) => (
        <div>
          <div className="text-sm font-mono font-medium text-steel-900">{r.product.code}</div>
          <div className="text-xs text-steel-500 truncate max-w-[200px]">{r.product.description}</div>
        </div>
      ),
    },
    {
      header: 'Supplier',
      cell: (r) => (
        <div>
          <div className="text-sm font-medium text-steel-800">{r.supplier.name}</div>
          <div className="text-xs text-steel-400 font-mono">{r.supplier.code}</div>
        </div>
      ),
    },
    {
      header: 'Reorder Point',
      cell: (r) => (
        <span className="text-sm text-steel-800">
          {formatQty(r.reorderPoint)}{' '}
          <span className="text-xs text-steel-400">{r.product.uom}</span>
        </span>
      ),
    },
    {
      header: 'Order Qty',
      cell: (r) => (
        <span className="text-sm text-steel-800">
          {formatQty(r.reorderQty)}{' '}
          <span className="text-xs text-steel-400">{r.product.uom}</span>
        </span>
      ),
    },
    {
      header: 'Unit Price',
      cell: (r) => (
        <span className="text-sm text-steel-700">
          {r.unitPrice > 0 ? `$${centsToDisplay(r.unitPrice)}` : <span className="text-steel-400">—</span>}
        </span>
      ),
    },
    {
      header: 'Lead Time',
      cell: (r) => (
        <span className="text-sm text-steel-600">
          {r.leadTimeDays != null ? `${r.leadTimeDays}d` : <span className="text-steel-400">—</span>}
        </span>
      ),
    },
    {
      header: 'Last Triggered',
      cell: (r) => (
        r.lastTriggeredAt
          ? (
            <div className="flex items-center gap-1 text-xs text-steel-500">
              <Clock size={11} />
              {new Date(r.lastTriggeredAt).toLocaleDateString()}
            </div>
          )
          : <span className="text-xs text-steel-400">Never</span>
      ),
    },
    {
      header: 'Status',
      cell: (r) => (
        r.isActive
          ? <span className="badge-green">Active</span>
          : <span className="badge-gray">Disabled</span>
      ),
    },
    {
      header: '',
      className: 'text-right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => { setEditing(r); setShowModal(true); }}
            className="p-1.5 rounded-md text-steel-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
            title="Edit rule"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => setDeleting(r)}
            className="p-1.5 rounded-md text-steel-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            title="Remove rule"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {runResult && (
            <div className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border ${
              runResult.posCreated > 0
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-green-50 text-green-700 border-green-200'
            }`}>
              {runResult.posCreated > 0
                ? <><AlertTriangle size={13} /> {runResult.posCreated} draft PO{runResult.posCreated !== 1 ? 's' : ''} created</>
                : <><CheckCircle size={13} /> All {runResult.checked} products are above their reorder points</>
              }
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => runCheck()}
            disabled={isRunning}
            className="btn-secondary btn-sm flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={isRunning ? 'animate-spin' : ''} />
            {isRunning ? 'Checking…' : 'Run Check Now'}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(null); setShowModal(true); }}
            className="btn-primary btn-sm flex items-center gap-1.5"
          >
            <Plus size={13} />
            Add Rule
          </button>
        </div>
      </div>

      {/* Rules table */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Zap size={15} className="text-steel-500" />
          <h3 className="font-semibold">Fulfillment Rules</h3>
          {rules && (
            <span className="ml-auto text-xs text-steel-400">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="card-body p-0">
          <DataTable
            columns={columns as unknown as Column<Record<string, unknown>>[]}
            data={(rules ?? []) as unknown as Record<string, unknown>[]}
            isLoading={isLoading}
            keyField="id"
            emptyMessage="No fulfillment rules configured. Click 'Add Rule' to create one."
          />
        </div>
      </div>

      {/* How it works callout */}
      {!isLoading && (rules ?? []).length === 0 && (
        <div className="card border-dashed">
          <div className="card-body">
            <div className="text-center py-4">
              <Zap size={32} className="mx-auto mb-3 text-steel-300" />
              <h3 className="text-sm font-semibold text-steel-700 mb-1">How Auto Fulfillment works</h3>
              <p className="text-xs text-steel-500 max-w-md mx-auto">
                Set a <strong>reorder point</strong> (minimum stock level) and an <strong>order quantity</strong> per product.
                Every hour the system checks current stock levels. When a product's available quantity
                drops below its reorder point, a <strong>draft Purchase Order</strong> is automatically
                created and marked for your review. You approve and send it — we handle the rest.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <RuleModal
        open={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        initial={editing}
      />
      {deleting && <DeleteModal rule={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

// ── Auto-Generated POs Tab ────────────────────────────────────────────────────

function AutoPosTab() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['fulfillment-recent-pos', page],
    queryFn: () =>
      fulfillmentApi.listRecentPos({ page, limit: 20 }).then((r) => r.data as {
        data: any[];
        meta: { total: number; page: number; limit: number; totalPages: number };
      }),
  });

  const columns: Column<Record<string, unknown>>[] = [
    {
      header: 'PO Number',
      cell: (r) => (
        <span className="text-sm font-mono font-medium text-primary-700">{r.poNumber as string}</span>
      ),
    },
    {
      header: 'Supplier',
      cell: (r) => {
        const s = r.supplier as any;
        return (
          <div>
            <div className="text-sm font-medium text-steel-800">{s?.name}</div>
            <div className="text-xs text-steel-400 font-mono">{s?.code}</div>
          </div>
        );
      },
    },
    {
      header: 'Product',
      cell: (r) => {
        const lines = r.lines as any[];
        const first = lines?.[0];
        return first ? (
          <div>
            <div className="text-sm font-mono font-medium text-steel-900">{first.product?.code}</div>
            <div className="text-xs text-steel-500 truncate max-w-[180px]">{first.product?.description}</div>
          </div>
        ) : <span className="text-steel-400">—</span>;
      },
    },
    {
      header: 'Qty Ordered',
      cell: (r) => {
        const lines = r.lines as any[];
        const first = lines?.[0];
        return first ? (
          <span className="text-sm text-steel-800">
            {formatQty(first.qtyOrdered)}{' '}
            <span className="text-xs text-steel-400">{first.product?.uom}</span>
          </span>
        ) : <span className="text-steel-400">—</span>;
      },
    },
    {
      header: 'Status',
      cell: (r) => {
        const status = r.status as string;
        if (status === 'DRAFT')    return <span className="badge-gray">Draft — Needs Review</span>;
        if (status === 'SUBMITTED') return <span className="badge-blue">Submitted</span>;
        if (status === 'APPROVED')  return <span className="badge-green">Approved</span>;
        return <span className="badge-gray">{status}</span>;
      },
    },
    {
      header: 'Created',
      cell: (r) => (
        <span className="text-xs text-steel-500 font-mono">
          {new Date(r.createdAt as string).toLocaleString()}
        </span>
      ),
    },
    {
      header: '',
      className: 'text-right',
      cell: (r) => (
        <button
          onClick={() => navigate(`/purchasing/orders/${r.id as string}`)}
          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium"
        >
          <ExternalLink size={11} />
          Review PO
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Draft POs require your approval.</span>{' '}
          Click <em>Review PO</em> on any row below to open the purchase order, verify the details,
          and submit it to trigger the supplier email.
        </div>
      </div>

      {/* POs table */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <ShoppingCart size={15} className="text-steel-500" />
          <h3 className="font-semibold">Auto-Generated Purchase Orders</h3>
          {data?.meta && (
            <span className="ml-auto text-xs text-steel-400">{data.meta.total} total</span>
          )}
        </div>
        <div className="card-body p-0">
          <DataTable
            columns={columns}
            data={data?.data ?? []}
            isLoading={isLoading}
            pagination={data?.meta}
            onPageChange={setPage}
            keyField="id"
            emptyMessage="No auto-generated POs yet. Once a product drops below its reorder point, a draft PO will appear here."
          />
        </div>
      </div>
    </div>
  );
}

// ── AutoFulfillmentPage ────────────────────────────────────────────────────────

type Tab = 'rules' | 'pos';

export function AutoFulfillmentPage() {
  const [activeTab, setActiveTab] = useState<Tab>('rules');

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Auto Fulfillment"
        subtitle="Automatically create draft purchase orders when stock falls below reorder levels"
        actions={
          <div className="flex items-center gap-1.5 text-xs text-steel-400">
            <Zap size={13} />
            <span>Inventory</span>
            <span className="text-steel-300">/</span>
            <span>Auto Fulfillment</span>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-steel-200">
        {([
          { key: 'rules', label: 'Fulfillment Rules',      icon: Zap },
          { key: 'pos',   label: 'Auto-Generated POs',     icon: ShoppingCart },
        ] as { key: Tab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[]).map(
          ({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-steel-500 hover:text-steel-700 hover:border-steel-300'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ),
        )}
      </div>

      {activeTab === 'rules' && <RulesTab />}
      {activeTab === 'pos'   && <AutoPosTab />}
    </div>
  );
}
