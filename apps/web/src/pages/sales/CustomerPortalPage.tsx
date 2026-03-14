import { useQuery } from '@tanstack/react-query';
import { salesApi, type SalesOrder, type Invoice } from '../../services/api';
import { Package, FileText, DollarSign, Clock, CheckCircle, ExternalLink, Download } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';

const ORDER_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', CONFIRMED: 'badge-blue', IN_PRODUCTION: 'badge-amber',
  READY_TO_SHIP: 'badge-teal', SHIPPED: 'badge-green', INVOICED: 'badge-violet',
};
const INV_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', SENT: 'badge-blue', PARTIALLY_PAID: 'badge-yellow',
  PAID: 'badge-green', OVERDUE: 'badge-red',
};

function fmtMoney(cents: number) { return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}` }

export function CustomerPortalPage() {
  const [activeTab, setActiveTab] = useState<'orders' | 'invoices' | 'quotes'>('orders');

  // In a real portal, customerId would come from JWT / session
  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['portal-orders'],
    queryFn: () => salesApi.listOrders({ limit: 50 }).then((r) => r.data),
  });

  const { data: quotesData, isLoading: quotesLoading } = useQuery({
    queryKey: ['portal-quotes'],
    queryFn: () => salesApi.listQuotes({ limit: 50 }).then((r) => r.data),
  });

  const orders: SalesOrder[] = ordersData?.data ?? [];
  const quotes: any[]        = quotesData?.data ?? [];

  const openOrders = orders.filter((o) => !['CLOSED','CANCELLED'].includes(o.status));
  const unpaidBalance = orders.reduce((s, o) => s + (o.totalAmount ?? 0) - (o.amountPaid ?? 0), 0);

  const tabs = [
    { id: 'orders' as const,   label: 'Orders',   icon: Package, count: openOrders.length },
    { id: 'quotes' as const,   label: 'Quotes',   icon: FileText, count: quotes.filter((q) => ['DRAFT','SENT'].includes(q.status)).length },
    { id: 'invoices' as const, label: 'Invoices', icon: DollarSign, count: 0 },
  ];

  return (
    <div className="max-w-[1100px] mx-auto animate-fade-in">
      {/* Portal header */}
      <div className="bg-primary-600 text-white rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Customer Portal</h1>
            <p className="text-primary-200 text-sm mt-1">View your orders, invoices, and quotes in real time</p>
          </div>
          <div className="text-right">
            <div className="text-primary-200 text-xs mb-1">Outstanding Balance</div>
            <div className="text-2xl font-bold tabular-nums">{fmtMoney(unpaidBalance)}</div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          {[
            { label: 'Open Orders', value: openOrders.length, icon: Package },
            { label: 'Open Quotes', value: quotes.filter((q) => ['DRAFT','SENT'].includes(q.status)).length, icon: FileText },
            { label: 'In Production', value: orders.filter((o) => o.status === 'IN_PRODUCTION').length, icon: Clock },
          ].map((stat) => (
            <div key={stat.label} className="bg-white/10 rounded-lg p-4 flex items-center gap-3">
              <div className="w-8 h-8 bg-white/15 rounded-lg flex items-center justify-center">
                <stat.icon size={16} className="text-white" />
              </div>
              <div>
                <div className="text-xl font-bold">{stat.value}</div>
                <div className="text-primary-200 text-xs">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex border-b border-border mb-6 gap-1">
        {tabs.map((tab) => (
          <button key={tab.id}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${activeTab === tab.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab(tab.id)}>
            <tab.icon size={14} />
            {tab.label}
            {tab.count > 0 && (
              <span className="badge-blue">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Orders tab */}
      {activeTab === 'orders' && (
        <div className="card">
          <div className="table-container rounded-xl">
            <table className="table">
              <thead><tr>
                <th>Order #</th><th>Status</th>
                <th className="text-right">Total</th><th>Order Date</th><th>Required</th><th>Tracking</th>
              </tr></thead>
              <tbody>
                {ordersLoading
                  ? Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: 6 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>)
                  : orders.map((o) => (
                      <tr key={o.id}>
                        <td className="font-mono text-xs font-bold text-primary-700">{o.orderNumber}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            {o.status === 'SHIPPED' && <CheckCircle size={12} className="text-green-500" />}
                            <span className={ORDER_BADGE[o.status] ?? 'badge-gray'}>{o.status?.replace(/_/g,' ')}</span>
                          </div>
                        </td>
                        <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtMoney(o.totalAmount ?? 0)}</td>
                        <td className="text-xs text-steel-500">{o.orderDate ? format(new Date(o.orderDate), 'dd MMM yyyy') : '—'}</td>
                        <td className="text-xs text-steel-500">{(o as any).requiredDate ? format(new Date((o as any).requiredDate), 'dd MMM yyyy') : '—'}</td>
                        <td>
                          {(o as any).trackingNumber ? (
                            <a href={(o as any).trackingUrl ?? '#'} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              {(o as any).trackingNumber} <ExternalLink size={10} />
                            </a>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {!ordersLoading && orders.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon"><Package size={22} /></div>
              <p className="text-sm font-medium">No orders yet</p>
            </div>
          )}
        </div>
      )}

      {/* Quotes tab */}
      {activeTab === 'quotes' && (
        <div className="card">
          <div className="table-container rounded-xl">
            <table className="table">
              <thead><tr>
                <th>Quote #</th><th>Status</th>
                <th className="text-right">Value</th><th>Quote Date</th><th>Valid Until</th><th></th>
              </tr></thead>
              <tbody>
                {quotesLoading
                  ? Array.from({ length: 4 }).map((_, i) => <tr key={i}>{Array.from({ length: 6 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>)
                  : quotes.map((q: any) => (
                      <tr key={q.id}>
                        <td className="font-mono text-xs font-bold text-primary-700">{q.quoteNumber}</td>
                        <td><span className={q.status === 'SENT' ? 'badge-blue' : q.status === 'ACCEPTED' ? 'badge-green' : q.status === 'EXPIRED' ? 'badge-red' : 'badge-gray'}>{q.status}</span></td>
                        <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtMoney(q.totalAmount ?? 0)}</td>
                        <td className="text-xs text-steel-500">{q.quoteDate ? format(new Date(q.quoteDate), 'dd MMM yyyy') : '—'}</td>
                        <td className="text-xs">
                          {q.validUntil ? (
                            <span className={new Date(q.validUntil) < new Date() ? 'text-red-500' : 'text-steel-500'}>
                              {format(new Date(q.validUntil), 'dd MMM yyyy')}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          <button className="btn-ghost btn-sm"><Download size={12} /> PDF</button>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {!quotesLoading && quotes.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon"><FileText size={22} /></div>
              <p className="text-sm font-medium">No quotes</p>
            </div>
          )}
        </div>
      )}

      {/* Invoices tab */}
      {activeTab === 'invoices' && (
        <div className="card">
          <div className="empty-state py-16">
            <div className="empty-state-icon"><DollarSign size={22} /></div>
            <p className="text-sm font-medium">Invoice history</p>
            <p className="text-xs text-muted-foreground mt-1">Your invoices will appear here</p>
          </div>
        </div>
      )}
    </div>
  );
}
