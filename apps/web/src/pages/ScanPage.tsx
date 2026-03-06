/**
 * ScanPage — mobile-first barcode scanner
 *
 * Lives outside the main Layout so it fills the full screen without the
 * desktop sidebar. Works in any modern mobile browser (iOS Safari 14.3+,
 * Chrome 88+) using the device camera via getUserMedia.
 *
 * Flow:
 *  1. Camera opens automatically and scans continuously.
 *  2. On a successful decode the barcode data is POSTed to /barcodes/scan.
 *  3. A bottom sheet slides up with entity details and contextual action buttons.
 *  4. "Scan again" resets to scanning mode.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowLeft, ScanLine, Package, MapPin, Wrench,
  Truck, Box, RefreshCw, ExternalLink, AlertCircle,
  ChevronRight, Layers, ClipboardList,
} from 'lucide-react';
import clsx from 'clsx';
import { BarcodeScanner } from '../components/scanner/BarcodeScanner';
import { inventoryApi } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Entity config ─────────────────────────────────────────────────────────────

const ENTITY_CONFIG: Record<
  EntityType,
  {
    label: string;
    color: string;
    bgColor: string;
    Icon: React.ComponentType<{ size?: number | string; className?: string }>;
  }
> = {
  INVENTORY_ITEM: { label: 'Inventory Item', color: 'text-blue-400',  bgColor: 'bg-blue-500/20',  Icon: Layers },
  LOCATION:       { label: 'Location',       color: 'text-green-400', bgColor: 'bg-green-500/20', Icon: MapPin },
  WORK_ORDER:     { label: 'Work Order',     color: 'text-amber-400', bgColor: 'bg-amber-500/20', Icon: Wrench },
  PRODUCT:        { label: 'Product',        color: 'text-purple-400',bgColor: 'bg-purple-500/20',Icon: Package },
  SHIPMENT:       { label: 'Shipment',       color: 'text-teal-400',  bgColor: 'bg-teal-500/20',  Icon: Truck },
};

// ── Main page ─────────────────────────────────────────────────────────────────

export function ScanPage() {
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
    [state.kind, scanMutation]
  );

  const reset = () => setState({ kind: 'scanning' });

  const isResultVisible = state.kind === 'result' || state.kind === 'error';

  return (
    <div className="fixed inset-0 bg-black flex flex-col" style={{ zIndex: 50 }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 pt-safe-top py-3 z-10">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft size={22} />
        </button>
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

      {/* ── Camera viewfinder ─────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        <BarcodeScanner
          onResult={handleScan}
          paused={state.kind === 'loading' || state.kind === 'result'}
        />

        {/* Loading overlay */}
        {state.kind === 'loading' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-white/70 text-sm">Looking up barcode…</p>
            </div>
          </div>
        )}

        {/* Scan hint — only shown while actively scanning */}
        {state.kind === 'scanning' && (
          <p className="absolute bottom-8 inset-x-0 text-center text-white/50 text-sm pointer-events-none">
            Point camera at a barcode or QR code
          </p>
        )}
      </div>

      {/* ── Result bottom sheet ───────────────────────────────────────────── */}
      <div
        className={clsx(
          'flex-shrink-0 transition-all duration-300 ease-out',
          isResultVisible ? 'translate-y-0' : 'translate-y-full'
        )}
      >
        {state.kind === 'result' && <ResultSheet data={state.data} />}
        {state.kind === 'error' && <ErrorSheet message={state.message} onRetry={reset} />}
      </div>

    </div>
  );
}

// ── Result sheet ──────────────────────────────────────────────────────────────

function ResultSheet({ data }: { data: ScanResponse }) {
  const navigate = useNavigate();
  const cfg = ENTITY_CONFIG[data.entityType] ?? ENTITY_CONFIG.PRODUCT;
  const { Icon } = cfg;

  return (
    <div className="bg-[#1a1a2e] border-t border-white/10 rounded-t-3xl px-5 pt-5 pb-safe-bottom pb-6">
      {/* Handle */}
      <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />

      {/* Entity type badge */}
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

      {/* Entity details */}
      <EntityDetails type={data.entityType} entity={data.entity} />

      {/* Action buttons */}
      <div className="mt-5 flex flex-col gap-2.5">
        <ActionButtons type={data.entityType} entity={data.entity} navigate={navigate} />
      </div>
    </div>
  );
}

// ── Entity detail rows ─────────────────────────────────────────────────────────

