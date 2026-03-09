import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, CheckCircle, XCircle, AlertCircle, Plug, Unplug,
  ChevronDown, ChevronRight, Clock, Users, AlertTriangle,
} from 'lucide-react';
import { integrationApi, IntegrationCredential, SyncLog } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { DataTable, Column } from '../../components/ui/DataTable';

// ── Provider card ──────────────────────────────────────────────────────────────

type Provider = 'xero' | 'shopify';

interface ProviderMeta {
  id:          Provider;
  name:        string;
  logo:        string;  // emoji/icon placeholder
  description: string;
  docsUrl:     string;
  fields:      { key: string; label: string; type: 'text' | 'password'; placeholder: string; hint?: string }[];
}

const PROVIDERS: ProviderMeta[] = [
  {
    id:          'xero',
    name:        'Xero',
    logo:        '🔵',
    description: 'Sync customers from your Xero accounting organisation. Contacts marked as "Customer" in Xero are imported and matched by Xero Contact ID.',
    docsUrl:     'https://developer.xero.com/documentation/api/accounting/contacts',
    fields: [
      { key: 'accessToken', label: 'Access Token',        type: 'password', placeholder: 'eyJ0eX…', hint: 'OAuth 2.0 bearer token from Xero Developer Portal' },
      { key: 'tenantId',    label: 'Organisation (Tenant) ID', type: 'text', placeholder: '00000000-0000-0000-0000-000000000000', hint: 'Found in Xero under Settings → General → Organisation ID' },
      { key: 'clientId',    label: 'Client ID (optional)', type: 'text', placeholder: 'ABC123…', hint: 'Required only for token refresh' },
    ],
  },
  {
    id:          'shopify',
    name:        'Shopify',
    logo:        '🛍️',
    description: 'Import Shopify customers into the ERP. Customers are matched by Shopify Customer ID; email and address data are synced on each run.',
    docsUrl:     'https://shopify.dev/docs/api/admin-rest/2024-01/resources/customer',
    fields: [
      { key: 'shopDomain',  label: 'Shop Domain',    type: 'text',     placeholder: 'myshop.myshopify.com', hint: 'Your Shopify store domain (without https://)' },
      { key: 'accessToken', label: 'Admin API Access Token', type: 'password', placeholder: 'shpat_…', hint: 'From Shopify Admin → Apps → Develop apps → API credentials' },
    ],
  },
];

// ── Sync status badge ──────────────────────────────────────────────────────────

function SyncStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'SUCCESS': return <span className="badge-green">Success</span>;
    case 'PARTIAL': return <span className="badge-yellow">Partial</span>;
    case 'FAILED':  return <span className="badge-red">Failed</span>;
    case 'RUNNING': return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
        <span className="w-2.5 h-2.5 border border-blue-600 border-t-transparent rounded-full animate-spin" />
        Running
      </span>
    );
    default: return <span className="badge-gray">{status}</span>;
  }
}

// ── Provider card component ────────────────────────────────────────────────────

