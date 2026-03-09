import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { processingApi } from '../../services/api';
import { Activity, Clock, DollarSign, Package, TrendingUp, Layers } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';

function fmtCurrency(cents: number) {
  if (cents >= 1_000_000_00) return `$${(cents / 1_000_000_00).toFixed(1)}M`;
  if (cents >= 1_000_00)     return `$${(cents / 1_000_00).toFixed(1)}K`;
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0 })}`;
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT:       '#94a3b8',
  SCHEDULED:   '#3b82f6',
  IN_PROGRESS: '#f59e0b',
  ON_HOLD:     '#f97316',
  COMPLETED:   '#22c55e',
  CANCELLED:   '#ef4444',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};

interface DashboardData {
  totalJobs: number;
  activeJobs: number;
  avgCycleHours: number | null;
  pipelineRevenue: number;
  statusCounts: Record<string, number>;
  upcoming: {
    id: string; status: string; scheduledDate: string;
    customer?: string; orderNumber?: string; totalAmount?: number;
  }[];
}

// ── Mini bar chart ─────────────────────────────────────────────────────────────

function StatusBarChart({ counts }: { counts: Record<string, number> }) {
  const statuses = Object.keys(STATUS_LABEL);
  const max = Math.max(...statuses.map((s) => counts[s] ?? 0), 1);

  return (
    <div className="flex items-end gap-2 h-24">
      {statuses.map((s) => {
        const count = counts[s] ?? 0;
        const pct = (count / max) * 100;
        return (
          <div key={s} className="flex flex-col items-center gap-1 flex-1">
            <span className="text-xs font-semibold text-steel-700">{count}</span>
            <div className="w-full rounded-t-sm transition-all" style={{ height: `${Math.max(pct * 0.8, count > 0 ? 8 : 2)}px`, background: STATUS_COLOR[s] }} />
            <span className="text-[9px] text-steel-400 text-center leading-tight" style={{ writingMode: 'unset' }}>{STATUS_LABEL[s].split(' ')[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ComponentType<any>;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="card card-body flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <div className="text-xl font-bold text-steel-900">{value}</div>
        <div className="text-xs font-medium text-steel-500">{label}</div>
        {sub && <div className="text-xs text-steel-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ── ProcessingDashboardPage ────────────────────────────────────────────────────

export function ProcessingDashboardPage() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['processing-dashboard'],
    queryFn: () => processingApi.getDashboard().then((r) => r.data as { data: DashboardData }),
    refetchInterval: 60_000,
  });

  const d = data?.data;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Orders Dashboard"
        subtitle="Real-time job status, cycle times and revenue pipeline"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card card-body h-20 skeleton" />
          ))
        ) : (
          <>
            <KpiCard
              icon={Layers}
              label="Total Jobs"
              value={String(d?.totalJobs ?? 0)}
              sub={`${d?.activeJobs ?? 0} active`}
              color="bg-primary-600"
            />
            <KpiCard
              icon={Activity}
              label="In Progress"
              value={String(d?.statusCounts?.IN_PROGRESS ?? 0)}
              sub={`${d?.statusCounts?.ON_HOLD ?? 0} on hold`}
              color="bg-amber-500"
            />
            <KpiCard
              icon={Clock}
              label="Avg Cycle Time"
              value={d?.avgCycleHours != null ? `${d.avgCycleHours}h` : '—'}
              sub="order → dispatch"
              color="bg-teal-600"
            />
            <KpiCard
              icon={DollarSign}
              label="Revenue in Pipeline"
              value={d?.pipelineRevenue ? fmtCurrency(d.pipelineRevenue) : '—'}
              sub="active job value"
              color="bg-green-600"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Status chart */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <TrendingUp size={15} className="text-steel-500" />
            <h3 className="font-semibold">Jobs by Status</h3>
          </div>
          <div className="card-body">
            {isLoading ? <div className="h-24 skeleton rounded" /> : (
              <StatusBarChart counts={d?.statusCounts ?? {}} />
            )}
          </div>
        </div>

        {/* Upcoming dispatch */}
        <div className="card lg:col-span-2">
          <div className="card-header flex items-center gap-2">
            <Package size={15} className="text-steel-500" />
            <h3 className="font-semibold">Upcoming Dispatch (14 days)</h3>
          </div>
          <div className="card-body p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 skeleton rounded" />)}
              </div>
            ) : !d?.upcoming?.length ? (
              <div className="p-6 text-center text-sm text-steel-400">No scheduled dispatch in next 14 days</div>
            ) : (
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>SO #</th>
                    <th>Scheduled</th>
                    <th className="text-right">Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.upcoming.map((wo) => (
                    <tr
                      key={wo.id}
                      className="cursor-pointer hover:bg-steel-50"
                      onClick={() => navigate(`/processing/work-orders/${wo.id}`)}
                    >
                      <td className="font-medium text-steel-900">{wo.customer ?? '—'}</td>
                      <td className="font-mono text-xs text-steel-500">{wo.orderNumber ?? '—'}</td>
                      <td className="text-xs text-steel-500">
                        {wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'}
                      </td>
                      <td className="text-right font-mono text-xs text-steel-700">
                        {wo.totalAmount ? fmtCurrency(Number(wo.totalAmount)) : '—'}
                      </td>
                      <td>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: STATUS_COLOR[wo.status] + '20', color: STATUS_COLOR[wo.status] }}>
                          {STATUS_LABEL[wo.status] ?? wo.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
