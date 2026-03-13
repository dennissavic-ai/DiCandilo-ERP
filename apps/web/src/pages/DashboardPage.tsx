import { useQuery } from '@tanstack/react-query';
import { reportingApi } from '../services/api';
import {
  TrendingUp, Package, AlertTriangle, ShoppingCart,
  DollarSign, Wrench, Clock, FileText, ArrowUpRight,
  ArrowDownRight, Minus, Target, Hash, Truck, Gauge,
  Percent, RotateCcw, ClipboardList,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

/* ── Formatters ───────────────────────────────────────────────────── */
function fmtCurrency(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}

/* ── Mock chart data ──────────────────────────────────────────────── */
const salesTrend = [
  { month: 'Aug', revenue: 12500000, orders: 34 },
  { month: 'Sep', revenue: 14800000, orders: 41 },
  { month: 'Oct', revenue: 13200000, orders: 38 },
  { month: 'Nov', revenue: 16800000, orders: 52 },
  { month: 'Dec', revenue: 14500000, orders: 44 },
  { month: 'Jan', revenue: 18900000, orders: 61 },
];

const arAgeing = [
  { label: 'Current', value: 8900000, color: '#22c55e' },
  { label: '1–30d',   value: 3400000, color: '#3b82f6' },
  { label: '31–60d',  value: 1800000, color: '#f59e0b' },
  { label: '61–90d',  value:  700000, color: '#f97316' },
  { label: '90d+',    value:  300000, color: '#ef4444' },
];

const topProducts = [
  { name: 'HR Plate 6mm × 1500×3000', sales: 42, value: 4820000 },
  { name: 'SS RHS 50×50×3',           sales: 31, value: 2970000 },
  { name: 'Al Flat 3×300×2400',       sales: 28, value: 1640000 },
  { name: 'Cold Rolled Sheet 2mm',    sales: 19, value: 1230000 },
  { name: 'MS Round Bar 50mm',        sales: 14, value:  890000 },
];

const recentActivity = [
  { id: 'SO-2024-0184', type: 'Sales Order',    customer: 'ACME Manufacturing',       status: 'Confirmed',   value: 2840000, time: '12 min ago' },
  { id: 'PO-2024-0091', type: 'Purchase Order', customer: 'Nucor Steel',              status: 'Submitted',   value: 6120000, time: '1 hr ago' },
  { id: 'WO-2024-0047', type: 'Work Order',     customer: 'BuildRight Construction',  status: 'In Progress', value: 0,       time: '2 hr ago' },
  { id: 'SO-2024-0183', type: 'Sales Order',    customer: 'Precision Fabricators',    status: 'Invoiced',    value: 1560000, time: '3 hr ago' },
  { id: 'INV-2024-0122', type: 'Invoice',       customer: 'ACME Manufacturing',       status: 'Overdue',     value: 3200000, time: '1 day ago' },
];

/* ── KPI card types ───────────────────────────────────────────────── */
interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  iconBg: string;
  onClick?: () => void;
}

