import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Mail, Bell, CheckCircle, XCircle, Send, Settings2, Clock, ChevronRight, GitBranch,
} from 'lucide-react';
import { automationApi, crmApi, EmailAutomationRule, EmailLog, PipelineStage } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { DataTable, Column } from '../../components/ui/DataTable';

// ── Trigger metadata ───────────────────────────────────────────────────────────

interface TriggerMeta {
  trigger: string;
  label: string;
  group: string;
}

const TRIGGER_META: TriggerMeta[] = [
  { trigger: 'SO_CONFIRMED',          label: 'Order Confirmed',          group: 'Order Status Automations' },
  { trigger: 'SO_IN_PRODUCTION',      label: 'In Production',            group: 'Order Status Automations' },
  { trigger: 'SO_READY_TO_SHIP',      label: 'Ready to Ship',            group: 'Order Status Automations' },
  { trigger: 'SO_SHIPPED',            label: 'Order Shipped',            group: 'Order Status Automations' },
  { trigger: 'SO_INVOICED',           label: 'Invoice Issued',           group: 'Order Status Automations' },
  { trigger: 'SO_CANCELLED',          label: 'Order Cancelled',          group: 'Order Status Automations' },
  { trigger: 'QUOTE_FOLLOWUP_3D',     label: 'Quote Follow-up (3 days)', group: 'Lead Nurturing' },
  { trigger: 'QUOTE_FOLLOWUP_7D',     label: 'Quote Follow-up (7 days)', group: 'Lead Nurturing' },
  { trigger: 'QUOTE_EXPIRY_WARNING',  label: 'Quote Expiry Warning',     group: 'Lead Nurturing' },
  { trigger: 'INVOICE_FOLLOWUP_7D',   label: 'Invoice Follow-up (7 days)',  group: 'Invoice Follow-Up' },
  { trigger: 'INVOICE_FOLLOWUP_14D',  label: 'Invoice Follow-up (14 days)', group: 'Invoice Follow-Up' },
  { trigger: 'INVOICE_FOLLOWUP_21D',  label: 'Invoice Follow-up (21 days)', group: 'Invoice Follow-Up' },
  { trigger: 'INVOICE_FOLLOWUP_30D',  label: 'Invoice Follow-up (30 days)', group: 'Invoice Follow-Up' },
];

