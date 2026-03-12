-- CreateEnum
CREATE TYPE "JobPlanStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED');

-- CreateTable
CREATE TABLE "JobPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "status" "JobPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPlanRole" (
    "id" TEXT NOT NULL,
    "jobPlanId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "estimatedHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "assignedUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPlanRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPlanEquipment" (
    "id" TEXT NOT NULL,
    "jobPlanId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "sequenceOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPlanEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPlanTask" (
    "id" TEXT NOT NULL,
    "jobPlanId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPlanTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleBlock" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobPlanId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobPlan_workOrderId_key" ON "JobPlan"("workOrderId");
CREATE INDEX "JobPlan_companyId_idx" ON "JobPlan"("companyId");
CREATE INDEX "ScheduleBlock_companyId_idx" ON "ScheduleBlock"("companyId");
CREATE INDEX "ScheduleBlock_workCenterId_startAt_endAt_idx" ON "ScheduleBlock"("workCenterId", "startAt", "endAt");

-- AddForeignKey
ALTER TABLE "JobPlan" ADD CONSTRAINT "JobPlan_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobPlanRole" ADD CONSTRAINT "JobPlanRole_jobPlanId_fkey" FOREIGN KEY ("jobPlanId") REFERENCES "JobPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobPlanEquipment" ADD CONSTRAINT "JobPlanEquipment_jobPlanId_fkey" FOREIGN KEY ("jobPlanId") REFERENCES "JobPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobPlanEquipment" ADD CONSTRAINT "JobPlanEquipment_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobPlanTask" ADD CONSTRAINT "JobPlanTask_jobPlanId_fkey" FOREIGN KEY ("jobPlanId") REFERENCES "JobPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_jobPlanId_fkey" FOREIGN KEY ("jobPlanId") REFERENCES "JobPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
