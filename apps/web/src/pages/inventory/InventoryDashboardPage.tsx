import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { inventoryApi } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Package, DollarSign, Layers, AlertTriangle, ToggleLeft, ToggleRight } from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtCurrency(cents: number) {
  if (cents >= 1_000_000_00) return `$${(cents / 1_000_000_00).toFixed(2)}M`;
  if (cents >= 1_000_00)     return `$${(cents / 1_000_00).toFixed(1)}K`;
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0 })}`;
}

function fmtQty(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-AU', { maximumFractionDigits: 2 });
}

// Pastel palette for category breakdown
const PALETTE = [
  '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
];

interface DashItem {
  productId: string;
  code: string;
  description: string;
  uom: string;
  category: string;
  qtyOnHand: number;
  totalValue: number;
}

interface CatItem {
  category: string;
  value: number;
  qty: number;
}

interface DashData {
  grandTotal: number;
  totalQty: number;
  productCount: number;
  items: DashItem[];
  byCategory: CatItem[];
}

// ── Horizontal bar chart ───────────────────────────────────────────────────────

function HorizBarChart({
  items,
  mode,
  maxItems = 20,
}: {
  items: DashItem[];
  mode: 'value' | 'qty';
  maxItems?: number;
}) {
  const sorted = [...items]
    .sort((a, b) => (mode === 'value' ? b.totalValue - a.totalValue : b.qtyOnHand - a.qtyOnHand))
    .slice(0, maxItems);

  const maxVal = Math.max(...sorted.map((i) => (mode === 'value' ? i.totalValue : i.qtyOnHand)), 1);

  return (
    <div className="space-y-1.5">
      {sorted.map((item, idx) => {
        const raw = mode === 'value' ? item.totalValue : item.qtyOnHand;
        const pct = (raw / maxVal) * 100;
        const label = mode === 'value' ? fmtCurrency(raw) : `${fmtQty(raw)} ${item.uom}`;
        return (
          <div key={item.productId} className="flex items-center gap-2 group">
            {/* Code */}
            <div className="w-36 flex-shrink-0 text-right">
              <span
                className="text-[11px] font-mono font-semibold text-primary-700 truncate inline-block max-w-full"
                title={item.description}
              >
                {item.code}
              </span>
            </div>
            {/* Bar */}
            <div className="flex-1 bg-steel-100 rounded-full h-4 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(pct, 0.5)}%`,
                  background: PALETTE[idx % PALETTE.length],
                }}
              />
            </div>
            {/* Value */}
            <div className="w-24 flex-shrink-0 text-right">
              <span className="text-xs font-mono font-semibold text-steel-700">{label}</span>
            </div>
          </div>
        );
      })}
      {sorted.length === 0 && (
        <div className="py-8 text-center text-sm text-steel-400">No inventory data</div>
      )}
    </div>
  );
}

// ── Category donut (simple SVG) ────────────────────────────────────────────────

function CategoryBreakdown({ data, mode }: { data: CatItem[]; mode: 'value' | 'qty' }) {
  const total = data.reduce((s, c) => s + (mode === 'value' ? c.value : c.qty), 1);
  if (!data.length) return null;

  let cumPct = 0;
  const segments = data.slice(0, 8).map((c, i) => {
    const pct = ((mode === 'value' ? c.value : c.qty) / total) * 100;
    const start = cumPct;
    cumPct += pct;
    return { ...c, pct, start, color: PALETTE[i % PALETTE.length] };
  });

  // SVG donut chart
  const R = 40, CX = 60, CY = 60, stroke = 22;
  function arc(startPct: number, pct: number) {
    const circumference = 2 * Math.PI * R;
    const offset = circumference - (pct / 100) * circumference;
    const rotation = (startPct / 100) * 360 - 90;
    return { strokeDasharray: `${circumference} ${circumference}`, strokeDashoffset: offset, rotate: rotation };
  }

  return (
    <div className="flex items-start gap-4">
      {/* Donut */}
      <svg width="120" height="120" className="flex-shrink-0">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const a = arc(s.start, s.pct);
          return (
            <circle key={i} cx={CX} cy={CY} r={R} fill="none"
              stroke={s.color} strokeWidth={stroke}
              strokeDasharray={a.strokeDasharray}
              strokeDashoffset={a.strokeDashoffset}
              transform={`rotate(${a.rotate} ${CX} ${CY})`}
            />
          );
        })}
      </svg>
      {/* Legend */}
      <div className="flex-1 space-y-1.5 pt-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <span className="text-xs text-steel-700 truncate flex-1" title={s.category}>{s.category}</span>
            <span className="text-xs font-mono font-semibold text-steel-600">
              {mode === 'value' ? fmtCurrency(s.value) : fmtQty(s.qty)}
            </span>
            <span className="text-[10px] text-steel-400 w-8 text-right">{s.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── KPI card ───────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, color }: { icon: React.ComponentType<any>; label: string; value: string; color: string }) {
  return (
    <div className="card card-body flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon size={16} className="text-white" />
      </div>
      <div>
        <div className="text-lg font-bold text-steel-900">{value}</div>
        <div className="text-xs text-steel-500">{label}</div>
      </div>
    </div>
  );
}

