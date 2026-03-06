import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { ProductsPage } from './pages/inventory/ProductsPage';
import { ProductDetailPage } from './pages/inventory/ProductDetailPage';
import { StockAdjustPage } from './pages/inventory/StockAdjustPage';
import { ReceiveStockPage } from './pages/inventory/ReceiveStockPage';
import { StockTransferPage } from './pages/inventory/StockTransferPage';
import { MtrPage } from './pages/inventory/MtrPage';
import { CustomersPage } from './pages/sales/CustomersPage';
import { SalesOrdersPage } from './pages/sales/SalesOrdersPage';
import { SalesOrderDetailPage } from './pages/sales/SalesOrderDetailPage';
import { QuotesPage } from './pages/sales/QuotesPage';
import { QuoteDetailPage } from './pages/sales/QuoteDetailPage';
import { PriceBooksPage } from './pages/sales/PriceBooksPage';
import { CustomerPortalPage } from './pages/sales/CustomerPortalPage';
import { PurchaseOrdersPage } from './pages/purchasing/PurchaseOrdersPage';
import { SuppliersPage } from './pages/purchasing/SuppliersPage';
import { PurchaseOrderDetailPage } from './pages/purchasing/PurchaseOrderDetailPage';
import { WorkOrdersPage } from './pages/processing/WorkOrdersPage';
import { WorkOrderDetailPage } from './pages/processing/WorkOrderDetailPage';
import { SchedulePage } from './pages/processing/SchedulePage';
import { NestingPage } from './pages/processing/NestingPage';
import { InvoicesPage } from './pages/accounting/InvoicesPage';
import { ARAgeingPage } from './pages/accounting/ARAgeingPage';
import { ChartOfAccountsPage } from './pages/accounting/ChartOfAccountsPage';
import { AccountsPayablePage } from './pages/accounting/AccountsPayablePage';
import { ReportingPage } from './pages/ReportingPage';
import { UsersPage } from './pages/admin/UsersPage';
import { AutomationPage } from './pages/admin/AutomationPage';
import { BarcodePrintPage } from './pages/inventory/BarcodePrintPage';
import { ScanPage } from './pages/ScanPage';
import { TasksPage } from './pages/TasksPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProspectsPage } from './pages/crm/ProspectsPage';
import { CallReportsPage } from './pages/crm/CallReportsPage';
import { ShippingPage } from './pages/shipping/ShippingPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return !isAuthenticated ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />

        {/* Full-screen scanner — private but no sidebar layout */}
        <Route path="/scan" element={<PrivateRoute><ScanPage /></PrivateRoute>} />

        {/* Private (wrapped in sidebar layout) */}
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />

          {/* Inventory */}
          <Route path="inventory">
            <Route index element={<InventoryPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/:id" element={<ProductDetailPage />} />
            <Route path="products/:id/barcodes" element={<BarcodePrintPage />} />
            <Route path="adjust" element={<StockAdjustPage />} />
            <Route path="receive" element={<ReceiveStockPage />} />
            <Route path="transfer" element={<StockTransferPage />} />
            <Route path="mtr" element={<MtrPage />} />
          </Route>

          {/* Sales */}
          <Route path="sales">
            <Route index element={<SalesOrdersPage />} />
            <Route path="orders" element={<SalesOrdersPage />} />
            <Route path="orders/:id" element={<SalesOrderDetailPage />} />
            <Route path="quotes" element={<QuotesPage />} />
            <Route path="quotes/:id" element={<QuoteDetailPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="price-books" element={<PriceBooksPage />} />
            <Route path="portal" element={<CustomerPortalPage />} />
          </Route>

          {/* Purchasing */}
          <Route path="purchasing">
            <Route index element={<PurchaseOrdersPage />} />
            <Route path="orders" element={<PurchaseOrdersPage />} />
            <Route path="orders/:id" element={<PurchaseOrderDetailPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
          </Route>

          {/* Processing */}
          <Route path="processing">
            <Route index element={<WorkOrdersPage />} />
            <Route path="work-orders" element={<WorkOrdersPage />} />
            <Route path="work-orders/:id" element={<WorkOrderDetailPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="nesting" element={<NestingPage />} />
          </Route>

          {/* Accounting */}
          <Route path="accounting">
            <Route index element={<InvoicesPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="ar-ageing" element={<ARAgeingPage />} />
            <Route path="chart-of-accounts" element={<ChartOfAccountsPage />} />
            <Route path="accounts-payable" element={<AccountsPayablePage />} />
          </Route>

          {/* Shipping */}
          <Route path="shipping" element={<ShippingPage />} />

          {/* CRM */}
          <Route path="crm">
            <Route index element={<ProspectsPage />} />
            <Route path="prospects" element={<ProspectsPage />} />
            <Route path="call-reports" element={<CallReportsPage />} />
          </Route>

          {/* Reporting */}
          <Route path="reporting" element={<ReportingPage />} />

          {/* Tasks */}
          <Route path="tasks" element={<TasksPage />} />

          {/* Admin */}
          <Route path="admin/users" element={<UsersPage />} />
          <Route path="admin/automation" element={<AutomationPage />} />

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
