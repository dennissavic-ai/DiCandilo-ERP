import { useQuery } from '@tanstack/react-query';
import { reportingApi } from '../services/api';
import { BarChart3, TrendingUp, Package, DollarSign, Download } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts';

const monthlySales = [
  { month: 'Jul', revenue: 9800000,  cost: 6300000 },
  { month: 'Aug', revenue: 12500000, cost: 8100000 },
  { month: 'Sep', revenue: 14800000, cost: 9500000 },
  { month: 'Oct', revenue: 13200000, cost: 8400000 },
  { month: 'Nov', revenue: 16800000, cost: 10900000 },
  { month: 'Dec', revenue: 14500000, cost: 9300000 },
  { month: 'Jan', revenue: 18900000, cost: 12100000 },
];

const topCustomers = [
  { name: 'ACME Manufacturing',       revenue: 14200000 },
  { name: 'BuildRight Construction',  revenue: 9800000 },
  { name: 'Precision Fabricators',    revenue: 6200000 },
];

function fmtCurrency(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg px-3 py-2.5 text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="text-xs">
          {p.name}: <strong>{fmtCurrency(p.value)}</strong>
        </p>
      ))}
    </div>
  );
}

const REPORT_CARDS = [
  { label: 'Sales Report',      icon: TrendingUp, color: 'bg-primary-500', desc: 'Revenue, margins, by customer' },
  { label: 'Inventory Report',  icon: Package,    color: 'bg-orange-500',  desc: 'Stock levels, valuation, ageing' },
  { label: 'AR/AP Report',      icon: DollarSign, color: 'bg-green-500',   desc: 'Receivables & payables summary' },
  { label: 'Production Report', icon: BarChart3,   color: 'bg-teal-500',   desc: 'Work order efficiency & yield' },
];

export function ReportingPage() {
  const { data: dashboard } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => reportingApi.getDashboard().then((r) => r.data),
  });

  const totalRevenue = monthlySales.reduce((s, m) => s + m.revenue, 0);
  const totalGP      = monthlySales.reduce((s, m) => s + (m.revenue - m.cost), 0);
  const gpPct        = ((totalGP / totalRevenue) * 100).toFixed(1);

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reporting</h1>
          <p className="page-subtitle">Business intelligence & performance analytics</p>
        </div>
        <button className="btn-secondary btn-sm">
          <Download size={13} /> Export
        </button>
      </div>

      {/* Report types */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {REPORT_CARDS.map((r) => (
          <button key={r.label} className="stat-card stat-card-clickable text-left">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-3 ${r.color}`}>
              <r.icon size={15} className="text-white" />
            </div>
            <div className="text-sm font-semibold text-foreground">{r.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{r.desc}</div>
          </button>
        ))}
      </div>

      {/* Revenue vs GP chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="card col-span-2">
          <div className="card-header">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Revenue vs Gross Profit</h3>
              <p className="text-xs text-muted-foreground mt-0.5">YTD — AUD</p>
            </div>
            <span className="badge-green">{gpPct}% GP margin</span>
          </div>
          <div className="card-body pt-2">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthlySales} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Bar dataKey="cost"    name="COGS"    fill="#93c5fd" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* KPI summary */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-sm font-semibold text-foreground">YTD Summary</h3>
          </div>
          <div className="card-body space-y-4">
            {[
              { label: 'Total Revenue',    value: fmtCurrency(totalRevenue) },
              { label: 'Gross Profit',     value: fmtCurrency(totalGP) },
              { label: 'GP Margin',        value: `${gpPct}%` },
              { label: 'Inventory Value',  value: fmtCurrency(dashboard?.inventory?.value ?? 42000000) },
              { label: 'AR Outstanding',   value: fmtCurrency(dashboard?.ar?.overdueBalance ?? 3200000) },
            ].map((kpi) => (
              <div key={kpi.label} className="flex justify-between items-baseline">
                <span className="text-xs text-muted-foreground">{kpi.label}</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">{kpi.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top customers */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-sm font-semibold text-foreground">Top Customers by Revenue</h3>
          <span className="text-xs text-muted-foreground">YTD</span>
        </div>
        <div className="card-body space-y-4">
          {topCustomers.map((c, i) => {
            const pct = (c.revenue / topCustomers[0].revenue) * 100;
            return (
              <div key={c.name} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[10px] font-bold">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-foreground">{c.name}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{fmtCurrency(c.revenue)}</span>
                </div>
                <div className="w-full bg-steel-100 rounded-full h-2">
                  <div className="h-2 rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