function EntityDetails({ type, entity }: { type: EntityType; entity: Record<string, unknown> | null }) {
  if (!entity) {
    return <p className="text-white/40 text-sm">Entity details unavailable.</p>;
  }

  if (type === 'INVENTORY_ITEM') {
    const product = entity.product as Record<string, unknown> | undefined;
    const location = entity.location as Record<string, unknown> | undefined;
    return (
      <div className="space-y-2">
        <DetailRow label="Product" value={`${product?.code ?? '—'} · ${product?.description ?? '—'}`} />
        <DetailRow label="Location" value={location ? `${location.code} — ${location.name}` : '—'} />
        {!!entity.heatNumber && <DetailRow label="Heat #" value={String(entity.heatNumber)} mono />}
        {!!entity.lotNumber  && <DetailRow label="Lot #"  value={String(entity.lotNumber)}  mono />}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <StockPill label="On Hand"     value={String(entity.qtyOnHand ?? 0)}     color="text-white" />
          <StockPill label="Available"   value={String(entity.qtyAvailable ?? 0)}  color="text-green-400" />
          <StockPill label="Allocated"   value={String(entity.qtyAllocated ?? 0)}  color="text-amber-400" />
        </div>
        {entity.unitCost !== undefined && (
          <DetailRow label="Unit cost" value={`$${(Number(entity.unitCost) / 100).toFixed(2)}`} />
        )}
      </div>
    );
  }

  if (type === 'LOCATION') {
    return (
      <div className="space-y-2">
        <DetailRow label="Code" value={String(entity.code ?? '—')} mono />
        <DetailRow label="Name" value={String(entity.name ?? '—')} />
        <DetailRow label="Type" value={String(entity.type ?? '—')} />
      </div>
    );
  }

  if (type === 'WORK_ORDER') {
    return (
      <div className="space-y-2">
        <DetailRow label="WO #"    value={String(entity.workOrderNumber ?? '—')} mono />
        <DetailRow label="Status"  value={String(entity.status ?? '—')} />
        <DetailRow label="Priority" value={String(entity.priority ?? '—')} />
        {!!entity.scheduledDate && (
          <DetailRow label="Scheduled" value={new Date(String(entity.scheduledDate)).toLocaleDateString()} />
        )}
      </div>
    );
  }

  if (type === 'PRODUCT') {
    return (
      <div className="space-y-2">
        <DetailRow label="SKU"         value={String(entity.code ?? '—')} mono />
        <DetailRow label="Description" value={String(entity.description ?? '—')} />
        {!!entity.grade    && <DetailRow label="Grade"  value={String(entity.grade)}    />}
        {!!entity.shape    && <DetailRow label="Shape"  value={String(entity.shape)}    />}
        {entity.listPrice !== undefined && (
          <DetailRow label="List price" value={`$${(Number(entity.listPrice) / 100).toFixed(2)}`} />
        )}
      </div>
    );
  }

  if (type === 'SHIPMENT') {
    return (
      <div className="space-y-2">
        <DetailRow label="Manifest #" value={String(entity.manifestNumber ?? '—')} mono />
        <DetailRow label="Status"     value={String(entity.status ?? '—')} />
        {!!entity.carrier         && <DetailRow label="Carrier"  value={String(entity.carrier)}         />}
        {!!entity.trackingNumber  && <DetailRow label="Tracking" value={String(entity.trackingNumber)}  mono />}
        {!!entity.shipDate && (
          <DetailRow label="Ship date" value={new Date(String(entity.shipDate)).toLocaleDateString()} />
        )}
      </div>
    );
  }

  return null;
}

// ── Contextual action buttons ─────────────────────────────────────────────────

function ActionButtons({
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
        <ActionButton icon={<Layers size={16} />}     label="View item details"   onClick={() => navigate('/inventory')} />
        <ActionButton icon={<ClipboardList size={16}/>} label="Adjust stock"       onClick={() => navigate('/inventory/adjust')} />
      </>
    );
  }
  if (type === 'LOCATION') {
    return (
      <ActionButton icon={<Package size={16} />} label="View stock at this location" onClick={() => navigate('/inventory')} />
    );
  }
  if (type === 'WORK_ORDER') {
    return (
      <>
        <ActionButton icon={<Wrench size={16} />}      label="View work order"    onClick={() => navigate('/processing/work-orders')} />
        <ActionButton icon={<ExternalLink size={16} />} label="Open in full app"  onClick={() => navigate('/processing/work-orders')} />
      </>
    );
  }
  if (type === 'PRODUCT') {
    return (
      <>
        {id && <ActionButton icon={<Package size={16} />}    label="View product"        onClick={() => navigate(`/inventory/products/${id}`)} />}
        {id && <ActionButton icon={<Box size={16} />}        label="Print barcode label" onClick={() => navigate(`/inventory/products/${id}/barcodes`)} />}
      </>
    );
  }
  if (type === 'SHIPMENT') {
    return (
      <ActionButton icon={<Truck size={16} />} label="View shipment" onClick={() => navigate('/')} />
    );
  }
  return null;
}

// ── Error sheet ───────────────────────────────────────────────────────────────

function ErrorSheet({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-[#1a1a2e] border-t border-white/10 rounded-t-3xl px-5 pt-5 pb-safe-bottom pb-6">
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

// ── Small shared UI pieces ────────────────────────────────────────────────────

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

function ActionButton({
  icon, label, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
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
