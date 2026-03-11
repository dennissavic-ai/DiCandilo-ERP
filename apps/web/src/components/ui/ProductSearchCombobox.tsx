import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi, type Product } from '../../services/api';
import { Search, X, Package } from 'lucide-react';

interface Props {
  value?: Product | null;
  onChange: (product: Product | null) => void;
  placeholder?: string;
}

export function ProductSearchCombobox({ value, onChange, placeholder = 'Search products…' }: Props) {
  const [open,        setOpen]        = useState(false);
  const [inputValue,  setInputValue]  = useState('');
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['products-search', inputValue],
    queryFn: () =>
      inventoryApi
        .listProducts({ search: inputValue || undefined, limit: 30 })
        .then((r) => r.data),
    enabled: open,
    staleTime: 10_000,
  });

  const products: Product[] = data?.data ?? [];

  const updatePosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  function openDropdown() {
    updatePosition();
    setOpen(true);
  }

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onScroll() {
      if (open) updatePosition();
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open, updatePosition]);

  function select(p: Product) {
    onChange(p);
    setInputValue('');
    setOpen(false);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
    setInputValue('');
  }

  const dropdown = open ? createPortal(
    <div
      style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 9999 }}
      className="bg-background border border-border rounded-lg shadow-2xl max-h-64 overflow-y-auto"
    >
      {isFetching && products.length === 0 && (
        <div className="px-3 py-4 text-xs text-muted-foreground text-center">Searching…</div>
      )}
      {!isFetching && products.length === 0 && (
        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
          {inputValue ? `No products matching "${inputValue}"` : 'Start typing to search products'}
        </div>
      )}
      {products.map((p) => (
        <button
          key={p.id}
          type="button"
          className="w-full text-left px-3 py-2.5 hover:bg-muted/60 flex items-start gap-2 border-b border-border last:border-0"
          onMouseDown={(e) => { e.preventDefault(); select(p); }}
        >
          <Package size={13} className="shrink-0 text-muted-foreground mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-foreground">{p.code}</div>
            <div className="text-[11px] text-muted-foreground truncate">{p.description}</div>
            {(p.grade || p.materialType) && (
              <div className="text-[10px] text-steel-400 mt-0.5">
                {[p.materialType, p.grade, p.shape].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <div className="text-right shrink-0 ml-3">
            <div className="text-xs font-mono text-primary-700">
              {p.listPrice ? `$${(p.listPrice / 100).toFixed(2)}` : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground">{p.uom}</div>
          </div>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Input trigger */}
      <div
        className="input flex items-center gap-2 h-8 cursor-text pr-8"
        onClick={openDropdown}
      >
        <Search size={11} className="shrink-0 text-muted-foreground" />
        {value && !open ? (
          <span className="text-xs truncate flex-1">{value.code} — {value.description}</span>
        ) : (
          <input
            className="flex-1 bg-transparent outline-none text-xs min-w-0"
            placeholder={value ? '' : placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={openDropdown}
            autoComplete="off"
          />
        )}
      </div>

      {/* Clear button */}
      {value && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X size={11} />
        </button>
      )}

      {dropdown}
    </div>
  );
}
