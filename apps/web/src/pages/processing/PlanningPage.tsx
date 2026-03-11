import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { planningApi } from '../../services/api';
import {
  ClipboardList, ChevronRight, CheckCircle2, Clock, AlertCircle,
  Calendar, Users, Wrench,
} from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT:     { label: 'Draft',     className: 'badge-warning' },
  READY:     { label: 'Ready',     className: 'badge-primary' },
  SCHEDULED: { label: 'Scheduled', className: 'badge-success' },
};

const WO_STATUS_COLOR: Record<string, string> = {
  DRAFT:       'text-muted-foreground',
  SCHEDULED:   'text-blue-600',
  IN_PROGRESS: 'text-orange-600',
  ON_HOLD:     'text-yellow-600',
  COMPLETED:   'text-green-600',
  CANCELLED:   'text-red-500',
};

export function PlanningPage() {
  const navigate = useNavigate();

  const { data: workOrders = [], isLoading } = useQuery({
    queryKey: ['planning-work-orders'],
    queryFn: () => planningApi.listWorkOrders().then((r) => r.data),
  });

  const withPlan    = workOrders.filter((wo: any) => wo.jobPlan);
  const withoutPlan = workOrders.filter((wo: any) => !wo.jobPlan);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Operations Planning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define roles, equipment, and prep tasks per work order — then auto-schedule with AI.
          </p>
        </div>
        <div className="flex gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <AlertCircle size={13} className="text-yellow-500" />
            {withoutPlan.length} unplanned
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-green-500" />
            {withPlan.length} with plan
          </span>
        </div>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground animate-pulse">Loading work orders…</div>
      )}

      {!isLoading && workOrders.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No work orders found.</p>
        </div>
      )}

      {/* Unplanned work orders */}
      {withoutPlan.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Needs Planning ({withoutPlan.length})
          </h2>
          <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
            {withoutPlan.map((wo: any) => (
              <WorkOrderRow key={wo.id} wo={wo} navigate={navigate} />
            ))}
          </div>
        </section>
      )}

      {/* Work orders with plans */}
      {withPlan.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Plans in Progress ({withPlan.length})
          </h2>
          <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
            {withPlan.map((wo: any) => (
              <WorkOrderRow key={wo.id} wo={wo} navigate={navigate} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function WorkOrderRow({ wo, navigate }: { wo: any; navigate: ReturnType<typeof useNavigate> }) {
  const plan = wo.jobPlan;
  const statusBadge = plan ? STATUS_BADGE[plan.status] : null;
  const woColorClass = WO_STATUS_COLOR[wo.status] ?? 'text-muted-foreground';

  const totalEstMins = wo.lines?.reduce((sum: number, l: any) => sum + (l.estimatedMinutes ?? 0), 0) ?? 0;
  const estHours = totalEstMins > 0 ? `${Math.round(totalEstMins / 60 * 10) / 10}h est.` : null;

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
          <span className={`text-[11px] font-medium ${woColorClass}`}>{wo.status.replace('_', ' ')}</span>
          {statusBadge && (
            <span className={`badge ${statusBadge.className} text-[10px]`}>{statusBadge.label}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
          {wo.salesOrder && (
            <span className="flex items-center gap-1">
              <ClipboardList size={10} />
              {wo.salesOrder.orderNumber} · {wo.salesOrder.customer?.name}
            </span>
          )}
          {wo.scheduledDate && (
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              {new Date(wo.scheduledDate).toLocaleDateString()}
            </span>
          )}
          {estHours && (
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {estHours}
            </span>
          )}
        </div>
      </div>

      {plan && (
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
          {plan.roles?.length > 0 && (
            <span className="flex items-center gap-1">
              <Users size={11} /> {plan.roles.length}
            </span>
          )}
          {plan.equipment?.length > 0 && (
            <span className="flex items-center gap-1">
              <Wrench size={11} /> {plan.equipment.length}
            </span>
          )}
        </div>
      )}

      <ChevronRight size={15} className="text-muted-foreground shrink-0" />
    </button>
  );
}
