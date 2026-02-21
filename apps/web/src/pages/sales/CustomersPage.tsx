import { useQuery } from '@tanstack/react-query';
import { salesApi } from '../../services/api';
import { Plus, Search, Users, Upload } from 'lucide-react';
import { useState } from 'react';
import { ImportModal } from '../../components/ui/ImportModal';

function fmtCurrency(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}

const CUSTOMER_COLUMNS = [
  { key: 'code',         label: 'Code',          required: true,  example: 'ACME001' },
  { key: 'name',         label: 'Name',          required: true,  example: 'ACME Corp' },
  { key: 'legalName',    label: 'Legal Name',    required: false, example: 'ACME Corporation Pty Ltd' },
  { key: 'taxId',        label: 'Tax ID / ABN',  required: false, example: '12345678901' },
  { key: 'currencyCode', label: 'Currency',      required: false, example: 'AUD' },
  { key: 'creditLimit',  label: 'Credit Limit $',required: false, example: '50000' },
  { key: 'creditTerms',  label: 'Terms (days)',  required: false, example: '30' },
  { key: 'notes',        label: 'Notes',         required: false, example: '' },
];

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => salesApi.listCustomers({ limit: 100 }).then((r) => r.data),
  });

  const customers = (data?.data ?? []).filter((c: any) =>
    !search ||
    c.code?.toLowerCase().includes(search.toLowerCase()) ||
    c.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">{data?.meta?.total ?? '—'} accounts</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => setImportOpen(true)}>
            <Upload size={13} /> Import CSV
          </button>
          <button className="btn-primary btn-sm"><Plus size={13} /> New Customer</button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              className="input pl-8 h-9 text-sm"
              placeholder="Search by code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Currency</th>
                <th className="text-right">Credit Limit</th>
                <th>Terms (days)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                : customers.map((c: any) => (
                    <tr key={c.id} className="cursor-pointer">
                      <td className="font-mono text-xs font-semibold text-primary-700">{c.code}</td>
                      <td className="font-medium text-foreground">{c.name}</td>
                      <td className="text-steel-500 text-xs">{c.currencyCode}</td>
                      <td className="text-right font-mono text-sm tabular-nums">{fmtCurrency(c.creditLimit)}</td>
                      <td className="text-steel-600 text-sm">{c.creditTerms}</td>
                      <td>
                        {c.creditHold
                          ? <span className="badge-red">Credit hold</span>
                          : c.isActive
                            ? <span className="badge-green">Active</span>
                            : <span className="badge-gray">Inactive</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && customers.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Users size={22} /></div>
            <p className="text-sm font-medium text-foreground">No customers found</p>
          </div>
        )}
      </div>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Customers"
        description="Upload a CSV file to bulk-import or update customer accounts."
        endpoint="/sales/customers/import"
        columns={CUSTOMER_COLUMNS}
        queryKey="customers"
      />
    </div>
  );
}
