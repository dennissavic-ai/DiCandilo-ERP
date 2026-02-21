# DiCandilo ERP — Metal Service Center Management System

A production-grade, cloud-ready ERP system purpose-built for metal service centers. Comparable to Steel Manager III by 4GL Solutions, built on a modern open-source stack.

---

## Features

| Module | Status | Description |
|---|---|---|
| **Inventory Management** | ✅ Full | Multi-location stock, heat tracking, MTRs, FIFO/average costing, barcoding, real-time WebSocket updates |
| **Purchasing** | ✅ Full | PO lifecycle, supplier DB, 3-way matching, receipts, landed cost |
| **Sales & Quoting** | ✅ Full | Customer CRM, pricing matrix, quote-to-order, credit management |
| **Inside Processing** | ✅ Full | Work orders, work centres, operations, scrap/yield tracking |
| **Outside Processing** | ✅ Full | Outsourced jobs, sub-contractor POs |
| **Linear Nesting** | ✅ Full | FFD algorithm, cut diagrams, remnant tracking |
| **Plate Nesting** | 🔄 API-ready | Integration layer for Sigmanest / Radan |
| **Production Scheduling** | ✅ Full | Schedule board, capacity management |
| **Picking & Shipping** | ✅ Full | Pick lists, manifests, BOL, carrier integration hooks |
| **Accounting (GL/AR/AP)** | ✅ Full | Auto-posting, journal entries, aging reports, trial balance |
| **Reporting & BI** | ✅ Full | KPI dashboard, sales/inventory/purchasing reports |
| **EDI Integration** | 🔄 Scaffold | 850/855/856/810 transaction sets, X12 & EDIFACT |
| **Customer Portal** | 🔄 Scaffold | Self-service order/invoice/MTR access |
| **Task Manager** | ✅ Full | Tasks, comments, entity linking, notifications |
| **Barcoding** | ✅ Full | QR/Code128 generation, USB/camera scan support |
| **Multi-Branch** | ✅ Full | Unlimited locations, inter-branch transfers |
| **RBAC** | ✅ Full | Granular role/permission system, full audit log |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js 20, TypeScript, Fastify 4 |
| **ORM** | Prisma 5 (PostgreSQL) |
| **Database** | PostgreSQL 16 |
| **Cache / Sessions** | Redis 7 |
| **Frontend** | React 18, TypeScript, Vite 5 |
| **Styling** | Tailwind CSS 3 |
| **State** | Zustand, TanStack Query v5 |
| **Charts** | Recharts |
| **Auth** | JWT (access + refresh tokens), Argon2 password hashing |
| **Real-time** | WebSockets (Fastify WS plugin) |
| **File Storage** | AWS S3 / MinIO (local dev) |
| **Containers** | Docker + Docker Compose |
| **Testing** | Jest + ts-jest |
| **API Docs** | Swagger / OpenAPI 3.0 |

---

## Project Structure

```
DiCandilo-ERP/
├── api/                          # Fastify backend
│   ├── src/
│   │   ├── app.ts                # Application entry point
│   │   ├── config/               # env, database, redis
│   │   ├── middleware/           # auth, audit logging
│   │   ├── modules/
│   │   │   ├── auth/             # JWT login, register, refresh
│   │   │   ├── inventory/        # Products, items, transactions, MTR
│   │   │   ├── purchasing/       # POs, suppliers, receipts
│   │   │   ├── sales/            # Customers, quotes, orders, pricing
│   │   │   ├── processing/       # Work orders, work centres, scheduling
│   │   │   ├── accounting/       # GL, AR, AP, invoices, payments
│   │   │   ├── reporting/        # Dashboard, BI reports
│   │   │   ├── shipping/         # Pick lists, manifests
│   │   │   ├── nesting/          # Linear nesting algorithm
│   │   │   ├── barcoding/        # QR/barcode generation & scanning
│   │   │   ├── tasks/            # Task manager
│   │   │   └── users/            # User management, RBAC
│   │   ├── utils/                # pagination, errors, helpers
│   │   └── websocket/            # Real-time WS plugin
│   ├── prisma/
│   │   ├── schema.prisma         # Full data model (30+ entities)
│   │   └── seed.ts               # Development seed data
│   └── tests/                    # Jest unit tests
│
├── web/                          # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/           # Sidebar, TopBar, Layout
│   │   │   └── ui/               # DataTable, Modal, PageHeader, StatusBadge
│   │   ├── pages/
│   │   │   ├── DashboardPage     # KPI cards + charts
│   │   │   ├── inventory/        # Stock, Products, Receive, Adjust
│   │   │   ├── sales/            # Orders, Quotes, Customers
│   │   │   ├── purchasing/       # POs, Suppliers
│   │   │   ├── processing/       # Work Orders, Schedule, Nesting
│   │   │   ├── accounting/       # Invoices, AR Ageing, CoA
│   │   │   └── admin/            # Users, Roles
│   │   ├── services/api.ts       # Typed Axios API client
│   │   └── store/authStore.ts    # Zustand auth state
│   └── public/
│
├── shared/                       # Shared TypeScript utilities
│   └── src/index.ts              # Formatters, enums, pure helpers
│
├── docker-compose.yml
├── .env.example
└── scripts/init.sql
```

