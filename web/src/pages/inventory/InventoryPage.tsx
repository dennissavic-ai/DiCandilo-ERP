import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, Package, Download, QrCode } from 'lucide-react';
import { inventoryApi, InventoryItem } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { DataTable, Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { useAuthStore } from '../../store/authStore';

function formatQty(val: string | number): string {
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: 4 });
}
function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function mmDisplay(mm?: number): string {
  if (!mm) return '—';
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)}m`;
  return `${mm}mm`;
}

export function InventoryPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission('inventory', 'create');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isRemnant, setIsRemnant] = useState<boolean | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);
  const [barcodeModal, setBarcodeModal] = useState<{ open: boolean; item?: InventoryItem }>({ open: false });
  const [barcodeData, setBarcodeData] = useState<{ imageUrl?: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-items', page, search, isRemnant],
    queryFn: () => inventoryApi.listItems({ page, limit: 25, search: search || undefined, isRemnant }).then((r) => r.data),
  });

  const handleBarcode = async (item: InventoryItem) => {
    setBarcodeModal({ open: true, item });
    try {
      const { data } = await inventoryApi.generateBarcode({ entityType: 'INVENTORY_ITEM', entityId: item.id });
      setBarcodeData(data);
    } catch {
      setBarcodeData(null);
    }
  };

  const columns: Column<InventoryItem & Record<string, unknown>>[] = [
    {
      header: 'Product',
      cell: (row) => (
        <div>
          <div className="font-medium text-steel-900">{row.product?.code}</div>
          <div className="text-xs text-steel-500 truncate max-w-[200px]">{row.product?.description}</div>
        </div>
      ),
    },
    {
      header: 'Location',
      cell: (row) => (
        <span className="badge-gray font-mono text-xs">{row.location?.code}</span>
      ),
    },
    {
      header: 'Grade / Alloy',
      cell: (row) => (
        <div className="text-xs">
          {row.product?.grade && <span className="badge-blue mr-1">{row.product.grade}</span>}
          {row.product?.alloy && <span className="badge-gray">{row.product.alloy}</span>}
        </div>
      ),
    },
    {
      header: 'Heat #',
      cell: (row) => <span className="font-mono text-xs">{row.heatNumber ?? '—'}</span>,
    },
    {
      header: 'Dimensions',
      cell: (row) => (
        <span className="text-xs text-steel-600 font-mono">
          {[row.thickness, row.width, row.length].filter(Boolean).map(mmDisplay).join(' × ')}
        </span>
      ),
    },
    {
      header: 'On Hand',
      className: 'text-right',
      cell: (row) => (
        <div className="text-right">
          <span className="font-semibold text-steel-900">{formatQty(row.qtyOnHand)}</span>
          <span className="text-xs text-steel-500 ml-1">{row.product?.uom}</span>
        </div>
      ),
    },
    {
      header: 'Available',
      className: 'text-right',
      cell: (row) => (
        <div className="text-right">
          <span className={`font-medium ${Number(row.qtyAvailable) === 0 ? 'text-red-600' : 'text-green-700'}`}>
            {formatQty(row.qtyAvailable)}
          </span>
        </div>
      ),
    },
    {
      header: 'Unit Cost',
      className: 'text-right',
      cell: (row) => <span className="font-mono text-sm">{centsToDisplay(Number(row.unitCost))}</span>,
    },
    {
      header: 'Total Value',
      className: 'text-right',
      cell: (row) => (
        <span className="font-mono text-sm font-semibold">{centsToDisplay(Number(row.totalCost))}</span>
      ),
    },
    {
      header: '',
      cell: (row) => (
        <div className="flex items-center gap-1">
          {row.isRemnant && <span className="badge-orange text-[10px]">Remnant</span>}
          {row.isQuarantined && <span className="badge-red text-[10px]">QC Hold</span>}
          <button
            onClick={(e) => { e.stopPropagation(); handleBarcode(row); }}
            className="p-1 rounded hover:bg-steel-100 text-steel-400 hover:text-steel-700"
            title="Generate barcode"
          >
            <QrCode size={13} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Inventory"
        subtitle="All stock on hand across all locations"
        breadcrumbs={[{ label: 'Inventory' }]}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary btn-sm" onClick={() => {}}>
              <Download size={14} /> Export
            </button>
            {canCreate && (
              <button className="btn-primary btn-sm" onClick={() => navigate('/inventory/receive')}>
                <Plus size={14} /> Receive Stock
              </button>
            )}
          </div>
        }
      />

      {/* Filters */}
      <div className="card mb-5">
        <div className="card-body py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
              <input
                type="search"
                placeholder="Search product, heat number…"
                className="input pl-9 py-1.5 text-sm"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select
              className="select py-1.5 text-sm w-44"
              value={isRemnant === undefined ? '' : String(isRemnant)}
              onChange={(e) => {
                setIsRemnant(e.target.value === '' ? undefined : e.target.value === 'true');
                setPage(1);
              }}
            >
              <option value="">All stock</option>
              <option value="false">Prime stock</option>
              <option value="true">Remnants only</option>
            </select>
            <button
              className="btn-secondary btn-sm"
              onClick={() => navigate('/inventory/adjust')}
            >
              <Filter size={13} /> Adjust Stock
            </button>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      {data && (
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="stat-card">
            <span className="text-xs text-steel-500 uppercase tracking-wider">Total Lines</span>
            <span className="text-xl font-bold">{data.meta.total.toLocaleString()}</span>
          </div>
          <div className="stat-card">
            <span className="text-xs text-steel-500 uppercase tracking-wider">Showing</span>
            <span className="text-xl font-bold">{data.data.length}</span>
          </div>
          <div className="stat-card">
            <span className="text-xs text-steel-500 uppercase tracking-wider">Page</span>
            <span className="text-xl font-bold">{data.meta.page} of {data.meta.totalPages}</span>
          </div>
        </div>
      )}

      {/* Table */}
      <DataTable
        columns={columns as Column<Record<string, unknown>>[]}
        data={(data?.data ?? []) as unknown as Record<string, unknown>[]}
        isLoading={isLoading}
        pagination={data?.meta}
        onPageChange={setPage}
        onRowClick={(row) => navigate(`/inventory/items/${(row as unknown as InventoryItem).id}`)}
        keyField="id"
        emptyMessage="No inventory items found. Receive stock to get started."
      />

      {/* Barcode modal */}
      <Modal
        open={barcodeModal.open}
        onClose={() => { setBarcodeModal({ open: false }); setBarcodeData(null); }}
        title="Item Barcode"
        size="sm"
        footer={
          <button
            onClick={() => { setBarcodeModal({ open: false }); setBarcodeData(null); }}
            className="btn-secondary btn-sm"
          >
            Close
          </button>
        }
      >
        {barcodeModal.item && (
          <div className="text-center space-y-3">
            <p className="font-medium">{barcodeModal.item.product?.code}</p>
            <p className="text-sm text-steel-500">{barcodeModal.item.product?.description}</p>
            {barcodeData?.imageUrl ? (
              <img src={barcodeData.imageUrl} alt="QR Code" className="mx-auto w-48 h-48" />
            ) : (
              <div className="w-48 h-48 bg-steel-100 rounded-xl mx-auto flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <p className="text-xs font-mono text-steel-500">ID: {barcodeModal.item.id.slice(0, 12)}…</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
