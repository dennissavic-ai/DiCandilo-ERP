import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer, QrCode } from 'lucide-react';
import { inventoryApi } from '../../services/api';

interface BarcodeSection {
  dataUrl?: string;
  data?: string;
  standard: string;
}

interface BarcodeLabelData {
  productId: string;
  sku: string;
  description: string;
  qrCode: BarcodeSection;
  code128: BarcodeSection;
  gs1128: BarcodeSection | null;
}

export function BarcodePrintPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['barcode-label', id],
    queryFn: () => inventoryApi.getProductBarcodeLabel(id!).then((r) => r.data as BarcodeLabelData),
    enabled: !!id,
  });

  return (
    <>
      {/* Print-specific styles */}
      <style>{`
        @media print {
          .print-hide { display: none !important; }
          body { margin: 0; background: white; }
          .print-page { padding: 16px; }
        }
      `}</style>

      <div className="min-h-screen bg-steel-50 print-page">
        {/* Toolbar — hidden when printing */}
        <div className="print-hide flex items-center justify-between px-6 py-4 bg-white border-b border-steel-200 shadow-sm">
          <div className="flex items-center gap-2">
            <QrCode size={18} className="text-primary-600" />
            <span className="font-semibold text-steel-900">Barcodes &amp; Labels</span>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-primary btn-sm flex items-center gap-1.5"
          >
            <Printer size={14} />
            Print
          </button>
        </div>

        {/* Content */}
        <div className="flex items-start justify-center p-8">
          {isLoading && (
            <div className="flex items-center justify-center h-64 text-steel-400">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mr-3" />
              Loading barcodes…
            </div>
          )}

          {isError && (
            <div className="text-center text-red-600 mt-12">
              <p className="font-medium">Failed to load barcode data.</p>
              <p className="text-sm text-steel-500 mt-1">Check the product ID and try again.</p>
            </div>
          )}

          {data && (
            <div className="bg-white border border-steel-200 rounded-2xl shadow-lg max-w-3xl w-full p-8">
              {/* Product Header */}
              <div className="border-b border-steel-200 pb-5 mb-6">
                <div className="text-3xl font-black text-steel-900 tracking-tight font-mono mb-1">
                  {data.sku}
                </div>
                <div className="text-base text-steel-600 mb-1">{data.description}</div>
                <div className="text-xs text-steel-400 font-mono">ID: {data.productId}</div>
              </div>

              {/* Barcode Sections */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* QR Code */}
                <BarcodeCard
                  title="QR Code"
                  standard={data.qrCode.standard}
                  dataUrl={data.qrCode.dataUrl}
                  rawData={data.qrCode.data}
                  isQr
                />

                {/* Code 128 */}
                <BarcodeCard
                  title="Code 128"
                  standard={data.code128.standard}
                  dataUrl={data.code128.dataUrl}
                  rawData={data.code128.data}
                />

                {/* GS1-128 (optional) */}
                {data.gs1128 && (
                  <BarcodeCard
                    title="GS1-128"
                    standard={data.gs1128.standard}
                    dataUrl={data.gs1128.dataUrl}
                    rawData={data.gs1128.data}
                  />
                )}
              </div>

              {/* Footer */}
              <div className="mt-6 pt-4 border-t border-steel-100 flex items-center justify-between text-xs text-steel-400">
                <span>DiCandilo Metal ERP</span>
                <span>Generated {new Date().toLocaleDateString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Barcode Card ──────────────────────────────────────────────────────────────

function BarcodeCard({
  title,
  standard,
  dataUrl,
  rawData,
  isQr = false,
}: {
  title: string;
  standard: string;
  dataUrl?: string;
  rawData?: string;
  isQr?: boolean;
}) {
  return (
    <div className="flex flex-col items-center bg-steel-50 border border-steel-200 rounded-xl p-4 text-center">
      <div className="text-xs font-semibold text-steel-700 uppercase tracking-wide mb-0.5">
        {title}
      </div>
      <div className="text-[10px] text-steel-400 mb-3">{standard}</div>

      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`${title} barcode`}
          className={isQr ? 'w-20 h-20 object-contain' : 'w-full max-h-[80px] object-contain'}
        />
      ) : (
        <div className="flex items-center justify-center bg-steel-100 rounded-lg text-steel-400 text-xs w-full h-20">
          Not available
        </div>
      )}

      {rawData && (
        <div className="mt-3 font-mono text-[10px] text-steel-500 break-all leading-snug">
          {rawData}
        </div>
      )}
    </div>
  );
}
