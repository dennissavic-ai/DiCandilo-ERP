import { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import clsx from 'clsx';

export interface Column<T> {
  header: string;
  accessor?: keyof T;
  cell?: (row: T) => ReactNode;
  className?: string;
  sortable?: boolean;
}

interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  keyField?: keyof T;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  isLoading,
  pagination,
  onPageChange,
  onRowClick,
  emptyMessage = 'No records found.',
  keyField,
}: Props<T>) {
  return (
    <div className="flex flex-col gap-3">
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.header} className={col.className}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-steel-100">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-steel-400">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    Loading…
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-steel-400 text-sm">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, i) => (
                <tr
                  key={keyField ? String(row[keyField]) : i}
                  onClick={() => onRowClick?.(row)}
                  className={clsx(onRowClick && 'cursor-pointer hover:bg-primary-50/50')}
                >
                  {columns.map((col) => (
                    <td key={col.header} className={col.className}>
                      {col.cell ? col.cell(row) : col.accessor ? String(row[col.accessor] ?? '') : null}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-steel-600">
          <span>
            Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange?.(1)}
              disabled={pagination.page === 1}
              className="btn-ghost btn-sm p-1.5"
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="btn-ghost btn-sm p-1.5"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-3 py-1 rounded-lg bg-steel-100 font-medium text-xs">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
              className="btn-ghost btn-sm p-1.5"
            >
              <ChevronRight size={14} />
            </button>
            <button
              onClick={() => onPageChange?.(pagination.totalPages)}
              disabled={pagination.page === pagination.totalPages}
              className="btn-ghost btn-sm p-1.5"
            >
              <ChevronsRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
