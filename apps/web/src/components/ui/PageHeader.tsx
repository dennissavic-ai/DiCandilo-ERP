import { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: Props) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        {breadcrumbs && (
          <nav className="flex items-center gap-1 text-xs text-steel-500 mb-1">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                {b.href ? (
                  <a href={b.href} className="hover:text-primary-600 transition-colors">{b.label}</a>
                ) : (
                  <span>{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-bold text-steel-900">{title}</h1>
        {subtitle && <p className="text-sm text-steel-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
