import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vsmApi } from '../../services/api';
import { useVSMSync, VSMViewer } from '../../hooks/useVSMSync';
import { useAuthStore } from '../../store/authStore';
import {
  LucideIcon,
  GitFork, Plus, Trash2, Save, X, BarChart2,
  Factory, Package, Truck, Users, Sparkles,
  PencilLine, Wifi, WifiOff, Brain, Loader2,
  ZoomIn, ZoomOut, Maximize2, Info, ChevronDown, ChevronUp,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface NodePos { x: number; y: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(sec: number | null | undefined): string {
  if (sec == null) return '—';
  if (sec === 0) return '0s';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) { const m = Math.floor(sec / 60); const s = sec % 60; return s ? `${m}m ${s}s` : `${m}m`; }
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function computeMetrics(nodes: VSMNode[]) {
  const proc = nodes.filter((n) => n.type === 'PROCESS' || n.type === 'SHIPPING');
  const totalCycleSec = proc.reduce((s, n) => s + (n.cycleTimeSec ?? 0), 0);
  const totalWaitSec = nodes.reduce((s, n) => s + (n.waitTimeSec ?? 0), 0);
  const totalLeadSec = totalCycleSec + totalWaitSec;
  const efficiency = totalLeadSec > 0 ? ((totalCycleSec / totalLeadSec) * 100).toFixed(1) : null;
  return { totalCycleSec, totalWaitSec, totalLeadSec, efficiency };
}

// Position stored as JSON prefix inside notes: {"_x":200,"_y":150}
function parseNodePos(notes: string | null): NodePos | null {
  if (!notes) return null;
  const m = notes.match(/^\{"_x":(-?\d+(?:\.\d+)?),"_y":(-?\d+(?:\.\d+)?)\}/);
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
}

function encodeNotesWithPos(pos: NodePos, notes: string | null): string {
  const clean = notes?.replace(/^\{"_x":.*?\}[ ]?/, '').trim() ?? '';
  const prefix = `{"_x":${Math.round(pos.x)},"_y":${Math.round(pos.y)}}`;
  return clean ? `${prefix} ${clean}` : prefix;
}

function stripPosFromNotes(notes: string | null): string {
  return notes?.replace(/^\{"_x":.*?\}[ ]?/, '').trim() ?? '';
}

// ── Node type config ──────────────────────────────────────────────────────────

const NODE_TYPE_META: Record<NodeType, {
  label: string;
  color: string;
  border: string;
  text: string;
  headerBg: string;
  icon: LucideIcon;
  description: string;
  hint: string;
}> = {
  SUPPLIER: {
    label: 'Supplier',
    color: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-800',
    headerBg: 'bg-amber-100',
    icon: Factory,
    description: 'An external entity that provides raw materials or components to start your value stream.',
    hint: 'e.g. Steel mill, distributor, raw material vendor. Define delivery frequency, lead time, and reliability.',
  },
  PROCESS: {
    label: 'Process',
    color: 'bg-blue-50',
    border: 'border-blue-300',
    text: 'text-blue-800',
    headerBg: 'bg-blue-100',
    icon: GitFork,
    description: 'A value-adding manufacturing or service step that transforms materials or information.',
    hint: 'e.g. Laser Cutting, Welding, Forming, Assembly. Capture cycle time, changeover, operator count, and uptime to identify bottlenecks.',
  },
  INVENTORY: {
    label: 'Inventory',
    color: 'bg-violet-50',
    border: 'border-violet-300',
    text: 'text-violet-800',
    headerBg: 'bg-violet-100',
    icon: Package,
    description: 'A holding point where materials wait between steps — raw materials, WIP, or finished goods.',
    hint: 'High inventory between steps signals a bottleneck or overproduction upstream. Use wait time to quantify queue depth.',
  },
  SHIPPING: {
    label: 'Shipping',
    color: 'bg-green-50',
    border: 'border-green-300',
    text: 'text-green-800',
    headerBg: 'bg-green-100',
    icon: Truck,
    description: 'Outbound logistics — packing, dispatch, and transport activities delivering product to the customer.',
    hint: 'Measure delivery frequency and transport lead time. Inconsistent shipping is a lean waste target.',
  },
  CUSTOMER: {
    label: 'Customer',
    color: 'bg-teal-50',
    border: 'border-teal-300',
    text: 'text-teal-800',
    headerBg: 'bg-teal-100',
    icon: Users,
    description: 'The end recipient of your product or service. Their demand rate (takt time) drives the entire value stream.',
    hint: 'Define demand rate, order frequency, and any special delivery requirements. Always map to a real customer segment.',
  },
};

const NODE_TYPES: NodeType[] = ['SUPPLIER', 'PROCESS', 'INVENTORY', 'SHIPPING', 'CUSTOMER'];
const NODE_W = 200;
const NODE_H = 130;

// ── Form helpers ──────────────────────────────────────────────────────────────

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
  type: 'PROCESS', label: '',
  cycleTimeSec: '', changeOverSec: '', uptimePct: '',
  operatorCount: '', batchSize: '', waitTimeSec: '', notes: '',
});

