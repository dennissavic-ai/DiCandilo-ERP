import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../../services/api';
import { Package, AlertTriangle, TrendingDown, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function fmtCurrency(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}

export function InventoryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => inventoryApi.getStockOnHand({ limit: 200 }).then((r) => r.data),
  });

  const items = (data?.data ?? []).filter((item: any) =>
    !search ||
    item.product?.code?.toLowerCase().includes(search.toLowerCase()) ||
    item.product?.description?.toLowerCase().includes(search.toLowerCase()),
  );

  const totalValue = items.reduce((sum: number, i: any) => sum + Number(i.totalCost ?? 0), 0);
  const lowStock   = items.filter((i: any) => i.qtyAvailable <= (i.product?.reorderPoint ?? 0)).length;
  const zeroStock  = items.filter((i: any) => i.qtyOnHand <= 0).length;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock on Hand</h1>
          <p className="page-subtitle">Live inventory positions across all locations</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => navigate('/inventory/adjust')}>
            Adjust Stock
          </button>
          <button className="btn-primary btn-sm" onClick={() => navigate('/inventory/receive')}>
            <Plus size={13} /> Receive Stock
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="stat-card">
          <div className="w-8 h-8 bg-primary-500 rounded-xl flex items-center justify-center mb-3">
            <Package size={15} className="text-white" />
          </div>
          <div className="text-xl font-bold tabular-nums">{fmtCurrency(totalValue)}</div>
          <div className="text-xs text-muted-foreground">Total Inventory Value</div>
        </div>
        <div className="stat-card">
          <div className="w-8 h-8 bg-amber-500 rounded-xl flex items-center justify-center mb-3">
            <AlertTriangle size={15} className="text-white" />
          </div>
          <div className="text-xl font-bold tabular-nums">{lowStock}</div>
          <div className="text-xs text-muted-foreground">Low Stock Alerts</div>
        </div>
        <div className="stat-card">
          <div className="w-8 h-8 bg-red-500 rounded-xl flex items-center justify-center mb-3">
            <TrendingDown size={15} className="text-white" />
          </div>
          <div className="text-xl font-bold tabular-nums">{zeroStock}</div>
          <div className="text-xs text-muted-foreground">Out of Stock Items</div>
        </div>
      </div>

      {/* Search */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              className="input pl-8 h-9 text-sm"
              placeholder="Search by product code or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Product Code</th>
                <th>Description</th>
                <th>Location</th>
                <th className="text-right">On Hand</th>
                <th className="text-right">Allocated</th>
                <th className="text-right">Available</th>
                <th className="text-right">Unit Cost</th>
                <th className="text-right">Total Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-20" /></td>
                      ))}
                    </tr>
                  ))
                : items.map((item: any) => {
                    const isLow  = item.qtyAvailable <= (item.product?.reorderPoint ?? 0) && item.qtyAvailable > 0;
                    const isZero = item.qtyOnHand <= 0;
                    return (
                      <tr
                        key={item.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/inventory/products/${item.productId}`)}
                      >
                        <td className="font-mono text-xs font-semibold text-primary-700">
                          {item.product?.code}
                        </td>
                        <td className="max-w-[240px] truncate font-medium text-foreground text-sm" title={item.product?.description}>
                          {item.product?.description}
                        </td>
                        <td className="text-steel-500 text-xs">{item.location?.name ?? '—'}</td>
                        <td className="text-right font-mono text-sm tabular-nums font-medium">{item.qtyOnHand ?? 0}</td>
                        <td className="text-right font-mono text-sm tabular-nums text-amber-600">{item.qtyAllocated ?? 0}</td>
                        <td className="text-right font-mono text-sm tabular-nums font-semibold">{item.qtyAvailable ?? 0}</td>
                        <td className="text-right font-mono text-xs">${((item.unitCost ?? 0) / 100).toFixed(2)}</td>
                        <td className="text-right font-mono text-xs font-semibold">{fmtCurrency(Number(item.totalCost ?? 0))}</td>
                        <td>
                          {isZero  ? <span className="badge-red">Out of stock</span>  :
                           isLow   ? <span className="badge-yellow">Low stock</span>   :
                                     <span className="badge-green">In stock</span>}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>

        {!isLoading && items.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Package size={22} /></div>
            <p className="text-sm font-medium text-foreground">No inventory items found</p>
            <p className="text-xs text-muted-foreground mt-1">Receive some stock to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
