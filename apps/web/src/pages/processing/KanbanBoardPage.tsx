import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { processingApi } from '../../services/api';
import { Clock, User, ArrowRight, GripVertical } from 'lucide-react';

// ── Status metadata ────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  DRAFT:       { label: 'Draft',       color: 'text-steel-600',  bg: 'bg-steel-100',  border: 'border-steel-200', dot: 'bg-steel-400' },
  SCHEDULED:   { label: 'Scheduled',   color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200',  dot: 'bg-blue-500' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-amber-200', dot: 'bg-amber-500' },
  ON_HOLD:     { label: 'On Hold',     color: 'text-orange-700', bg: 'bg-orange-50',  border: 'border-orange-200',dot: 'bg-orange-500' },
  COMPLETED:   { label: 'Completed',   color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200', dot: 'bg-green-500' },
  CANCELLED:   { label: 'Cancelled',   color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-200',   dot: 'bg-red-400' },
};

const PRIORITY_COLOR: Record<number, string> = {
  1: 'text-green-600', 2: 'text-teal-600', 3: 'text-blue-600',
  4: 'text-amber-600', 5: 'text-orange-600', 6: 'text-red-600',
  7: 'text-red-700', 8: 'text-red-800', 9: 'text-red-900', 10: 'text-red-900',
};

function fmtCurrency(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// ── Work Order card ────────────────────────────────────────────────────────────

interface WOCard {
  id: string;
  workOrderNumber: string;
  status: string;
  priority: number;
  scheduledDate?: string;
  salesOrder?: { orderNumber: string; totalAmount: number; customer?: { name: string } };
  lines: { operation: string; workCenter?: { name: string } }[];
  _count: { timeEntries: number };
}

function WorkOrderCard({ wo, onDragStart }: { wo: WOCard; onDragStart: () => void }) {
  const navigate = useNavigate();
  const meta = STATUS_META[wo.status] ?? STATUS_META.DRAFT;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={() => navigate(`/processing/work-orders/${wo.id}`)}
      className="bg-white border border-steel-200 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-primary-300 transition-all cursor-pointer select-none group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-mono text-xs font-bold text-primary-700">{wo.workOrderNumber}</span>
        <div className="flex items-center gap-1.5">
          <GripVertical size={12} className="text-steel-300 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
          <span className={`text-xs font-semibold ${PRIORITY_COLOR[wo.priority] ?? 'text-steel-500'}`}>P{wo.priority}</span>
        </div>
      </div>

      {wo.salesOrder?.customer && (
        <p className="text-sm font-medium text-steel-900 truncate mb-1">
          {wo.salesOrder.customer.name}
        </p>
      )}
      {wo.salesOrder?.orderNumber && (
        <p className="text-xs text-steel-400 font-mono mb-2">SO: {wo.salesOrder.orderNumber}</p>
      )}

      {/* Operations */}
      {wo.lines.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {wo.lines.slice(0, 3).map((line, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-steel-100 text-steel-600 rounded font-medium">
              {line.workCenter?.name ?? line.operation}
            </span>
          ))}
          {wo.lines.length > 3 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-steel-100 text-steel-400 rounded">+{wo.lines.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-2">
          {wo.scheduledDate && (
            <span className="flex items-center gap-1 text-xs text-steel-400">
              <Clock size={10} />
              {fmtDate(wo.scheduledDate)}
            </span>
          )}
          {wo._count.timeEntries > 0 && (
            <span className="flex items-center gap-1 text-xs text-blue-500">
              <User size={10} />
              {wo._count.timeEntries}
            </span>
          )}
        </div>
        {wo.salesOrder?.totalAmount ? (
          <span className="text-xs font-mono font-semibold text-steel-600">
            {fmtCurrency(wo.salesOrder.totalAmount)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── Column ─────────────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT:       ['SCHEDULED', 'CANCELLED'],
  SCHEDULED:   ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD:     ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED:   [],
  CANCELLED:   [],
};

function Column({
  status,
  cards,
  onDrop,
  isDropTarget,
  onDragOver,
  onDragLeave,
}: {
  status: string;
  cards: WOCard[];
  onDrop: (status: string) => void;
  isDropTarget: boolean;
  onDragOver: (status: string) => void;
  onDragLeave: () => void;
}) {
  const meta = STATUS_META[status];

  return (
    <div
      className={`flex flex-col rounded-xl border-2 transition-colors min-w-[240px] max-w-[280px] flex-shrink-0 ${
        isDropTarget ? 'border-primary-400 bg-primary-50/30' : `${meta.border} bg-steel-50/50`
      }`}
      onDragOver={(e) => { e.preventDefault(); onDragOver(status); }}
      onDragLeave={onDragLeave}
      onDrop={() => onDrop(status)}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-steel-100">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${meta.color}`}>{meta.label}</span>
        <span className={`ml-auto text-xs font-bold tabular-nums ${meta.color} ${meta.bg} px-1.5 py-0.5 rounded-full`}>
          {cards.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {cards.map((wo) => (
          <WorkOrderCard
            key={wo.id}
            wo={wo}
            onDragStart={() => {/* parent handles via ref */}}
          />
        ))}
        {cards.length === 0 && (
          <div className="flex items-center justify-center h-16 rounded-lg border border-dashed border-steel-200">
            <span className="text-xs text-steel-300">Drop here</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── KanbanBoardPage ────────────────────────────────────────────────────────────

export function KanbanBoardPage() {
  const qc = useQueryClient();
  const draggingId  = useRef<string | null>(null);
  const draggingStatus = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['kanban'],
    queryFn: () => processingApi.getKanban().then((r) => r.data as { data: Record<string, WOCard[]>; statusOrder: string[] }),
    refetchInterval: 30_000,
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      processingApi.updateStatus(id, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kanban'] }); setError(null); },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Failed to update status'),
  });

  const columns = data?.statusOrder ?? Object.keys(STATUS_META);
  const grouped = data?.data ?? {};

  function handleDragStart(woId: string, status: string) {
    draggingId.current = woId;
    draggingStatus.current = status;
  }

  function handleDrop(targetStatus: string) {
    setDropTarget(null);
    if (!draggingId.current || draggingStatus.current === targetStatus) return;

    const fromStatus = draggingStatus.current!;
    const valid = VALID_TRANSITIONS[fromStatus] ?? [];
    if (!valid.includes(targetStatus)) {
      setError(`Cannot move from ${STATUS_META[fromStatus]?.label} → ${STATUS_META[targetStatus]?.label}`);
      setTimeout(() => setError(null), 3000);
      return;
    }

    updateStatus({ id: draggingId.current, status: targetStatus });
    draggingId.current = null;
    draggingStatus.current = null;
  }

  // Attach drag start to cards via event delegation (simple approach)
  const totalRevenue = columns.reduce((sum, s) => {
    if (['COMPLETED', 'CANCELLED'].includes(s)) return sum;
    return sum + (grouped[s] ?? []).reduce((cs, wo) => cs + Number(wo.salesOrder?.totalAmount ?? 0), 0);
  }, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-steel-200 bg-white">
        <div>
          <h1 className="text-base font-semibold text-steel-900">Work Order Board</h1>
          <p className="text-xs text-steel-400">
            {Object.values(grouped).flat().length} jobs · Pipeline value: {fmtCurrency(totalRevenue)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-steel-400">
          <ArrowRight size={12} />
          Drag cards to move between stages
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 p-4 h-full" style={{ minWidth: 'max-content' }}>
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="w-60 flex-shrink-0 rounded-xl border border-steel-200 bg-steel-50 animate-pulse">
                  <div className="h-10 border-b border-steel-100 mx-2 my-2 rounded skeleton" />
                  {Array.from({ length: 3 }).map((__, j) => (
                    <div key={j} className="h-24 mx-2 mb-2 rounded-xl skeleton" />
                  ))}
                </div>
              ))
            : columns.map((status) => (
                <div
                  key={status}
                  onDragStart={(e) => {
                    const card = (e.target as HTMLElement).closest('[draggable]') as HTMLElement;
                    if (card) {
                      const woId = card.getAttribute('data-wo-id') ?? '';
                      handleDragStart(woId, status);
                    }
                  }}
                >
                  {/* We need to attach data-wo-id to draggable divs — patch cards */}
                  <Column
                    status={status}
                    cards={(grouped[status] ?? []).map((wo) => wo)}
                    onDrop={handleDrop}
                    isDropTarget={dropTarget === status}
                    onDragOver={setDropTarget}
                    onDragLeave={() => setDropTarget(null)}
                  />
                </div>
              ))
          }
        </div>
      </div>
    </div>
  );
}
