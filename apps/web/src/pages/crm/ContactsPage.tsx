import { useQuery } from '@tanstack/react-query';
import { api, salesApi } from '../../services/api';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Users, Mail, Phone, ChevronRight,
  TrendingUp, UserCheck,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STAGE_BADGE: Record<string, string> = {
  LEAD:        'badge-gray',
  CONTACTED:   'badge-blue',
  QUALIFIED:   'badge-teal',
  PROPOSAL:    'badge-amber',
  NEGOTIATION: 'badge-orange',
  WON:         'badge-green',
  LOST:        'badge-red',
};

interface ContactRow {
  id: string;
  type: 'prospect' | 'customer';
  name: string;           // contact person name
  company: string;
  email?: string;
  phone?: string;
  badge?: string;         // stage for prospects, 'CUSTOMER' for customers
  industry?: string;
  sub?: string;           // e.g. "Customer · NET30" or stage display
}

function buildContacts(prospects: any[], customers: any[]): ContactRow[] {
  const rows: ContactRow[] = [];

  for (const p of prospects) {
    rows.push({
      id:       p.id,
      type:     'prospect',
      name:     p.contactName || p.companyName,
      company:  p.companyName,
      email:    p.email,
      phone:    p.phone,
      badge:    p.stage,
      industry: p.industry,
      sub:      p.stage,
    });
  }

  for (const c of customers) {
    // Primary contact from contacts JSON array
    const contacts: any[] = c.contacts ?? [];
    const primary = contacts.find((ct: any) => ct.isPrimary) ?? contacts[0];

    rows.push({
      id:      c.id,
      type:    'customer',
      name:    primary?.name ?? primary?.email ?? c.name,
      company: c.name,
      email:   primary?.email,
      phone:   primary?.phone,
      badge:   'CUSTOMER',
      sub:     `Customer · Net ${c.creditTerms ?? 0}`,
    });
  }

  return rows;
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ row }: { row: ContactRow }) {
  if (row.type === 'customer') {
    return <span className="badge-green">Customer</span>;
  }
  return <span className={STAGE_BADGE[row.badge ?? 'LEAD'] ?? 'badge-gray'}>{row.badge}</span>;
}

// ── ContactsPage ──────────────────────────────────────────────────────────────

export function ContactsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'prospect' | 'customer'>('all');

  const { data: prospectsData, isLoading: prospectsLoading } = useQuery({
    queryKey: ['contacts-prospects'],
    queryFn: () => api.get('/crm/prospects', { params: { limit: 500 } }).then((r) => r.data),
  });

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['contacts-customers'],
    queryFn: () => salesApi.listCustomers({ limit: 500 }).then((r) => r.data),
  });

  const isLoading = prospectsLoading || customersLoading;

  const allContacts = buildContacts(
    (prospectsData as any)?.data ?? [],
    (customersData as any)?.data ?? [],
  );

  const filtered = allContacts.filter((c) => {
    if (sourceFilter !== 'all' && c.type !== sourceFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q)
    );
  });

  const prospects  = allContacts.filter((c) => c.type === 'prospect');
  const customers  = allContacts.filter((c) => c.type === 'customer');

  function handleClick(row: ContactRow) {
    navigate(`/crm/contacts/${row.type}/${row.id}`);
  }

  return (
    <div className="max-w-[1200px] mx-auto animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Users size={20} className="text-primary-600" />
            Contacts
          </h1>
          <p className="page-subtitle">
            {allContacts.length} contacts · {prospects.length} prospects · {customers.length} customers
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
              <input
                className="input pl-8 h-9 text-sm w-full"
                placeholder="Search by name, company, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1 border border-steel-200 rounded-lg p-1 bg-steel-50">
              {(['all', 'prospect', 'customer'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setSourceFilter(f)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize ${
                    sourceFilter === f
                      ? 'bg-white text-steel-900 shadow-sm'
                      : 'text-steel-500 hover:text-steel-700'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'prospect' ? 'Prospects' : 'Customers'}
                </button>
              ))}
            </div>
            <span className="text-xs text-steel-400 ml-auto">{filtered.length} shown</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Company</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Source / Stage</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                : filtered.map((row) => (
                    <tr
                      key={`${row.type}-${row.id}`}
                      className="cursor-pointer hover:bg-steel-50 transition-colors"
                      onClick={() => handleClick(row)}
                    >
                      {/* Contact */}
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                            row.type === 'customer'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-primary-100 text-primary-700'
                          }`}>
                            {row.type === 'customer'
                              ? <UserCheck size={13} />
                              : (row.name?.charAt(0)?.toUpperCase() ?? '?')
                            }
                          </div>
                          <div>
                            <div className="font-medium text-steel-900 text-sm">{row.name || '—'}</div>
                            {row.industry && (
                              <div className="text-xs text-steel-400">{row.industry}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Company */}
                      <td>
                        <div className="text-sm text-steel-700">{row.company}</div>
                      </td>

                      {/* Email */}
                      <td>
                        {row.email
                          ? (
                            <a
                              href={`mailto:${row.email}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                            >
                              <Mail size={11} />
                              {row.email}
                            </a>
                          )
                          : <span className="text-steel-300">—</span>
                        }
                      </td>

                      {/* Phone */}
                      <td>
                        {row.phone
                          ? (
                            <a
                              href={`tel:${row.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 text-xs text-steel-600 hover:text-steel-900"
                            >
                              <Phone size={11} />
                              {row.phone}
                            </a>
                          )
                          : <span className="text-steel-300">—</span>
                        }
                      </td>

                      {/* Stage / Source */}
                      <td><SourceBadge row={row} /></td>

                      {/* Arrow */}
                      <td className="text-right">
                        <ChevronRight size={14} className="text-steel-300 ml-auto" />
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>

        {!isLoading && filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Users size={22} /></div>
            <p className="text-sm font-medium">
              {search ? `No contacts match "${search}"` : 'No contacts yet'}
            </p>
            {!search && (
              <p className="text-xs text-steel-400 mt-1">
                Contacts are built from your Prospects pipeline and ERP Customers.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
