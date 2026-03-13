/**
 * BarcodesPage — two-tab section for Print and Scan
 *
 * Print tab:
 *  - Left panel: searchable product list with multi-select checkboxes
 *  - Right panel: live A4 page preview populated with barcode labels
 *  - Download as PDF button (jsPDF)
 *
 * Scan tab:
 *  - Full camera scanner (reuses BarcodeScanner component)
 *  - Result bottom sheet with entity details
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Printer, ScanLine, Search, Check, X, Download,
  Package, QrCode, ChevronRight, Layers, MapPin,
  Wrench, Truck, RefreshCw, AlertCircle, ClipboardList,
  ExternalLink, Box, FileText,
} from 'lucide-react';
import clsx from 'clsx';
import { jsPDF } from 'jspdf';
import { inventoryApi, Product } from '../../services/api';
import { BarcodeScanner } from '../../components/scanner/BarcodeScanner';

// ── Types ────────────────────────────────────────────────────────────────────

interface BarcodeLabel {
  productId: string;
  sku: string;
  description: string;
  qrCode: { format: string; standard: string; dataUrl: string; data: string };
  code128: { format: string; standard: string; dataUrl: string; data: string };
}

type EntityType = 'INVENTORY_ITEM' | 'LOCATION' | 'WORK_ORDER' | 'PRODUCT' | 'SHIPMENT';

interface ScanResponse {
  entityType: EntityType;
  entityId: string;
  entity: Record<string, unknown> | null;
}

type ScanState =
  | { kind: 'scanning' }
  | { kind: 'loading' }
  | { kind: 'result'; data: ScanResponse }
  | { kind: 'error'; message: string };

// ── Constants ────────────────────────────────────────────────────────────────

// A4 dimensions in mm
const A4_W = 210;
const A4_H = 297;
const MARGIN = 10;

// Label grid: 3 columns x 9 rows = 27 labels per page
const COLS = 3;
const ROWS = 9;
const LABEL_W = (A4_W - MARGIN * 2) / COLS;  // ~63.3mm
const LABEL_H = (A4_H - MARGIN * 2) / ROWS;  // ~30.8mm

const LABELS_PER_PAGE = COLS * ROWS;

// ── Entity config (scan tab) ─────────────────────────────────────────────────

const ENTITY_CONFIG: Record<
  EntityType,
  { label: string; color: string; bgColor: string; Icon: React.ComponentType<{ size?: number | string; className?: string }> }
> = {
  INVENTORY_ITEM: { label: 'Inventory Item', color: 'text-blue-400',   bgColor: 'bg-blue-500/20',   Icon: Layers },
  LOCATION:       { label: 'Location',       color: 'text-green-400',  bgColor: 'bg-green-500/20',  Icon: MapPin },
  WORK_ORDER:     { label: 'Work Order',     color: 'text-amber-400',  bgColor: 'bg-amber-500/20',  Icon: Wrench },
  PRODUCT:        { label: 'Product',        color: 'text-purple-400', bgColor: 'bg-purple-500/20', Icon: Package },
  SHIPMENT:       { label: 'Shipment',       color: 'text-teal-400',   bgColor: 'bg-teal-500/20',   Icon: Truck },
};

// ── Main Page ────────────────────────────────────────────────────────────────

export function BarcodesPage() {
  const [tab, setTab] = useState<'print' | 'scan'>('print');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab header */}
      <div className="flex-shrink-0 flex items-center gap-4 px-6 py-3 bg-white border-b border-steel-200 shadow-sm">
        <QrCode size={18} className="text-primary-600" />
        <span className="font-semibold text-steel-900 mr-4">Barcodes</span>

        <div className="flex rounded-lg bg-steel-100 p-0.5">
          <button
            onClick={() => setTab('print')}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-all',
              tab === 'print'
                ? 'bg-white text-steel-900 shadow-sm'
                : 'text-steel-500 hover:text-steel-700',
            )}
          >
            <Printer size={14} />
            Print
          </button>
          <button
            onClick={() => setTab('scan')}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-all',
              tab === 'scan'
                ? 'bg-white text-steel-900 shadow-sm'
                : 'text-steel-500 hover:text-steel-700',
            )}
          >
            <ScanLine size={14} />
            Scan
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'print' ? <PrintTab /> : <ScanTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRINT TAB
// ═══════════════════════════════════════════════════════════════════════════════

