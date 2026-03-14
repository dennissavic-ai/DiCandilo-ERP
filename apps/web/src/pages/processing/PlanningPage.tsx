import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { planningApi } from '../../services/api';
import {
  ClipboardList, ChevronRight, ChevronLeft, CheckCircle2, Clock, AlertCircle,
  Calendar, Users, Wrench, Loader2, GripHorizontal, Plus, X, Zap, Trash2,
} from 'lucide-react';
import { useState, useMemo } from 'react';
import { format, addDays, startOfWeek, addWeeks, subWeeks, differenceInMinutes, differenceInDays, isSameDay, isWeekend } from 'date-fns';

// ── Constants ────────────────────────────────────────────────────────────────

const WO_STATUS_COLOR: Record<string, string> = {
  DRAFT: '#94a3b8', SCHEDULED: '#3b82f6', IN_PROGRESS: '#f59e0b',
  ON_HOLD: '#eab308', COMPLETED: '#22c55e', CANCELLED: '#ef4444',
};

const GANTT_COLORS = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981',
  '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

type ViewMode = 'gantt' | 'list';
type ZoomLevel = '1day' | '2day' | 'week';

// Working hours: 7:00 AM to 5:00 PM = 10 hours
const WORK_START_HOUR = 7;
const WORK_END_HOUR = 17;
const WORK_HOURS = WORK_END_HOUR - WORK_START_HOUR; // 10

