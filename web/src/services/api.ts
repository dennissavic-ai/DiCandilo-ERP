import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// Request interceptor: attach JWT
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401 by refreshing token
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value: unknown) => void; reject: (err: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          if (originalRequest.headers) originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken });
        useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
        processQueue(null, data.accessToken);
        if (originalRequest.headers) originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ── Typed API helpers ──────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// Auth
export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  register: (data: object) => api.post('/auth/register', data),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me'),
};

// Inventory
export const inventoryApi = {
  // Products
  listProducts: (params?: object) => api.get<PaginatedResponse<Product>>('/inventory/products', { params }),
  getProduct: (id: string) => api.get<Product>(`/inventory/products/${id}`),
  createProduct: (data: object) => api.post<Product>('/inventory/products', data),
  updateProduct: (id: string, data: object) => api.put<Product>(`/inventory/products/${id}`, data),
  deleteProduct: (id: string) => api.delete(`/inventory/products/${id}`),

  // Categories
  listCategories: () => api.get('/inventory/categories'),
  createCategory: (data: object) => api.post('/inventory/categories', data),

  // Locations
  listLocations: () => api.get<InventoryLocation[]>('/inventory/locations'),
  createLocation: (data: object) => api.post('/inventory/locations', data),

  // Items
  listItems: (params?: object) => api.get<PaginatedResponse<InventoryItem>>('/inventory/items', { params }),
  getItem: (id: string) => api.get<InventoryItem>(`/inventory/items/${id}`),
  createItem: (data: object) => api.post<InventoryItem>('/inventory/items', data),

  // Operations
  adjustStock: (data: object) => api.post('/inventory/adjust', data),
  receiveStock: (data: object) => api.post('/inventory/receive', data),
  createTransfer: (data: object) => api.post('/inventory/transfers', data),
  getValuation: (params?: object) => api.get('/inventory/valuation', { params }),
  getTransactions: (itemId: string, params?: object) => api.get(`/inventory/items/${itemId}/transactions`, { params }),

  // MTRs
  listMTRs: (itemId: string) => api.get(`/inventory/items/${itemId}/mtrs`),
  createMTR: (itemId: string, data: object) => api.post(`/inventory/items/${itemId}/mtrs`, data),

  // Barcodes
  generateBarcode: (data: object) => api.post('/barcodes/generate', data),
  scanBarcode: (data: string) => api.post('/barcodes/scan', { data }),
};

// Sales
export const salesApi = {
  listCustomers: (params?: object) => api.get<PaginatedResponse<Customer>>('/sales/customers', { params }),
  getCustomer: (id: string) => api.get<Customer>(`/sales/customers/${id}`),
  createCustomer: (data: object) => api.post('/sales/customers', data),
  updateCustomer: (id: string, data: object) => api.put(`/sales/customers/${id}`, data),
  listQuotes: (params?: object) => api.get<PaginatedResponse<SalesQuote>>('/sales/quotes', { params }),
  getQuote: (id: string) => api.get<SalesQuote>(`/sales/quotes/${id}`),
  createQuote: (data: object) => api.post('/sales/quotes', data),
  convertQuote: (id: string) => api.post(`/sales/quotes/${id}/convert`),
  listOrders: (params?: object) => api.get<PaginatedResponse<SalesOrder>>('/sales/orders', { params }),
  getOrder: (id: string) => api.get<SalesOrder>(`/sales/orders/${id}`),
  createOrder: (data: object) => api.post('/sales/orders', data),
  confirmOrder: (id: string) => api.patch(`/sales/orders/${id}/confirm`),
  cancelOrder: (id: string) => api.patch(`/sales/orders/${id}/cancel`),
};

// Purchasing
export const purchasingApi = {
  listSuppliers: (params?: object) => api.get<PaginatedResponse<Supplier>>('/purchasing/suppliers', { params }),
  getSupplier: (id: string) => api.get<Supplier>(`/purchasing/suppliers/${id}`),
  createSupplier: (data: object) => api.post('/purchasing/suppliers', data),
  listOrders: (params?: object) => api.get<PaginatedResponse<PurchaseOrder>>('/purchasing/orders', { params }),
  getOrder: (id: string) => api.get<PurchaseOrder>(`/purchasing/orders/${id}`),
  createOrder: (data: object) => api.post('/purchasing/orders', data),
  submitOrder: (id: string) => api.patch(`/purchasing/orders/${id}/submit`),
  approveOrder: (id: string) => api.patch(`/purchasing/orders/${id}/approve`),
  createReceipt: (poId: string, data: object) => api.post(`/purchasing/orders/${poId}/receipts`, data),
};

// Accounting
export const accountingApi = {
  listAccounts: (params?: object) => api.get('/accounting/accounts', { params }),
  listInvoices: (params?: object) => api.get<PaginatedResponse<Invoice>>('/accounting/invoices', { params }),
  getInvoice: (id: string) => api.get<Invoice>(`/accounting/invoices/${id}`),
  createInvoiceFromOrder: (soId: string) => api.post(`/accounting/invoices/from-order/${soId}`),
  recordPayment: (invoiceId: string, data: object) => api.post(`/accounting/invoices/${invoiceId}/payments`, data),
  getARAgeing: () => api.get('/accounting/ar-aging'),
  getTrialBalance: (params?: object) => api.get('/accounting/trial-balance', { params }),
  listJournalEntries: (params?: object) => api.get('/accounting/journal-entries', { params }),
};

