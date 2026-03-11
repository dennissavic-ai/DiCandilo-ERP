import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi, type Product } from '../../services/api';
import { Search, X, Package } from 'lucide-react';

interface Props {
  value?: Product | null;
  onChange: (product: Product | null) => void;
  placeholder?: string;
}

export function ProductSearchCombobox({ value, onChange, placeholder = 'Search products…' }: Props) {
  const [open,       setOpen]       = useState(false);
  const [inputValue, setInputValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Show selected product name in the input when not focused
  const displayValue = value
    ? `${value.code} — ${value.description}`
    : inputValue;

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

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Input */}
      <div
        className="input flex items-center gap-2 h-8 cursor-text pr-8"
        onClick={() => { setOpen(true); }}
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
            onFocus={() => setOpen(true)}
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

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-background border border-border rounded-lg shadow-xl max-h-56 overflow-y-auto">
          {isFetching && products.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">Searching…</div>
          )}
          {!isFetching && products.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              {inputValue ? `No products matching "${inputValue}"` : 'No products found'}
            </div>
          )}
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-muted/60 flex items-start gap-2 border-b border-border last:border-0"
              onMouseDown={(e) => { e.preventDefault(); select(p); }}
            >
              <Package size={12} className="shrink-0 text-muted-foreground mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">{p.code}</div>
                <div className="text-[11px] text-muted-foreground truncate">{p.description}</div>
                {(p.grade || p.materialType) && (
                  <div className="text-[10px] text-steel-400 mt-0.5">
                    {[p.materialType, p.grade, p.shape].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <div className="ml-auto text-right shrink-0">
                <div className="text-xs font-mono text-primary-700">
                  {p.listPrice ? `$${(p.listPrice / 100).toFixed(2)}` : '—'}
                </div>
                <div className="text-[10px] text-muted-foreground">{p.uom}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
