-- CreateEnum
CREATE TYPE "VSMNodeType" AS ENUM ('SUPPLIER', 'PROCESS', 'INVENTORY', 'SHIPPING', 'CUSTOMER');

-- CreateTable
CREATE TABLE "ValueStreamMap" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "deletedAt"   TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "createdBy"   TEXT,
    "updatedBy"   TEXT,

    CONSTRAINT "ValueStreamMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VSMNode" (
    "id"             TEXT NOT NULL,
    "mapId"          TEXT NOT NULL,
    "type"           "VSMNodeType" NOT NULL DEFAULT 'PROCESS',
    "label"          TEXT NOT NULL,
    "position"       INTEGER NOT NULL,
    "cycleTimeSec"   INTEGER,
    "changeOverSec"  INTEGER,
    "uptimePct"      DOUBLE PRECISION,
    "operatorCount"  INTEGER,
    "batchSize"      INTEGER,
    "waitTimeSec"    INTEGER,
    "promotedFromId" TEXT,
    "notes"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VSMNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ValueStreamMap_companyId_idx" ON "ValueStreamMap"("companyId");

-- CreateIndex
CREATE INDEX "VSMNode_mapId_idx" ON "VSMNode"("mapId");

-- AddForeignKey
ALTER TABLE "VSMNode" ADD CONSTRAINT "VSMNode_mapId_fkey"
    FOREIGN KEY ("mapId") REFERENCES "ValueStreamMap"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
