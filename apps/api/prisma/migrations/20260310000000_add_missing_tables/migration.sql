-- Migration: Add missing tables that exist in schema but not in DB
-- Plus new DocumentAttachment and Supplier notes column

-- ─── Prospect ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Prospect" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "companyName"     TEXT NOT NULL,
    "contactName"     TEXT,
    "email"           TEXT,
    "phone"           TEXT,
    "stage"           TEXT NOT NULL DEFAULT 'LEAD',
    "industry"        TEXT,
    "estimatedValue"  BIGINT,
    "probability"     INTEGER DEFAULT 50,
    "nextFollowUp"    TIMESTAMP(3),
    "notes"           TEXT,
    "deletedAt"       TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"       TEXT,
    "updatedBy"       TEXT,
    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Prospect_companyId_idx" ON "Prospect"("companyId");
CREATE INDEX IF NOT EXISTS "Prospect_companyId_stage_idx" ON "Prospect"("companyId", "stage");

-- ─── CallReport ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CallReport" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "prospectId"      TEXT,
    "customerId"      TEXT,
    "supplierId"      TEXT,
    "userId"          TEXT,
    "type"            TEXT NOT NULL,
    "callDate"        TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER,
    "subject"         TEXT NOT NULL,
    "notes"           TEXT,
    "outcome"         TEXT NOT NULL,
    "followUpDate"    TIMESTAMP(3),
    "deletedAt"       TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"       TEXT,
    CONSTRAINT "CallReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CallReport_companyId_idx" ON "CallReport"("companyId");
CREATE INDEX IF NOT EXISTS "CallReport_prospectId_idx" ON "CallReport"("prospectId");
CREATE INDEX IF NOT EXISTS "CallReport_customerId_idx" ON "CallReport"("customerId");
CREATE INDEX IF NOT EXISTS "CallReport_supplierId_idx" ON "CallReport"("supplierId");

-- ─── PipelineStage ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PipelineStage" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "color"       TEXT NOT NULL DEFAULT 'gray',
    "order"       INTEGER NOT NULL,
    "isWon"       BOOLEAN NOT NULL DEFAULT false,
    "isLost"      BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PipelineStage_companyId_name_key" ON "PipelineStage"("companyId", "name");
CREATE INDEX IF NOT EXISTS "PipelineStage_companyId_order_idx" ON "PipelineStage"("companyId", "order");

-- ─── AutoFulfillmentRule ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AutoFulfillmentRule" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "productId"       TEXT NOT NULL,
    "supplierId"      TEXT NOT NULL,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "reorderPoint"    DECIMAL(18,4) NOT NULL,
    "reorderQty"      DECIMAL(18,4) NOT NULL,
    "unitPrice"       BIGINT NOT NULL DEFAULT 0,
    "leadTimeDays"    INTEGER,
    "notes"           TEXT,
    "lastTriggeredAt" TIMESTAMP(3),
    "deletedAt"       TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"       TEXT,
    "updatedBy"       TEXT,
    CONSTRAINT "AutoFulfillmentRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AutoFulfillmentRule_companyId_productId_key" ON "AutoFulfillmentRule"("companyId", "productId");
CREATE INDEX IF NOT EXISTS "AutoFulfillmentRule_companyId_idx" ON "AutoFulfillmentRule"("companyId");
CREATE INDEX IF NOT EXISTS "AutoFulfillmentRule_isActive_idx" ON "AutoFulfillmentRule"("isActive");

ALTER TABLE "AutoFulfillmentRule" ADD CONSTRAINT "AutoFulfillmentRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutoFulfillmentRule" ADD CONSTRAINT "AutoFulfillmentRule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── IntegrationCredential ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "IntegrationCredential" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "provider"    TEXT NOT NULL,
    "config"      JSONB NOT NULL DEFAULT '{}',
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy"   TEXT,
    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationCredential_companyId_provider_key" ON "IntegrationCredential"("companyId", "provider");
CREATE INDEX IF NOT EXISTS "IntegrationCredential_companyId_idx" ON "IntegrationCredential"("companyId");

-- ─── SyncLog ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SyncLog" (
    "id"            TEXT NOT NULL,
    "companyId"     TEXT NOT NULL,
    "credentialId"  TEXT NOT NULL,
    "provider"      TEXT NOT NULL,
    "direction"     TEXT NOT NULL,
    "entityType"    TEXT NOT NULL,
    "status"        TEXT NOT NULL,
    "totalRecords"  INTEGER NOT NULL DEFAULT 0,
    "syncedRecords" INTEGER NOT NULL DEFAULT 0,
    "errorCount"    INTEGER NOT NULL DEFAULT 0,
    "errors"        JSONB NOT NULL DEFAULT '[]',
    "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"   TIMESTAMP(3),
    "triggeredBy"   TEXT,
    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SyncLog_companyId_provider_idx" ON "SyncLog"("companyId", "provider");
CREATE INDEX IF NOT EXISTS "SyncLog_credentialId_idx" ON "SyncLog"("credentialId");

ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "IntegrationCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── JobTimeEntry ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "JobTimeEntry" (
    "id"           TEXT NOT NULL,
    "companyId"    TEXT NOT NULL,
    "workOrderId"  TEXT NOT NULL,
    "workCenterId" TEXT,
    "userId"       TEXT,
    "eventType"    TEXT NOT NULL,
    "scannedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"    TEXT,
    CONSTRAINT "JobTimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JobTimeEntry_companyId_idx" ON "JobTimeEntry"("companyId");
CREATE INDEX IF NOT EXISTS "JobTimeEntry_workOrderId_idx" ON "JobTimeEntry"("workOrderId");
CREATE INDEX IF NOT EXISTS "JobTimeEntry_workCenterId_idx" ON "JobTimeEntry"("workCenterId");

ALTER TABLE "JobTimeEntry" ADD CONSTRAINT "JobTimeEntry_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobTimeEntry" ADD CONSTRAINT "JobTimeEntry_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── CashFlowEntry ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CashFlowEntry" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "entryDate"   TIMESTAMP(3) NOT NULL,
    "type"        TEXT NOT NULL,
    "amount"      BIGINT NOT NULL,
    "description" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"   TEXT,
    CONSTRAINT "CashFlowEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CashFlowEntry_companyId_entryDate_idx" ON "CashFlowEntry"("companyId", "entryDate");

-- ─── DocumentAttachment ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "DocumentAttachment" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "sourceType"  TEXT NOT NULL,
    "sourceId"    TEXT NOT NULL,
    "fileName"    TEXT NOT NULL,
    "fileUrl"     TEXT NOT NULL,
    "fileSize"    INTEGER,
    "mimeType"    TEXT,
    "uploadedBy"  TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DocumentAttachment_companyId_sourceType_sourceId_idx" ON "DocumentAttachment"("companyId", "sourceType", "sourceId");

-- ─── Supplier notes column ────────────────────────────────────────────────────

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "interactionNotes" JSONB NOT NULL DEFAULT '[]';

-- ─── CallReport FK constraints (optional — added without breaking existing data)
-- (supplierId not FK-constrained since Supplier table already exists)
