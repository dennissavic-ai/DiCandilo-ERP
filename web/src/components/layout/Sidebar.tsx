import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Package, ShoppingCart, Truck, Settings,
  BarChart3, FileText, Wrench, DollarSign, Users, ClipboardList,
  QrCode, Factory, ChevronDown, ChevronRight, Layers,
} from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

interface NavItem {
  label: string;
  to?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children?: NavItem[];
  permission?: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  {
    label: 'Inventory', icon: Package,
    children: [
      { label: 'Stock on Hand', to: '/inventory', icon: Layers },
      { label: 'Products', to: '/inventory/products', icon: Package },
      { label: 'Receive Stock', to: '/inventory/receive', icon: Truck },
      { label: 'Adjust Stock', to: '/inventory/adjust', icon: Settings },
    ],
  },
  {
    label: 'Sales', icon: ShoppingCart,
    children: [
      { label: 'Sales Orders', to: '/sales/orders', icon: FileText },
      { label: 'Quotes', to: '/sales/quotes', icon: ClipboardList },
      { label: 'Customers', to: '/sales/customers', icon: Users },
    ],
  },
  {
    label: 'Purchasing', icon: Truck,
    children: [
      { label: 'Purchase Orders', to: '/purchasing/orders', icon: FileText },
      { label: 'Suppliers', to: '/purchasing/suppliers', icon: Factory },
    ],
  },
  {
    label: 'Processing', icon: Wrench,
    children: [
      { label: 'Work Orders', to: '/processing/work-orders', icon: ClipboardList },
      { label: 'Schedule', to: '/processing/schedule', icon: BarChart3 },
      { label: 'Nesting', to: '/processing/nesting', icon: Layers },
    ],
  },
  {
    label: 'Accounting', icon: DollarSign,
    children: [
      { label: 'Invoices', to: '/accounting/invoices', icon: FileText },
      { label: 'AR Ageing', to: '/accounting/ar-ageing', icon: BarChart3 },
      { label: 'Chart of Accounts', to: '/accounting/chart-of-accounts', icon: DollarSign },
    ],
  },
  { label: 'Reporting', to: '/reporting', icon: BarChart3 },
  { label: 'Tasks', to: '/tasks', icon: ClipboardList },
  { label: 'Barcoding', to: '/inventory', icon: QrCode },
  { label: 'Users', to: '/admin/users', icon: Users },
];

function NavGroup({ item }: { item: NavItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full sidebar-item-inactive group"
      >
        <item.icon size={18} />
        <span className="flex-1 text-left">{item.label}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-steel-200 pl-3">
          {item.children?.map((child) => (
            <NavLink
              key={child.to}
              to={child.to!}
              className={({ isActive }) =>
                clsx('flex items-center gap-2.5 px-2 py-1.5 text-sm rounded-lg transition-all',
                  isActive
                    ? 'text-primary-700 bg-primary-50 font-medium'
                    : 'text-steel-500 hover:text-steel-900 hover:bg-steel-100')
              }
            >
              <child.icon size={14} />
              {child.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-steel-200 flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-steel-200">
        <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Factory size={16} className="text-white" />
        </div>
        <div>
          <div className="text-sm font-bold text-steel-900 leading-tight">DiCandilo</div>
          <div className="text-[10px] text-steel-500 uppercase tracking-wider">Metal ERP</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map((item) =>
          item.children ? (
            <NavGroup key={item.label} item={item} />
          ) : (
            <NavLink
              key={item.to}
              to={item.to!}
              end={item.to === '/'}
              className={({ isActive }) =>
                isActive ? 'sidebar-item-active' : 'sidebar-item-inactive'
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          )
        )}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-steel-200">
        <div className="text-xs text-steel-400 text-center">v1.0.0</div>
      </div>
    </aside>
  );
}
