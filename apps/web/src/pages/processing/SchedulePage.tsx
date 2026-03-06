import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { processingApi } from '../../services/api';
import { ChevronLeft, ChevronRight, Calendar, BarChart3, Plus } from 'lucide-react';
import { useState } from 'react';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isToday, isSameDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const STATUS_COLOR: Record<string, string> = {
  DRAFT:       'bg-steel-200 text-steel-700 border-steel-300',
  SCHEDULED:   'bg-blue-100 text-blue-800 border-blue-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 border-amber-300',
  ON_HOLD:     'bg-yellow-100 text-yellow-800 border-yellow-300',
  COMPLETED:   'bg-green-100 text-green-800 border-green-300',
  CANCELLED:   'bg-red-100 text-red-600 border-red-200',
};

const PRIORITY_COLOR: Record<number, string> = {
  1: 'border-l-green-400', 2: 'border-l-blue-400', 3: 'border-l-amber-400',
  4: 'border-l-orange-500', 5: 'border-l-red-500',
};

export function SchedulePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [view, setView] = useState<'week' | 'list'>('week');

  const weekDays = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)); // Mon-Sat

  const { data, isLoading } = useQuery({
    queryKey: ['schedule', weekStart.toISOString()],
    queryFn: () => processingApi.getSchedule({
      from: weekStart.toISOString().split('T')[0],
      to: addDays(weekStart, 6).toISOString().split('T')[0],
    }).then((r) => r.data),
  });

  const { data: allWO } = useQuery({
    queryKey: ['work-orders-schedule'],
    queryFn: () => processingApi.listWorkOrders({ limit: 200 }).then((r) => r.data),
  });

  const workOrders: any[] = (allWO as any)?.data ?? [];
  const scheduledWOs: any[] = (data as any)?.workOrders ?? workOrders;

  // Group WOs by day for week view
  function wodForDay(day: Date) {
    return scheduledWOs.filter((wo) => wo.scheduledDate && isSameDay(new Date(wo.scheduledDate), day));
  }

  const statusCounts = {
    inProgress: workOrders.filter((wo) => wo.status === 'IN_PROGRESS').length,
    scheduled:  workOrders.filter((wo) => wo.status === 'SCHEDULED').length,
    onHold:     workOrders.filter((wo) => wo.status === 'ON_HOLD').length,
    overdue:    workOrders.filter((wo) => wo.scheduledDate && new Date(wo.scheduledDate) < new Date() && !['COMPLETED','CANCELLED'].includes(wo.status)).length,
  };

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Production Schedule</h1>
          <p className="page-subtitle">
            Week of {format(weekStart, 'dd MMM yyyy')} — {format(addDays(weekStart, 5), 'dd MMM yyyy')}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex border border-border rounded overflow-hidden">
            <button className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'week' ? 'bg-primary-600 text-white' : 'bg-white text-steel-600 hover:bg-steel-50'}`}
              onClick={() => setView('week')}><Calendar size={12} className="inline mr-1" />Week</button>
            <button className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'list' ? 'bg-primary-600 text-white' : 'bg-white text-steel-600 hover:bg-steel-50'}`}
              onClick={() => setView('list')}><BarChart3 size={12} className="inline mr-1" />List</button>
          </div>
          <button className="btn-secondary btn-sm" onClick={() => setWeekStart((w) => subWeeks(w, 1))}><ChevronLeft size={14} /></button>
          <button className="btn-secondary btn-sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</button>
          <button className="btn-secondary btn-sm" onClick={() => setWeekStart((w) => addWeeks(w, 1))}><ChevronRight size={14} /></button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'In Progress', value: statusCounts.inProgress, color: 'text-amber-600' },
          { label: 'Scheduled',   value: statusCounts.scheduled,  color: 'text-blue-600' },
          { label: 'On Hold',     value: statusCounts.onHold,     color: 'text-yellow-600' },
          { label: 'Overdue',     value: statusCounts.overdue,    color: statusCounts.overdue > 0 ? 'text-red-600' : 'text-foreground' },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {view === 'week' ? (
        /* ── Week view ── */
        <div className="card overflow-hidden">
          <div className="grid grid-cols-6 divide-x divide-border">
            {weekDays.map((day) => (
              <div key={day.toISOString()} className="min-h-[300px]">
                {/* Day header */}
                <div className={`px-3 py-2 border-b border-border text-center ${isToday(day) ? 'bg-primary-600 text-white' : 'bg-steel-50'}`}>
                  <div className={`text-[10px] font-semibold uppercase tracking-wider ${isToday(day) ? 'text-white/70' : 'text-muted-foreground'}`}>{format(day, 'EEE')}</div>
                  <div className={`text-lg font-bold leading-tight ${isToday(day) ? 'text-white' : ''}`}>{format(day, 'd')}</div>
                  <div className={`text-[10px] ${isToday(day) ? 'text-white/70' : 'text-muted-foreground'}`}>{format(day, 'MMM')}</div>
                </div>

                {/* WOs for this day */}
                <div className="p-1.5 space-y-1.5">
                  {isLoading
                    ? <div className="skeleton h-14 w-full rounded" />
                    : wodForDay(day).map((wo) => (
                        <div key={wo.id}
                          className={`p-2 rounded border-l-2 border border-border cursor-pointer text-xs transition-shadow hover:shadow-md ${STATUS_COLOR[wo.status] ?? ''} ${PRIORITY_COLOR[wo.priority] ?? ''}`}
                          onClick={() => navigate(`/processing/work-orders/${wo.id}`)}>
                          <div className="font-mono font-bold text-[11px]">{wo.workOrderNumber}</div>
                          <div className="truncate text-[11px] mt-0.5">{wo.salesOrder?.customer?.name ?? 'Internal'}</div>
                          {wo.workCenter && <div className="text-[10px] opacity-70 mt-0.5">{wo.workCenter.name}</div>}
                        </div>
                      ))}
                  {!isLoading && wodForDay(day).length === 0 && (
                    <div className="text-center text-[11px] text-muted-foreground/40 pt-8">—</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── List view ── */
        <div className="card">
          <div className="table-container rounded-xl">
            <table className="table">
              <thead>
                <tr><th>WO #</th><th>Status</th><th>Priority</th><th>Customer</th><th>Work Centre</th><th>Scheduled</th><th>Due</th></tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 7 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                    ))
                  : workOrders.sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).map((wo) => (
                      <tr key={wo.id} className="cursor-pointer" onClick={() => navigate(`/processing/work-orders/${wo.id}`)}>
                        <td className="font-mono text-xs font-semibold text-primary-700">{wo.workOrderNumber}</td>
                        <td><span className={`badge ${STATUS_COLOR[wo.status]?.split(' ').slice(0,2).join(' ') ?? ''} text-xs`}>{wo.status?.replace(/_/g,' ')}</span></td>
                        <td>
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white
                            ${wo.priority <= 2 ? 'bg-green-500' : wo.priority === 3 ? 'bg-amber-500' : 'bg-red-500'}`}>
                            {wo.priority}
                          </span>
                        </td>
                        <td className="font-medium text-sm">{wo.salesOrder?.customer?.name ?? '—'}</td>
                        <td className="text-xs text-muted-foreground">{wo.workCenter?.name ?? '—'}</td>
                        <td className="text-xs text-steel-500">{wo.scheduledDate ? format(new Date(wo.scheduledDate), 'dd MMM yyyy') : '—'}</td>
                        <td className="text-xs">
                          {wo.dueDate ? (
                            <span className={new Date(wo.dueDate) < new Date() && !['COMPLETED','CANCELLED'].includes(wo.status) ? 'text-red-500 font-medium' : ''}>
                              {format(new Date(wo.dueDate), 'dd MMM yyyy')}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {!isLoading && workOrders.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon"><Calendar size={22} /></div>
              <p className="text-sm font-medium">No work orders scheduled</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
