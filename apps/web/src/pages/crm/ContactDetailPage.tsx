import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, salesApi } from '../../services/api';
import {
  ArrowLeft, Mail, Phone, Building2, TrendingUp, Calendar,
  Clock, FileText, DollarSign, User, Briefcase,
  MessageSquare, UserCheck, ChevronRight, AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  LEAD: 'bg-steel-100 text-steel-700',
  CONTACTED: 'bg-blue-100 text-blue-700',
  QUALIFIED: 'bg-teal-100 text-teal-700',
  PROPOSAL: 'bg-amber-100 text-amber-700',
  NEGOTIATION: 'bg-orange-100 text-orange-700',
  WON: 'bg-green-100 text-green-700',
  LOST: 'bg-red-100 text-red-600',
};

const ACTIVITY_COLORS: Record<string, string> = {
  CALL:    'bg-blue-500',
  VISIT:   'bg-teal-500',
  EMAIL:   'bg-steel-400',
  MEETING: 'bg-violet-500',
  DEMO:    'bg-amber-500',
};

const OUTCOME_BADGE: Record<string, string> = {
  FOLLOW_UP:       'badge-yellow',
  QUOTE_REQUESTED: 'badge-blue',
  ORDER_PLACED:    'badge-green',
  NOT_INTERESTED:  'badge-red',
  CALLBACK:        'badge-orange',
  NO_ANSWER:       'badge-gray',
};

const SO_STATUS_BADGE: Record<string, string> = {
  DRAFT:        'badge-gray',
  CONFIRMED:    'badge-blue',
  IN_PRODUCTION:'badge-amber',
  SHIPPED:      'badge-teal',
  INVOICED:     'badge-green',
  CLOSED:       'badge-green',
  CANCELLED:    'badge-red',
};

// ── Prospect Contact Detail ───────────────────────────────────────────────────

