import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { processingApi } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { QrCode, LogIn, LogOut, Clock, Search, CheckCircle, XCircle } from 'lucide-react';

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── Scan / manual entry widget ────────────────────────────────────────────────

function ScanWidget() {
  const qc = useQueryClient();
  const [jobCode, setJobCode]     = useState('');
  const [station, setStation]     = useState('');
  const [eventType, setEventType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [result, setResult]       = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const { data: workCenters } = useQuery({
    queryKey: ['work-centers'],
    queryFn: () => processingApi.listWorkCenters().then((r) => r.data as any[]),
  });

  const { mutate: doScan, isPending } = useMutation({
    mutationFn: () => processingApi.scan({ jobBarcode: jobCode, stationBarcode: station || undefined, eventType }),
    onSuccess: (res: any) => {
      const d = res.data;
      setResult({ type: 'ok', text: `${d.message} — ${d.workOrder?.workOrderNumber}${d.workCenter ? ` @ ${d.workCenter.name}` : ''}` });
      setJobCode('');
      setTimeout(() => setResult(null), 5000);
      qc.invalidateQueries({ queryKey: ['time-entries'] });
      qc.invalidateQueries({ queryKey: ['kanban'] });
    },
    onError: (e: any) => {
      setResult({ type: 'err', text: e?.response?.data?.message ?? 'Scan failed' });
      setTimeout(() => setResult(null), 5000);
    },
  });

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <QrCode size={15} className="text-steel-500" />
        <h3 className="font-semibold">Scan / Manual Check-In · Check-Out</h3>
      </div>
      <div className="card-body">
        <p className="text-xs text-steel-500 mb-4">
          Scan a work order barcode and optionally a station barcode to record time. Use a USB barcode scanner (it types into the field) or enter manually.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {/* Event type */}
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Event</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEventType('CHECK_IN')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  eventType === 'CHECK_IN'
                    ? 'bg-green-600 text-white border-green-600'
                    : 'border-steel-200 text-steel-600 hover:bg-steel-50'
                }`}
              >
                <LogIn size={13} /> Check In
              </button>
              <button
                type="button"
                onClick={() => setEventType('CHECK_OUT')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  eventType === 'CHECK_OUT'
                    ? 'bg-red-500 text-white border-red-500'
                    : 'border-steel-200 text-steel-600 hover:bg-steel-50'
                }`}
              >
                <LogOut size={13} /> Check Out
              </button>
            </div>
          </div>

          {/* Job barcode */}
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Job Barcode / WO #</label>
            <input
              type="text"
              value={jobCode}
              onChange={(e) => setJobCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && jobCode) doScan(); }}
              placeholder="Scan or type WO number…"
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white font-mono"
              autoFocus
            />
          </div>

          {/* Station */}
          <div>
            <label className="block text-xs font-medium text-steel-600 mb-1">Station (optional)</label>
            <select
              value={station}
              onChange={(e) => setStation(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="">— Any station —</option>
              {(workCenters ?? []).map((wc: any) => (
                <option key={wc.id} value={wc.code}>{wc.name} ({wc.code})</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => doScan()}
            disabled={isPending || !jobCode.trim()}
            className="btn-primary flex items-center gap-2"
          >
            <QrCode size={14} />
            {isPending ? 'Recording…' : `Record ${eventType === 'CHECK_IN' ? 'Check-In' : 'Check-Out'}`}
          </button>

          {result && (
            <div className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg ${
              result.type === 'ok'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {result.type === 'ok' ? <CheckCircle size={13} /> : <XCircle size={13} />}
              {result.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Time entries log ──────────────────────────────────────────────────────────

interface TimeEntry {
  id: string;
  eventType: string;
  scannedAt: string;
  workOrder: { workOrderNumber: string };
  workCenter?: { code: string; name: string };
}

export function TimeTrackingPage() {
  const [filterWO, setFilterWO] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['time-entries'],
    queryFn: () => processingApi.listTimeEntries({ limit: 200 }).then((r) => r.data as { data: TimeEntry[] }),
    refetchInterval: 15_000,
  });

  const entries = (data?.data ?? []).filter((e) => {
    if (!filterWO) return true;
    return e.workOrder?.workOrderNumber?.toLowerCase().includes(filterWO.toLowerCase());
  });

  // Compute durations: pair CHECK_IN → CHECK_OUT per WO per station
  const durationMap: Record<string, number> = {};
  const checkIns: Record<string, TimeEntry> = {};
  for (const e of [...entries].reverse()) {
    const key = `${e.workOrder?.workOrderNumber}-${e.workCenter?.code ?? 'any'}`;
    if (e.eventType === 'CHECK_IN') {
      checkIns[key] = e;
    } else if (e.eventType === 'CHECK_OUT' && checkIns[key]) {
      const ms = new Date(e.scannedAt).getTime() - new Date(checkIns[key].scannedAt).getTime();
      durationMap[e.id] = Math.round(ms / 60000);
      delete checkIns[key];
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Time Tracking"
        subtitle="Barcode scan check-ins and check-outs per work order and station"
      />

      <ScanWidget />

      <div className="card mt-5">
        <div className="card-header flex items-center gap-3">
          <Clock size={15} className="text-steel-500" />
          <h3 className="font-semibold">Recent Scan Events</h3>
          <div className="ml-auto relative max-w-48">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              type="text"
              value={filterWO}
              onChange={(e) => setFilterWO(e.target.value)}
              placeholder="Filter by WO #…"
              className="w-full pl-7 pr-2 py-1.5 text-xs border border-steel-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            />
          </div>
        </div>
        <div className="card-body p-0">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Time</th>
                <th>Work Order</th>
                <th>Station</th>
                <th>Event</th>
                <th className="text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 5 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                  ))
                : entries.map((e) => (
                    <tr key={e.id}>
                      <td className="text-xs font-mono text-steel-500">{fmtDateTime(e.scannedAt)}</td>
                      <td className="font-mono text-xs font-semibold text-primary-700">{e.workOrder?.workOrderNumber}</td>
                      <td className="text-xs text-steel-600">{e.workCenter ? `${e.workCenter.name} (${e.workCenter.code})` : <span className="text-steel-300">—</span>}</td>
                      <td>
                        {e.eventType === 'CHECK_IN'
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200"><LogIn size={9} /> Check In</span>
                          : <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200"><LogOut size={9} /> Check Out</span>
                        }
                      </td>
                      <td className="text-right text-xs font-mono text-steel-500">
                        {durationMap[e.id] != null ? `${durationMap[e.id]}m` : <span className="text-steel-300">—</span>}
                      </td>
                    </tr>
                  ))
              }
              {!isLoading && entries.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-steel-400">No scan events yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