// Reporting
export const reportingApi = {
  getDashboard: () => api.get('/reporting/dashboard'),
  getSalesReport: (params: object) => api.get('/reporting/sales', { params }),
  getInventoryReport: (params: object) => api.get('/reporting/inventory', { params }),
  getPurchasingReport: (params: object) => api.get('/reporting/purchasing', { params }),
};

// Processing
export const processingApi = {
  listWorkCenters: () => api.get('/processing/work-centers'),
  listWorkOrders: (params?: object) => api.get<PaginatedResponse<WorkOrder>>('/processing/work-orders', { params }),
  getWorkOrder: (id: string) => api.get<WorkOrder>(`/processing/work-orders/${id}`),
  createWorkOrder: (data: object) => api.post('/processing/work-orders', data),
  updateStatus: (id: string, status: string) => api.patch(`/processing/work-orders/${id}/status`, { status }),
  getSchedule: (params?: object) => api.get('/processing/schedule', { params }),
};

// Nesting
export const nestingApi = {
  listJobs: () => api.get('/nesting/jobs'),
  getJob: (id: string) => api.get(`/nesting/jobs/${id}`),
  createJob: (data: object) => api.post('/nesting/jobs', data),
};

// Users
export const usersApi = {
  listUsers: (params?: object) => api.get('/users', { params }),
  createUser: (data: object) => api.post('/users', data),
  updateUser: (id: string, data: object) => api.put(`/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/users/${id}`),
  listRoles: () => api.get('/users/roles'),
  listPermissions: () => api.get('/users/permissions'),
  getAuditLog: (params?: object) => api.get('/users/audit-log', { params }),
};

// Tasks
export const tasksApi = {
  listTasks: (params?: object) => api.get('/tasks', { params }),
  getTask: (id: string) => api.get(`/tasks/${id}`),
  createTask: (data: object) => api.post('/tasks', data),
  updateTask: (id: string, data: object) => api.put(`/tasks/${id}`, data),
  deleteTask: (id: string) => api.delete(`/tasks/${id}`),
  addComment: (id: string, body: string) => api.post(`/tasks/${id}/comments`, { body }),
};

// ── TypeScript interfaces ──────────────────────────────────────────────────────

export interface Product {
  id: string;
  code: string;
  description: string;
  longDescription?: string;
  uom: string;
  materialType?: string;
  grade?: string;
  alloy?: string;
  shape?: string;
  finish?: string;
  coating?: string;
  standardLength?: number;
  standardWidth?: number;
  standardThickness?: number;
  weightPerMeter?: number;
  costMethod: string;
  standardCost: number;
  listPrice: number;
  reorderPoint?: number;
  reorderQty?: number;
  isBought: boolean;
  isSold: boolean;
  isStocked: boolean;
  trackByHeat: boolean;
  requiresMtr: boolean;
  isActive: boolean;
  category?: { id: string; name: string; code: string };
}

export interface InventoryLocation {
  id: string;
  branchId: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface InventoryItem {
  id: string;
  productId: string;
  locationId: string;
  lotNumber?: string;
  heatNumber?: string;
  certificateNumber?: string;
  thickness?: number;
  width?: number;
  length?: number;
  weightGrams?: number;
  qtyOnHand: string;
  qtyAllocated: string;
  qtyAvailable: string;
  qtyOnOrder: string;
  unitCost: number;
  totalCost: number;
  isRemnant: boolean;
  isQuarantined: boolean;
  version: number;
  product?: Product;
  location?: InventoryLocation;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  legalName?: string;
  taxId?: string;
  currencyCode: string;
  creditLimit: number;
  creditTerms: number;
  creditHold: boolean;
  billingAddress?: Record<string, string>;
  contacts: unknown[];
  isActive: boolean;
  customerGroup?: { id: string; name: string };
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  paymentTerms: number;
  currencyCode: string;
  isActive: boolean;
}

export interface SalesQuote {
  id: string;
  quoteNumber: string;
  status: string;
  quoteDate: string;
  validUntil?: string;
  totalAmount: number;
  customer: { id: string; name: string; code: string };
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  status: string;
  orderDate: string;
  totalAmount: number;
  amountPaid: number;
  customer: { id: string; name: string; code: string };
  lines?: SalesOrderLine[];
}

export interface SalesOrderLine {
  id: string;
  lineNumber: number;
  description: string;
  uom: string;
  qtyOrdered: string;
  qtyShipped: string;
  unitPrice: number;
  lineTotal: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  totalCost: number;
  supplier: { id: string; name: string; code: string };
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: number;
  balanceDue: number;
  customer: { id: string; name: string; code: string };
}

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  status: string;
  priority: number;
  scheduledDate?: string;
  salesOrder?: { orderNumber: string; customer?: { name: string } };
}
