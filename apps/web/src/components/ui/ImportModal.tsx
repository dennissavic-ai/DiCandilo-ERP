import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, X, Download, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import { api } from '../../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  example?: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  endpoint: string;          // e.g. '/inventory/products/import'
  columns: ImportColumn[];
  queryKey: string | string[];
}

// ─── Tiny CSV parser (handles quoted fields) ──────────────────────────────────

function parseLine(line: string): string[] {
  const row: string[] = [];
  let inQuotes = false;
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  row.push(current.trim());
  return row;
}

function parseCSVPreview(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  const rows = lines.slice(1, 6).map(parseLine); // preview first 5 data rows
  return { headers, rows };
}

// ─── Template download (generates CSV in-browser) ─────────────────────────────

function downloadTemplate(columns: ImportColumn[], filename: string) {
  const header = columns.map((c) => c.key).join(',');
  const example = columns.map((c) => c.example ?? '').join(',');
  const csv = `${header}\n${example}\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportModal({ open, onClose, title, description, endpoint, columns, queryKey }: ImportModalProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [dragging, setDragging] = useState(false);

  const mutation = useMutation<ImportResult, Error, File>({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append('file', f);
      const res = await api.post<ImportResult>(endpoint, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: () => {
      const keys = Array.isArray(queryKey) ? queryKey : [queryKey];
      queryClient.invalidateQueries({ queryKey: keys });
    },
  });

  if (!open) return null;

  function handleFile(f: File) {
    if (!f.name.endsWith('.csv')) return;
    setFile(f);
    mutation.reset();
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setPreview(parseCSVPreview(text));
    };
    reader.readAsText(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleClose() {
    setFile(null);
    setPreview(null);
    mutation.reset();
    onClose();
  }

  const result = mutation.data;
  const hasErrors = result && result.errors.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-steel-100">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-steel-400 hover:text-steel-600 hover:bg-steel-50 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Template download */}
          <div className="flex items-center justify-between bg-primary-50 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-primary-700">
              <FileText size={14} />
              <span>Download the CSV template to see the required columns and format.</span>
            </div>
            <button
              onClick={() => downloadTemplate(columns, `${title.toLowerCase().replace(/\s+/g, '-')}-template.csv`)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary-700 hover:text-primary-800 underline underline-offset-2"
            >
              <Download size={13} /> Template
            </button>
          </div>

          {/* Column legend */}
          <div>
            <p className="text-xs font-medium text-steel-600 mb-2">Required columns</p>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((col) => (
                <span
                  key={col.key}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono ${
                    col.required ? 'bg-primary-50 text-primary-700' : 'bg-steel-50 text-steel-600'
                  }`}
                >
                  {col.key}
                  {col.required && <span className="text-red-500">*</span>}
                </span>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          {!result && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragging
                  ? 'border-primary-400 bg-primary-50'
                  : file
                    ? 'border-green-400 bg-green-50'
                    : 'border-steel-200 bg-steel-50 hover:border-primary-300 hover:bg-primary-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <Upload size={24} className={`mx-auto mb-2 ${file ? 'text-green-500' : 'text-steel-400'}`} />
              {file ? (
                <div>
                  <p className="text-sm font-medium text-green-700">{file.name}</p>
                  <p className="text-xs text-green-600 mt-0.5">{(file.size / 1024).toFixed(1)} KB — click to change</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-steel-600">Drop CSV file here, or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Only .csv files are accepted</p>
                </div>
              )}
            </div>
          )}

          {/* Preview table */}
          {preview && !result && preview.headers.length > 0 && (
            <div>
              <p className="text-xs font-medium text-steel-600 mb-2">
                Preview — first {preview.rows.length} rows
              </p>
              <div className="overflow-x-auto rounded-xl border border-steel-100">
                <table className="w-full text-xs">
                  <thead className="bg-steel-50">
                    <tr>
                      {preview.headers.map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-semibold text-steel-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-steel-50">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5 text-steel-700 max-w-[160px] truncate" title={cell}>{cell || <span className="text-steel-300">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import result */}
          {result && (
            <div className="space-y-3">
              <div className={`flex items-center gap-2 text-sm font-medium ${hasErrors ? 'text-amber-700' : 'text-green-700'}`}>
                {hasErrors ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                Import complete
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Created', value: result.created, color: 'text-green-600' },
                  { label: 'Updated', value: result.updated, color: 'text-blue-600' },
                  { label: 'Skipped', value: result.skipped, color: 'text-steel-500' },
                ].map((s) => (
                  <div key={s.label} className="bg-steel-50 rounded-xl p-3 text-center">
                    <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              {hasErrors && (
                <div className="bg-red-50 rounded-xl p-3 space-y-1 max-h-40 overflow-y-auto">
                  <p className="text-xs font-semibold text-red-700 mb-1.5">{result.errors.length} row(s) failed</p>
                  {result.errors.map((e, i) => (
                    <div key={i} className="flex gap-2 text-xs text-red-600">
                      <span className="font-mono font-semibold shrink-0">Row {e.row}</span>
                      <span>{e.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* API error */}
          {mutation.isError && (
            <div className="flex items-start gap-2 bg-red-50 rounded-xl p-3 text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{mutation.error?.message ?? 'Import failed. Please check your file and try again.'}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-steel-100">
          {result ? (
            <button onClick={handleClose} className="btn-primary btn-sm">Done</button>
          ) : (
            <>
              <button onClick={handleClose} className="btn-secondary btn-sm">Cancel</button>
              <button
                disabled={!file || mutation.isPending}
                onClick={() => file && mutation.mutate(file)}
                className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mutation.isPending ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Importing…
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Upload size={13} /> Import
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