// ── InventoryDashboardPage ─────────────────────────────────────────────────────

export function InventoryDashboardPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'value' | 'qty'>('value');

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-dashboard'],
    queryFn: () => inventoryApi.getDashboard().then((r) => r.data as { data: DashData }),
    refetchInterval: 120_000,
  });

  const d = data?.data;

  // Low-stock items (qtyOnHand === 0) for alert strip
  const { data: stockData } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => inventoryApi.getStockOnHand({ limit: 500 }).then((r) => r.data),
  });
  const zeroStock = (stockData?.data ?? []).filter((i: any) => Number(i.qtyOnHand) <= 0).length;
  const lowStock  = (stockData?.data ?? []).filter((i: any) => Number(i.qtyAvailable) > 0 && Number(i.qtyAvailable) <= (i.product?.reorderPoint ?? 0)).length;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Inventory Dashboard"
        subtitle="Visual breakdown of stock holdings by value and unit count"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="card card-body h-16 skeleton" />)
        ) : (
          <>
            <KpiCard icon={DollarSign} label="Total Stock Value"   value={d ? fmtCurrency(d.grandTotal) : '—'} color="bg-primary-600" />
            <KpiCard icon={Layers}     label="Product Lines"       value={String(d?.productCount ?? 0)}         color="bg-teal-600" />
            <KpiCard icon={AlertTriangle} label="Low Stock Alerts" value={String(lowStock)}                     color="bg-amber-500" />
            <KpiCard icon={Package}    label="Out of Stock"        value={String(zeroStock)}                    color="bg-red-500" />
          </>
        )}
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm font-medium text-steel-600">View by:</span>
        <div className="flex rounded-lg border border-steel-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setMode('value')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              mode === 'value' ? 'bg-primary-600 text-white' : 'bg-white text-steel-600 hover:bg-steel-50'
            }`}
          >
            <DollarSign size={12} /> Dollar Value
          </button>
          <button
            type="button"
            onClick={() => setMode('qty')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              mode === 'qty' ? 'bg-primary-600 text-white' : 'bg-white text-steel-600 hover:bg-steel-50'
            }`}
          >
            <Package size={12} /> Unit Count
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        {/* Bar chart */}
        <div className="card lg:col-span-2">
          <div className="card-header flex items-center justify-between">
            <h3 className="font-semibold">
              Top Products by {mode === 'value' ? 'Dollar Value' : 'Unit Count'}
            </h3>
            <span className="text-xs text-steel-400">Top 20</span>
          </div>
          <div className="card-body">
            {isLoading
              ? <div className="space-y-2">{Array.from({length:8}).map((_,i) => <div key={i} className="skeleton h-5 rounded" />)}</div>
              : <HorizBarChart items={d?.items ?? []} mode={mode} />
            }
          </div>
        </div>

        {/* Category breakdown */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold">By Category</h3>
          </div>
          <div className="card-body">
            {isLoading
              ? <div className="skeleton h-40 rounded" />
              : <CategoryBreakdown data={d?.byCategory ?? []} mode={mode} />
            }
          </div>
        </div>
      </div>

      {/* Full product table */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h3 className="font-semibold">All Products</h3>
          <button
            type="button"
            onClick={() => navigate('/inventory/stock-on-hand')}
            className="text-xs text-primary-600 hover:underline"
          >
            View stock detail →
          </button>
        </div>
        <div className="card-body p-0">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Product Code</th>
                <th>Description</th>
                <th>Category</th>
                <th className="text-right">Qty on Hand</th>
                <th className="text-right">Total Value</th>
                <th className="text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}>{Array.from({length:6}).map((_,j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                  ))
                : (d?.items ?? []).map((item, idx) => {
                    const pct = d!.grandTotal > 0 ? (item.totalValue / d!.grandTotal) * 100 : 0;
                    return (
                      <tr
                        key={item.productId}
                        className="cursor-pointer hover:bg-steel-50"
                        onClick={() => navigate(`/inventory/products/${item.productId}`)}
                      >
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: PALETTE[idx % PALETTE.length] }} />
                            <span className="font-mono text-xs font-bold text-primary-700">{item.code}</span>
                          </div>
                        </td>
                        <td className="text-steel-700 max-w-[240px] truncate" title={item.description}>{item.description}</td>
                        <td className="text-xs text-steel-500">{item.category}</td>
                        <td className="text-right font-mono text-sm tabular-nums">{fmtQty(item.qtyOnHand)} {item.uom}</td>
                        <td className="text-right font-mono text-sm font-semibold tabular-nums text-steel-800">{fmtCurrency(item.totalValue)}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-steel-100 rounded-full h-1.5 overflow-hidden">
                              <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-steel-500 w-8 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>
          {!isLoading && !d?.items?.length && (
            <div className="py-10 text-center text-sm text-steel-400">No inventory data — receive some stock to get started.</div>
          )}
        </div>
      </div>
    </div>
  );
}