function ProspectDetail({ id }: { id: string }) {
  const { data: prospectsRes } = useQuery({
    queryKey: ['prospect-detail', id],
    queryFn: () => api.get('/crm/prospects', { params: { limit: 500 } }).then((r) => r.data),
  });

  const { data: activityRes, isLoading: activityLoading } = useQuery({
    queryKey: ['prospect-activity', id],
    queryFn: () =>
      api.get('/crm/call-reports', { params: { prospectId: id, limit: 100 } }).then((r) => r.data),
  });

  const prospect = ((prospectsRes as any)?.data ?? []).find((p: any) => p.id === id);
  const activities: any[] = (activityRes as any)?.data ?? [];

  if (!prospect && !(prospectsRes as any)?.data) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!prospect) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><AlertCircle size={22} /></div>
        <p className="text-sm font-medium">Prospect not found</p>
      </div>
    );
  }

  const stageClass = STAGE_COLORS[prospect.stage] ?? 'bg-steel-100 text-steel-700';
  const overdue = prospect.nextFollowUp && new Date(prospect.nextFollowUp) < new Date();

  return (
    <div className="space-y-6">
      {/* Contact header card */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="w-14 h-14 rounded-2xl bg-primary-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xl font-bold text-primary-700">
                {(prospect.contactName || prospect.companyName)?.charAt(0)?.toUpperCase()}
              </span>
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h2 className="text-xl font-bold text-steel-900">
                  {prospect.contactName || prospect.companyName}
                </h2>
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${stageClass}`}>
                  {prospect.stage}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-sm text-steel-500 mb-3">
                <Building2 size={13} />
                {prospect.companyName}
                {prospect.industry && (
                  <span className="text-steel-300">· {prospect.industry}</span>
                )}
              </div>

              <div className="flex flex-wrap gap-4">
                {prospect.email && (
                  <a
                    href={`mailto:${prospect.email}`}
                    className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800"
                  >
                    <Mail size={13} />
                    {prospect.email}
                  </a>
                )}
                {prospect.phone && (
                  <a
                    href={`tel:${prospect.phone}`}
                    className="flex items-center gap-1.5 text-sm text-steel-600 hover:text-steel-900"
                  >
                    <Phone size={13} />
                    {prospect.phone}
                  </a>
                )}
              </div>
            </div>

            {/* KPIs */}
            <div className="flex gap-3 flex-shrink-0">
              {prospect.estimatedValue && (
                <div className="stat-card min-w-[100px] text-right">
                  <div className="flex items-center justify-end gap-1 text-base font-bold text-steel-900">
                    <DollarSign size={14} className="text-steel-400" />
                    {(prospect.estimatedValue / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-xs text-steel-400">Est. Value</div>
                </div>
              )}
              {prospect.probability != null && (
                <div className="stat-card min-w-[80px] text-right">
                  <div className="text-base font-bold text-primary-600">{prospect.probability}%</div>
                  <div className="text-xs text-steel-400">Probability</div>
                </div>
              )}
            </div>
          </div>

          {/* Follow-up + notes */}
          <div className="mt-4 pt-4 border-t border-steel-100 flex flex-wrap gap-6">
            {prospect.nextFollowUp && (
              <div className="flex items-center gap-2">
                <Calendar size={14} className={overdue ? 'text-red-500' : 'text-steel-400'} />
                <div>
                  <div className="text-xs text-steel-400">Next Follow-up</div>
                  <div className={`text-sm font-medium ${overdue ? 'text-red-600' : 'text-steel-700'}`}>
                    {format(new Date(prospect.nextFollowUp), 'dd MMM yyyy')}
                    {overdue && <span className="text-xs ml-1">(overdue)</span>}
                  </div>
                </div>
              </div>
            )}
            {prospect.notes && (
              <div className="flex-1 min-w-[200px]">
                <div className="text-xs text-steel-400 mb-0.5">Notes</div>
                <div className="text-sm text-steel-700 whitespace-pre-line">{prospect.notes}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Deal summary */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Briefcase size={15} className="text-steel-500" />
          <h3 className="font-semibold">Deal</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-steel-400 mb-1">Stage</div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${stageClass}`}>
                {prospect.stage}
              </span>
            </div>
            <div>
              <div className="text-xs text-steel-400 mb-1">Est. Value</div>
              <div className="text-sm font-semibold text-steel-900">
                {prospect.estimatedValue
                  ? `$${(prospect.estimatedValue / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-steel-400 mb-1">Probability</div>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 bg-steel-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 rounded-full"
                    style={{ width: `${prospect.probability ?? 0}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-primary-700">{prospect.probability ?? 0}%</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-steel-400 mb-1">Weighted Value</div>
              <div className="text-sm font-semibold text-steel-900">
                {prospect.estimatedValue
                  ? `$${((prospect.estimatedValue * (prospect.probability ?? 50) / 100) / 100)
                      .toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity timeline */}
      <ActivityTimeline activities={activities} isLoading={activityLoading} />
    </div>
  );
}

// ── Customer Contact Detail ───────────────────────────────────────────────────

function CustomerDetail({ id }: { id: string }) {
  const { data: customer, isLoading: customerLoading } = useQuery({
    queryKey: ['contact-customer', id],
    queryFn: () => salesApi.getCustomer(id).then((r) => r.data as any),
  });

  const { data: ordersRes, isLoading: ordersLoading } = useQuery({
    queryKey: ['contact-orders', id],
    queryFn: () =>
      api.get('/sales/orders', { params: { customerId: id, limit: 20 } }).then((r) => r.data),
    enabled: Boolean(id),
  });

  const { data: activityRes, isLoading: activityLoading } = useQuery({
    queryKey: ['customer-activity', id],
    queryFn: () =>
      api.get('/crm/call-reports', { params: { customerId: id, limit: 100 } }).then((r) => r.data),
  });

  const orders: any[] = (ordersRes as any)?.data ?? [];
  const activities: any[] = (activityRes as any)?.data ?? [];
  const contacts: any[] = customer?.contacts ?? [];
  const primary = contacts.find((c: any) => c.isPrimary) ?? contacts[0];

  if (customerLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><AlertCircle size={22} /></div>
        <p className="text-sm font-medium">Customer not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center flex-shrink-0">
              <UserCheck size={24} className="text-green-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h2 className="text-xl font-bold text-steel-900">{customer.name}</h2>
                <span className="badge-green">ERP Customer</span>
                <span className="text-xs font-mono text-steel-400">{customer.code}</span>
              </div>
              {primary && (
                <div className="text-sm text-steel-500 mb-3">
                  Primary contact: <span className="font-medium text-steel-700">{primary.name ?? primary.email}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-4">
                {primary?.email && (
                  <a href={`mailto:${primary.email}`} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800">
                    <Mail size={13} />
                    {primary.email}
                  </a>
                )}
                {primary?.phone && (
                  <a href={`tel:${primary.phone}`} className="flex items-center gap-1.5 text-sm text-steel-600 hover:text-steel-900">
                    <Phone size={13} />
                    {primary.phone}
                  </a>
                )}
              </div>
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <div className="stat-card min-w-[100px] text-right">
                <div className="text-base font-bold text-steel-900">{customer.creditTerms ?? 0}d</div>
                <div className="text-xs text-steel-400">Credit Terms</div>
              </div>
              <div className="stat-card min-w-[100px] text-right">
                <div className={`text-base font-bold ${customer.creditHold ? 'text-red-600' : 'text-green-600'}`}>
                  {customer.creditHold ? 'On Hold' : 'Active'}
                </div>
                <div className="text-xs text-steel-400">Credit Status</div>
              </div>
            </div>
          </div>

          {/* All contacts */}
          {contacts.length > 1 && (
            <div className="mt-4 pt-4 border-t border-steel-100">
              <div className="text-xs font-medium text-steel-500 mb-2">All Contacts</div>
              <div className="flex flex-wrap gap-2">
                {contacts.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-steel-50 rounded-lg">
                    <User size={11} className="text-steel-400" />
                    <span className="text-xs text-steel-700">{c.name ?? c.email}</span>
                    {c.isPrimary && <span className="text-[10px] text-primary-600 font-medium">Primary</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sales orders */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <FileText size={15} className="text-steel-500" />
          <h3 className="font-semibold">Sales Orders</h3>
          {!ordersLoading && (
            <span className="ml-auto text-xs text-steel-400">{orders.length} orders</span>
          )}
        </div>
        <div className="card-body p-0">
          {ordersLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-10 w-full rounded-lg" />)}
            </div>
          ) : orders.length === 0 ? (
            <div className="empty-state py-8">
              <div className="empty-state-icon"><FileText size={18} /></div>
              <p className="text-sm text-steel-400">No sales orders yet</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="text-right">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any) => (
                  <tr key={o.id} className="hover:bg-steel-50">
                    <td className="font-mono text-sm font-medium text-primary-700">{o.orderNumber}</td>
                    <td className="text-xs text-steel-500">
                      {o.orderDate ? format(new Date(o.orderDate), 'dd MMM yyyy') : '—'}
                    </td>
                    <td>
                      <span className={SO_STATUS_BADGE[o.status] ?? 'badge-gray'}>
                        {o.status?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="text-right font-mono text-sm font-semibold">
                      ${((o.totalAmount ?? 0) / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="text-right">
                      <Link
                        to={`/sales/orders/${o.id}`}
                        className="flex items-center justify-end gap-1 text-xs text-primary-600 hover:text-primary-800"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View <ChevronRight size={11} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Activity timeline */}
      <ActivityTimeline activities={activities} isLoading={activityLoading} />
    </div>
  );
}

// ── Shared Activity Timeline ──────────────────────────────────────────────────

function ActivityTimeline({
  activities,
  isLoading,
}: {
  activities: any[];
  isLoading: boolean;
}) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <MessageSquare size={15} className="text-steel-500" />
        <h3 className="font-semibold">Activity History</h3>
        {!isLoading && (
          <span className="ml-auto text-xs text-steel-400">{activities.length} activities</span>
        )}
      </div>
      <div className="card-body">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-16 w-full rounded-lg" />)}
          </div>
        ) : activities.length === 0 ? (
          <div className="empty-state py-6">
            <div className="empty-state-icon"><MessageSquare size={18} /></div>
            <p className="text-sm text-steel-400">No activity logged yet</p>
            <p className="text-xs text-steel-300 mt-1">Log calls, meetings, and emails in Call Reports.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-3.5 top-0 bottom-0 w-px bg-steel-100" />

            <div className="space-y-4">
              {activities.map((act: any) => {
                const dotColor = ACTIVITY_COLORS[act.type] ?? 'bg-steel-400';
                const followUpOverdue = act.followUpDate && new Date(act.followUpDate) < new Date() && act.outcome === 'FOLLOW_UP';

                return (
                  <div key={act.id} className="flex gap-4 pl-1">
                    {/* Timeline dot */}
                    <div className={`w-6 h-6 rounded-full ${dotColor} flex items-center justify-center flex-shrink-0 z-10 mt-0.5`}>
                      <MessageSquare size={10} className="text-white" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 bg-steel-50 rounded-xl px-4 py-3 border border-steel-100">
                      <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-steel-900">{act.subject}</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${dotColor} text-white`}>
                            {act.type}
                          </span>
                        </div>
                        <div className="text-xs text-steel-400 flex items-center gap-1 flex-shrink-0">
                          <Calendar size={10} />
                          {act.callDate ? format(new Date(act.callDate), 'dd MMM yyyy') : '—'}
                          {act.durationMinutes && (
                            <span className="flex items-center gap-0.5 ml-2">
                              <Clock size={9} />
                              {act.durationMinutes}m
                            </span>
                          )}
                        </div>
                      </div>

                      {act.notes && (
                        <p className="text-xs text-steel-600 mb-2 leading-relaxed">{act.notes}</p>
                      )}

                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className={OUTCOME_BADGE[act.outcome] ?? 'badge-gray'}>
                          {act.outcome?.replace(/_/g, ' ')}
                        </span>

                        <div className="flex items-center gap-3">
                          {act.followUpDate && (
                            <span className={`flex items-center gap-1 text-xs ${followUpOverdue ? 'text-red-500 font-medium' : 'text-steel-400'}`}>
                              <Calendar size={9} />
                              Follow-up: {format(new Date(act.followUpDate), 'dd MMM yyyy')}
                            </span>
                          )}
                          {act.user?.name && (
                            <span className="flex items-center gap-1 text-xs text-steel-400">
                              <User size={9} />
                              {act.user.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ContactDetailPage ─────────────────────────────────────────────────────────

export function ContactDetailPage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();

  const isProspect = type === 'prospect';
  const isCustomer = type === 'customer';

  if (!id || (!isProspect && !isCustomer)) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><AlertCircle size={22} /></div>
        <p className="text-sm font-medium">Invalid contact type</p>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto animate-fade-in">
      {/* Back navigation */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/crm/contacts')}
          className="flex items-center gap-1.5 text-sm text-steel-500 hover:text-steel-900 transition-colors"
        >
          <ArrowLeft size={14} />
          Contacts
        </button>
        <span className="text-steel-300">/</span>
        <span className="text-sm text-steel-700 font-medium">
          {isProspect ? 'Prospect' : 'Customer'} Detail
        </span>
      </div>

      {isProspect && <ProspectDetail id={id} />}
      {isCustomer && <CustomerDetail id={id} />}
    </div>
  );
}