function PrintTab() {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<BarcodeLabel[]>([]);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const a4Ref = useRef<HTMLDivElement>(null);

  // Fetch products
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products-barcode-print', search],
    queryFn: () => inventoryApi.listProducts({ search, limit: 100 }).then((r) => r.data),
    staleTime: 10_000,
  });

  const products = productsData?.data ?? [];

  // Toggle product selection
  const toggleProduct = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Select all visible products
  const selectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      products.forEach((p) => next.add(p.id));
      return next;
    });
  }, [products]);

  // Clear selection
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Fetch barcode labels whenever selection changes
  useEffect(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setLabels([]);
      return;
    }

    let cancelled = false;
    setLoadingLabels(true);

    inventoryApi
      .getBatchBarcodeLabels(ids)
      .then((r) => {
        if (!cancelled) {
          setLabels((r.data as { labels: BarcodeLabel[] }).labels);
        }
      })
      .catch(() => {
        if (!cancelled) setLabels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLabels(false);
      });

    return () => { cancelled = true; };
  }, [selectedIds]);

  // Group labels into pages
  const pages = useMemo(() => {
    const result: BarcodeLabel[][] = [];
    for (let i = 0; i < labels.length; i += LABELS_PER_PAGE) {
      result.push(labels.slice(i, i + LABELS_PER_PAGE));
    }
    return result.length > 0 ? result : [[]];
  }, [labels]);

  // Generate PDF
  const downloadPdf = useCallback(async () => {
    if (labels.length === 0) return;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      if (pageIdx > 0) pdf.addPage();
      const pageLabels = pages[pageIdx];

      for (let i = 0; i < pageLabels.length; i++) {
        const label = pageLabels[i];
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = MARGIN + col * LABEL_W;
        const y = MARGIN + row * LABEL_H;

        // Label border
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.2);
        pdf.rect(x, y, LABEL_W, LABEL_H);

        // SKU (bold)
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'bold');
        pdf.text(label.sku, x + 2, y + 4.5, { maxWidth: LABEL_W - 4 });

        // Description (smaller)
        pdf.setFontSize(5.5);
        pdf.setFont('helvetica', 'normal');
        const desc = label.description.length > 45
          ? label.description.substring(0, 42) + '...'
          : label.description;
        pdf.text(desc, x + 2, y + 8, { maxWidth: LABEL_W - 4 });

        // QR code (left)
        try {
          pdf.addImage(label.qrCode.dataUrl, 'PNG', x + 2, y + 10.5, 16, 16);
        } catch { /* skip if image fails */ }

        // Code 128 (right of QR)
        try {
          pdf.addImage(label.code128.dataUrl, 'PNG', x + 20, y + 14, LABEL_W - 24, 10);
        } catch { /* skip if image fails */ }
      }
    }

    pdf.save(`barcode-labels-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [labels, pages]);

  return (
    <div className="flex flex-col lg:flex-row h-full overflow-hidden">
      {/* ── Left panel: product list ────────────────────────────────────── */}
      <div className="w-full lg:w-80 flex-shrink-0 border-b lg:border-b-0 lg:border-r border-steel-200 bg-white flex flex-col overflow-hidden max-h-[40vh] lg:max-h-none">
        {/* Search */}
        <div className="p-3 border-b border-steel-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400 pointer-events-none" />
            <input
              type="search"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 py-1.5 text-sm h-8 w-full bg-steel-50/80"
            />
          </div>
        </div>

        {/* Selection controls */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-steel-100 bg-steel-50/50">
          <span className="text-xs text-steel-500">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              Select all
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={clearSelection}
                className="text-xs text-steel-400 hover:text-steel-600"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-steel-400">
              <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mr-2" />
              Loading...
            </div>
          )}

          {!isLoading && products.length === 0 && (
            <div className="text-center py-12 text-steel-400 text-sm">
              No products found
            </div>
          )}

          {products.map((product) => {
            const isSelected = selectedIds.has(product.id);
            return (
              <button
                key={product.id}
                onClick={() => toggleProduct(product.id)}
                className={clsx(
                  'w-full flex items-start gap-3 px-3 py-2.5 text-left border-b border-steel-50 transition-colors',
                  isSelected ? 'bg-primary-50/60' : 'hover:bg-steel-50',
                )}
              >
                {/* Checkbox */}
                <div
                  className={clsx(
                    'flex-shrink-0 w-5 h-5 rounded border-2 mt-0.5 flex items-center justify-center transition-all',
                    isSelected
                      ? 'bg-primary-600 border-primary-600'
                      : 'border-steel-300 bg-white',
                  )}
                >
                  {isSelected && <Check size={12} className="text-white" />}
                </div>

                {/* Product info */}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-mono font-semibold text-steel-900 truncate">
                    {product.code}
                  </div>
                  <div className="text-xs text-steel-500 truncate leading-snug mt-0.5">
                    {product.description}
                  </div>
                  {(product.materialType || product.grade) && (
                    <div className="flex gap-1.5 mt-1">
                      {product.materialType && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-steel-100 text-steel-500">
                          {product.materialType}
                        </span>
                      )}
                      {product.grade && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-steel-100 text-steel-500">
                          {product.grade}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right panel: A4 preview ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-steel-100">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 sm:px-6 py-3 bg-white border-b border-steel-200 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <FileText size={15} className="text-steel-400 flex-shrink-0" />
            <span className="text-xs sm:text-sm text-steel-600 truncate">
              {labels.length === 0
                ? 'Select products to preview labels'
                : `${labels.length} label${labels.length !== 1 ? 's' : ''} · ${pages.length} page${pages.length !== 1 ? 's' : ''}`}
            </span>
            {loadingLabels && (
              <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
          </div>
          <button
            onClick={downloadPdf}
            disabled={labels.length === 0}
            className="btn-primary btn-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Download A4</span> PDF
          </button>
        </div>

        {/* A4 page(s) preview */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-3 sm:p-6">
          {labels.length === 0 && !loadingLabels && (
            <div className="flex flex-col items-center justify-center h-full text-steel-400">
              <QrCode size={48} className="mb-3 opacity-30" />
              <p className="text-sm font-medium">No labels to preview</p>
              <p className="text-xs mt-1">Select products from the list to populate this page</p>
            </div>
          )}

          <div className="flex flex-col items-center gap-8" ref={a4Ref}>
            {pages.map((pageLabels, pageIdx) =>
              pageLabels.length > 0 && (
                <A4PagePreview
                  key={pageIdx}
                  labels={pageLabels}
                  pageNumber={pageIdx + 1}
                  totalPages={pages.length}
                />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── A4 Page Preview ──────────────────────────────────────────────────────────

function A4PagePreview({
  labels,
  pageNumber,
  totalPages,
}: {
  labels: BarcodeLabel[];
  pageNumber: number;
  totalPages: number;
}) {
  // Scale the 210x297mm A4 to fit on screen
  const PX_W = 595; // ~A4 at 72dpi
  const PX_H = Math.round(PX_W * (A4_H / A4_W));
  const scale = PX_W / A4_W; // px per mm
  const containerRef = useRef<HTMLDivElement>(null);
  const [cssScale, setCssScale] = useState(1);

  // Auto-scale A4 preview to fit container width
  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? PX_W;
      setCssScale(Math.min(1, (w - 16) / PX_W));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="relative"
      ref={containerRef}
      style={{
        width: PX_W * cssScale,
        height: PX_H * cssScale,
      }}
    >
      {/* Page number badge */}
      {totalPages > 1 && (
        <div className="absolute -top-3 right-2 px-2 py-0.5 rounded-full bg-steel-200 text-[10px] text-steel-500 font-medium z-10">
          Page {pageNumber} / {totalPages}
        </div>
      )}

      <div
        className="bg-white shadow-xl border border-steel-200 relative overflow-hidden origin-top-left"
        style={{
          width: PX_W,
          height: PX_H,
          padding: `${MARGIN * scale}px`,
          transform: `scale(${cssScale})`,
        }}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${COLS}, 1fr)`,
            gridTemplateRows: `repeat(${ROWS}, 1fr)`,
            width: '100%',
            height: '100%',
            gap: 0,
          }}
        >
          {Array.from({ length: LABELS_PER_PAGE }).map((_, i) => {
            const label = labels[i];
            return (
              <div
                key={i}
                className={clsx(
                  'border border-steel-150 flex',
                  label ? '' : 'bg-steel-50/30',
                )}
                style={{ overflow: 'hidden' }}
              >
                {label && <LabelCell label={label} scale={scale} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Single label cell in the A4 grid ─────────────────────────────────────────

function LabelCell({ label, scale }: { label: BarcodeLabel; scale: number }) {
  return (
    <div className="w-full h-full flex flex-col p-[3px] overflow-hidden">
      {/* SKU */}
      <div
        className="font-mono font-bold text-steel-900 truncate leading-tight"
        style={{ fontSize: Math.max(7, 8 * (scale / 3)) }}
      >
        {label.sku}
      </div>

      {/* Description */}
      <div
        className="text-steel-500 truncate leading-tight"
        style={{ fontSize: Math.max(5, 5.5 * (scale / 3)) }}
      >
        {label.description}
      </div>

      {/* Barcodes row */}
      <div className="flex-1 flex items-center gap-1 min-h-0 mt-0.5">
        {/* QR code */}
        <img
          src={label.qrCode.dataUrl}
          alt="QR"
          className="h-full object-contain flex-shrink-0"
          style={{ maxHeight: '100%', width: 'auto' }}
        />

        {/* Code 128 */}
        <div className="flex-1 flex items-center min-w-0">
          <img
            src={label.code128.dataUrl}
            alt="Code 128"
            className="w-full object-contain"
            style={{ maxHeight: '80%' }}
          />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCAN TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ScanTab() {
  const navigate = useNavigate();
  const [state, setState] = useState<ScanState>({ kind: 'scanning' });

  const scanMutation = useMutation({
    mutationFn: (barcodeData: string) =>
      inventoryApi.scanBarcode(barcodeData).then((r) => r.data as ScanResponse),
    onSuccess: (data) => setState({ kind: 'result', data }),
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Barcode not found in the system';
      setState({ kind: 'error', message: msg });
    },
  });

  const handleScan = useCallback(
    (text: string) => {
      if (state.kind !== 'scanning') return;
      setState({ kind: 'loading' });
      scanMutation.mutate(text);
    },
    [state.kind, scanMutation],
  );

  const reset = () => setState({ kind: 'scanning' });

  const isResultVisible = state.kind === 'result' || state.kind === 'error';

  return (
    <div className="relative flex flex-col h-full bg-black">
      {/* Top controls */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 z-10">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-primary-400" />
          <span className="text-white font-semibold text-base tracking-tight">Barcode Scanner</span>
        </div>
        {isResultVisible && (
          <button
            onClick={reset}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white/80 text-sm active:bg-white/20 transition-colors"
          >
            <RefreshCw size={13} />
            Scan again
          </button>
        )}
      </div>

      {/* Camera viewfinder */}
      <div className="flex-1 relative overflow-hidden">
        <BarcodeScanner
          onResult={handleScan}
          paused={state.kind === 'loading' || state.kind === 'result'}
        />

        {state.kind === 'loading' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-white/70 text-sm">Looking up barcode...</p>
            </div>
          </div>
        )}

        {state.kind === 'scanning' && (
          <p className="absolute bottom-8 inset-x-0 text-center text-white/50 text-sm pointer-events-none">
            Point camera at a barcode or QR code
          </p>
        )}
      </div>

      {/* Result bottom sheet */}
      <div
        className={clsx(
          'flex-shrink-0 transition-all duration-300 ease-out',
          isResultVisible ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        {state.kind === 'result' && <ResultSheet data={state.data} navigate={navigate} />}
        {state.kind === 'error' && <ErrorSheet message={state.message} onRetry={reset} />}
      </div>
    </div>
  );
}

// ── Scan result sheet ────────────────────────────────────────────────────────

function ResultSheet({ data, navigate }: { data: ScanResponse; navigate: ReturnType<typeof useNavigate> }) {
  const cfg = ENTITY_CONFIG[data.entityType] ?? ENTITY_CONFIG.PRODUCT;
  const { Icon } = cfg;

  return (
    <div className="bg-[#1a1a2e] border-t border-white/10 rounded-t-3xl px-5 pt-5 pb-6">
      <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />

      <div className="flex items-center gap-2.5 mb-4">
        <div className={clsx('p-2 rounded-xl', cfg.bgColor)}>
          <Icon size={18} className={cfg.color} />
        </div>
        <div>
          <p className={clsx('text-xs font-semibold uppercase tracking-wide', cfg.color)}>
            {cfg.label}
          </p>
          <p className="text-white/40 text-[10px] font-mono mt-0.5 truncate max-w-[240px]">
            {data.entityId}
          </p>
        </div>
      </div>

      <ScanEntityDetails type={data.entityType} entity={data.entity} />

      <div className="mt-5 flex flex-col gap-2.5">
        <ScanActionButtons type={data.entityType} entity={data.entity} navigate={navigate} />
      </div>
    </div>
  );
}

function ScanEntityDetails({ type, entity }: { type: EntityType; entity: Record<string, unknown> | null }) {
  if (!entity) {
    return <p className="text-white/40 text-sm">Entity details unavailable.</p>;
  }

  if (type === 'INVENTORY_ITEM') {
    const product = entity.product as Record<string, unknown> | undefined;
    const location = entity.location as Record<string, unknown> | undefined;
    return (
      <div className="space-y-2">
        <DetailRow label="Product" value={`${product?.code ?? '-'} \u00B7 ${product?.description ?? '-'}`} />
        <DetailRow label="Location" value={location ? `${location.code} - ${location.name}` : '-'} />
        {!!entity.heatNumber && <DetailRow label="Heat #" value={String(entity.heatNumber)} mono />}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <StockPill label="On Hand" value={String(entity.qtyOnHand ?? 0)} color="text-white" />
          <StockPill label="Available" value={String(entity.qtyAvailable ?? 0)} color="text-green-400" />
          <StockPill label="Allocated" value={String(entity.qtyAllocated ?? 0)} color="text-amber-400" />
        </div>
      </div>
    );
  }

  if (type === 'PRODUCT') {
    return (
      <div className="space-y-2">
        <DetailRow label="SKU" value={String(entity.code ?? '-')} mono />
        <DetailRow label="Description" value={String(entity.description ?? '-')} />
        {!!entity.grade && <DetailRow label="Grade" value={String(entity.grade)} />}
        {!!entity.shape && <DetailRow label="Shape" value={String(entity.shape)} />}
      </div>
    );
  }

  if (type === 'WORK_ORDER') {
    return (
      <div className="space-y-2">
        <DetailRow label="WO #" value={String(entity.workOrderNumber ?? '-')} mono />
        <DetailRow label="Status" value={String(entity.status ?? '-')} />
        <DetailRow label="Priority" value={String(entity.priority ?? '-')} />
      </div>
    );
  }

  if (type === 'LOCATION') {
    return (
      <div className="space-y-2">
        <DetailRow label="Code" value={String(entity.code ?? '-')} mono />
        <DetailRow label="Name" value={String(entity.name ?? '-')} />
        <DetailRow label="Type" value={String(entity.type ?? '-')} />
      </div>
    );
  }

  if (type === 'SHIPMENT') {
    return (
      <div className="space-y-2">
        <DetailRow label="Manifest #" value={String(entity.manifestNumber ?? '-')} mono />
        <DetailRow label="Status" value={String(entity.status ?? '-')} />
        {!!entity.carrier && <DetailRow label="Carrier" value={String(entity.carrier)} />}
      </div>
    );
  }

  return null;
}

function ScanActionButtons({
  type, entity, navigate,
}: {
  type: EntityType;
  entity: Record<string, unknown> | null;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const id = entity?.id as string | undefined;

  if (type === 'INVENTORY_ITEM') {
    return (
      <>
        <ActionButton icon={<Layers size={16} />} label="View item details" onClick={() => navigate('/inventory')} />
        <ActionButton icon={<ClipboardList size={16} />} label="Adjust stock" onClick={() => navigate('/inventory/adjust')} />
      </>
    );
  }
  if (type === 'PRODUCT') {
    return (
      <>
        {id && <ActionButton icon={<Package size={16} />} label="View product" onClick={() => navigate(`/inventory/products/${id}`)} />}
        {id && <ActionButton icon={<Box size={16} />} label="Print barcode label" onClick={() => navigate(`/inventory/products/${id}/barcodes`)} />}
      </>
    );
  }
  if (type === 'WORK_ORDER') {
    return (
      <ActionButton icon={<Wrench size={16} />} label="View work order" onClick={() => navigate('/processing/work-orders')} />
    );
  }
  if (type === 'LOCATION') {
    return (
      <ActionButton icon={<Package size={16} />} label="View stock at this location" onClick={() => navigate('/inventory')} />
    );
  }
  if (type === 'SHIPMENT') {
    return (
      <ActionButton icon={<Truck size={16} />} label="View shipment" onClick={() => navigate('/')} />
    );
  }
  return null;
}

// ── Scan error sheet ─────────────────────────────────────────────────────────

function ErrorSheet({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-[#1a1a2e] border-t border-white/10 rounded-t-3xl px-5 pt-5 pb-6">
      <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />
      <div className="flex flex-col items-center text-center gap-4 py-2">
        <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <div>
          <p className="text-white font-semibold">Barcode not recognised</p>
          <p className="text-white/50 text-sm mt-1 leading-relaxed">{message}</p>
        </div>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium active:bg-primary-700 transition-colors"
        >
          <RefreshCw size={14} />
          Try again
        </button>
      </div>
    </div>
  );
}

// ── Shared UI pieces ─────────────────────────────────────────────────────────

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-white/40 text-sm flex-shrink-0">{label}</span>
      <span className={clsx('text-white text-sm text-right leading-snug', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function StockPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white/5 rounded-xl py-2.5 text-center">
      <p className={clsx('text-base font-bold', color)}>{value}</p>
      <p className="text-white/30 text-[10px] mt-0.5">{label}</p>
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white/8 hover:bg-white/12 active:bg-white/15 text-white transition-colors text-left"
    >
      <span className="text-white/60">{icon}</span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      <ChevronRight size={16} className="text-white/30" />
    </button>
  );
}