const ZOOM_CONFIG: Record<ZoomLevel, { dayWidth: number; label: string }> = {
  '1day': { dayWidth: 400, label: '1 Day' },
  '2day': { dayWidth: 200, label: '2 Days' },
  'week': { dayWidth: 100, label: 'Week' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function blockColor(idx: number) {
  return GANTT_COLORS[idx % GANTT_COLORS.length];
}

function minutesToLabel(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ScheduleBlock {
  id: string;
  jobPlanId: string;
  workCenterId: string;
  startAt: string;
  endAt: string;
  isConfirmed: boolean;
  aiGenerated: boolean;
  notes?: string;
  workCenter: { id: string; code: string; name: string };
  jobPlan: {
    id: string;
    workOrder: {
      workOrderNumber: string;
      priority: number;
      status: string;
      salesOrder?: { orderNumber: string; customer?: { name: string } };
    };
  };
}

interface WorkCenter {
  id: string;
  code: string;
  name: string;
  type: string;
}

// ── Unscheduled Actions Panel ───────────────────────────────────────────────

function UnscheduledPanel({
  workOrders,
  onClickSchedule,
}: {
  workOrders: any[];
  onClickSchedule: (woId: string, wcId?: string) => void;
}) {
  const unscheduledActions = useMemo(() => {
    const items: { woId: string; woNumber: string; customer: string; line: any; priority: number }[] = [];
    for (const wo of workOrders) {
      if (['COMPLETED', 'CANCELLED'].includes(wo.status)) continue;
      // WO has no plan or plan has no schedule blocks → all lines are unscheduled
      const hasBlocks = (wo.jobPlan?.scheduleBlocks?.length ?? 0) > 0;
      if (!hasBlocks) {
        for (const line of wo.lines ?? []) {
          items.push({
            woId: wo.id,
            woNumber: wo.workOrderNumber,
            customer: wo.salesOrder?.customer?.name ?? 'Internal',
            line,
            priority: wo.priority,
          });
        }
      }
    }
    return items;
  }, [workOrders]);

  if (unscheduledActions.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        <CheckCircle2 size={20} className="mx-auto mb-2 text-green-400" />
        All actions scheduled
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {unscheduledActions.map((item) => (
        <button
          key={`${item.woId}-${item.line.id}`}
          onClick={() => onClickSchedule(item.woId, item.line.workCenterId ?? undefined)}
          className="w-full text-left px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50/50 hover:bg-amber-100/60 transition-colors group"
        >
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.priority <= 3 ? 'bg-green-500' : item.priority <= 6 ? 'bg-amber-500' : 'bg-red-500'}`} />
            <span className="text-[11px] font-bold text-steel-700 truncate">{item.woNumber}</span>
            <span className="text-[10px] text-steel-400 truncate flex-1">{item.customer}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-steel-800 font-medium truncate">{item.line.operation}</span>
            {item.line.estimatedMinutes && (
              <span className="text-[10px] text-steel-400 flex-shrink-0">{minutesToLabel(item.line.estimatedMinutes)}</span>
            )}
          </div>
          {item.line.workCenter && (
            <div className="mt-0.5 text-[10px] text-steel-400 flex items-center gap-1">
              <Wrench size={9} /> {item.line.workCenter.name}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Add Block Modal ──────────────────────────────────────────────────────────

function AddBlockModal({
  workCenters,
  workOrders,
  onClose,
  onSave,
  isSaving,
  defaultWorkCenterId,
  defaultDate,
  defaultWorkOrderId,
}: {
  workCenters: WorkCenter[];
  workOrders: any[];
  onClose: () => void;
  onSave: (planId: string, data: { workCenterId: string; startAt: string; endAt: string; notes?: string }) => void;
  isSaving: boolean;
  defaultWorkCenterId?: string;
  defaultDate?: Date;
  defaultWorkOrderId?: string;
}) {
  const [workOrderId, setWorkOrderId] = useState(defaultWorkOrderId ?? '');
  const [workCenterId, setWorkCenterId] = useState(defaultWorkCenterId ?? '');
  const [date, setDate] = useState(defaultDate ? format(defaultDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('08:00');
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');

  const { data: planData } = useQuery({
    queryKey: ['plan-for-wo', workOrderId],
    queryFn: () => workOrderId ? planningApi.getPlan(workOrderId).then((r) => r.data) : null,
    enabled: !!workOrderId,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workOrderId || !workCenterId || !(planData as any)?.plan?.id) return;
    const startAt = new Date(`${date}T${startTime}:00`).toISOString();
    const endAt = new Date(new Date(`${date}T${startTime}:00`).getTime() + duration * 60000).toISOString();
    onSave((planData as any).plan.id, { workCenterId, startAt, endAt, notes: notes || undefined });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Add Schedule Block</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="form-label">Work Order</label>
            <select className="input" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
              <option value="">Select…</option>
              {workOrders.filter((wo: any) => !['COMPLETED', 'CANCELLED'].includes(wo.status)).map((wo: any) => (
                <option key={wo.id} value={wo.id}>
                  {wo.workOrderNumber} — {wo.salesOrder?.customer?.name ?? 'Internal'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Work Centre</label>
            <select className="input" value={workCenterId} onChange={(e) => setWorkCenterId(e.target.value)}>
              <option value="">Select…</option>
              {workCenters.map((wc) => (
                <option key={wc.id} value={wc.id}>{wc.code} — {wc.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="form-label">Date</label>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Start</label>
              <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Duration (min)</label>
              <input type="number" className="input" min={15} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional…" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary btn-sm" disabled={isSaving || !workOrderId || !workCenterId}>
              {isSaving ? 'Adding…' : 'Add Block'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Gantt Chart ──────────────────────────────────────────────────────────────

function GanttChart({
  blocks,
  workCenters,
  weekStart,
  zoom,
  onDeleteBlock,
  onClickAdd,
}: {
  blocks: ScheduleBlock[];
  workCenters: WorkCenter[];
  weekStart: Date;
  zoom: ZoomLevel;
  onDeleteBlock: (planId: string, blockId: string) => void;
  onClickAdd: (wcId: string, day: Date) => void;
}) {
  const navigate = useNavigate();
  const { dayWidth } = ZOOM_CONFIG[zoom];
  const numDays = zoom === 'week' ? 14 : zoom === '2day' ? 7 : 5;
  const days = Array.from({ length: numDays }, (_, i) => addDays(weekStart, i));
  const headerH = 48;
  const rowH = 64;
  const labelW = 150;

  // Map WO number to color index
  const woNumbers = [...new Set(blocks.map((b) => b.jobPlan.workOrder.workOrderNumber))];
  const woColorMap = new Map(woNumbers.map((n, i) => [n, i]));

  const visibleWCs = workCenters;
  const totalW = labelW + numDays * dayWidth;
  const totalH = headerH + visibleWCs.length * rowH;

  // Calculate block position within a day column based on working hours (7am-5pm)
  function blockLeft(block: ScheduleBlock): number {
    const start = new Date(block.startAt);
    const dayIdx = differenceInDays(start, weekStart);
    const hourOfDay = start.getHours() + start.getMinutes() / 60;
    // Clamp to working hours
    const workFraction = Math.max(0, Math.min(1, (hourOfDay - WORK_START_HOUR) / WORK_HOURS));
    return labelW + dayIdx * dayWidth + workFraction * dayWidth;
  }

  function blockWidth(block: ScheduleBlock): number {
    const mins = differenceInMinutes(new Date(block.endAt), new Date(block.startAt));
    // Width based on working hours, not 24 hours
    const w = (mins / (WORK_HOURS * 60)) * dayWidth;
    return Math.max(w, 28);
  }

  return (
    <div className="card overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
      <div style={{ width: totalW, minHeight: totalH }} className="relative select-none">
        {/* Header row — day columns */}
        <div className="sticky top-0 z-20 flex" style={{ height: headerH }}>
          <div className="shrink-0 bg-steel-50 border-b border-r border-border flex items-center px-3" style={{ width: labelW }}>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-steel-400">Work Centre</span>
          </div>
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={`shrink-0 border-b border-r border-border flex flex-col items-center justify-center ${
                isSameDay(day, new Date()) ? 'bg-primary-50' : isWeekend(day) ? 'bg-steel-100/60' : 'bg-steel-50'
              }`}
              style={{ width: dayWidth }}
            >
              <span className="text-[10px] font-semibold uppercase text-steel-400">{format(day, 'EEE')}</span>
              <span className={`text-sm font-bold ${isSameDay(day, new Date()) ? 'text-primary-700' : ''}`}>
                {format(day, 'd MMM')}
              </span>
            </div>
          ))}
        </div>

        {/* Work centre rows */}
        {visibleWCs.map((wc) => {
          const rowBlocks = blocks.filter((b) => b.workCenterId === wc.id);
          return (
            <div key={wc.id} className="flex" style={{ height: rowH }}>
              {/* Label */}
              <div
                className="shrink-0 sticky left-0 z-10 bg-white border-b border-r border-border flex items-center px-3 gap-2"
                style={{ width: labelW }}
              >
                <Wrench size={12} className="text-steel-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-steel-800 truncate">{wc.name}</div>
                  <div className="text-[10px] text-steel-400">{wc.code}</div>
                </div>
              </div>

              {/* Day cells */}
              <div className="relative flex-1" style={{ width: numDays * dayWidth }}>
                {/* Grid lines */}
                {days.map((day, di) => (
                  <div
                    key={di}
                    className={`absolute top-0 bottom-0 border-r border-b border-border cursor-pointer hover:bg-primary-50/20 ${
                      isWeekend(day) ? 'bg-steel-50/40' : ''
                    } ${isSameDay(day, new Date()) ? 'bg-primary-50/30' : ''}`}
                    style={{ left: di * dayWidth, width: dayWidth }}
                    onDoubleClick={() => onClickAdd(wc.id, day)}
                  />
                ))}

                {/* Blocks */}
                {rowBlocks.map((block) => {
                  const left = blockLeft(block);
                  const width = blockWidth(block);
                  const wo = block.jobPlan.workOrder;
                  const colorIdx = woColorMap.get(wo.workOrderNumber) ?? 0;
                  const color = blockColor(colorIdx);
                  const mins = differenceInMinutes(new Date(block.endAt), new Date(block.startAt));

                  // Only render if within visible range
                  if (left < labelW - width || left > totalW) return null;

                  return (
                    <div
                      key={block.id}
                      className="absolute top-1.5 group cursor-pointer"
                      style={{
                        left: Math.max(left, labelW),
                        width: Math.min(width, totalW - Math.max(left, labelW)),
                        height: rowH - 12,
                      }}
                      title={`${wo.workOrderNumber} · ${wo.salesOrder?.customer?.name ?? 'Internal'}\n${block.notes ?? ''}\n${minutesToLabel(mins)}`}
                    >
                      <div
                        className="h-full rounded-md border shadow-sm flex items-center gap-1.5 px-2 overflow-hidden transition-shadow hover:shadow-md"
                        style={{ background: `${color}18`, borderColor: `${color}50` }}
                      >
                        <GripHorizontal size={10} style={{ color }} className="shrink-0 opacity-40" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-bold truncate" style={{ color }}>
                            {wo.workOrderNumber}
                          </div>
                          {width > 60 && (
                            <div className="text-[9px] truncate text-steel-500">
                              {block.notes ?? (wo.salesOrder?.customer?.name ?? 'Internal')} · {minutesToLabel(mins)}
                            </div>
                          )}
                        </div>
                        {/* Delete button on hover */}
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteBlock(block.jobPlanId, block.id); }}
                          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Empty state */}
        {visibleWCs.length === 0 && (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            No work centres configured.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Work Order List View ─────────────────────────────────────────────────────

function WorkOrderList({ workOrders, navigate }: { workOrders: any[]; navigate: ReturnType<typeof useNavigate> }) {
  const withPlan = workOrders.filter((wo: any) => wo.jobPlan);
  const withoutPlan = workOrders.filter((wo: any) => !wo.jobPlan);

  function WORow({ wo }: { wo: any }) {
    const plan = wo.jobPlan;
    const totalMins = wo.lines?.reduce((s: number, l: any) => s + (l.estimatedMinutes ?? 0), 0) ?? 0;
    return (
      <button
        onClick={() => navigate(`/processing/planning/${wo.id}`)}
        className="w-full flex items-center gap-4 px-4 py-3 bg-background hover:bg-muted/40 transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
          <ClipboardList size={15} className="text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{wo.workOrderNumber}</span>
            <span className="text-[11px] font-medium" style={{ color: WO_STATUS_COLOR[wo.status] }}>{wo.status.replace('_', ' ')}</span>
            {plan && (
              <span className={`badge text-[10px] ${plan.status === 'SCHEDULED' ? 'badge-success' : plan.status === 'READY' ? 'badge-primary' : 'badge-warning'}`}>
                {plan.status}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
            {wo.salesOrder && <span>{wo.salesOrder.orderNumber} · {wo.salesOrder.customer?.name}</span>}
            {wo.scheduledDate && <span className="flex items-center gap-1"><Calendar size={10} />{new Date(wo.scheduledDate).toLocaleDateString()}</span>}
            {totalMins > 0 && <span className="flex items-center gap-1"><Clock size={10} />{minutesToLabel(totalMins)}</span>}
          </div>
        </div>
        {plan && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
            {plan.roles?.length > 0 && <span className="flex items-center gap-1"><Users size={11} />{plan.roles.length}</span>}
            {plan.equipment?.length > 0 && <span className="flex items-center gap-1"><Wrench size={11} />{plan.equipment.length}</span>}
          </div>
        )}
        <ChevronRight size={15} className="text-muted-foreground shrink-0" />
      </button>
    );
  }

  return (
    <div className="space-y-5">
      {withoutPlan.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Needs Planning ({withoutPlan.length})
          </h2>
          <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
            {withoutPlan.map((wo: any) => <WORow key={wo.id} wo={wo} />)}
          </div>
        </section>
      )}
      {withPlan.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Plans in Progress ({withPlan.length})
          </h2>
          <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
            {withPlan.map((wo: any) => <WORow key={wo.id} wo={wo} />)}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function PlanningPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>('gantt');
  const [zoom, setZoom] = useState<ZoomLevel>('2day');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [showAddModal, setShowAddModal] = useState(false);
  const [addDefaults, setAddDefaults] = useState<{ wcId?: string; day?: Date; woId?: string }>({});
  const [isQuickScheduling, setIsQuickScheduling] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch data
  const { data: workOrders = [], isLoading: woLoading } = useQuery({
    queryKey: ['planning-work-orders'],
    queryFn: () => planningApi.listWorkOrders().then((r) => r.data),
  });

  const { data: workCentersRaw = [], isLoading: wcLoading } = useQuery({
    queryKey: ['planning-work-centers'],
    queryFn: () => planningApi.listWorkCenters().then((r) => r.data),
  });
  const workCenters: WorkCenter[] = workCentersRaw as any;

  const numDays = zoom === 'week' ? 14 : zoom === '2day' ? 7 : 5;
  const { data: scheduleBlocks = [] } = useQuery({
    queryKey: ['planning-schedule', weekStart.toISOString(), numDays],
    queryFn: () => planningApi.getSchedule({
      from: weekStart.toISOString(),
      to: addDays(weekStart, numDays).toISOString(),
    }).then((r) => r.data),
  });

  // Mutations
  const { mutate: addBlock, isPending: isAddingBlock } = useMutation({
    mutationFn: ({ planId, data }: { planId: string; data: any }) => planningApi.addScheduleBlock(planId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planning-schedule'] });
      qc.invalidateQueries({ queryKey: ['planning-work-orders'] });
      setShowAddModal(false);
    },
  });

  const { mutate: deleteBlock } = useMutation({
    mutationFn: ({ planId, blockId }: { planId: string; blockId: string }) => planningApi.deleteScheduleBlock(planId, blockId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planning-schedule'] });
      qc.invalidateQueries({ queryKey: ['planning-work-orders'] });
    },
  });

  // Quick Schedule — distributes all unscheduled WO actions across work centres
  async function handleQuickSchedule() {
    setIsQuickScheduling(true);
    setScheduleMsg(null);
    try {
      const res = await planningApi.quickSchedule();
      const data = (res as any).data;
      qc.invalidateQueries({ queryKey: ['planning-schedule'] });
      qc.invalidateQueries({ queryKey: ['planning-work-orders'] });
      setScheduleMsg({ type: 'success', text: data.message ?? `Scheduled ${data.scheduled} actions` });
      // Jump to next week to see the newly scheduled blocks
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setWeekStart(startOfWeek(tomorrow, { weekStartsOn: 1 }));
      setTimeout(() => setScheduleMsg(null), 5000);
    } catch (err: any) {
      setScheduleMsg({ type: 'error', text: err?.response?.data?.message ?? 'Quick schedule failed.' });
      setTimeout(() => setScheduleMsg(null), 5000);
    } finally {
      setIsQuickScheduling(false);
    }
  }

  // Clear Schedule
  async function handleClearSchedule() {
    setScheduleMsg(null);
    try {
      const res = await planningApi.clearSchedule();
      const data = (res as any).data;
      qc.invalidateQueries({ queryKey: ['planning-schedule'] });
      qc.invalidateQueries({ queryKey: ['planning-work-orders'] });
      setScheduleMsg({ type: 'success', text: `Cleared ${data.deleted} schedule blocks` });
      setTimeout(() => setScheduleMsg(null), 5000);
    } catch (err: any) {
      setScheduleMsg({ type: 'error', text: 'Failed to clear schedule.' });
      setTimeout(() => setScheduleMsg(null), 5000);
    }
  }

  // Count unscheduled actions
  const unscheduledCount = useMemo(() => {
    let count = 0;
    for (const wo of workOrders as any[]) {
      if (['COMPLETED', 'CANCELLED'].includes(wo.status)) continue;
      if (!(wo.jobPlan?.scheduleBlocks?.length > 0)) {
        count += (wo.lines?.length ?? 0);
      }
    }
    return count;
  }, [workOrders]);

  const scheduledCount = (scheduleBlocks as any[]).length;
  const isLoading = woLoading || wcLoading;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Operations Planning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {view === 'gantt'
              ? `Gantt view · ${format(weekStart, 'dd MMM')} — ${format(addDays(weekStart, numDays - 1), 'dd MMM yyyy')}`
              : 'Define roles, equipment, and prep tasks per work order'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* KPI badges */}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertCircle size={13} className="text-yellow-500" />
            {unscheduledCount} unscheduled
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 size={13} className="text-green-500" />
            {scheduledCount} scheduled
          </span>

          <div className="w-px h-5 bg-border mx-1" />

          {/* View toggle */}
          <div className="flex border border-border rounded overflow-hidden">
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'gantt' ? 'bg-primary-600 text-white' : 'bg-white text-steel-600 hover:bg-steel-50'}`}
              onClick={() => setView('gantt')}
            >
              <Calendar size={12} className="inline mr-1" />Gantt
            </button>
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'list' ? 'bg-primary-600 text-white' : 'bg-white text-steel-600 hover:bg-steel-50'}`}
              onClick={() => setView('list')}
            >
              <ClipboardList size={12} className="inline mr-1" />List
            </button>
          </div>

          {view === 'gantt' && (
            <>
              {/* Zoom */}
              <div className="flex border border-border rounded overflow-hidden">
                {(['1day', '2day', 'week'] as ZoomLevel[]).map((z) => (
                  <button
                    key={z}
                    className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${zoom === z ? 'bg-steel-700 text-white' : 'bg-white text-steel-500 hover:bg-steel-50'}`}
                    onClick={() => setZoom(z)}
                  >
                    {ZOOM_CONFIG[z].label}
                  </button>
                ))}
              </div>

              {/* Week nav */}
              <button className="btn-secondary btn-sm" onClick={() => setWeekStart((w) => subWeeks(w, 1))}><ChevronLeft size={14} /></button>
              <button className="btn-secondary btn-sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</button>
              <button className="btn-secondary btn-sm" onClick={() => setWeekStart((w) => addWeeks(w, 1))}><ChevronRight size={14} /></button>

              {/* Add block */}
              <button
                className="btn-secondary btn-sm"
                onClick={() => { setAddDefaults({}); setShowAddModal(true); }}
              >
                <Plus size={13} /> Add Block
              </button>
            </>
          )}

          {/* Clear Schedule */}
          {scheduledCount > 0 && (
            <button
              className="btn-secondary btn-sm text-red-500 hover:text-red-700"
              onClick={handleClearSchedule}
              title="Clear all schedule blocks"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}

          {/* Quick Schedule */}
          <button
            className="btn-primary btn-sm flex items-center gap-1.5"
            onClick={handleQuickSchedule}
            disabled={isQuickScheduling || unscheduledCount === 0}
          >
            {isQuickScheduling
              ? <><Loader2 size={13} className="animate-spin" />Scheduling…</>
              : <><Zap size={13} />Quick Schedule</>}
          </button>
        </div>
      </div>

      {/* Schedule message */}
      {scheduleMsg && (
        <div className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg ${
          scheduleMsg.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {scheduleMsg.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {scheduleMsg.text}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Content */}
      {!isLoading && view === 'gantt' && (
        <div className="flex gap-4">
          {/* Gantt */}
          <div className="flex-1 min-w-0">
            <GanttChart
              blocks={scheduleBlocks as unknown as ScheduleBlock[]}
              workCenters={workCenters}
              weekStart={weekStart}
              zoom={zoom}
              onDeleteBlock={(planId, blockId) => deleteBlock({ planId, blockId })}
              onClickAdd={(wcId, day) => {
                setAddDefaults({ wcId, day });
                setShowAddModal(true);
              }}
            />
          </div>

          {/* Unscheduled sidebar */}
          <div className="w-64 flex-shrink-0">
            <div className="card sticky top-4">
              <div className="card-header flex items-center gap-2">
                <AlertCircle size={13} className="text-amber-500" />
                <span className="text-sm font-semibold">To Be Scheduled</span>
                <span className="ml-auto text-[10px] font-bold text-amber-600 bg-amber-100 rounded-full px-1.5 py-0.5">{unscheduledCount}</span>
              </div>
              <div className="p-2 max-h-[calc(100vh-320px)] overflow-y-auto">
                <UnscheduledPanel
                  workOrders={workOrders as any[]}
                  onClickSchedule={(woId, wcId) => {
                    setAddDefaults({ woId, wcId });
                    setShowAddModal(true);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {!isLoading && view === 'list' && (
        <WorkOrderList workOrders={workOrders as any[]} navigate={navigate} />
      )}

      {/* Add block modal */}
      {showAddModal && (
        <AddBlockModal
          workCenters={workCenters}
          workOrders={workOrders as any[]}
          onClose={() => setShowAddModal(false)}
          onSave={(planId, data) => addBlock({ planId, data })}
          isSaving={isAddingBlock}
          defaultWorkCenterId={addDefaults.wcId}
          defaultDate={addDefaults.day}
          defaultWorkOrderId={addDefaults.woId}
        />
      )}
    </div>
  );
}
