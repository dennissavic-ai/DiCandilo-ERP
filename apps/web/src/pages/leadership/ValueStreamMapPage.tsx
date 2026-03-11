import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vsmApi } from '../../services/api';
import {
  GitFork, Plus, Trash2, ChevronLeft, ChevronRight,
  Sparkles, PencilLine, Save, X, BarChart2, Info,
  Factory, Package, Truck, Users, ChevronDown,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────────

type NodeType = 'SUPPLIER' | 'PROCESS' | 'INVENTORY' | 'SHIPPING' | 'CUSTOMER';

interface VSMNode {
  id: string;
  mapId: string;
  type: NodeType;
  label: string;
  position: number;
  cycleTimeSec: number | null;
  changeOverSec: number | null;
  uptimePct: number | null;
  operatorCount: number | null;
  batchSize: number | null;
  waitTimeSec: number | null;
  promotedFromId: string | null;
  notes: string | null;
}

interface VSMMap {
  id: string;
  name: string;
  description: string | null;
  nodes: VSMNode[];
  _count?: { nodes: number };
  updatedAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function fmtTime(sec: number | null | undefined): string {
  if (sec == null) return '—';
  if (sec === 0) return '0s';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function computeMetrics(nodes: VSMNode[]) {
  const processNodes = nodes.filter((n) => n.type === 'PROCESS' || n.type === 'SHIPPING');
  const totalCycleSec = processNodes.reduce((s, n) => s + (n.cycleTimeSec ?? 0), 0);
  const totalWaitSec = nodes.reduce((s, n) => s + (n.waitTimeSec ?? 0), 0);
  const totalLeadSec = totalCycleSec + totalWaitSec;
  const efficiency = totalLeadSec > 0 ? ((totalCycleSec / totalLeadSec) * 100).toFixed(1) : null;
  return { totalCycleSec, totalWaitSec, totalLeadSec, efficiency };
}

// ── Node type config ────────────────────────────────────────────────────────────

const NODE_TYPE_META: Record<NodeType, {
  label: string;
  color: string;
  border: string;
  text: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = {
  SUPPLIER:  { label: 'Supplier',   color: 'bg-amber-50',   border: 'border-amber-300',  text: 'text-amber-800',  icon: Factory },
  PROCESS:   { label: 'Process',    color: 'bg-blue-50',    border: 'border-blue-300',   text: 'text-blue-800',   icon: GitFork },
  INVENTORY: { label: 'Inventory',  color: 'bg-violet-50',  border: 'border-violet-300', text: 'text-violet-800', icon: Package },
  SHIPPING:  { label: 'Shipping',   color: 'bg-green-50',   border: 'border-green-300',  text: 'text-green-800',  icon: Truck },
  CUSTOMER:  { label: 'Customer',   color: 'bg-teal-50',    border: 'border-teal-300',   text: 'text-teal-800',   icon: Users },
};

// ── SVG Canvas ──────────────────────────────────────────────────────────────────

const BOX_W = 156;
const BOX_H = 64;
const DATA_H = 100;
const H_GAP = 56;   // horizontal space between boxes
const STEP = BOX_W + H_GAP;
const PAD_X = 28;
const PROC_Y = 24;
const DATA_Y = PROC_Y + BOX_H + 14;
const TL_Y = DATA_Y + DATA_H + 22;
const CANVAS_H = TL_Y + 36;

const TYPE_FILLS: Record<NodeType, string> = {
  SUPPLIER:  '#fffbeb',
  PROCESS:   '#eff6ff',
  INVENTORY: '#f5f3ff',
  SHIPPING:  '#f0fdf4',
  CUSTOMER:  '#f0fdfa',
};
const TYPE_STROKES: Record<NodeType, string> = {
  SUPPLIER:  '#fbbf24',
  PROCESS:   '#93c5fd',
  INVENTORY: '#c4b5fd',
  SHIPPING:  '#86efac',
  CUSTOMER:  '#5eead4',
};
const TYPE_TEXT: Record<NodeType, string> = {
  SUPPLIER:  '#92400e',
  PROCESS:   '#1e40af',
  INVENTORY: '#5b21b6',
  SHIPPING:  '#14532d',
  CUSTOMER:  '#134e4a',
};

function VSMCanvas({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: VSMNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
        <GitFork size={32} className="opacity-20" />
        <p>Add your first process step below, or use <strong>Promote</strong> to import from work centers.</p>
      </div>
    );
  }

  const canvasW = PAD_X * 2 + nodes.length * STEP - H_GAP;

  // Timeline total
  const metrics = computeMetrics(nodes);

  return (
    <div className="overflow-x-auto">
      <svg
        width={Math.max(canvasW, 600)}
        height={CANVAS_H}
        style={{ display: 'block', minWidth: canvasW }}
      >
        {/* Timeline track */}
        <rect x={PAD_X} y={TL_Y + 4} width={canvasW - PAD_X * 2} height={18} rx={4} fill="#f1f5f9" />

        {nodes.map((node, i) => {
          const x = PAD_X + i * STEP;
          const cx = x + BOX_W / 2;
          const isSelected = node.id === selectedId;
          const fill = TYPE_FILLS[node.type];
          const stroke = isSelected ? '#3b82f6' : TYPE_STROKES[node.type];
          const strokeW = isSelected ? 2.5 : 1.5;
          const tc = TYPE_TEXT[node.type];

          // Timeline proportion for this node (cycle time)
          const nodeTotal = (node.cycleTimeSec ?? 0) + (node.waitTimeSec ?? 0);
          const tlPct = metrics.totalLeadSec > 0 ? nodeTotal / metrics.totalLeadSec : 0;
          const tlX = PAD_X + i * STEP;
          const tlW = Math.max(tlPct * (canvasW - PAD_X * 2), 0);

          return (
            <g key={node.id} onClick={() => onSelect(node.id)} style={{ cursor: 'pointer' }}>
              {/* Arrow to next */}
              {i < nodes.length - 1 && (
                <g>
                  <line
                    x1={x + BOX_W} y1={PROC_Y + BOX_H / 2}
                    x2={x + BOX_W + H_GAP - 6} y2={PROC_Y + BOX_H / 2}
                    stroke="#94a3b8" strokeWidth={1.5}
                  />
                  <polygon
                    points={`${x + BOX_W + H_GAP - 6},${PROC_Y + BOX_H / 2 - 4} ${x + BOX_W + H_GAP},${PROC_Y + BOX_H / 2} ${x + BOX_W + H_GAP - 6},${PROC_Y + BOX_H / 2 + 4}`}
                    fill="#94a3b8"
                  />
                  {/* Wait time label between nodes */}
                  {node.waitTimeSec != null && (
                    <text
                      x={x + BOX_W + H_GAP / 2}
                      y={PROC_Y + BOX_H / 2 - 7}
                      textAnchor="middle" fontSize={9} fill="#64748b"
                    >
                      wait: {fmtTime(node.waitTimeSec)}
                    </text>
                  )}
                </g>
              )}

              {/* Process box */}
              <rect
                x={x} y={PROC_Y} width={BOX_W} height={BOX_H}
                rx={6} fill={fill}
                stroke={stroke} strokeWidth={strokeW}
              />

              {/* Node type label (top-left badge) */}
              <text x={x + 8} y={PROC_Y + 14} fontSize={9} fill={tc} fontWeight={600} opacity={0.7}>
                {NODE_TYPE_META[node.type].label.toUpperCase()}
              </text>

              {/* Node label */}
              <text
                x={cx} y={PROC_Y + 40} fontSize={13}
                textAnchor="middle" fill={tc} fontWeight={700}
              >
                {node.label.length > 18 ? node.label.slice(0, 16) + '…' : node.label}
              </text>

              {/* Data box */}
              <rect
                x={x} y={DATA_Y} width={BOX_W} height={DATA_H}
                rx={4} fill="#f8fafc" stroke="#e2e8f0" strokeWidth={1}
              />
              <text x={x + 8} y={DATA_Y + 14} fontSize={9} fill="#475569">
                C/T: {fmtTime(node.cycleTimeSec)}
              </text>
              <text x={x + 8} y={DATA_Y + 28} fontSize={9} fill="#475569">
                C/O: {fmtTime(node.changeOverSec)}
              </text>
              <text x={x + 8} y={DATA_Y + 42} fontSize={9} fill="#475569">
                Uptime: {node.uptimePct != null ? `${node.uptimePct}%` : '—'}
              </text>
              <text x={x + 8} y={DATA_Y + 56} fontSize={9} fill="#475569">
                Operators: {node.operatorCount ?? '—'}
              </text>
              <text x={x + 8} y={DATA_Y + 70} fontSize={9} fill="#475569">
                Batch: {node.batchSize ?? '—'}
              </text>
              {node.promotedFromId && (
                <text x={x + 8} y={DATA_Y + 88} fontSize={8} fill="#6366f1" fontStyle="italic">
                  ✦ promoted
                </text>
              )}

              {/* Timeline segment */}
              {tlW > 0 && (
                <rect
                  x={tlX} y={TL_Y + 4}
                  width={Math.min(tlW, STEP)}
                  height={18}
                  rx={3}
                  fill={isSelected ? '#3b82f6' : TYPE_STROKES[node.type]}
                  opacity={0.55}
                />
              )}
              {/* Timeline label */}
              <text x={x + BOX_W / 2} y={TL_Y + 17} textAnchor="middle" fontSize={8} fill="#475569">
                {fmtTime((node.cycleTimeSec ?? 0) + (node.waitTimeSec ?? 0))}
              </text>
            </g>
          );
        })}

        {/* Canvas labels */}
        <text x={PAD_X} y={PROC_Y - 8} fontSize={10} fill="#94a3b8" fontWeight={600}>
          PROCESS FLOW
        </text>
        <text x={PAD_X} y={TL_Y - 4} fontSize={10} fill="#94a3b8" fontWeight={600}>
          LEAD TIME TIMELINE
        </text>
      </svg>
    </div>
  );
}

// ── Add / Edit Node Form ────────────────────────────────────────────────────────

const NODE_TYPES: NodeType[] = ['SUPPLIER', 'PROCESS', 'INVENTORY', 'SHIPPING', 'CUSTOMER'];

interface NodeFormState {
  type: NodeType;
  label: string;
  cycleTimeSec: string;
  changeOverSec: string;
  uptimePct: string;
  operatorCount: string;
  batchSize: string;
  waitTimeSec: string;
  notes: string;
}

const emptyForm = (): NodeFormState => ({
  type: 'PROCESS',
  label: '',
  cycleTimeSec: '',
  changeOverSec: '',
  uptimePct: '',
  operatorCount: '',
  batchSize: '',
  waitTimeSec: '',
  notes: '',
});

function nodeToForm(n: VSMNode): NodeFormState {
  return {
    type: n.type,
    label: n.label,
    cycleTimeSec: n.cycleTimeSec != null ? String(n.cycleTimeSec) : '',
    changeOverSec: n.changeOverSec != null ? String(n.changeOverSec) : '',
    uptimePct: n.uptimePct != null ? String(n.uptimePct) : '',
    operatorCount: n.operatorCount != null ? String(n.operatorCount) : '',
    batchSize: n.batchSize != null ? String(n.batchSize) : '',
    waitTimeSec: n.waitTimeSec != null ? String(n.waitTimeSec) : '',
    notes: n.notes ?? '',
  };
}

function formToPayload(f: NodeFormState) {
  return {
    type: f.type,
    label: f.label.trim(),
    cycleTimeSec:  f.cycleTimeSec  !== '' ? parseInt(f.cycleTimeSec)  : null,
    changeOverSec: f.changeOverSec !== '' ? parseInt(f.changeOverSec) : null,
    uptimePct:     f.uptimePct     !== '' ? parseFloat(f.uptimePct)  : null,
    operatorCount: f.operatorCount !== '' ? parseInt(f.operatorCount) : null,
    batchSize:     f.batchSize     !== '' ? parseInt(f.batchSize)     : null,
    waitTimeSec:   f.waitTimeSec   !== '' ? parseInt(f.waitTimeSec)   : null,
    notes:         f.notes.trim() || null,
  };
}

function NodeEditorPanel({
  mapId,
  node,
  onClose,
}: {
  mapId: string;
  node: VSMNode | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<NodeFormState>(node ? nodeToForm(node) : emptyForm());
  const isEdit = node != null;

  const addMutation = useMutation({
    mutationFn: (data: object) => vsmApi.addNode(mapId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vsm-map', mapId] }); onClose(); },
  });
  const updateMutation = useMutation({
    mutationFn: (data: object) => vsmApi.updateNode(mapId, node!.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vsm-map', mapId] }); onClose(); },
  });

  function set(field: keyof NodeFormState, val: string) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) return;
    const payload = formToPayload(form);
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      addMutation.mutate(payload);
    }
  }

  const busy = addMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-foreground">
          {isEdit ? 'Edit Node' : 'Add Process Node'}
        </h3>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      {/* Type */}
      <div className="flex gap-1.5 flex-wrap">
        {NODE_TYPES.map((t) => {
          const meta = NODE_TYPE_META[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => set('type', t)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-all ${
                form.type === t
                  ? `${meta.color} ${meta.border} ${meta.text}`
                  : 'bg-muted border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Label */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Label *</label>
        <input
          className="input text-sm w-full"
          placeholder="e.g. CNC Cutting"
          value={form.label}
          onChange={(e) => set('label', e.target.value)}
          required
        />
      </div>

      {/* Metric fields */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Cycle Time (sec)</label>
          <input className="input text-sm w-full" type="number" min={0} placeholder="e.g. 120"
            value={form.cycleTimeSec} onChange={(e) => set('cycleTimeSec', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Changeover (sec)</label>
          <input className="input text-sm w-full" type="number" min={0} placeholder="e.g. 300"
            value={form.changeOverSec} onChange={(e) => set('changeOverSec', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Uptime %</label>
          <input className="input text-sm w-full" type="number" min={0} max={100} placeholder="e.g. 85"
            value={form.uptimePct} onChange={(e) => set('uptimePct', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Operators</label>
          <input className="input text-sm w-full" type="number" min={0} placeholder="e.g. 2"
            value={form.operatorCount} onChange={(e) => set('operatorCount', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Batch Size</label>
          <input className="input text-sm w-full" type="number" min={1} placeholder="e.g. 50"
            value={form.batchSize} onChange={(e) => set('batchSize', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Wait Before (sec)</label>
          <input className="input text-sm w-full" type="number" min={0} placeholder="e.g. 3600"
            value={form.waitTimeSec} onChange={(e) => set('waitTimeSec', e.target.value)} />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Notes</label>
        <textarea className="input text-sm w-full" rows={2} placeholder="Optional notes…"
          value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={busy || !form.label.trim()}
          className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
          <Save size={12} />
          {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Node'}
        </button>
        <button type="button" onClick={onClose} className="btn-ghost text-xs px-3 py-1.5">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Metrics bar ─────────────────────────────────────────────────────────────────

function MetricsBar({ nodes }: { nodes: VSMNode[] }) {
  const { totalCycleSec, totalWaitSec, totalLeadSec, efficiency } = computeMetrics(nodes);
  const processCount = nodes.filter((n) => n.type === 'PROCESS').length;

  return (
    <div className="flex flex-wrap gap-4 items-center px-4 py-3 bg-muted/40 border-t border-border rounded-b-xl text-xs">
      <MetricItem label="Process Steps" value={String(processCount)} />
      <MetricItem label="Total Lead Time" value={fmtTime(totalLeadSec)} />
      <MetricItem label="Value-Added Time" value={fmtTime(totalCycleSec)} highlight />
      <MetricItem label="Wait / Queue Time" value={fmtTime(totalWaitSec)} />
      {efficiency && (
        <MetricItem
          label="Flow Efficiency"
          value={`${efficiency}%`}
          highlight={parseFloat(efficiency) > 20}
        />
      )}
      {efficiency && (
        <div className="flex-1 flex items-center gap-2 min-w-32">
          <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${Math.min(parseFloat(efficiency), 100)}%` }}
            />
          </div>
          <span className="text-muted-foreground">{efficiency}% efficient</span>
        </div>
      )}
    </div>
  );
}

function MetricItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</span>
      <span className={`font-semibold ${highlight ? 'text-blue-600' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────────

export function ValueStreamMapPage() {
  const qc = useQueryClient();
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAddNode, setShowAddNode] = useState(false);
  const [newMapName, setNewMapName] = useState('');
  const [showNewMapForm, setShowNewMapForm] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const { data: maps = [], isLoading: mapsLoading } = useQuery<VSMMap[]>({
    queryKey: ['vsm-maps'],
    queryFn: () => vsmApi.listMaps().then((r) => r.data),
  });

  const { data: activeMap, isLoading: mapLoading } = useQuery<VSMMap>({
    queryKey: ['vsm-map', selectedMapId],
    queryFn: () => vsmApi.getMap(selectedMapId!).then((r) => r.data),
    enabled: !!selectedMapId,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const createMap = useMutation({
    mutationFn: (name: string) => vsmApi.createMap({ name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['vsm-maps'] });
      setSelectedMapId(res.data.id);
      setNewMapName('');
      setShowNewMapForm(false);
    },
  });

  const deleteMap = useMutation({
    mutationFn: (id: string) => vsmApi.deleteMap(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vsm-maps'] });
      setSelectedMapId(null);
      setSelectedNodeId(null);
    },
  });

  const renameMap = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => vsmApi.updateMap(id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vsm-maps'] });
      qc.invalidateQueries({ queryKey: ['vsm-map', selectedMapId] });
      setEditingName(false);
    },
  });

  const deleteNode = useMutation({
    mutationFn: ({ mapId, nodeId }: { mapId: string; nodeId: string }) =>
      vsmApi.deleteNode(mapId, nodeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vsm-map', selectedMapId] });
      setSelectedNodeId(null);
    },
  });

  const moveNode = useMutation({
    mutationFn: ({ mapId, nodeIds }: { mapId: string; nodeIds: string[] }) =>
      vsmApi.reorderNodes(mapId, nodeIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vsm-map', selectedMapId] }),
  });

  const promote = useMutation({
    mutationFn: (id: string) => vsmApi.promote(id),
    onSuccess: () => {
      setPromoteError(null);
      qc.invalidateQueries({ queryKey: ['vsm-map', selectedMapId] });
      qc.invalidateQueries({ queryKey: ['vsm-maps'] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? 'Promotion failed.';
      setPromoteError(msg);
    },
  });

  // ── Computed ──────────────────────────────────────────────────────────────────

  const nodes: VSMNode[] = activeMap?.nodes ?? [];
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  function handleSelectNode(id: string) {
    setSelectedNodeId((prev) => (prev === id ? null : id));
    setShowAddNode(false);
  }

  function handleMoveLeft() {
    if (!selectedNode || !activeMap) return;
    const sorted = [...nodes].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((n) => n.id === selectedNode.id);
    if (idx <= 0) return;
    const newOrder = sorted.map((n) => n.id);
    [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
    moveNode.mutate({ mapId: activeMap.id, nodeIds: newOrder });
  }

  function handleMoveRight() {
    if (!selectedNode || !activeMap) return;
    const sorted = [...nodes].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((n) => n.id === selectedNode.id);
    if (idx >= sorted.length - 1) return;
    const newOrder = sorted.map((n) => n.id);
    [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
    moveNode.mutate({ mapId: activeMap.id, nodeIds: newOrder });
  }

  function startRename() {
    setNameInput(activeMap?.name ?? '');
    setEditingName(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  }

  function submitRename(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMapId || !nameInput.trim()) return;
    renameMap.mutate({ id: selectedMapId, name: nameInput.trim() });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 overflow-hidden" style={{ height: 'calc(100vh - 60px)' }}>

      {/* ── Left sidebar: map list ─────────────────────────────────────────── */}
      <aside className="w-[240px] flex-shrink-0 border-r border-border flex flex-col bg-background">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitFork size={15} className="text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Maps</h2>
            </div>
            <button
              onClick={() => setShowNewMapForm((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="New map"
            >
              <Plus size={15} />
            </button>
          </div>

          {showNewMapForm && (
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (newMapName.trim()) createMap.mutate(newMapName.trim());
              }}
            >
              <input
                autoFocus
                className="input text-xs flex-1 py-1"
                placeholder="Map name…"
                value={newMapName}
                onChange={(e) => setNewMapName(e.target.value)}
              />
              <button type="submit" disabled={!newMapName.trim() || createMap.isPending}
                className="btn-primary text-xs px-2 py-1">
                Add
              </button>
            </form>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-1">
          {mapsLoading && (
            <p className="text-xs text-muted-foreground px-4 py-3 animate-pulse">Loading…</p>
          )}
          {!mapsLoading && maps.length === 0 && (
            <p className="text-xs text-muted-foreground px-4 py-4">
              No maps yet. Click <strong>+</strong> to create one.
            </p>
          )}
          {maps.map((m) => (
            <button
              key={m.id}
              onClick={() => { setSelectedMapId(m.id); setSelectedNodeId(null); setShowAddNode(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                m.id === selectedMapId
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-accent'
              }`}
            >
              <div className="font-medium truncate">{m.name}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {m._count?.nodes ?? 0} nodes · {new Date(m.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main canvas area ───────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">

        {!selectedMapId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <GitFork size={40} className="opacity-20" />
            <p className="text-sm">Select a map from the list, or create a new one.</p>
            <button
              onClick={() => setShowNewMapForm(true)}
              className="btn-primary text-sm px-4 py-2 flex items-center gap-2"
            >
              <Plus size={14} /> New Map
            </button>
          </div>
        ) : (
          <>
            {/* Map header */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
              {editingName ? (
                <form onSubmit={submitRename} className="flex items-center gap-2 flex-1">
                  <input
                    ref={nameRef}
                    className="input text-sm font-semibold flex-1 max-w-xs"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                  />
                  <button type="submit" disabled={renameMap.isPending}
                    className="btn-primary text-xs px-2.5 py-1.5 flex items-center gap-1">
                    <Save size={11} /> Save
                  </button>
                  <button type="button" onClick={() => setEditingName(false)}
                    className="btn-ghost text-xs px-2.5 py-1.5">Cancel</button>
                </form>
              ) : (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <h1 className="text-lg font-semibold text-foreground truncate">
                    {activeMap?.name ?? '…'}
                  </h1>
                  <button onClick={startRename} className="text-muted-foreground hover:text-foreground"
                    title="Rename map">
                    <PencilLine size={13} />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Promote button */}
                <button
                  onClick={() => { setPromoteError(null); promote.mutate(selectedMapId); }}
                  disabled={promote.isPending}
                  title="Auto-populate from work centers"
                  className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <Sparkles size={12} className="text-violet-500" />
                  {promote.isPending ? 'Promoting…' : 'Promote from Work Centers'}
                </button>

                {/* Add node */}
                <button
                  onClick={() => { setShowAddNode((v) => !v); setSelectedNodeId(null); }}
                  className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <Plus size={12} />
                  Add Node
                </button>

                {/* Delete map */}
                <button
                  onClick={() => {
                    if (window.confirm(`Delete map "${activeMap?.name}"? This cannot be undone.`)) {
                      deleteMap.mutate(selectedMapId);
                    }
                  }}
                  className="text-muted-foreground hover:text-red-500 transition-colors p-1.5"
                  title="Delete map"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Promote error */}
            {promoteError && (
              <div className="mx-5 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
                <Info size={12} />
                {promoteError}
                <button onClick={() => setPromoteError(null)} className="ml-auto"><X size={11} /></button>
              </div>
            )}

            {/* Canvas */}
            <div className="flex-1 overflow-auto px-5 py-4 min-h-0">
              {mapLoading ? (
                <div className="text-sm text-muted-foreground animate-pulse">Loading map…</div>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="p-4 bg-white">
                    <VSMCanvas
                      nodes={[...nodes].sort((a, b) => a.position - b.position)}
                      selectedId={selectedNodeId}
                      onSelect={handleSelectNode}
                    />
                  </div>
                  <MetricsBar nodes={nodes} />
                </div>
              )}

              {/* Node toolbar (when a node is selected) */}
              {selectedNode && !showAddNode && (
                <div className="mt-4 rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${NODE_TYPE_META[selectedNode.type].color} ${NODE_TYPE_META[selectedNode.type].text} border ${NODE_TYPE_META[selectedNode.type].border}`}>
                        {NODE_TYPE_META[selectedNode.type].label}
                      </span>
                      <span className="font-semibold text-foreground">{selectedNode.label}</span>
                      {selectedNode.promotedFromId && (
                        <span className="text-[10px] text-violet-500 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
                          Promoted from WC
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={handleMoveLeft} title="Move left" disabled={moveNode.isPending}
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground">
                        <ChevronLeft size={14} />
                      </button>
                      <button onClick={handleMoveRight} title="Move right" disabled={moveNode.isPending}
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground">
                        <ChevronRight size={14} />
                      </button>
                      <button
                        onClick={() => { setShowAddNode(true); }}
                        title="Edit node"
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground"
                      >
                        <PencilLine size={14} />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Remove node "${selectedNode.label}"?`)) {
                            deleteNode.mutate({ mapId: selectedMapId, nodeId: selectedNode.id });
                          }
                        }}
                        className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500"
                        title="Delete node"
                      >
                        <Trash2 size={14} />
                      </button>
                      <button onClick={() => setSelectedNodeId(null)}
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground">
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Node metrics read-only summary */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-xs">
                    {[
                      ['Cycle Time', fmtTime(selectedNode.cycleTimeSec)],
                      ['Changeover', fmtTime(selectedNode.changeOverSec)],
                      ['Uptime', selectedNode.uptimePct != null ? `${selectedNode.uptimePct}%` : '—'],
                      ['Operators', selectedNode.operatorCount ?? '—'],
                      ['Batch Size', selectedNode.batchSize ?? '—'],
                      ['Wait Before', fmtTime(selectedNode.waitTimeSec)],
                    ].map(([label, val]) => (
                      <div key={String(label)} className="bg-muted/40 rounded p-2">
                        <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
                        <div className="font-semibold text-foreground mt-0.5">{String(val)}</div>
                      </div>
                    ))}
                  </div>

                  {selectedNode.notes && (
                    <p className="text-xs text-muted-foreground italic">{selectedNode.notes}</p>
                  )}
                </div>
              )}

              {/* Add / Edit node form */}
              {showAddNode && selectedMapId && (
                <div className="mt-4 rounded-xl border border-border bg-card p-4">
                  <NodeEditorPanel
                    mapId={selectedMapId}
                    node={selectedNodeId && showAddNode ? selectedNode : null}
                    onClose={() => { setShowAddNode(false); setSelectedNodeId(null); }}
                  />
                </div>
              )}

              {/* Empty state hint */}
              {!mapLoading && nodes.length === 0 && !showAddNode && (
                <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <BarChart2 size={28} className="opacity-25" />
                    <p>This map has no process nodes yet.</p>
                    <p className="text-xs">
                      Click <strong>Add Node</strong> to build manually, or use{' '}
                      <strong>Promote from Work Centers</strong> to import your shop floor layout automatically.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* ── Right info panel (legend) ──────────────────────────────────────── */}
      <aside className="w-[200px] flex-shrink-0 border-l border-border bg-muted/20 px-4 py-4 hidden xl:block">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Node Types
        </h3>
        <div className="space-y-2">
          {NODE_TYPES.map((t) => {
            const meta = NODE_TYPE_META[t];
            const Icon = meta.icon;
            return (
              <div key={t} className={`flex items-center gap-2 px-2 py-1.5 rounded ${meta.color} border ${meta.border}`}>
                <Icon size={12} className={meta.text} />
                <span className={`text-xs font-medium ${meta.text}`}>{meta.label}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Abbreviations
          </h3>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p><strong>C/T</strong> — Cycle Time</p>
            <p><strong>C/O</strong> — Changeover Time</p>
            <p><strong>Wait</strong> — Queue before step</p>
            <p><strong>Flow Efficiency</strong></p>
            <p className="pl-2">= VA Time ÷ Lead Time</p>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Tips
          </h3>
          <ul className="space-y-2 text-[11px] text-muted-foreground list-disc pl-3">
            <li>Click a node in the canvas to select and edit it.</li>
            <li>Use <strong>Promote</strong> to auto-import your shop floor work centers.</li>
            <li>Move nodes left/right using the arrows.</li>
            <li>Flow Efficiency above 30% is a lean target.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