function nodeToForm(n: VSMNode): NodeFormState {
  return {
    type: n.type,
    label: n.label,
    cycleTimeSec:  n.cycleTimeSec  != null ? String(n.cycleTimeSec)  : '',
    changeOverSec: n.changeOverSec != null ? String(n.changeOverSec) : '',
    uptimePct:     n.uptimePct     != null ? String(n.uptimePct)     : '',
    operatorCount: n.operatorCount != null ? String(n.operatorCount) : '',
    batchSize:     n.batchSize     != null ? String(n.batchSize)     : '',
    waitTimeSec:   n.waitTimeSec   != null ? String(n.waitTimeSec)   : '',
    notes: stripPosFromNotes(n.notes),
  };
}

function formToPayload(f: NodeFormState, existingNotes: string | null) {
  const existingPos = parseNodePos(existingNotes);
  const cleanNotes = f.notes.trim() || null;
  const finalNotes = existingPos ? encodeNotesWithPos(existingPos, cleanNotes) : cleanNotes;
  return {
    type: f.type,
    label: f.label.trim(),
    cycleTimeSec:  f.cycleTimeSec  !== '' ? parseInt(f.cycleTimeSec)  : null,
    changeOverSec: f.changeOverSec !== '' ? parseInt(f.changeOverSec) : null,
    uptimePct:     f.uptimePct     !== '' ? parseFloat(f.uptimePct)   : null,
    operatorCount: f.operatorCount !== '' ? parseInt(f.operatorCount) : null,
    batchSize:     f.batchSize     !== '' ? parseInt(f.batchSize)     : null,
    waitTimeSec:   f.waitTimeSec   !== '' ? parseInt(f.waitTimeSec)   : null,
    notes: finalNotes,
  };
}

// ── Node Arrows (SVG) ─────────────────────────────────────────────────────────

function NodeArrows({ sortedNodes, positions }: { sortedNodes: VSMNode[]; positions: Record<string, NodePos> }) {
  const arrows: React.ReactNode[] = [];

  for (let i = 0; i < sortedNodes.length - 1; i++) {
    const from = positions[sortedNodes[i].id];
    const to   = positions[sortedNodes[i + 1].id];
    if (!from || !to) continue;

    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const cp = Math.max(Math.abs(x2 - x1) * 0.4, 40);
    const d  = `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${x2 - cp} ${y2}, ${x2} ${y2}`;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 - 14;
    const wait = sortedNodes[i].waitTimeSec;

    arrows.push(
      <g key={`arrow-${i}`}>
        <path d={d} fill="none" stroke="#94a3b8" strokeWidth={1.5} markerEnd="url(#arrowhead)" />
        {wait != null && wait > 0 && (
          <>
            <rect x={midX - 22} y={midY - 9} width={44} height={13} rx={3} fill="white" stroke="#e2e8f0" strokeWidth={1} />
            <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#64748b">{fmtTime(wait)}</text>
          </>
        )}
      </g>
    );
  }

  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none', width: 1, height: 1 }}>
      <defs>
        <marker id="arrowhead" markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
        </marker>
      </defs>
      {arrows}
    </svg>
  );
}

// ── Node Bubble ───────────────────────────────────────────────────────────────