// ── Toggle Switch ──────────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 ${
        enabled ? 'bg-primary-600' : 'bg-steel-200'
      }`}
      aria-pressed={enabled}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

// ── Rule Row ──────────────────────────────────────────────────────────────────

interface RuleRowState {
  isEnabled: boolean;
  subject: string;
  delayHours: number;
  saved: boolean;
}

function RuleRow({
  meta,
  rule,
  onSave,
  isSaving,
}: {
  meta: TriggerMeta;
  rule: EmailAutomationRule | undefined;
  onSave: (trigger: string, data: { isEnabled: boolean; subject: string; delayHours: number }) => void;
  isSaving: boolean;
}) {
  const [state, setState] = useState<RuleRowState>({
    isEnabled: rule?.isEnabled ?? false,
    subject: rule?.subject ?? '',
    delayHours: rule?.delayHours ?? 0,
    saved: false,
  });

  // Sync when remote data arrives
  useEffect(() => {
    if (rule) {
      setState({
        isEnabled: rule.isEnabled,
        subject: rule.subject,
        delayHours: rule.delayHours,
        saved: false,
      });
    }
  }, [rule]);

  function handleSave() {
    onSave(meta.trigger, {
      isEnabled: state.isEnabled,
      subject: state.subject,
      delayHours: state.delayHours,
    });
    setState((s) => ({ ...s, saved: true }));
    setTimeout(() => setState((s) => ({ ...s, saved: false })), 3000);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 border-b border-steel-100 last:border-0">
      {/* Toggle + label */}
      <div className="flex items-center gap-3 min-w-[220px]">
        <ToggleSwitch
          enabled={state.isEnabled}
          onChange={(v) => setState((s) => ({ ...s, isEnabled: v }))}
        />
        <div>
          <span className="text-sm font-medium text-steel-900">{meta.label}</span>
          <div className="flex items-center gap-1 text-xs text-steel-400 mt-0.5">
            <Clock size={10} />
            <span>{state.delayHours === 0 ? 'Immediate' : `${state.delayHours}h delay`}</span>
          </div>
        </div>
      </div>

      {/* Subject */}
      <div className="flex-1">
        <input
          type="text"
          value={state.subject}
          onChange={(e) => setState((s) => ({ ...s, subject: e.target.value }))}
          placeholder="Email subject…"
          className="w-full px-3 py-1.5 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900 placeholder-steel-400"
        />
      </div>

      {/* Delay hours */}
      <div className="w-28">
        <div className="relative">
          <input
            type="number"
            min={0}
            value={state.delayHours}
            onChange={(e) => setState((s) => ({ ...s, delayHours: Number(e.target.value) }))}
            className="w-full px-3 py-1.5 pr-8 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-steel-400 pointer-events-none">h</span>
        </div>
      </div>

      {/* Save button + success indicator */}
      <div className="flex items-center gap-2">
        {state.saved && (
          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
            <CheckCircle size={12} />
            Saved
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="btn-primary btn-sm"
        >
          {isSaving ? (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              Saving…
            </span>
          ) : (
            'Save'
          )}
        </button>
      </div>
    </div>
  );
}

// ── Rules Tab ─────────────────────────────────────────────────────────────────

function RulesGroup({
  group,
  icon: Icon,
  metas,
  rulesByTrigger,
  onSave,
  isSaving,
  savingTrigger,
}: {
  group: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  metas: TriggerMeta[];
  rulesByTrigger: Map<string, EmailAutomationRule>;
  onSave: (trigger: string, data: { isEnabled: boolean; subject: string; delayHours: number }) => void;
  isSaving: boolean;
  savingTrigger?: string;
}) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Icon size={15} className="text-steel-500" />
        <h3 className="font-semibold">{group}</h3>
      </div>
      <div className="card-body">
        <div className="text-xs text-steel-400 flex gap-4 pb-2 border-b border-steel-100 font-medium uppercase tracking-wide">
          <span className="min-w-[220px]">Trigger / Delay</span>
          <span className="flex-1">Email Subject</span>
          <span className="w-28">Delay (h)</span>
          <span className="w-20 text-right">Action</span>
        </div>
        {metas.map((meta) => (
          <RuleRow
            key={meta.trigger}
            meta={meta}
            rule={rulesByTrigger.get(meta.trigger)}
            onSave={onSave}
            isSaving={isSaving && savingTrigger === meta.trigger}
          />
        ))}
      </div>
    </div>
  );
}

function RulesTab() {
  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ['automation-rules'],
    queryFn: () => automationApi.listRules().then((r) => r.data as EmailAutomationRule[]),
  });

  const { data: stagesData, isLoading: stagesLoading } = useQuery({
    queryKey: ['pipeline-stages'],
    queryFn: () => crmApi.listStages().then((r) => r.data as PipelineStage[]),
  });

  const { mutate: saveRule, isPending: isSaving, variables: savingVars } = useMutation({
    mutationFn: ({ trigger, data }: { trigger: string; data: { isEnabled: boolean; subject: string; delayHours: number } }) =>
      automationApi.updateRule(trigger, data),
  });

  // Test Email state
  const [testTo, setTestTo] = useState('');
  const [testTrigger, setTestTrigger] = useState(TRIGGER_META[0].trigger);
  const [testMsg, setTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { mutate: sendTest, isPending: isSendingTest } = useMutation({
    mutationFn: () => automationApi.testEmail(testTo, testTrigger),
    onSuccess: () => {
      setTestMsg({ type: 'success', text: 'Test email sent successfully.' });
      setTimeout(() => setTestMsg(null), 4000);
    },
    onError: () => {
      setTestMsg({ type: 'error', text: 'Failed to send test email.' });
      setTimeout(() => setTestMsg(null), 4000);
    },
  });

  const rulesByTrigger = new Map<string, EmailAutomationRule>(
    (rulesData ?? []).map((r) => [r.trigger, r])
  );

  // Build CRM stage trigger metas dynamically from pipeline stages
  const crmStageMetas: TriggerMeta[] = (stagesData ?? [])
    .filter((s) => !s.isLost) // LOST stage typically doesn't need a customer email
    .map((s) => ({
      trigger: `CRM_STAGE_${s.name.toUpperCase().replace(/\s+/g, '_')}`,
      label: `Stage → ${s.name}`,
      group: 'Pipeline Stage Notifications',
    }));

  const soGroups = Array.from(new Set(TRIGGER_META.map((m) => m.group)));
  const isLoading = rulesLoading || stagesLoading;

  return (
    <div className="space-y-5">
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
        {soGroups.map((group) => (
          <RulesGroup
            key={group}
            group={group}
            icon={Bell}
            metas={TRIGGER_META.filter((m) => m.group === group)}
            rulesByTrigger={rulesByTrigger}
            onSave={(trigger, data) => saveRule({ trigger, data })}
            isSaving={isSaving}
            savingTrigger={savingVars?.trigger}
          />
        ))}
        {crmStageMetas.length > 0 && (
          <RulesGroup
            group="Pipeline Stage Notifications"
            icon={GitBranch}
            metas={crmStageMetas}
            rulesByTrigger={rulesByTrigger}
            onSave={(trigger, data) => saveRule({ trigger, data })}
            isSaving={isSaving}
            savingTrigger={savingVars?.trigger}
          />
        )}
        </>
      )}

      {/* Test Email */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Send size={15} className="text-steel-500" />
          <h3 className="font-semibold">Send Test Email</h3>
        </div>
        <div className="card-body">
          <p className="text-sm text-steel-500 mb-4">
            Send a test email using a specific trigger template to verify your configuration.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-steel-600 mb-1">To Email</label>
              <input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full px-3 py-1.5 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900 placeholder-steel-400"
              />
            </div>
            <div className="w-64">
              <label className="block text-xs font-medium text-steel-600 mb-1">Trigger</label>
              <select
                value={testTrigger}
                onChange={(e) => setTestTrigger(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white text-steel-900"
              >
                {TRIGGER_META.map((m) => (
                  <option key={m.trigger} value={m.trigger}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => sendTest()}
                disabled={isSendingTest || !testTo}
                className="btn-primary btn-sm flex items-center gap-1.5"
              >
                <Send size={13} />
                {isSendingTest ? 'Sending…' : 'Send Test'}
              </button>
            </div>
          </div>
          {testMsg && (
            <div
              className={`mt-3 flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                testMsg.type === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {testMsg.type === 'success' ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {testMsg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Email Log Tab ─────────────────────────────────────────────────────────────

function EmailLogTab() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['automation-logs', page],
    queryFn: () =>
      automationApi.listLogs({ page, limit: 20 }).then((r) => r.data as {
        data: EmailLog[];
        meta: { total: number; page: number; limit: number; totalPages: number };
      }),
  });

  const { data: stagesData } = useQuery({
    queryKey: ['pipeline-stages'],
    queryFn: () => crmApi.listStages().then((r) => r.data as PipelineStage[]),
  });

  const crmStageMetas: TriggerMeta[] = (stagesData ?? []).map((s) => ({
    trigger: `CRM_STAGE_${s.name.toUpperCase().replace(/\s+/g, '_')}`,
    label: `Stage → ${s.name}`,
    group: 'Pipeline Stage Notifications',
  }));

  const TRIGGER_LABEL = new Map([...TRIGGER_META, ...crmStageMetas].map((m) => [m.trigger, m.label]));

  const columns: Column<Record<string, unknown>>[] = [
    {
      header: 'Date / Time',
      cell: (r) => (
        <span className="text-xs font-mono text-steel-600">
          {new Date(r.sentAt as string).toLocaleString()}
        </span>
      ),
    },
    {
      header: 'Trigger',
      cell: (r) => (
        <span className="text-xs font-medium text-steel-700">
          {TRIGGER_LABEL.get(r.trigger as string) ?? (r.trigger as string)}
        </span>
      ),
    },
    {
      header: 'Entity',
      cell: (r) => (
        <span className="text-xs text-steel-500 font-mono">
          {(r.entityType as string)} · {(r.entityId as string).slice(0, 8)}…
        </span>
      ),
    },
    {
      header: 'Recipient',
      cell: (r) => (
        <span className="text-sm text-steel-700">{r.recipient as string}</span>
      ),
    },
    {
      header: 'Subject',
      cell: (r) => (
        <span className="text-sm text-steel-600 truncate max-w-[260px] block">{r.subject as string}</span>
      ),
    },
    {
      header: 'Status',
      className: 'text-right',
      cell: (r) => {
        const status = (r.status as string).toUpperCase();
        if (status === 'SENT') return <span className="badge-green">Sent</span>;
        if (status === 'FAILED') return <span className="badge-red">{r.errorMsg ? 'Failed' : 'Failed'}</span>;
        return <span className="badge-gray">{r.status as string}</span>;
      },
    },
  ];

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Clock size={15} className="text-steel-500" />
        <h3 className="font-semibold">Email Log</h3>
        {data?.meta && (
          <span className="ml-auto text-xs text-steel-400">{data.meta.total} entries</span>
        )}
      </div>
      <div className="card-body p-0">
        <DataTable
          columns={columns}
          data={(data?.data ?? []) as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          pagination={data?.meta}
          onPageChange={setPage}
          keyField="id"
          emptyMessage="No emails have been sent yet."
        />
      </div>
    </div>
  );
}

// ── AutomationPage ─────────────────────────────────────────────────────────────

type Tab = 'rules' | 'log';

export function AutomationPage() {
  const [activeTab, setActiveTab] = useState<Tab>('rules');

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Email Automation"
        subtitle="Configure automated customer emails"
        actions={
          <div className="flex items-center gap-1.5 text-xs text-steel-400">
            <Settings2 size={13} />
            <span>Automation Config</span>
            <ChevronRight size={11} />
            <Mail size={13} />
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-steel-200">
        {([
          { key: 'rules', label: 'Email Rules', icon: Bell },
          { key: 'log',   label: 'Email Log',   icon: Clock },
        ] as { key: Tab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-steel-500 hover:text-steel-700 hover:border-steel-300'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'rules' && <RulesTab />}
      {activeTab === 'log'   && <EmailLogTab />}
    </div>
  );
}
