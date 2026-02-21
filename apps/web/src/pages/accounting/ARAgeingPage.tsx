import { useQuery } from '@tanstack/react-query';
import { accountingApi } from '../../services/api';
import { DollarSign, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const AGEING_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'];

function fmtCurrency(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(2)}`;
}

export function ARAgeingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['ar-ageing'],
    queryFn: () => accountingApi.getARAgeing().then((r) => r.data),
  });

  const buckets = data?.buckets ?? [
    { label: 'Current', amount: 8900000, count: 12 },
    { label: '1–30d',   amount: 3400000, count: 5  },
    { label: '31–60d',  amount: 1800000, count: 3  },
    { label: '61–90d',  amount:  700000, count: 1  },
    { label: '90d+',    amount:  300000, count: 1  },
  ];

  const totalOutstanding = buckets.reduce((s: number, b: any) => s + b.amount, 0);
  const totalOverdue     = buckets.slice(1).reduce((s: number, b: any) => s + b.amount, 0);

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">AR Ageing</h1>
          <p className="page-subtitle">Accounts receivable outstanding by age bucket</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="stat-card">
          <div className="w-8 h-8 bg-primary-500 rounded-xl flex items-center justify-center mb-3">
            <DollarSign size={15} className="text-white" />
          </div>
          <div className="text-xl font-bold tabular-nums">{fmtCurrency(totalOutstanding)}</div>
          <div className="text-xs text-muted-foreground">Total Outstanding</div>
        </div>
        <div className="stat-card">
          <div className="w-8 h-8 bg-red-500 rounded-xl flex items-center justify-center mb-3">
            <AlertTriangle size={15} className="text-white" />
          </div>
          <div className="text-xl font-bold tabular-nums text-red-600">{fmtCurrency(totalOverdue)}</div>
          <div className="text-xs text-muted-foreground">Overdue</div>
        </div>
        <div className="stat-card">
          <div className="text-xl font-bold tabular-nums">{buckets.reduce((s: number, b: any) => s + b.count, 0)}</div>
          <div className="text-xs text-muted-foreground">Total Invoices</div>
        </div>
        <div className="stat-card">
          <div className="text-xl font-bold tabular-nums text-amber-600">
            {((totalOverdue / totalOutstanding) * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground">Overdue Rate</div>
        </div>
      </div>

      {/* Chart */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="text-sm font-semibold text-foreground">Ageing Distribution</h3>
        </div>
        <div className="card-body pt-2">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={buckets} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => [fmtCurrency(v), 'Balance']} />
              <Bar dataKey="amount" radius={[5, 5, 0, 0]}>
                {buckets.map((_: any, i: number) => <Cell key={i} fill={AGEING_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bucket summary table */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-sm font-semibold text-foreground">Bucket Summary</h3>
        </div>
        <div className="table-container rounded-b-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Age Bucket</th>
                <th className="text-right">Invoices</th>
                <th className="text-right">Amount</th>
                <th className="text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 4 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                : buckets.map((b: any, i: number) => (
                    <tr key={b.label}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: AGEING_COLORS[i] }} />
                          <span className="font-medium text-foreground">{b.label}</span>
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{b.count}</td>
                      <td className="text-right font-mono tabular-nums font-semibold">{fmtCurrency(b.amount)}</td>
                      <td className="text-right tabular-nums text-muted-foreground">
                        {((b.amount / totalOutstanding) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
              <tr className="font-semibold bg-steel-50">
                <td>Total</td>
                <td className="text-right tabular-nums">{buckets.reduce((s: number, b: any) => s + b.count, 0)}</td>
                <td className="text-right font-mono tabular-nums">{fmtCurrency(totalOutstanding)}</td>
                <td className="text-right">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
