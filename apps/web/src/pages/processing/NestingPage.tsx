import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { nestingApi } from '../../services/api';
import { Layers, Plus, Trash2, Zap, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Piece { lineNumber: number; length: number; qty: number; }

function NestResultBar({ efficiency }: { efficiency: number }) {
  const color = efficiency >= 90 ? 'bg-green-500' : efficiency >= 75 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Material yield</span>
        <span className={`font-bold ${efficiency >= 90 ? 'text-green-600' : efficiency >= 75 ? 'text-amber-600' : 'text-red-600'}`}>
          {efficiency.toFixed(1)}%
        </span>
      </div>
      <div className="w-full bg-steel-100 rounded-full h-3">
        <div className={`h-3 rounded-full transition-all duration-700 ${color}`} style={{ width: `${efficiency}%` }} />
      </div>
    </div>
  );
}

export function NestingPage() {
  const [stockLength, setStockLength] = useState(6000);
  const [stockQty,    setStockQty]    = useState(3);
  const [pieces,      setPieces]      = useState<Piece[]>([
    { lineNumber: 1, length: 2000, qty: 4 },
    { lineNumber: 2, length: 1500, qty: 3 },
  ]);

  const addPiece = () =>
    setPieces((p) => [...p, { lineNumber: p.length + 1, length: 1000, qty: 1 }]);

  const removePiece = (i: number) =>
    setPieces((p) => p.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, lineNumber: idx + 1 })));

  const updatePiece = (i: number, field: keyof Piece, value: number) =>
    setPieces((p) => p.map((x, idx) => (idx === i ? { ...x, [field]: value } : x)));

  const { mutate: runNest, data: result, isPending, error } = useMutation({
    mutationFn: () =>
      nestingApi.createJob({
        type: 'LINEAR',
        stockLength,
        stockQty,
        pieces,
      }).then((r) => r.data),
  });

  const job = result as any;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Nesting Optimisation</h1>
          <p className="page-subtitle">Minimise material waste with the cut optimiser</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Input panel ─────────────────────────────── */}
        <div className="space-y-5">
          {/* Stock parameters */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-sm text-foreground">Stock Configuration</h3>
            </div>
            <div className="card-body space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="label">Stock Length (mm)</label>
                  <input type="number" className="input" value={stockLength}
                    onChange={(e) => setStockLength(Number(e.target.value))} />
                </div>
                <div className="form-group">
                  <label className="label">Qty Available</label>
                  <input type="number" className="input" value={stockQty}
                    onChange={(e) => setStockQty(Number(e.target.value))} />
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-steel-50 border border-dashed border-steel-200">
                <Layers size={13} className="text-steel-400" />
                <span className="text-xs text-muted-foreground">
                  Total material available: <strong>{(stockLength * stockQty).toLocaleString()} mm</strong>
                  {' '}({((stockLength * stockQty) / 1000).toFixed(1)} m)
                </span>
              </div>
            </div>
          </div>

          {/* Cut list */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-sm text-foreground">Cut List</h3>
              <button className="btn-secondary btn-sm" onClick={addPiece}>
                <Plus size={12} /> Add piece
              </button>
            </div>
            <div className="card-body space-y-2">
              {pieces.map((piece, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-steel-50/40">
                  <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {piece.lineNumber}
                  </span>
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div className="form-group">
                      <label className="label text-[11px]">Length (mm)</label>
                      <input type="number" className="input h-8 text-sm" value={piece.length}
                        onChange={(e) => updatePiece(i, 'length', Number(e.target.value))} />
                    </div>
                    <div className="form-group">
                      <label className="label text-[11px]">Qty required</label>
                      <input type="number" className="input h-8 text-sm" value={piece.qty}
                        onChange={(e) => updatePiece(i, 'qty', Number(e.target.value))} />
                    </div>
                  </div>
                  <button className="btn-icon btn-ghost text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removePiece(i)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="card-footer">
              <button
                className="btn-primary w-full"
                onClick={() => runNest()}
                disabled={isPending || pieces.length === 0}
              >
                {isPending
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Optimising…</>
                  : <><Zap size={15} /> Run Optimisation</>}
              </button>
            </div>
          </div>
        </div>

        {/* ── Result panel ────────────────────────────── */}
        <div>
          {error && (
            <div className="card p-5 border-red-200 bg-red-50 flex gap-3 mb-5">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700">Optimisation failed</p>
                <p className="text-xs text-red-600 mt-0.5">{(error as any).message}</p>
              </div>
            </div>
          )}

          {job ? (
            <div className="card space-y-0">
              <div className="card-header">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-green-500" />
                  <h3 className="font-semibold text-sm text-foreground">Optimisation Complete</h3>
                </div>
                <span className="badge-green">{job.efficiency?.toFixed(1)}% efficiency</span>
              </div>
              <div className="card-body space-y-5">
                <NestResultBar efficiency={job.efficiency ?? 0} />

                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Bars Used',   value: job.barsUsed     ?? '—' },
                    { label: 'Total Cuts',  value: job.totalCuts    ?? '—' },
                    { label: 'Scrap (mm)',  value: (job.totalScrap  ?? 0).toLocaleString() },
                  ].map((s) => (
                    <div key={s.label} className="bg-steel-50 rounded-xl p-3 text-center">
                      <div className="text-lg font-bold text-foreground tabular-nums">{s.value}</div>
                      <div className="text-[11px] text-muted-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Cut patterns */}
                {job.patterns && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cut Patterns</h4>
                    {job.patterns.map((pat: any, idx: number) => (
                      <div key={idx} className="border border-border rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-foreground">Bar #{idx + 1}</span>
                          <span className="badge-gray">{pat.scrap}mm scrap</span>
                        </div>
                        <div className="flex gap-1 h-6 rounded overflow-hidden">
                          {pat.cuts?.map((cut: any, ci: number) => {
                            const pct = (cut.length / stockLength) * 100;
                            const colors = ['bg-primary-400','bg-primary-600','bg-blue-400','bg-teal-400','bg-violet-400'];
                            return (
                              <div
                                key={ci}
                                className={`${colors[cut.lineNumber % colors.length]} flex items-center justify-center text-[9px] font-bold text-white overflow-hidden`}
                                style={{ width: `${pct}%` }}
                                title={`Line ${cut.lineNumber}: ${cut.length}mm`}
                              >
                                {pct > 8 ? `${cut.length}` : ''}
                              </div>
                            );
                          })}
                          {/* Scrap remainder */}
                          {pat.scrap > 0 && (
                            <div
                              className="bg-steel-200 flex items-center justify-center text-[9px] text-steel-400 overflow-hidden"
                              style={{ width: `${(pat.scrap / stockLength) * 100}%` }}
                            >
                              {((pat.scrap / stockLength) * 100) > 5 ? 'scrap' : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card h-full min-h-[400px] flex items-center justify-center">
              <div className="empty-state">
                <div className="empty-state-icon"><Layers size={22} /></div>
                <p className="text-sm font-semibold text-foreground">No result yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure your stock and cut list, then click Run Optimisation.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