function KpiCard({ label, value, sub, trend, trendValue, icon: Icon, iconBg, onClick }: KpiProps) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-steel-400';

  return (
    <div
      onClick={onClick}
      className={`stat-card ${onClick ? 'stat-card-clickable' : ''}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon size={16} className="text-white" />
        </div>
        {trendValue && (
          <div className={`flex items-center gap-0.5 text-xs font-medium ${trendColor}`}>
            <TrendIcon size={12} />
            {trendValue}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
      <div className="text-xs font-medium text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-steel-400 mt-1">{sub}</div>}
    </div>
  );
}

/* ── Status badge map ─────────────────────────────────────────────── */
function statusBadge(status: string) {
  const map: Record<string, string> = {
    Confirmed:   'badge-green',
    Submitted:   'badge-blue',
    'In Progress': 'badge-amber',
    Invoiced:    'badge-teal',
    Overdue:     'badge-red',
  };
  return <span className={map[status] ?? 'badge-gray'}>{status}</span>;
}

/* ── Custom tooltip for charts ─────────────────────────────────────── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg px-3 py-2.5 text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="text-muted-foreground">
          <span className="text-foreground font-medium">
            {typeof p.value === 'number' && p.value > 1000 ? fmtCurrency(p.value) : p.value}
          </span>
          {' '}{p.name}
        </p>
      ))}
    </div>
  );
}

/* ── Gauge ring (SVG) ─────────────────────────────────────────────── */
function GaugeRing({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width={size} height={size} className="flex-shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        className="transition-all duration-700" />
    </svg>
  );
}

/* ── KPI fundamental tile ────────────────────────────────────────── */
interface FundamentalProps {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  iconColor: string;
  gauge?: { pct: number; color: string };
  onClick?: () => void;
}

function FundamentalCard({ label, value, sub, trend, trendValue, icon: Icon, iconColor, gauge, onClick }: FundamentalProps) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-steel-400';

  return (
    <div onClick={onClick} className={`card p-4 flex items-center gap-4 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}>
      {gauge ? (
        <div className="relative">
          <GaugeRing pct={gauge.pct} color={gauge.color} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold text-foreground tabular-nums rotate-90">{gauge.pct}%</span>
          </div>
        </div>
      ) : (
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconColor}`}>
          <Icon size={18} className="text-white" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-lg font-bold text-foreground tabular-nums leading-tight">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-[11px] text-steel-400 mt-0.5">{sub}</div>}
      </div>
      {trendValue && (
        <div className={`flex items-center gap-0.5 text-xs font-medium ${trendColor}`}>
          <TrendIcon size={12} />
          {trendValue}
        </div>
      )}
    </div>
  );
}

/* ── Dashboard page ───────────────────────────────────────────────── */
export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => reportingApi.getDashboard().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['kpis'],
    queryFn: () => reportingApi.getKpis().then((r) => r.data),
    refetchInterval: 120_000,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="max-w-[1400px] mx-auto space-y-6 animate-fade-in">

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">
            {greeting}, {user?.firstName} 👋
          </h1>
          <p className="page-subtitle">
            Here's what's happening at your service centre today.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => navigate('/inventory/receive')}>
            + Receive Stock
          </button>
          <button className="btn-primary btn-sm" onClick={() => navigate('/sales/orders')}>
            + New Order
          </button>
        </div>
      </div>

      {/* ── KPI grid ────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="skeleton h-9 w-9 rounded-xl" />
              <div className="skeleton h-6 w-20" />
              <div className="skeleton h-3 w-28" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard
            label="Sales Today"     icon={TrendingUp}    iconBg="bg-primary-500"
            value={fmtCurrency(dashboard?.sales?.today?.amount ?? 1890000)}
            sub={`${dashboard?.sales?.today?.count ?? 7} orders`}
            trend="up" trendValue="+12%"
            onClick={() => navigate('/sales/orders')}
          />
          <KpiCard
            label="Sales This Month" icon={DollarSign}   iconBg="bg-green-500"
            value={fmtCurrency(dashboard?.sales?.month?.amount ?? 18900000)}
            sub={`${dashboard?.sales?.month?.count ?? 61} orders`}
            trend="up" trendValue="+23%"
          />
          <KpiCard
            label="Open Orders"     icon={ShoppingCart}  iconBg="bg-blue-500"
            value={String(dashboard?.orders?.open ?? 14)}
            sub="awaiting fulfilment"
            onClick={() => navigate('/sales/orders')}
          />
          <KpiCard
            label="Open Quotes"     icon={FileText}      iconBg="bg-violet-500"
            value={String(dashboard?.orders?.openQuotes ?? 6)}
            sub="pending response"
            onClick={() => navigate('/sales/quotes')}
          />
          <KpiCard
            label="Inventory Value" icon={Package}       iconBg="bg-orange-500"
            value={fmtCurrency(dashboard?.inventory?.value ?? 42000000)}
            sub={`${dashboard?.inventory?.lowStockCount ?? 3} low-stock alerts`}
            trend="flat"
            onClick={() => navigate('/inventory')}
          />
          <KpiCard
            label="AR Overdue"      icon={AlertTriangle} iconBg="bg-red-500"
            value={fmtCurrency(dashboard?.ar?.overdueBalance ?? 3200000)}
            sub={`${dashboard?.ar?.overdueCount ?? 2} invoices`}
            trend="down" trendValue="-8%"
            onClick={() => navigate('/accounting/ar-ageing')}
          />
          <KpiCard
            label="Open Work Orders" icon={Wrench}       iconBg="bg-teal-500"
            value={String(dashboard?.production?.openWorkOrders ?? 8)}
            sub="in production"
            onClick={() => navigate('/processing/work-orders')}
          />
          <KpiCard
            label="Open POs"        icon={Clock}         iconBg="bg-indigo-500"
            value={String(dashboard?.purchasing?.openPOs ?? 5)}
            sub="with suppliers"
            onClick={() => navigate('/purchasing/orders')}
          />
        </div>
      )}

      {/* ── Business KPIs ──────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Business KPIs</h2>
          <span className="text-[11px] text-muted-foreground">This month</span>
        </div>

        {kpisLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card p-4 flex items-center gap-4">
                <div className="skeleton w-10 h-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-5 w-16" />
                  <div className="skeleton h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Revenue */}
            <FundamentalCard
              label="Revenue This Month"
              icon={Target}
              iconColor="bg-emerald-500"
              value={fmtCurrency(kpis?.revenue?.thisMonth ?? 0)}
              sub={`YTD: ${fmtCurrency(kpis?.revenue?.ytd ?? 0)}`}
              trend={kpis?.revenue?.growthPct != null ? (kpis.revenue.growthPct >= 0 ? 'up' : 'down') : 'flat'}
              trendValue={kpis?.revenue?.growthPct != null ? `${kpis.revenue.growthPct > 0 ? '+' : ''}${kpis.revenue.growthPct}%` : undefined}
              onClick={() => navigate('/accounting/invoices')}
            />

            {/* Number of Sales */}
            <FundamentalCard
              label="Sales Orders"
              icon={Hash}
              iconColor="bg-blue-500"
              value={String(kpis?.sales?.countThisMonth ?? 0)}
              sub={`Avg order: ${fmtCurrency(kpis?.sales?.avgOrderValue ?? 0)}`}
              trend={kpis?.sales?.growthPct != null ? (kpis.sales.growthPct >= 0 ? 'up' : 'down') : 'flat'}
              trendValue={kpis?.sales?.growthPct != null ? `${kpis.sales.growthPct > 0 ? '+' : ''}${kpis.sales.growthPct}%` : undefined}
              onClick={() => navigate('/sales/orders')}
            />

            {/* Dispatch Ready Value */}
            <FundamentalCard
              label="Ready for Dispatch"
              icon={Truck}
              iconColor="bg-amber-500"
              value={fmtCurrency(kpis?.dispatchReady?.value ?? 0)}
              sub={`${kpis?.dispatchReady?.count ?? 0} work orders`}
              onClick={() => navigate('/processing/work-orders')}
            />

            {/* Machine Utilisation */}
            <FundamentalCard
              label="Avg Machine Utilisation"
              icon={Gauge}
              iconColor="bg-teal-500"
              value={`${kpis?.machineUtilisation?.avgPct ?? 0}%`}
              sub={`${kpis?.machineUtilisation?.centers?.length ?? 0} work centres`}
              gauge={{
                pct: kpis?.machineUtilisation?.avgPct ?? 0,
                color: (kpis?.machineUtilisation?.avgPct ?? 0) >= 75 ? '#22c55e'
                     : (kpis?.machineUtilisation?.avgPct ?? 0) >= 50 ? '#f59e0b' : '#ef4444',
              }}
              onClick={() => navigate('/processing/work-orders')}
            />

            {/* Quote Conversion Rate */}
            <FundamentalCard
              label="Quote Conversion"
              icon={Percent}
              iconColor="bg-violet-500"
              value={kpis?.quoteConversion?.pct != null ? `${kpis.quoteConversion.pct}%` : '--'}
              sub={`${kpis?.quoteConversion?.won ?? 0} of ${kpis?.quoteConversion?.total ?? 0} quotes`}
              gauge={kpis?.quoteConversion?.pct != null ? {
                pct: kpis.quoteConversion.pct,
                color: kpis.quoteConversion.pct >= 50 ? '#22c55e' : kpis.quoteConversion.pct >= 30 ? '#f59e0b' : '#ef4444',
              } : undefined}
              onClick={() => navigate('/sales/quotes')}
            />

            {/* On-Time Delivery */}
            <FundamentalCard
              label="On-Time Delivery"
              icon={Clock}
              iconColor="bg-cyan-500"
              value={kpis?.onTimeDeliveryPct != null ? `${kpis.onTimeDeliveryPct}%` : '--'}
              sub="shipped on or before due"
            />

            {/* Inventory Turnover */}
            <FundamentalCard
              label="Inventory Turnover"
              icon={RotateCcw}
              iconColor="bg-orange-500"
              value={kpis?.inventoryTurnover != null ? `${kpis.inventoryTurnover}x` : '--'}
              sub="COGS / avg inventory (YTD)"
              onClick={() => navigate('/inventory')}
            />

            {/* Open Backlog */}
            <FundamentalCard
              label="Order Backlog"
              icon={ClipboardList}
              iconColor="bg-indigo-500"
              value={fmtCurrency(kpis?.backlog?.value ?? 0)}
              sub={`${kpis?.backlog?.count ?? 0} open orders`}
              onClick={() => navigate('/sales/orders')}
            />
          </div>
        )}

        {/* Machine utilisation breakdown */}
        {!kpisLoading && kpis?.machineUtilisation?.centers?.length > 0 && (
          <div className="card mt-4">
            <div className="card-header">
              <h3 className="font-semibold text-foreground text-sm">Work Centre Utilisation</h3>
              <span className="text-xs text-muted-foreground">This month</span>
            </div>
            <div className="card-body">
              <div className="space-y-3">
                {kpis.machineUtilisation.centers
                  .sort((a: any, b: any) => b.utilisationPct - a.utilisationPct)
                  .map((center: any) => (
                  <div key={center.id} className="flex items-center gap-3">
                    <div className="w-28 text-xs font-medium text-foreground truncate" title={center.name}>
                      {center.code}
                    </div>
                    <div className="flex-1 bg-steel-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${
                          center.utilisationPct >= 75 ? 'bg-green-500'
                          : center.utilisationPct >= 50 ? 'bg-amber-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${center.utilisationPct}%` }}
                      />
                    </div>
                    <div className="w-12 text-right text-xs font-semibold text-foreground tabular-nums">
                      {center.utilisationPct}%
                    </div>
                    <div className="w-16 text-right text-[11px] text-muted-foreground">
                      {center.jobCount} jobs
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Charts row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Revenue trend — 2/3 width */}
        <div className="card col-span-2">
          <div className="card-header">
            <div>
              <h3 className="font-semibold text-foreground text-sm">Revenue Trend</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Last 6 months · AUD</p>
            </div>
            <span className="badge-green text-[11px]">+23% vs last period</span>
          </div>
          <div className="card-body pt-2">
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={salesTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone" dataKey="revenue" name="Revenue"
                  stroke="#2563eb" strokeWidth={2.5}
                  fill="url(#grad1)" dot={false} activeDot={{ r: 4, fill: '#2563eb' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AR Ageing — 1/3 width */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="font-semibold text-foreground text-sm">AR Ageing</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Outstanding receivables</p>
            </div>
          </div>
          <div className="card-body pt-2">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={arAgeing} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" name="Balance" radius={[4, 4, 0, 0]}>
                  {arAgeing.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Bottom row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent Activity — 2/3 */}
        <div className="card col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-foreground text-sm">Recent Activity</h3>
            <button className="text-xs text-primary-600 hover:text-primary-700 font-medium">
              View all
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Party</th>
                  <th>Status</th>
                  <th className="text-right">Value</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map((row) => (
                  <tr key={row.id} className="cursor-pointer" onClick={() => navigate('/sales/orders')}>
                    <td className="font-mono text-xs font-semibold text-primary-700">{row.id}</td>
                    <td className="text-steel-500 text-xs">{row.type}</td>
                    <td className="font-medium text-foreground text-sm">{row.customer}</td>
                    <td>{statusBadge(row.status)}</td>
                    <td className="text-right font-medium tabular-nums">
                      {row.value > 0 ? fmtCurrency(row.value) : '—'}
                    </td>
                    <td className="text-steel-400 text-xs">{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Products — 1/3 */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-foreground text-sm">Top Products</h3>
            <span className="text-xs text-muted-foreground">This month</span>
          </div>
          <div className="card-body space-y-3">
            {topProducts.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-steel-100 flex items-center justify-center text-[10px] font-bold text-steel-500 flex-shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{p.sales} sales</div>
                </div>
                <div className="text-xs font-semibold text-foreground tabular-nums">
                  {fmtCurrency(p.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Quick actions ────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-foreground text-sm">Quick Actions</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'New Sales Order',  icon: ShoppingCart, path: '/sales/orders',          color: 'bg-blue-50   text-blue-700   border-blue-200   hover:bg-blue-100' },
              { label: 'New Quote',        icon: FileText,     path: '/sales/quotes',           color: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100' },
              { label: 'Receive Stock',    icon: Package,      path: '/inventory/receive',      color: 'bg-green-50  text-green-700  border-green-200  hover:bg-green-100' },
              { label: 'New Work Order',   icon: Wrench,       path: '/processing/work-orders', color: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' },
            ].map((a) => (
              <button
                key={a.path}
                onClick={() => navigate(a.path)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-sm font-medium ${a.color}`}
              >
                <a.icon size={20} />
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
