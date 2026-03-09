import { useQuery } from '@tanstack/react-query';
import { accountingApi } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { DollarSign, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';

function fmtCurrency(cents: number) {
  if (cents >= 1_000_000_00) return `$${(cents / 1_000_000_00).toFixed(2)}M`;
  if (cents >= 1_000_00)     return `$${(cents / 1_000_00).toFixed(1)}K`;
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0 })}`;
}

function fmtMonth(key: string) {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
}

// ── SVG Revenue Chart ─────────────────────────────────────────────────────────

interface MonthPoint { month: string; invoiced: number; received: number }

function RevenueChart({ data }: { data: MonthPoint[] }) {
  if (!data.length) return <div className="h-48 flex items-center justify-center text-sm text-steel-400">No data</div>;

  const W = 640, H = 160, PAD_L = 56, PAD_B = 28, PAD_T = 16, PAD_R = 16;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const maxVal = Math.max(...data.map((d) => Math.max(d.invoiced, d.received)), 1);

  function x(i: number) { return PAD_L + (i / (data.length - 1)) * chartW; }
  function y(v: number) { return PAD_T + chartH - (v / maxVal) * chartH; }

  const invoicedPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.invoiced)}`).join(' ');
  const receivedPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.received)}`).join(' ');

  // Y-axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ val: t * maxVal, y: PAD_T + chartH - t * chartH }));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: '400px', height: '160px' }}>
        {/* Grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={t.y} x2={W - PAD_R} y2={t.y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD_L - 6} y={t.y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">
              {fmtCurrency(t.val)}
            </text>
          </g>
        ))}

        {/* Lines */}
        <path d={invoicedPath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
        <path d={receivedPath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 2" />

        {/* Dots */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.invoiced)} r="3" fill="#3b82f6" />
            <circle cx={x(i)} cy={y(d.received)} r="3" fill="#22c55e" />
          </g>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {fmtMonth(d.month)}
          </text>
        ))}
      </svg>

      <div className="flex items-center gap-4 mt-2 px-2">
        <span className="flex items-center gap-1.5 text-xs text-steel-600">
          <span className="w-6 h-0.5 bg-blue-500 inline-block rounded" />
          Invoiced
        </span>
        <span className="flex items-center gap-1.5 text-xs text-steel-600">
          <span className="w-6 border-t-2 border-dashed border-green-500 inline-block" />
          Received
        </span>
      </div>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const INV_STATUS: Record<string, string> = {
  DRAFT: 'badge-gray', SENT: 'badge-blue', PARTIALLY_PAID: 'badge-amber',
  PAID: 'badge-green', OVERDUE: 'badge-red', CANCELLED: 'badge-red',
};

// ── AccountingDashboardPage ────────────────────────────────────────────────────

interface DashData {
  kpis: { totalInvoiced: number; totalReceived: number; totalOutstanding: number; overdueCount: number };
  monthlyRevenue: MonthPoint[];
  topCustomers: { name: string; total: number }[];
  recentInvoices: { id: string; invoiceNumber: string; customer?: string; totalAmount: number; status: string; invoiceDate: string; workOrders: any[] }[];
}

export function AccountingDashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['accounting-dashboard'],
    queryFn: () => accountingApi.getDashboard().then((r) => r.data as { data: DashData }),
    refetchInterval: 120_000,
  });

  const d = data?.data;

  const kpis = [
    { label: 'Invoiced (12mo)',    value: d ? fmtCurrency(d.kpis.totalInvoiced)    : '—', icon: TrendingUp,    color: 'bg-blue-600' },
    { label: 'Received (12mo)',    value: d ? fmtCurrency(d.kpis.totalReceived)    : '—', icon: CheckCircle,   color: 'bg-green-600' },
    { label: 'Outstanding',        value: d ? fmtCurrency(d.kpis.totalOutstanding) : '—', icon: DollarSign,    color: 'bg-amber-500' },
    { label: 'Overdue Invoices',   value: d ? String(d.kpis.overdueCount)          : '—', icon: AlertTriangle, color: 'bg-red-500' },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Accounting Dashboard" subtitle="Revenue overview — last 12 months" />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map((k) => (
          <div key={k.label} className="card card-body flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${k.color}`}>
              <k.icon size={16} className="text-white" />
            </div>
            <div>
              <div className={`text-lg font-bold ${isLoading ? 'skeleton h-5 w-16' : 'text-steel-900'}`}>{isLoading ? '' : k.value}</div>
              <div className="text-xs text-steel-500">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        {/* Revenue chart */}
        <div className="card lg:col-span-2">
          <div className="card-header flex items-center gap-2">
            <TrendingUp size={15} className="text-steel-500" />
            <h3 className="font-semibold">Revenue Over Time</h3>
          </div>
          <div className="card-body">
            {isLoading
              ? <div className="h-48 skeleton rounded" />
              : <RevenueChart data={d?.monthlyRevenue ?? []} />
            }
          </div>
        </div>

        {/* Top customers */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <DollarSign size={15} className="text-steel-500" />
            <h3 className="font-semibold">Top Customers</h3>
          </div>
          <div className="card-body p-0">
            {isLoading
              ? <div className="p-4 space-y-2">{Array.from({length: 6}).map((_, i) => <div key={i} className="skeleton h-5 rounded" />)}</div>
              : (d?.topCustomers ?? []).map((c, i) => {
                  const maxVal = d!.topCustomers[0]?.total ?? 1;
                  const pct = (c.total / maxVal) * 100;
                  return (
                    <div key={c.name} className="flex items-center gap-2 px-4 py-2 border-b border-steel-50 last:border-0">
                      <span className="text-xs font-semibold text-steel-400 w-4 flex-shrink-0">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-steel-800 truncate">{c.name}</div>
                        <div className="mt-1 h-1 rounded-full bg-steel-100 overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="text-xs font-mono font-semibold text-steel-700 flex-shrink-0">{fmtCurrency(c.total)}</span>
                    </div>
                  );
                })
            }
          </div>
        </div>
      </div>

      {/* Recent invoices with job links */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <DollarSign size={15} className="text-steel-500" />
          <h3 className="font-semibold">Recent Invoices</h3>
          <span className="text-xs text-steel-400 ml-1">— linked work orders</span>
        </div>
        <div className="card-body p-0">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th>Work Orders</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 6 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                  ))
                : (d?.recentInvoices ?? []).map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-mono text-xs font-semibold text-primary-700">{inv.invoiceNumber}</td>
                      <td className="font-medium text-steel-900">{inv.customer ?? '—'}</td>
                      <td className="text-xs text-steel-500">{new Date(inv.invoiceDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                      <td><span className={INV_STATUS[inv.status] ?? 'badge-gray'}>{inv.status}</span></td>
                      <td className="text-right font-mono text-xs font-semibold text-steel-700">{fmtCurrency(inv.totalAmount)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {inv.workOrders.length === 0
                            ? <span className="text-steel-300 text-xs">—</span>
                            : inv.workOrders.map((wo: any) => (
                                <a key={wo.id} href={`/processing/work-orders/${wo.id}`}
                                  className="text-[10px] font-mono font-medium text-primary-600 hover:underline bg-primary-50 px-1.5 py-0.5 rounded">
                                  {wo.workOrderNumber}
                                </a>
                              ))
                          }
                        </div>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