function NodeBubble({
  node, pos, isSelected,
}: {
  node: VSMNode;
  pos: NodePos;
  isSelected: boolean;
}) {
  const meta = NODE_TYPE_META[node.type];
  const Icon = meta.icon;
  const hasMetrics = node.cycleTimeSec != null || node.operatorCount != null ||
    node.uptimePct != null || node.batchSize != null;

  return (
    <div
      data-node-id={node.id}
      style={{ position: 'absolute', left: pos.x, top: pos.y, width: NODE_W, cursor: 'grab', userSelect: 'none' }}
      className={`rounded-xl border-2 shadow-lg transition-shadow ${meta.color} ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-300 ring-offset-1 shadow-blue-100' : meta.border
      }`}
    >
      {/* Header */}
      <div className={`${meta.headerBg} px-2.5 py-1.5 rounded-t-[10px] flex items-center gap-1.5`}>
        <Icon size={11} className={meta.text} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.text}`}>{meta.label}</span>
        {node.promotedFromId && (
          <span className="ml-auto text-violet-500 text-[9px] font-semibold">★ WC</span>
        )}
      </div>

      {/* Label */}
      <div className={`px-3 py-2 font-semibold text-sm leading-tight ${meta.text}`}>
        {node.label.length > 24 ? `${node.label.slice(0, 22)}…` : node.label}
      </div>

      {/* Metrics */}
      {hasMetrics && (
        <div className="px-3 pb-2.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
          {node.cycleTimeSec  != null && <span className="text-[10px] text-slate-500">C/T: {fmtTime(node.cycleTimeSec)}</span>}
          {node.changeOverSec != null && <span className="text-[10px] text-slate-500">C/O: {fmtTime(node.changeOverSec)}</span>}
          {node.uptimePct     != null && <span className="text-[10px] text-slate-500">Up: {node.uptimePct}%</span>}
          {node.operatorCount != null && <span className="text-[10px] text-slate-500">Ops: {node.operatorCount}</span>}
          {node.batchSize     != null && <span className="text-[10px] text-slate-500">Batch: {node.batchSize}</span>}
        </div>
      )}

      {!hasMetrics && <div className="pb-3" />}

      {isSelected && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-blue-600 font-medium whitespace-nowrap bg-white px-2 py-0.5 rounded-full border border-blue-200 shadow-sm">
          Click to edit
        </div>
      )}
    </div>
  );
}

// ── Miro Board Canvas ─────────────────────────────────────────────────────────

function MiroBoard({
  nodes, mapId, selectedNodeId, onSelectNode,
}: {
  nodes: VSMNode[];
  mapId: string;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan]   = useState({ x: 100, y: 100 });
  const [zoom, setZoom] = useState(1);
  const [positions, setPositions] = useState<Record<string, NodePos>>({});

  const dragRef = useRef<{
    type: 'pan' | 'node';
    nodeId?: string;
    startCX: number; startCY: number;
    startPanX: number; startPanY: number;
    startNodeX?: number; startNodeY?: number;
    moved: boolean;
  } | null>(null);

  const updateNode = useMutation({
    mutationFn: ({ nodeId, data }: { nodeId: string; data: object }) =>
      vsmApi.updateNode(mapId, nodeId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vsm-map', mapId] }),
  });

  // Initialise positions from stored notes or auto-layout
  useEffect(() => {
    setPositions((prev) => {
      const sorted = [...nodes].sort((a, b) => a.position - b.position);
      const next: Record<string, NodePos> = {};
      sorted.forEach((node, i) => {
        if (prev[node.id]) {
          next[node.id] = prev[node.id];
        } else {
          const stored = parseNodePos(node.notes);
          next[node.id] = stored ?? { x: 80 + i * 240, y: 160 };
        }
      });
      return next;
    });
  }, [nodes.map((n) => n.id).join(',')]);

  // Wheel zoom toward cursor
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => {
      const nz = Math.min(3, Math.max(0.2, z * factor));
      const sf = nz / z;
      setPan((p) => ({ x: mx - sf * (mx - p.x), y: my - sf * (my - p.y) }));
      return nz;
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Unified pointer handler — distinguishes node drag from canvas pan
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const nodeEl = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null;

    e.currentTarget.setPointerCapture(e.pointerId);

    if (nodeEl) {
      const nodeId = nodeEl.dataset.nodeId!;
      const pos = positions[nodeId] ?? { x: 0, y: 0 };
      dragRef.current = {
        type: 'node', nodeId,
        startCX: e.clientX, startCY: e.clientY,
        startPanX: pan.x, startPanY: pan.y,
        startNodeX: pos.x, startNodeY: pos.y,
        moved: false,
      };
    } else {
      dragRef.current = {
        type: 'pan',
        startCX: e.clientX, startCY: e.clientY,
        startPanX: pan.x, startPanY: pan.y,
        moved: false,
      };
    }
  }, [positions, pan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dxC = e.clientX - d.startCX;
    const dyC = e.clientY - d.startCY;
    if (Math.hypot(dxC, dyC) > 3) d.moved = true;

    if (d.type === 'pan') {
      setPan({ x: d.startPanX + dxC, y: d.startPanY + dyC });
    } else if (d.type === 'node' && d.nodeId && d.moved) {
      const dx = dxC / zoom;
      const dy = dyC / zoom;
      setPositions((prev) => ({
        ...prev,
        [d.nodeId!]: { x: (d.startNodeX ?? 0) + dx, y: (d.startNodeY ?? 0) + dy },
      }));
    }
  }, [zoom]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;

    if (d.type === 'node' && d.nodeId) {
      if (!d.moved) {
        // Click — toggle selection
        onSelectNode(selectedNodeId === d.nodeId ? null : d.nodeId);
      } else {
        // Drag end — persist position
        const pos = positions[d.nodeId];
        const node = nodes.find((n) => n.id === d.nodeId);
        if (pos && node) {
          updateNode.mutate({ nodeId: d.nodeId, data: { notes: encodeNotesWithPos(pos, node.notes) } });
        }
      }
    } else if (d.type === 'pan' && !d.moved) {
      onSelectNode(null); // Deselect on canvas click
    }
  }, [selectedNodeId, positions, nodes, onSelectNode, updateNode]);

  function fitToView() {
    if (!nodes.length || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xs = nodes.map((n) => positions[n.id]?.x ?? 0);
    const ys = nodes.map((n) => positions[n.id]?.y ?? 0);
    const minX = Math.min(...xs); const minY = Math.min(...ys);
    const maxX = Math.max(...xs) + NODE_W; const maxY = Math.max(...ys) + NODE_H;
    const cw = maxX - minX; const ch = maxY - minY;
    const newZoom = Math.min(0.85 * rect.width / cw, 0.85 * rect.height / ch, 2);
    setZoom(newZoom);
    setPan({
      x: (rect.width  - cw * newZoom) / 2 - minX * newZoom,
      y: (rect.height - ch * newZoom) / 2 - minY * newZoom,
    });
  }

  const sortedNodes = [...nodes].sort((a, b) => a.position - b.position);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden select-none"
      style={{
        flex: 1,
        cursor: dragRef.current?.type === 'pan' ? 'grabbing' : 'default',
        backgroundImage: 'radial-gradient(circle, #cbd5e1 1.5px, transparent 1.5px)',
        backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
        backgroundPosition: `${pan.x % (28 * zoom)}px ${pan.y % (28 * zoom)}px`,
        backgroundColor: '#f8fafc',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {/* Transform layer */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }}>
        <NodeArrows sortedNodes={sortedNodes} positions={positions} />
        {nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;
          return (
            <NodeBubble
              key={node.id}
              node={node}
              pos={pos}
              isSelected={node.id === selectedNodeId}
            />
          );
        })}
      </div>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-3 pointer-events-none">
          <BarChart2 size={40} className="opacity-15" />
          <p className="text-sm">Add a node to start mapping your value stream.</p>
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-4 left-4 flex flex-col bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <button onClick={() => setZoom((z) => Math.min(3, z * 1.2))} className="p-2 hover:bg-accent text-muted-foreground" title="Zoom in">
          <ZoomIn size={13} />
        </button>
        <div className="px-1.5 py-1 text-[10px] text-muted-foreground text-center border-y border-border">
          {Math.round(zoom * 100)}%
        </div>
        <button onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))} className="p-2 hover:bg-accent text-muted-foreground" title="Zoom out">
          <ZoomOut size={13} />
        </button>
        <button onClick={fitToView} className="p-2 hover:bg-accent text-muted-foreground" title="Fit to view">
          <Maximize2 size={13} />
        </button>
      </div>

      {/* Hint */}
      <div className="absolute bottom-4 right-4 text-[10px] text-muted-foreground bg-white/80 px-2 py-1 rounded border border-border">
        Drag to move · Scroll to zoom · Click node to edit
      </div>
    </div>
  );
}

// ── Right-side Properties Panel ───────────────────────────────────────────────

function NodePanel({
  mapId,
  mode,
  node,
  onClose,
}: {
  mapId: string;
  mode: 'add' | 'edit';
  node: VSMNode | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<NodeFormState>(node ? nodeToForm(node) : emptyForm());
  const [showTypeDesc, setShowTypeDesc] = useState<NodeType | null>(mode === 'add' ? 'PROCESS' : null);

  const addMutation = useMutation({
    mutationFn: (data: object) => vsmApi.addNode(mapId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vsm-map', mapId] }); onClose(); },
  });
  const updateMutation = useMutation({
    mutationFn: (data: object) => vsmApi.updateNode(mapId, node!.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vsm-map', mapId] }); onClose(); },
  });
  const deleteMutation = useMutation({
    mutationFn: () => vsmApi.deleteNode(mapId, node!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vsm-map', mapId] }); onClose(); },
  });

  function set(field: keyof NodeFormState, val: string) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) return;
    const payload = formToPayload(form, node?.notes ?? null);
    if (mode === 'edit') updateMutation.mutate(payload);
    else addMutation.mutate(payload);
  }

  const busy = addMutation.isPending || updateMutation.isPending;
  const meta = NODE_TYPE_META[form.type];

  return (
    <div className="w-[300px] flex-shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">
          {mode === 'add' ? 'Add Node' : `Edit: ${node?.label ?? ''}`}
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Node type selector */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Node Type
          </label>
          <div className="space-y-1.5">
            {NODE_TYPES.map((t) => {
              const m = NODE_TYPE_META[t];
              const Icon = m.icon;
              const isActive = form.type === t;
              return (
                <div key={t}>
                  <button
                    type="button"
                    onClick={() => { set('type', t); setShowTypeDesc(showTypeDesc === t ? null : t); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm ${
                      isActive
                        ? `${m.color} ${m.border} ${m.text} font-semibold shadow-sm`
                        : 'bg-muted/40 border-border text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <Icon size={13} />
                    <span>{m.label}</span>
                    <span className="ml-auto opacity-50">
                      {showTypeDesc === t ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </span>
                  </button>
                  {showTypeDesc === t && (
                    <div className={`mt-1 px-3 py-2 rounded-lg ${m.color} border ${m.border} text-[11px] ${m.text} space-y-1`}>
                      <p>{m.description}</p>
                      <p className="opacity-70 italic">{m.hint}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Label */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Label *</label>
            <input
              className="input text-sm w-full"
              placeholder={`e.g. ${form.type === 'PROCESS' ? 'CNC Cutting' : form.type === 'SUPPLIER' ? 'Steel Mill' : meta.label}`}
              value={form.label}
              onChange={(e) => set('label', e.target.value)}
              required
            />
          </div>

          {/* Metric fields */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Cycle Time (sec)</label>
              <input className="input text-sm w-full" type="number" min={0} placeholder="120"
                value={form.cycleTimeSec} onChange={(e) => set('cycleTimeSec', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Changeover (sec)</label>
              <input className="input text-sm w-full" type="number" min={0} placeholder="300"
                value={form.changeOverSec} onChange={(e) => set('changeOverSec', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Uptime %</label>
              <input className="input text-sm w-full" type="number" min={0} max={100} placeholder="85"
                value={form.uptimePct} onChange={(e) => set('uptimePct', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Operators</label>
              <input className="input text-sm w-full" type="number" min={0} placeholder="2"
                value={form.operatorCount} onChange={(e) => set('operatorCount', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Batch Size</label>
              <input className="input text-sm w-full" type="number" min={1} placeholder="50"
                value={form.batchSize} onChange={(e) => set('batchSize', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Wait Before (sec)</label>
              <input className="input text-sm w-full" type="number" min={0} placeholder="3600"
                value={form.waitTimeSec} onChange={(e) => set('waitTimeSec', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Notes</label>
            <textarea className="input text-sm w-full" rows={2} placeholder="Optional notes…"
              value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy || !form.label.trim()}
              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 flex-1">
              <Save size={12} />
              {busy ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Add Node'}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost text-xs px-3 py-1.5">
              Cancel
            </button>
          </div>

          {mode === 'edit' && node && (
            <div className="pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => { if (window.confirm(`Remove "${node.label}"?`)) deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
                className="w-full text-xs text-red-500 hover:text-red-600 hover:bg-red-50 py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Trash2 size={12} />
                {deleteMutation.isPending ? 'Deleting…' : 'Delete Node'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

// ── Metrics Bar ───────────────────────────────────────────────────────────────

function MetricsBar({ nodes }: { nodes: VSMNode[] }) {
  const { totalCycleSec, totalWaitSec, totalLeadSec, efficiency } = computeMetrics(nodes);
  const processCount = nodes.filter((n) => n.type === 'PROCESS').length;

  return (
    <div className="flex flex-wrap gap-6 items-center px-5 py-2.5 bg-muted/40 border-t border-border text-xs flex-shrink-0">
      <Metric label="Process Steps" value={String(processCount)} />
      <Metric label="Lead Time" value={fmtTime(totalLeadSec)} />
      <Metric label="Value-Added" value={fmtTime(totalCycleSec)} highlight />
      <Metric label="Queue / Wait" value={fmtTime(totalWaitSec)} />
      {efficiency && (
        <>
          <Metric label="Flow Efficiency" value={`${efficiency}%`} highlight={parseFloat(efficiency) > 20} />
          <div className="flex items-center gap-2 flex-1 min-w-24">
            <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(parseFloat(efficiency), 100)}%` }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className={`font-semibold ${highlight ? 'text-blue-600' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

// ── Presence Avatars ──────────────────────────────────────────────────────────

const AVATAR_COLORS = ['bg-violet-500', 'bg-blue-500', 'bg-teal-500', 'bg-orange-500', 'bg-pink-500'];
function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

function PresenceAvatars({ viewers, isConnected }: { viewers: VSMViewer[]; isConnected: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span title={isConnected ? 'Live sync active' : 'Connecting…'}>
        {isConnected
          ? <Wifi size={12} className="text-green-500" />
          : <WifiOff size={12} className="text-muted-foreground animate-pulse" />}
      </span>
      {viewers.length > 0 && (
        <div className="flex -space-x-1.5">
          {viewers.slice(0, 4).map((v, i) => (
            <div key={v.userId} title={`${v.userName} is viewing`}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
              {initials(v.userName)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AI Analysis Panel ─────────────────────────────────────────────────────────

function AIAnalysisPanel({ mapId, nodes, onClose }: {
  mapId: string;
  nodes: VSMNode[];
  onClose: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  async function runAnalysis() {
    setStatus('loading');
    setResult('');
    setError('');
    try {
      const token = useAuthStore.getState().accessToken ?? '';
      const res = await fetch(`/api/v1/vsm/${mapId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
      }

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; text?: string; chunk?: string; error?: string };
            if (evt.type === 'chunk' && evt.chunk) { accumulated += evt.chunk; setResult(accumulated); }
            if (evt.type === 'done') { if (evt.text) { accumulated = evt.text; setResult(evt.text); } setStatus('done'); }
            if (evt.type === 'error') throw new Error(evt.error ?? 'Analysis failed');
          } catch (parseErr) {
            if ((parseErr as Error).message !== 'Unexpected end of JSON input') throw parseErr;
          }
        }
      }
      if (status !== 'done') setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  return (
    <div className="border-t border-border flex flex-col flex-shrink-0" style={{ maxHeight: 340 }}>
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-gradient-to-r from-violet-50 to-blue-50 border-b border-border">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-violet-500" />
          <span className="text-sm font-semibold text-foreground">AI Value Stream Analysis</span>
        </div>
        <div className="flex items-center gap-2">
          {(status === 'idle' || status === 'done' || status === 'error') && (
            <button
              onClick={runAnalysis}
              disabled={nodes.length === 0}
              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              <Sparkles size={11} />
              {status === 'done' ? 'Re-Analyze' : 'Analyze VSM'}
            </button>
          )}
          {status === 'loading' && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Analyzing…
            </div>
          )}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-3 text-sm text-foreground bg-white">
        {status === 'idle' && (
          <p className="text-muted-foreground text-sm">
            Click <strong>Analyze VSM</strong> to get AI-powered lean analysis and recommendations for this value stream.
          </p>
        )}
        {status === 'error' && (
          <p className="text-red-600 text-sm flex items-start gap-2">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            {error}
          </p>
        )}
        {(status === 'loading' || status === 'done') && result && (
          <div className="prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed">
            {result}
          </div>
        )}
        {status === 'loading' && !result && (
          <div className="space-y-2 animate-pulse">
            <div className="h-3 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-5/6" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ValueStreamMapPage() {
  const qc = useQueryClient();
  const [selectedMapId, setSelectedMapId]   = useState<string | null>(null);
  const { viewers, isConnected }             = useVSMSync(selectedMapId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelMode, setPanelMode]           = useState<'add' | 'edit' | null>(null);
  const [showAI, setShowAI]                 = useState(false);
  const [newMapName, setNewMapName]         = useState('');
  const [showNewMapForm, setShowNewMapForm] = useState(false);
  const [promoteError, setPromoteError]     = useState<string | null>(null);
  const [editingName, setEditingName]       = useState(false);
  const [nameInput, setNameInput]           = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: maps = [], isLoading: mapsLoading } = useQuery<VSMMap[]>({
    queryKey: ['vsm-maps'],
    queryFn: () => vsmApi.listMaps().then((r) => r.data),
  });

  const { data: activeMap, isLoading: mapLoading } = useQuery<VSMMap>({
    queryKey: ['vsm-map', selectedMapId],
    queryFn: () => vsmApi.getMap(selectedMapId!).then((r) => r.data),
    enabled: !!selectedMapId,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMap = useMutation({
    mutationFn: (name: string) => vsmApi.createMap({ name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['vsm-maps'] });
      setSelectedMapId(res.data.id);
      setNewMapName(''); setShowNewMapForm(false);
    },
  });

  const deleteMap = useMutation({
    mutationFn: (id: string) => vsmApi.deleteMap(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vsm-maps'] });
      setSelectedMapId(null); setSelectedNodeId(null); setPanelMode(null);
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

  const promote = useMutation({
    mutationFn: (id: string) => vsmApi.promote(id),
    onSuccess: () => {
      setPromoteError(null);
      qc.invalidateQueries({ queryKey: ['vsm-map', selectedMapId] });
      qc.invalidateQueries({ queryKey: ['vsm-maps'] });
    },
    onError: (err: any) => setPromoteError(err?.response?.data?.error ?? 'Promotion failed.'),
  });

  const seedExamples = useMutation({
    mutationFn: () => vsmApi.seedExamples(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['vsm-maps'] });
      const first = (res.data as any[])?.[0];
      if (first?.id) setSelectedMapId(first.id);
    },
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const nodes: VSMNode[] = activeMap?.nodes ?? [];
  const selectedNode     = nodes.find((n) => n.id === selectedNodeId) ?? null;

  function handleSelectNode(id: string | null) {
    setSelectedNodeId(id);
    if (id) {
      setPanelMode('edit');
    } else {
      if (panelMode === 'edit') setPanelMode(null);
    }
  }

  function handleAddNode() {
    setSelectedNodeId(null);
    setPanelMode('add');
  }

  function handleClosePanel() {
    setPanelMode(null);
    setSelectedNodeId(null);
  }

  function startRename() {
    setNameInput(activeMap?.name ?? '');
    setEditingName(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 overflow-hidden" style={{ height: 'calc(100vh - 60px)' }}>

      {/* Left sidebar: map list */}
      <aside className="w-[220px] flex-shrink-0 border-r border-border flex flex-col bg-background">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitFork size={14} className="text-primary" />
              <h2 className="text-sm font-semibold">Maps</h2>
            </div>
            <button onClick={() => setShowNewMapForm((v) => !v)}
              className="text-muted-foreground hover:text-foreground" title="New map">
              <Plus size={14} />
            </button>
          </div>
          {showNewMapForm && (
            <form className="mt-2 flex gap-1.5" onSubmit={(e) => {
              e.preventDefault();
              if (newMapName.trim()) createMap.mutate(newMapName.trim());
            }}>
              <input autoFocus className="input text-xs flex-1 py-1" placeholder="Map name…"
                value={newMapName} onChange={(e) => setNewMapName(e.target.value)} />
              <button type="submit" disabled={!newMapName.trim() || createMap.isPending}
                className="btn-primary text-xs px-2 py-1">Add</button>
            </form>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-1">
          {mapsLoading && <p className="text-xs text-muted-foreground px-4 py-3 animate-pulse">Loading…</p>}
          {!mapsLoading && maps.length === 0 && (
            <p className="text-xs text-muted-foreground px-4 pt-4">No maps yet. Click <strong>+</strong> to create one.</p>
          )}
          {!mapsLoading && (
            <div className="px-4 py-3">
              <button
                onClick={() => seedExamples.mutate()}
                disabled={seedExamples.isPending}
                className="w-full text-xs px-3 py-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center justify-center gap-1.5"
              >
                <Sparkles size={11} />
                {seedExamples.isPending ? 'Loading…' : 'Load Steel Examples'}
              </button>
            </div>
          )}
          {maps.map((m) => (
            <button key={m.id}
              onClick={() => { setSelectedMapId(m.id); setSelectedNodeId(null); setPanelMode(null); setShowAI(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                m.id === selectedMapId ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-accent'
              }`}>
              <div className="font-medium truncate">{m.name}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {m._count?.nodes ?? 0} nodes · {new Date(m.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <main className="flex-1 flex overflow-hidden min-w-0">
        {!selectedMapId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <GitFork size={40} className="opacity-20" />
            <p className="text-sm">Select a map or create a new one.</p>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowNewMapForm(true)} className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
                <Plus size={14} /> New Map
              </button>
              <button
                onClick={() => seedExamples.mutate()}
                disabled={seedExamples.isPending}
                className="text-sm px-4 py-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center gap-2"
              >
                <Sparkles size={14} />
                {seedExamples.isPending ? 'Loading…' : 'Load Steel Examples'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

            {/* Toolbar */}
            <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border flex-shrink-0 bg-background">
              {editingName ? (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (selectedMapId && nameInput.trim()) renameMap.mutate({ id: selectedMapId, name: nameInput.trim() });
                }} className="flex items-center gap-2 flex-1">
                  <input ref={nameRef} className="input text-sm font-semibold flex-1 max-w-xs"
                    value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
                  <button type="submit" disabled={renameMap.isPending}
                    className="btn-primary text-xs px-2.5 py-1.5 flex items-center gap-1"><Save size={11} /> Save</button>
                  <button type="button" onClick={() => setEditingName(false)}
                    className="btn-ghost text-xs px-2.5 py-1.5">Cancel</button>
                </form>
              ) : (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <h1 className="text-base font-semibold text-foreground truncate">{activeMap?.name ?? '…'}</h1>
                  <button onClick={startRename} className="text-muted-foreground hover:text-foreground p-0.5" title="Rename">
                    <PencilLine size={12} />
                  </button>
                </div>
              )}

              <PresenceAvatars viewers={viewers} isConnected={isConnected} />

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => { setPromoteError(null); promote.mutate(selectedMapId); }}
                  disabled={promote.isPending}
                  className="btn-outline text-xs px-2.5 py-1.5 flex items-center gap-1.5">
                  <Sparkles size={11} className="text-violet-500" />
                  {promote.isPending ? 'Promoting…' : 'Auto-Populate'}
                </button>
                <button onClick={handleAddNode} className="btn-primary text-xs px-2.5 py-1.5 flex items-center gap-1.5">
                  <Plus size={11} /> Add Node
                </button>
                <button
                  onClick={() => setShowAI((v) => !v)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors ${
                    showAI ? 'bg-violet-100 border-violet-300 text-violet-700' : 'btn-outline'
                  }`}
                  title="AI Analysis"
                >
                  <Brain size={11} />
                  AI Analyze
                </button>
                <button
                  onClick={() => { if (window.confirm(`Delete map "${activeMap?.name}"?`)) deleteMap.mutate(selectedMapId); }}
                  className="text-muted-foreground hover:text-red-500 p-1.5 transition-colors" title="Delete map">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Promote error banner */}
            {promoteError && (
              <div className="mx-5 mt-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2 flex-shrink-0">
                <Info size={12} />
                {promoteError}
                <button onClick={() => setPromoteError(null)} className="ml-auto"><X size={11} /></button>
              </div>
            )}

            {/* Canvas + panels */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Canvas */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {mapLoading ? (
                  <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
                    Loading map…
                  </div>
                ) : (
                  <MiroBoard
                    nodes={nodes}
                    mapId={selectedMapId}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                  />
                )}

                <MetricsBar nodes={nodes} />

                {/* AI Analysis Panel */}
                {showAI && (
                  <AIAnalysisPanel
                    mapId={selectedMapId}
                    nodes={nodes}
                    onClose={() => setShowAI(false)}
                  />
                )}
              </div>

              {/* Right properties panel */}
              {panelMode && (
                <NodePanel
                  mapId={selectedMapId}
                  mode={panelMode}
                  node={panelMode === 'edit' ? selectedNode : null}
                  onClose={handleClosePanel}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