function ProviderCard({
  meta,
  credential,
  onRefetch,
}: {
  meta: ProviderMeta;
  credential: IntegrationCredential | null;
  onRefetch: () => void;
}) {
  const qc = useQueryClient();
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(!credential?.isActive);
  const [syncResult, setSyncResult] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  const isConnected = !!credential?.isActive;

  const { mutate: saveConfig, isPending: isSaving } = useMutation({
    mutationFn: () => integrationApi.saveConfig(meta.id, formValues),
    onSuccess: () => {
      onRefetch();
      setFormOpen(false);
      setSyncResult({ type: 'success', text: 'Configuration saved.' });
      setTimeout(() => setSyncResult(null), 4000);
    },
    onError: (e: any) => {
      setSyncResult({ type: 'error', text: e?.response?.data?.message ?? 'Failed to save configuration.' });
      setTimeout(() => setSyncResult(null), 5000);
    },
  });

  const { mutate: disconnect, isPending: isDisconnecting } = useMutation({
    mutationFn: () => integrationApi.disconnect(meta.id),
    onSuccess: () => {
      onRefetch();
      setFormValues({});
      setFormOpen(true);
      setSyncResult({ type: 'info', text: `${meta.name} disconnected.` });
      setTimeout(() => setSyncResult(null), 4000);
    },
  });

  const { mutate: runSync, isPending: isSyncing } = useMutation({
    mutationFn: () => integrationApi.runSync(meta.id),
    onSuccess: (res: any) => {
      const { syncedRecords, errorCount, totalRecords } = res.data ?? {};
      const msg = syncedRecords !== undefined
        ? `Sync complete — ${syncedRecords}/${totalRecords} customers imported, ${errorCount} errors.`
        : 'Sync complete.';
      setSyncResult({ type: errorCount > 0 ? 'info' : 'success', text: msg });
      setTimeout(() => setSyncResult(null), 6000);
      qc.invalidateQueries({ queryKey: ['sync-logs', meta.id] });
      onRefetch();
    },
    onError: (e: any) => {
      setSyncResult({ type: 'error', text: e?.response?.data?.message ?? 'Sync failed.' });
      setTimeout(() => setSyncResult(null), 5000);
    },
  });

  const { data: logsData } = useQuery({
    queryKey: ['sync-logs', meta.id],
    queryFn: () => integrationApi.listSyncLogs({ provider: meta.id, limit: 10 }).then((r) => r.data as { data: SyncLog[]; meta: any }),
    enabled: logsOpen,
  });

  const logColumns: Column<Record<string, unknown>>[] = [
    {
      header: 'Date',
      cell: (r) => <span className="text-xs font-mono text-steel-600">{new Date(r.startedAt as string).toLocaleString()}</span>,
    },
    {
      header: 'Status',
      cell: (r) => <SyncStatusBadge status={r.status as string} />,
    },
    {
      header: 'Records',
      cell: (r) => (
        <span className="text-sm text-steel-700">
          {r.syncedRecords as number}/{r.totalRecords as number}
        </span>
      ),
    },
    {
      header: 'Errors',
      cell: (r) => (
        r.errorCount as number > 0
          ? <span className="text-xs font-medium text-red-600">{r.errorCount as number} errors</span>
          : <span className="text-xs text-steel-400">—</span>
      ),
    },
    {
      header: 'Duration',
      cell: (r) => {
        if (!r.completedAt) return <span className="text-xs text-steel-400">—</span>;
        const ms = new Date(r.completedAt as string).getTime() - new Date(r.startedAt as string).getTime();
        return <span className="text-xs text-steel-500">{(ms / 1000).toFixed(1)}s</span>;
      },
    },
  ];

  return (
    <div className="card">
      <div className="card-header flex items-center gap-3">
        <span className="text-2xl">{meta.logo}</span>
        <div className="flex-1">
          <h3 className="font-semibold text-steel-900">{meta.name}</h3>
          <p className="text-xs text-steel-500 mt-0.5">{meta.description}</p>
        </div>
        {/* Connection status */}
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <span className="flex items-center gap-1 text-xs text-green-700 font-medium bg-green-50 px-2 py-1 rounded-full border border-green-200">
                <CheckCircle size={11} />
                Connected
              </span>
              {credential?.lastSyncAt && (
                <span className="text-xs text-steel-400">
                  Last sync: {new Date(credential.lastSyncAt).toLocaleString()}
                </span>
              )}
            </>
          ) : (
            <span className="flex items-center gap-1 text-xs text-steel-500 font-medium bg-steel-100 px-2 py-1 rounded-full border border-steel-200">
              <Unplug size={11} />
              Not connected
            </span>
          )}
        </div>
      </div>

      <div className="card-body space-y-4">
        {/* Feedback message */}
        {syncResult && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
            syncResult.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200'
            : syncResult.type === 'error'  ? 'bg-red-50 text-red-700 border border-red-200'
            :                                'bg-blue-50 text-blue-700 border border-blue-200'
          }`}>
            {syncResult.type === 'success' ? <CheckCircle size={14} /> : syncResult.type === 'error' ? <XCircle size={14} /> : <AlertCircle size={14} />}
            {syncResult.text}
          </div>
        )}

        {/* Config form toggle */}
        <button
          type="button"
          onClick={() => setFormOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs font-medium text-steel-500 hover:text-steel-700 transition-colors"
        >
          {formOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {isConnected ? 'Update credentials' : 'Configure credentials'}
        </button>

        {formOpen && (
          <div className="bg-steel-50 border border-steel-200 rounded-xl p-4 space-y-3">
            {meta.fields.map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-steel-700 mb-1">
                  {field.label}
                </label>
                <input
                  type={field.type}
                  value={formValues[field.key] ?? ''}
                  onChange={(e) => setFormValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900 placeholder-steel-400 font-mono"
                />
                {field.hint && <p className="text-xs text-steel-400 mt-1">{field.hint}</p>}
              </div>
            ))}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => saveConfig()}
                disabled={isSaving || Object.keys(formValues).length === 0}
                className="btn-primary btn-sm flex items-center gap-1.5"
              >
                <Plug size={12} />
                {isSaving ? 'Saving…' : isConnected ? 'Update' : 'Connect'}
              </button>
              {isConnected && (
                <button
                  type="button"
                  onClick={() => disconnect()}
                  disabled={isDisconnecting}
                  className="btn-sm border border-red-200 text-red-600 hover:bg-red-50 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                >
                  <Unplug size={12} className="inline mr-1" />
                  {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Action row */}
        {isConnected && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => runSync()}
              disabled={isSyncing}
              className="btn-primary flex items-center gap-2"
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'Syncing…' : 'Sync Customers Now'}
            </button>
            <span className="text-xs text-steel-400">
              Imports customers from {meta.name} into the ERP. New records are created; existing ones (matched by {meta.id === 'xero' ? 'Xero Contact ID' : 'Shopify Customer ID'}) are updated.
            </span>
          </div>
        )}

        {/* Sync logs toggle */}
        {isConnected && (
          <>
            <button
              type="button"
              onClick={() => setLogsOpen((o) => !o)}
              className="flex items-center gap-1.5 text-xs font-medium text-steel-500 hover:text-steel-700 transition-colors"
            >
              {logsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Clock size={12} />
              Sync history
            </button>

            {logsOpen && (
              <div className="border border-steel-200 rounded-xl overflow-hidden">
                <DataTable
                  columns={logColumns}
                  data={(logsData?.data ?? []) as unknown as Record<string, unknown>[]}
                  isLoading={false}
                  keyField="id"
                  emptyMessage="No sync runs yet."
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Summary stats ──────────────────────────────────────────────────────────────

function SyncSummaryBanner({ credentials }: { credentials: IntegrationCredential[] }) {
  const connected = credentials.filter((c) => c.isActive);
  if (connected.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-4 mb-5">
      <div className="card card-body flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
          <Plug size={15} className="text-green-600" />
        </div>
        <div>
          <div className="text-lg font-semibold text-steel-900">{connected.length}</div>
          <div className="text-xs text-steel-500">Active integration{connected.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div className="card card-body flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
          <Users size={15} className="text-blue-600" />
        </div>
        <div>
          <div className="text-lg font-semibold text-steel-900">
            {connected.filter((c) => c.lastSyncAt).length}
          </div>
          <div className="text-xs text-steel-500">Synced providers</div>
        </div>
      </div>
    </div>
  );
}

// ── IntegrationsPage ──────────────────────────────────────────────────────────

export function IntegrationsPage() {
  const { data: configData, refetch } = useQuery({
    queryKey: ['integration-configs'],
    queryFn: () => integrationApi.listConfigs().then((r) => r.data as { data: IntegrationCredential[] }),
  });

  const credentials = configData?.data ?? [];

  function credentialFor(provider: Provider) {
    return credentials.find((c) => c.provider === provider) ?? null;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Integrations"
        subtitle="Sync customers from Xero and Shopify into the ERP"
        actions={
          <div className="flex items-center gap-1.5 text-xs text-steel-400">
            <AlertTriangle size={12} className="text-amber-500" />
            <span>Credentials are stored encrypted per company</span>
          </div>
        }
      />

      <SyncSummaryBanner credentials={credentials} />

      <div className="space-y-5">
        {PROVIDERS.map((meta) => (
          <ProviderCard
            key={meta.id}
            meta={meta}
            credential={credentialFor(meta.id)}
            onRefetch={refetch}
          />
        ))}
      </div>
    </div>
  );
}
