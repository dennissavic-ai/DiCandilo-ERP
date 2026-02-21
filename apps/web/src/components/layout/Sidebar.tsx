import { NavLink, useLocation } from 'react-router-dom';
import {
  Package, ShoppingCart, Truck, BarChart3,
  FileText, Wrench, DollarSign, Users, ClipboardList, QrCode,
  Factory, ChevronDown, Layers, TrendingUp, Settings,
  BookOpen, Gauge,
} from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

interface NavChild {
  label: string;
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}
interface NavItem {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  to?: string;
  children?: NavChild[];
  end?: boolean;
}

const NAV_MAIN: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: Gauge, end: true },
];

const NAV_OPS: NavItem[] = [
  {
    label: 'Inventory', icon: Package,
    children: [
      { label: 'Stock on Hand',  to: '/inventory',          icon: Layers },
      { label: 'Products',       to: '/inventory/products',  icon: Package },
      { label: 'Receive Stock',  to: '/inventory/receive',   icon: Truck },
      { label: 'Adjust Stock',   to: '/inventory/adjust',    icon: Settings },
    ],
  },
  {
    label: 'Sales', icon: ShoppingCart,
    children: [
      { label: 'Sales Orders', to: '/sales/orders',    icon: FileText },
      { label: 'Quotes',       to: '/sales/quotes',    icon: ClipboardList },
      { label: 'Customers',    to: '/sales/customers', icon: Users },
    ],
  },
  {
    label: 'Purchasing', icon: Truck,
    children: [
      { label: 'Purchase Orders', to: '/purchasing/orders',    icon: FileText },
      { label: 'Suppliers',       to: '/purchasing/suppliers', icon: Factory },
    ],
  },
  {
    label: 'Processing', icon: Wrench,
    children: [
      { label: 'Work Orders', to: '/processing/work-orders', icon: ClipboardList },
      { label: 'Schedule',    to: '/processing/schedule',    icon: BarChart3 },
      { label: 'Nesting',     to: '/processing/nesting',     icon: Layers },
    ],
  },
  {
    label: 'Accounting', icon: DollarSign,
    children: [
      { label: 'Invoices',          to: '/accounting/invoices',          icon: FileText },
      { label: 'AR Ageing',         to: '/accounting/ar-ageing',         icon: TrendingUp },
      { label: 'Chart of Accounts', to: '/accounting/chart-of-accounts', icon: BookOpen },
    ],
  },
];

const NAV_ANALYTICS: NavItem[] = [
  { label: 'Reporting', to: '/reporting', icon: BarChart3 },
  { label: 'Tasks',     to: '/tasks',     icon: ClipboardList },
];

const NAV_ADMIN: NavItem[] = [
  { label: 'Barcoding', to: '/barcoding',   icon: QrCode },
  { label: 'Users',     to: '/admin/users', icon: Users },
];

function useGroupActive(children: NavChild[]) {
  const { pathname } = useLocation();
  return children.some((c) => pathname.startsWith(c.to));
}

function NavGroup({ item }: { item: NavItem & { children: NavChild[] } }) {
  const groupActive = useGroupActive(item.children);
  const [open, setOpen] = useState(groupActive);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'w-full sidebar-item group',
          groupActive
            ? 'text-white'
            : 'text-[hsl(var(--sidebar-foreground))] hover:bg-white/[0.08] hover:text-white',
        )}
      >
        <item.icon size={15} className="flex-shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown size={12} className={clsx('transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="ml-5 mt-0.5 mb-1 border-l border-white/10 pl-3 space-y-px">
          {item.children.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-2.5 py-1.5 text-[12.5px] rounded-md transition-all duration-100',
                  isActive
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-[hsl(var(--sidebar-foreground))] hover:bg-white/[0.08] hover:text-white',
                )
              }
            >
              <child.icon size={12} className="flex-shrink-0 opacity-70" />
              {child.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/25 select-none">
      {label}
    </p>
  );
}

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to!}
      end={item.end}
      className={({ isActive }) => (isActive ? 'sidebar-item-active' : 'sidebar-item-inactive')}
    >
      <item.icon size={15} className="flex-shrink-0" />
      {item.label}
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside
      className="w-[220px] flex-shrink-0 flex flex-col h-full overflow-hidden select-none"
      style={{ background: 'hsl(var(--sidebar-background))' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-[18px] border-b border-white/[0.07]">
        <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
          <Factory size={15} className="text-white" />
        </div>
        <div>
          <div className="text-[13px] font-bold text-white leading-tight tracking-tight">DiCandilo</div>
          <div className="text-[9.5px] uppercase tracking-[0.12em] text-white/35">Metal ERP</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-px">
        <SectionLabel label="Main" />
        {NAV_MAIN.map((item) => <NavItemLink key={item.to} item={item} />)}

        <SectionLabel label="Operations" />
        {NAV_OPS.map((item) =>
          item.children
            ? <NavGroup key={item.label} item={item as NavItem & { children: NavChild[] }} />
            : <NavItemLink key={item.to} item={item} />
        )}

        <SectionLabel label="Analytics" />
        {NAV_ANALYTICS.map((item) => <NavItemLink key={item.to} item={item} />)}

        <SectionLabel label="Admin" />
        {NAV_ADMIN.map((item) => <NavItemLink key={item.to} item={item} />)}
      </nav>

      {/* Footer status */}
      <div className="px-4 py-3 border-t border-white/[0.07]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
          <span className="text-[11px] text-white/25">v1.0.0 · All systems operational</span>
        </div>
      </div>
    </aside>
  );
}
