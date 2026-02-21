import { useQuery } from '@tanstack/react-query';
import { reportingApi } from '../services/api';
import { TrendingUp, Package, AlertTriangle, ShoppingCart, DollarSign, Wrench, Clock, FileText } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

function centsToK(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  onClick?: () => void;
}

function KPICard({ label, value, sub, icon: Icon, color, onClick }: KPICardProps) {
  return (
    <div
      onClick={onClick}
      className={`stat-card hover:shadow-md transition-shadow ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-steel-500 uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center`}>
          <Icon size={15} className="text-white" />
        </div>
      </div>
      <div className="text-2xl font-bold text-steel-900">{value}</div>
      {sub && <div className="text-xs text-steel-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// Mock chart data — in production this would come from the reporting API
const salesChartData = [
  { month: 'Aug', sales: 125000 }, { month: 'Sep', sales: 148000 },
  { month: 'Oct', sales: 132000 }, { month: 'Nov', sales: 168000 },
  { month: 'Dec', sales: 145000 }, { month: 'Jan', sales: 189000 },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => reportingApi.getDashboard().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-xl font-bold text-steel-900">
          {greeting}, {user?.firstName}
        </h1>
        <p className="text-sm text-steel-500">Here's what's happening at your service center today.</p>
      </div>

      {/* KPI Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="stat-card animate-pulse">
              <div className="h-4 bg-steel-200 rounded w-24 mb-3"></div>
              <div className="h-7 bg-steel-200 rounded w-16"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <KPICard
            label="Sales Today" icon={TrendingUp} color="bg-primary-500"
            value={centsToK(dashboard?.sales?.today?.amount ?? 0)}
            sub={`${dashboard?.sales?.today?.count ?? 0} orders`}
            onClick={() => navigate('/sales/orders')}
          />
          <KPICard
            label="Sales This Month" icon={DollarSign} color="bg-green-500"
            value={centsToK(dashboard?.sales?.month?.amount ?? 0)}
            sub={`${dashboard?.sales?.month?.count ?? 0} orders`}
          />
          <KPICard
            label="Open Orders" icon={ShoppingCart} color="bg-blue-500"
            value={String(dashboard?.orders?.open ?? 0)}
            sub="awaiting fulfilment"
            onClick={() => navigate('/sales/orders')}
          />
          <KPICard
            label="Open Quotes" icon={FileText} color="bg-violet-500"
            value={String(dashboard?.orders?.openQuotes ?? 0)}
            sub="pending response"
            onClick={() => navigate('/sales/quotes')}
          />
          <KPICard
            label="Inventory Value" icon={Package} color="bg-orange-500"
            value={centsToK(dashboard?.inventory?.value ?? 0)}
            sub={`${dashboard?.inventory?.lowStockCount ?? 0} low stock alerts`}
            onClick={() => navigate('/inventory')}
          />
          <KPICard
            label="AR Overdue" icon={AlertTriangle} color="bg-red-500"
            value={centsToK(dashboard?.ar?.overdueBalance ?? 0)}
            sub={`${dashboard?.ar?.overdueCount ?? 0} invoices`}
            onClick={() => navigate('/accounting/ar-ageing')}
          />
          <KPICard
            label="Open Work Orders" icon={Wrench} color="bg-teal-500"
            value={String(dashboard?.production?.openWorkOrders ?? 0)}
            sub="in production"
            onClick={() => navigate('/processing/work-orders')}
          />
          <KPICard
            label="Open POs" icon={Clock} color="bg-indigo-500"
            value={String(dashboard?.purchasing?.openPOs ?? 0)}
            sub="with suppliers"
            onClick={() => navigate('/purchasing/orders')}
          />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales trend */}
        <div className="card col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-steel-900">Sales Trend</h3>
            <p className="text-xs text-steel-500 mt-0.5">Last 6 months — revenue in USD</p>
          </div>
          <div className="card-body pt-2">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={salesChartData}>
                <defs>
                  <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                <Tooltip formatter={(v: number) => [`$${(v / 100).toLocaleString()}`, 'Sales']} />
                <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} fill="url(#salesGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AR Ageing summary */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-steel-900">AR Ageing</h3>
            <p className="text-xs text-steel-500 mt-0.5">Outstanding receivables</p>
          </div>
          <div className="card-body pt-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={[
                { label: 'Current', value: 89000 },
                { label: '1–30d', value: 34000 },
                { label: '31–60d', value: 18000 },
                { label: '61–90d', value: 7000 },
                { label: '90d+', value: 3000 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                <Tooltip formatter={(v: number) => [`$${(v / 100).toLocaleString()}`, 'AR Balance']} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-steel-900">Quick Actions</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'New Sales Order', icon: ShoppingCart, path: '/sales/orders', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
              { label: 'New Quote', icon: FileText, path: '/sales/quotes', color: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100' },
              { label: 'Receive Stock', icon: Package, path: '/inventory/receive', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' },
              { label: 'New Work Order', icon: Wrench, path: '/processing/work-orders', color: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' },
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
