-- AlterTable: add Xero and Shopify integration fields to Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "xeroContactId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "shopifyCustomerId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Customer_companyId_xeroContactId_idx" ON "Customer"("companyId", "xeroContactId");
CREATE INDEX IF NOT EXISTS "Customer_companyId_shopifyCustomerId_idx" ON "Customer"("companyId", "shopifyCustomerId");
