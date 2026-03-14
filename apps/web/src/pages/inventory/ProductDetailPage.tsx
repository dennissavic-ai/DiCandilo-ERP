import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Package, MapPin, Hash, Scale, Ruler, Tag, FileText, BarChart3, QrCode, Printer } from 'lucide-react';
import { inventoryApi, Product } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { DataTable, Column } from '../../components/ui/DataTable';

function mmDisplay(mm?: number | null): string {
  if (!mm) return '—';
  return `${mm}mm`;
}

function gramsToKg(g?: number | null | bigint): string {
  if (!g) return '—';
  return `${(Number(g) / 1000).toFixed(3)} kg/m`;
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => inventoryApi.getProduct(id!).then((r) => r.data as Product & {
      inventoryItems: Array<{
        id: string; qtyOnHand: string; qtyAvailable: string; unitCost: number; totalCost: number;
        heatNumber?: string; location: { code: string; name: string };
      }>;
    }),
    enabled: !!id,
  });

  const [barcodeEnabled, setBarcodeEnabled] = useState(false);
  const {
    data: barcodeData,
    isFetching: barcodeLoading,
    refetch: fetchBarcodes,
  } = useQuery({
    queryKey: ['barcode-label', id],
    queryFn: () => inventoryApi.getProductBarcodeLabel(id!).then((r) => r.data as {
      qrCode: { dataUrl: string; data: string; standard: string };
      code128: { dataUrl: string; data: string; standard: string };
    }),
    enabled: barcodeEnabled && !!id,
  });

  function handleGenerateBarcodes() {
    setBarcodeEnabled(true);
    fetchBarcodes();
  }

  function handleCopySku() {
    if (product?.code) {
      navigator.clipboard.writeText(product.code);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!product) return <div>Product not found.</div>;

  const stockColumns: Column<Record<string, unknown>>[] = [
    { header: 'Location', cell: (r) => <span className="badge-gray font-mono">{(r.location as { code: string }).code}</span> },
    { header: 'Heat #', cell: (r) => <span className="font-mono text-xs">{(r.heatNumber as string) ?? '—'}</span> },
    { header: 'On Hand', className: 'text-right', cell: (r) => <span className="font-semibold">{Number(r.qtyOnHand).toLocaleString()}</span> },
    { header: 'Available', className: 'text-right', cell: (r) => <span className={`font-medium ${Number(r.qtyAvailable) === 0 ? 'text-red-600' : 'text-green-700'}`}>{Number(r.qtyAvailable).toLocaleString()}</span> },
    { header: 'Unit Cost', className: 'text-right', cell: (r) => <span className="font-mono">${(Number(r.unitCost) / 100).toFixed(2)}</span> },
    { header: 'Total Value', className: 'text-right', cell: (r) => <span className="font-mono font-semibold">${(Number(r.totalCost) / 100).toFixed(2)}</span> },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={product.code}
        subtitle={product.description}
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Products', href: '/inventory/products' }, { label: product.code }]}
        actions={
          <button onClick={() => navigate(-1)} className="btn-secondary btn-sm">
            <ArrowLeft size={14} /> Back
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attributes */}
        <div className="lg:col-span-2 space-y-5">
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Package size={15} className="text-steel-500" />
              <h3 className="font-semibold">Product Details</h3>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                {[
                  { label: 'Product Code', value: product.code, icon: Tag },
                  { label: 'Category', value: (product.category as { name: string } | undefined)?.name ?? '—', icon: Package },
                  { label: 'Material Type', value: product.materialType ?? '—', icon: Package },
                  { label: 'Grade', value: product.grade ?? '—', icon: Hash },
                  { label: 'Alloy / Temper', value: product.alloy ?? '—', icon: Hash },
                  { label: 'Shape', value: product.shape ?? '—', icon: Package },
                  { label: 'Finish', value: product.finish ?? '—', icon: Package },
                  { label: 'Coating', value: product.coating ?? '—', icon: Package },
                  { label: 'UOM', value: product.uom, icon: Scale },
                  { label: 'Cost Method', value: product.costMethod, icon: BarChart3 },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-2">
                    <item.icon size={13} className="text-steel-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs text-steel-500">{item.label}</div>
                      <div className="font-medium text-steel-900">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Dimensions */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Ruler size={15} className="text-steel-500" />
              <h3 className="font-semibold">Standard Dimensions</h3>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                {[
                  { label: 'Thickness', value: mmDisplay(product.standardThickness) },
                  { label: 'Width', value: mmDisplay(product.standardWidth) },
                  { label: 'Length', value: mmDisplay(product.standardLength) },
                  { label: 'Weight / m', value: gramsToKg(product.weightPerMeter) },
                ].map((d) => (
                  <div key={d.label} className="bg-steel-50 rounded-lg p-3 text-center">
                    <div className="text-xs text-steel-500 mb-1">{d.label}</div>
                    <div className="font-semibold text-steel-900 font-mono">{d.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stock */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <MapPin size={15} className="text-steel-500" />
              <h3 className="font-semibold">Stock by Location</h3>
            </div>
            <div className="card-body p-0">
              <DataTable
                columns={stockColumns}
                data={(product.inventoryItems ?? []) as unknown as Record<string, unknown>[]}
                keyField="id"
                emptyMessage="No stock on hand."
              />
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="space-y-5">
          {/* Pricing */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <FileText size={15} className="text-steel-500" />
              <h3 className="font-semibold">Pricing</h3>
            </div>
            <div className="card-body space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-steel-500">Standard Cost</span>
                <span className="font-mono font-semibold">${(product.standardCost / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-steel-500">List Price</span>
                <span className="font-mono font-semibold text-green-700">${(product.listPrice / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-steel-500">Margin</span>
                <span className="font-mono font-semibold text-blue-700">
                  {product.standardCost > 0
                    ? `${(((product.listPrice - product.standardCost) / product.standardCost) * 100).toFixed(1)}%`
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Flags */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold">Product Flags</h3>
            </div>
            <div className="card-body space-y-2">
              {[
                { label: 'Purchased', value: product.isBought },
                { label: 'Sold', value: product.isSold },
                { label: 'Stocked', value: product.isStocked },
                { label: 'Track by Heat #', value: product.trackByHeat },
                { label: 'Requires MTR', value: product.requiresMtr },
              ].map((f) => (
                <div key={f.label} className="flex items-center justify-between text-sm">
                  <span className="text-steel-600">{f.label}</span>
                  <span className={f.value ? 'badge-green' : 'badge-gray'}>{f.value ? 'Yes' : 'No'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Barcodes & Labels */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <QrCode size={15} className="text-steel-500" />
              <h3 className="font-semibold">Barcodes &amp; Labels</h3>
            </div>
            <div className="card-body space-y-3">
              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerateBarcodes}
                  disabled={barcodeLoading}
                  className="btn-secondary btn-sm flex items-center gap-1.5"
                >
                  {barcodeLoading ? (
                    <>
                      <span className="w-3 h-3 border border-steel-400 border-t-transparent rounded-full animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <QrCode size={13} />
                      Generate
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/inventory/products/${product.id}/barcodes`)}
                  className="btn-secondary btn-sm flex items-center gap-1.5"
                >
                  <Printer size={13} />
                  Print Label
                </button>
                <button
                  type="button"
                  onClick={handleCopySku}
                  className="btn-secondary btn-sm flex items-center gap-1.5"
                >
                  Copy SKU
                </button>
              </div>

              {/* Barcode images */}
              {barcodeData && (
                <div className="space-y-3 pt-1 border-t border-steel-100">
                  {/* QR Code */}
                  <div className="flex items-start gap-3">
                    <img
                      src={barcodeData.qrCode.dataUrl}
                      alt="QR Code"
                      className="w-20 h-20 object-contain border border-steel-100 rounded-lg bg-white p-1"
                    />
                    <div className="text-xs text-steel-500 mt-1">
                      <div className="font-medium text-steel-700">QR Code</div>
                      <div className="text-[10px] text-steel-400">{barcodeData.qrCode.standard}</div>
                      <div className="font-mono mt-1 break-all leading-snug">{barcodeData.qrCode.data}</div>
                    </div>
                  </div>

                  {/* Code 128 */}
                  <div>
                    <div className="text-xs font-medium text-steel-700 mb-1">Code 128</div>
                    <img
                      src={barcodeData.code128.dataUrl}
                      alt="Code 128"
                      className="w-full max-h-[50px] object-contain border border-steel-100 rounded-lg bg-white p-1"
                    />
                    <div className="text-[10px] font-mono text-steel-400 mt-1">{barcodeData.code128.data}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Totals */}
          <div className="card bg-primary-50 border-primary-200">
            <div className="card-body space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-primary-700">Total Lines</span>
                <span className="font-bold text-primary-900">{(product.inventoryItems ?? []).length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-primary-700">Total On Hand</span>
                <span className="font-bold text-primary-900">
                  {(product.inventoryItems ?? []).reduce((s, i) => s + Number(i.qtyOnHand), 0).toLocaleString()} {product.uom}
                </span>
              </div>
              <div className="flex justify-between border-t border-primary-200 pt-2">
                <span className="text-primary-700">Total Value</span>
                <span className="font-bold text-primary-900">
                  ${((product.inventoryItems ?? []).reduce((s, i) => s + Number(i.totalCost), 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