---

## Quick Start (Docker)

### Prerequisites
- Docker Desktop 4.x+
- Docker Compose v2+

### 1. Clone and configure

```bash
git clone <repo-url>
cd DiCandilo-ERP
cp .env.example .env
# Edit .env — at minimum, change JWT_SECRET to a random 32+ char string
```

### 2. Start all services

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, API (port 3001), Web (port 3000), and MinIO (port 9000).
The API container automatically runs migrations and seeds sample data on first start.

### 3. Open the application

```
http://localhost:3000
```

**Default login:**
- Email: `admin@dicandilo.com`
- Password: `Admin@12345`

### 4. API Documentation (Swagger UI)

```
http://localhost:3001/docs
```

---

## Local Development (without Docker)

### Prerequisites
- Node.js 20+, PostgreSQL 16, Redis 7

```bash
# Install all workspace dependencies
npm install

# Configure environment
cp .env.example api/.env
# Edit api/.env with your local DATABASE_URL, REDIS_URL, JWT_SECRET

# Set up the database
npm run db:migrate
npm run db:seed

# Start both API and Web with hot-reload
npm run dev
```

---

## Database Management

```bash
npm run db:studio       # Prisma Studio visual browser
npm run db:migrate      # Run pending migrations
npm run db:seed         # Re-seed sample data

# Create a new migration after schema changes
cd api && npx prisma migrate dev --name your_migration_name

# Production deploy
cd api && npx prisma migrate deploy
```

---

## Running Tests

```bash
npm run test            # All tests
npm run test:coverage   # With HTML coverage report
```

Key test suites:
- `api/tests/inventory.test.ts` — FIFO logic, quantity calculations, unit conversions
- `api/tests/nesting.test.ts` — Linear nesting FFD algorithm (7 test cases)
- `api/tests/pricing.test.ts` — Pricing rule engine (7 test cases)

---

## Key Design Decisions

| Decision | Detail |
|---|---|
| **Financial precision** | All money stored as `BigInt` cents — zero floating-point risk |
| **Physical units** | Lengths in mm, weights in grams — converted at the display layer |
| **Optimistic locking** | `InventoryItem.version` increments on every write; callers supply `expectedVersion` to prevent race conditions |
| **Soft deletes** | Every entity has `deletedAt`; records are never physically deleted |
| **Audit trail** | Every mutation records user, action, entity, old/new values, IP |
| **Auto GL posting** | Invoices, receipts, and payments automatically create balanced journal entries |
| **Real-time** | WebSocket broadcasts `INVENTORY_UPDATE` events to all company clients on stock changes |

---

## API Summary

Base URL: `http://localhost:3001/api/v1`

All endpoints except `/auth/*` require `Authorization: Bearer <token>`.

```
POST   /auth/login                 Login
POST   /auth/register              Register new company
POST   /auth/refresh               Refresh access token
GET    /auth/me                    Current user + permissions

GET    /inventory/items            List all stock (paginated, searchable)
POST   /inventory/receive          Receive stock (bulk)
POST   /inventory/adjust           Adjust stock (optimistic locked)
POST   /inventory/transfers        Inter-branch transfer
GET    /inventory/valuation        Inventory value summary

GET    /sales/orders               List sales orders
POST   /sales/quotes               Create quote
POST   /sales/quotes/:id/convert   Convert quote → sales order

GET    /purchasing/orders          List POs
POST   /purchasing/orders          Create PO
PATCH  /purchasing/orders/:id/approve

POST   /accounting/invoices/from-order/:id   Auto-generate invoice
POST   /accounting/invoices/:id/payments     Record payment
GET    /accounting/ar-aging                  AR ageing report
GET    /accounting/trial-balance

GET    /reporting/dashboard        KPI dashboard data
GET    /reporting/sales            Sales report
GET    /reporting/inventory        Inventory report

POST   /nesting/jobs               Run linear nesting
POST   /barcodes/generate          Generate QR code
POST   /barcodes/scan              Look up entity by scan
```

Full Swagger documentation at `/docs`.

---

## Deployment (AWS)

Recommended architecture:

```
Route 53 → CloudFront → S3 (static web)
                      → ALB → ECS Fargate (API, auto-scaled)
                                  → RDS Aurora PostgreSQL (Multi-AZ)
                                  → ElastiCache Redis
                                  → S3 (MTR file storage)
```

All configuration via environment variables — see `.env.example` for the full list.
Use AWS Secrets Manager for `JWT_SECRET`, `DATABASE_URL`, and `AWS_SECRET_ACCESS_KEY`.

---

## Licence

Proprietary — DiCandilo Steel & Metals. All rights reserved.