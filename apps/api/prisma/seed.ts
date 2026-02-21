import { PrismaClient, CostMethod, LocationType, TransactionType } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Company & Branch ──────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { id: 'seed-company-001' },
    update: {},
    create: {
      id: 'seed-company-001',
      name: 'DiCandilo Steel & Metals',
      legalName: 'DiCandilo Steel & Metals Pty Ltd',
      currency: 'USD',
      email: 'admin@dicandilo.com',
      phone: '+1 (555) 000-0000',
    },
  });
  console.log('✔ Company created:', company.name);

  const mainBranch = await prisma.branch.upsert({
    where: { id: 'seed-branch-001' },
    update: {},
    create: {
      id: 'seed-branch-001',
      companyId: company.id,
      code: 'MAIN',
      name: 'Main Warehouse',
      isDefault: true,
      address: { street: '1 Steel Way', city: 'Houston', state: 'TX', zip: '77001', country: 'US' },
    },
  });
  console.log('✔ Branch created:', mainBranch.name);

  // ── Permissions ───────────────────────────────────────────────────────────
  const modules = ['inventory', 'purchasing', 'sales', 'processing', 'accounting', 'reporting', 'users', 'shipping', 'tasks'];
  const actions = ['view', 'create', 'edit', 'delete', 'approve'];
  const permissionMap: Record<string, string> = {};

  for (const mod of modules) {
    for (const action of actions) {
      const perm = await prisma.permission.upsert({
        where: { module_action: { module: mod, action } },
        update: {},
        create: { module: mod, action, description: `${action} ${mod}` },
      });
      permissionMap[`${mod}:${action}`] = perm.id;
    }
  }
  console.log('✔ Permissions seeded:', Object.keys(permissionMap).length);

  // ── Roles ─────────────────────────────────────────────────────────────────
  const adminRole = await prisma.role.upsert({
    where: { name: 'Admin' },
    update: {},
    create: {
      name: 'Admin',
      description: 'Full system access',
      isSystem: true,
      permissions: { create: Object.values(permissionMap).map((pid) => ({ permissionId: pid })) },
    },
  });

  const salesRole = await prisma.role.upsert({
    where: { name: 'Sales' },
    update: {},
    create: {
      name: 'Sales',
      description: 'Sales team — quotes, orders, customers',
      permissions: {
        create: ['sales:view', 'sales:create', 'sales:edit', 'inventory:view', 'reporting:view', 'tasks:view', 'tasks:create']
          .map((k) => ({ permissionId: permissionMap[k] })).filter((p) => p.permissionId),
      },
    },
  });

  const warehouseRole = await prisma.role.upsert({
    where: { name: 'Warehouse' },
    update: {},
    create: {
      name: 'Warehouse',
      description: 'Warehouse operations — inventory, receiving, shipping',
      permissions: {
        create: ['inventory:view', 'inventory:create', 'inventory:edit', 'shipping:view', 'shipping:create', 'purchasing:view']
          .map((k) => ({ permissionId: permissionMap[k] })).filter((p) => p.permissionId),
      },
    },
  });

  const accountingRole = await prisma.role.upsert({
    where: { name: 'Accounting' },
    update: {},
    create: {
      name: 'Accounting',
      description: 'Accounting team — invoices, payments, reports',
      permissions: {
        create: ['accounting:view', 'accounting:create', 'accounting:edit', 'reporting:view', 'sales:view', 'purchasing:view']
          .map((k) => ({ permissionId: permissionMap[k] })).filter((p) => p.permissionId),
      },
    },
  });

  console.log('✔ Roles seeded: Admin, Sales, Warehouse, Accounting');

  // ── Admin user ────────────────────────────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@dicandilo.com' },
    update: {},
    create: {
      companyId: company.id,
      branchId: mainBranch.id,
      roleId: adminRole.id,
      email: 'admin@dicandilo.com',
      passwordHash: await argon2.hash('Admin@12345'),
      firstName: 'System',
      lastName: 'Administrator',
      isActive: true,
    },
  });
  console.log('✔ Admin user created: admin@dicandilo.com / Admin@12345');

  // ── GL Accounts ───────────────────────────────────────────────────────────
  const glAccounts = [
    { code: '1000', name: 'Cash & Cash Equivalents', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1100', name: 'Accounts Receivable', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1110', name: 'Allowance for Doubtful Accounts', type: 'ASSET', normalBalance: 'CREDIT' },
    { code: '1200', name: 'Raw Materials Inventory', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1210', name: 'Work In Progress Inventory', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1220', name: 'Finished Goods Inventory', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1300', name: 'Prepaid Expenses', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1500', name: 'Property, Plant & Equipment', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1510', name: 'Accumulated Depreciation', type: 'ASSET', normalBalance: 'CREDIT' },
    { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '2100', name: 'Accrued Liabilities', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '2200', name: 'Sales Tax Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '2300', name: 'Customer Deposits', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '3000', name: "Owner's Equity", type: 'EQUITY', normalBalance: 'CREDIT' },
    { code: '3100', name: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CREDIT' },
    { code: '4000', name: 'Sales — Steel Products', type: 'REVENUE', normalBalance: 'CREDIT' },
    { code: '4100', name: 'Sales — Processing Services', type: 'REVENUE', normalBalance: 'CREDIT' },
    { code: '4200', name: 'Freight Revenue', type: 'REVENUE', normalBalance: 'CREDIT' },
    { code: '5000', name: 'Cost of Goods Sold — Material', type: 'COGS', normalBalance: 'DEBIT' },
    { code: '5100', name: 'Cost of Goods Sold — Processing', type: 'COGS', normalBalance: 'DEBIT' },
    { code: '5200', name: 'Freight Cost', type: 'COGS', normalBalance: 'DEBIT' },
    { code: '6000', name: 'Wages & Salaries', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '6100', name: 'Utilities', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '6200', name: 'Rent & Occupancy', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '6300', name: 'Insurance', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '6400', name: 'Depreciation & Amortisation', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '6500', name: 'Sales & Marketing', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '6600', name: 'General & Administrative', type: 'EXPENSE', normalBalance: 'DEBIT' },
  ];

  for (const acct of glAccounts) {
    await prisma.gLAccount.upsert({
      where: { companyId_code: { companyId: company.id, code: acct.code } },
      update: {},
      create: { companyId: company.id, ...acct as { code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COGS'; normalBalance: 'DEBIT' | 'CREDIT' }, isSystemAccount: true },
    });
  }
  console.log('✔ GL Accounts seeded:', glAccounts.length);

  // ── Product Categories ────────────────────────────────────────────────────
  const catFlat = await prisma.productCategory.upsert({
    where: { companyId_code: { companyId: company.id, code: 'FLAT' } },
    update: {},
    create: { companyId: company.id, code: 'FLAT', name: 'Flat Products' },
  });
  const catLong = await prisma.productCategory.upsert({
    where: { companyId_code: { companyId: company.id, code: 'LONG' } },
    update: {},
    create: { companyId: company.id, code: 'LONG', name: 'Long Products' },
  });
  const catTube = await prisma.productCategory.upsert({
    where: { companyId_code: { companyId: company.id, code: 'TUBE' } },
    update: {},
    create: { companyId: company.id, code: 'TUBE', name: 'Tube & Pipe' },
  });
  console.log('✔ Product categories seeded');

  // ── Inventory Locations ───────────────────────────────────────────────────
  const locations = [
    { code: 'REC', name: 'Receiving Bay', type: LocationType.RECEIVING },
    { code: 'A01', name: 'Rack A01', type: LocationType.STORAGE },
    { code: 'A02', name: 'Rack A02', type: LocationType.STORAGE },
    { code: 'B01', name: 'Rack B01', type: LocationType.STORAGE },
    { code: 'SHIP', name: 'Shipping Bay', type: LocationType.SHIPPING },
    { code: 'QC', name: 'QC / Quarantine', type: LocationType.QUARANTINE },
    { code: 'SCRAP', name: 'Scrap Bay', type: LocationType.SCRAP },
    { code: 'WIP', name: 'Work In Progress', type: LocationType.WIP },
  ];

  let firstLocation = null;
  for (const loc of locations) {
    const l = await prisma.inventoryLocation.upsert({
      where: { branchId_code: { branchId: mainBranch.id, code: loc.code } },
      update: {},
      create: { branchId: mainBranch.id, ...loc, createdBy: adminUser.id },
    });
    if (!firstLocation) firstLocation = l;
  }
  console.log('✔ Inventory locations seeded:', locations.length);

  // ── Sample Products ───────────────────────────────────────────────────────
  const products = [
    {
      code: 'HR-PLT-6X1500X3000', categoryId: catFlat.id,
      description: 'Hot Rolled Plate 6mm x 1500mm x 3000mm',
      uom: 'EA', materialType: 'steel', grade: 'A36', shape: 'plate',
      standardThickness: 6, standardWidth: 1500, standardLength: 3000,
      weightPerMeter: 47100, costMethod: CostMethod.AVERAGE,
      standardCost: 18000, listPrice: 24000, isBought: true, isSold: true, isStocked: true,
    },
    {
      code: 'SS-RHS-50X50X3', categoryId: catTube.id,
      description: '304 Stainless RHS 50x50x3mm',
      uom: 'M', materialType: 'stainless', grade: '304', alloy: 'L', shape: 'RHS',
      standardThickness: 3, standardWidth: 50, standardLength: 6000,
      weightPerMeter: 4390, costMethod: CostMethod.FIFO,
      standardCost: 3500, listPrice: 4800, isBought: true, isSold: true, isStocked: true, trackByHeat: true, requiresMtr: true,
    },
    {
      code: 'AL-FLAT-3X300X2400', categoryId: catFlat.id,
      description: '6061-T6 Aluminium Flat Bar 3mm x 300mm x 2400mm',
      uom: 'EA', materialType: 'aluminum', grade: '6061', alloy: 'T6', shape: 'flat',
      standardThickness: 3, standardWidth: 300, standardLength: 2400,
      weightPerMeter: 2430, costMethod: CostMethod.AVERAGE,
      standardCost: 9500, listPrice: 13000, isBought: true, isSold: true, isStocked: true,
    },
    {
      code: 'CR-SHT-2X1200X2400', categoryId: catFlat.id,
      description: 'Cold Rolled Sheet 2mm x 1200mm x 2400mm',
      uom: 'EA', materialType: 'steel', grade: 'CQ', shape: 'sheet', finish: 'cold rolled',
      standardThickness: 2, standardWidth: 1200, standardLength: 2400,
      weightPerMeter: 15700, costMethod: CostMethod.FIFO,
      standardCost: 8500, listPrice: 11500, isBought: true, isSold: true, isStocked: true,
    },
    {
      code: 'MS-RND-50', categoryId: catLong.id,
      description: 'Mild Steel Round Bar 50mm Dia x 6000mm',
      uom: 'M', materialType: 'steel', grade: '1020', shape: 'round bar',
      standardWidth: 50, standardLength: 6000,
      weightPerMeter: 15400, costMethod: CostMethod.AVERAGE,
      standardCost: 1200, listPrice: 1650, isBought: true, isSold: true, isStocked: true, reorderPoint: 50,
    },
  ];

  const createdProducts: { id: string; code: string }[] = [];
  for (const prod of products) {
    const p = await prisma.product.upsert({
      where: { companyId_code: { companyId: company.id, code: prod.code } },
      update: {},
      create: { companyId: company.id, ...prod, createdBy: adminUser.id, updatedBy: adminUser.id },
    });
    createdProducts.push({ id: p.id, code: p.code });
  }
  console.log('✔ Products seeded:', createdProducts.length);

  // ── Sample Inventory ──────────────────────────────────────────────────────
  if (firstLocation) {
    for (const prod of createdProducts.slice(0, 3)) {
      const existing = await prisma.inventoryItem.findFirst({ where: { productId: prod.id, locationId: firstLocation.id } });
      if (!existing) {
        const qty = 50;
        const cost = 18000;
        const item = await prisma.inventoryItem.create({
          data: {
            productId: prod.id,
            locationId: firstLocation.id,
            qtyOnHand: qty,
            qtyAvailable: qty,
            unitCost: cost,
            totalCost: BigInt(qty * cost),
            createdBy: adminUser.id,
          },
        });
        await prisma.stockTransaction.create({
          data: {
            inventoryItemId: item.id,
            transactionType: TransactionType.OPENING,
            quantity: qty,
            unitCost: cost,
            totalCost: BigInt(qty * cost),
            qtyBefore: 0,
            qtyAfter: qty,
            notes: 'Seed opening balance',
            createdBy: adminUser.id,
          },
        });
      }
    }
    console.log('✔ Sample inventory items seeded');
  }

  // ── Sample Customers ──────────────────────────────────────────────────────
  const customers = [
    { code: 'ACME-001', name: 'ACME Manufacturing', creditLimit: 5000000, creditTerms: 30 },
    { code: 'BLDG-002', name: 'BuildRight Construction', creditLimit: 2500000, creditTerms: 14 },
    { code: 'FABR-003', name: 'Precision Fabricators LLC', creditLimit: 1000000, creditTerms: 30 },
  ];
  for (const cust of customers) {
    await prisma.customer.upsert({
      where: { companyId_code: { companyId: company.id, code: cust.code } },
      update: {},
      create: { companyId: company.id, ...cust, createdBy: adminUser.id, updatedBy: adminUser.id },
    });
  }
  console.log('✔ Sample customers seeded:', customers.length);

  // ── Sample Suppliers ──────────────────────────────────────────────────────
  const suppliers = [
    { code: 'NUCOR-001', name: 'Nucor Steel', paymentTerms: 30 },
    { code: 'RYERSON-002', name: 'Ryerson Metals', paymentTerms: 45 },
  ];
  for (const sup of suppliers) {
    await prisma.supplier.upsert({
      where: { companyId_code: { companyId: company.id, code: sup.code } },
      update: {},
      create: { companyId: company.id, ...sup, createdBy: adminUser.id, updatedBy: adminUser.id },
    });
  }
  console.log('✔ Sample suppliers seeded:', suppliers.length);

  // ── Work Centers ──────────────────────────────────────────────────────────
  const workCenters = [
    { code: 'SAW-01', name: 'Band Saw #1', type: 'SAW' },
    { code: 'SHEAR-01', name: 'Hydraulic Shear #1', type: 'SHEAR' },
    { code: 'PRESS-01', name: 'Press Brake #1', type: 'BEND' },
    { code: 'DRILL-01', name: 'Radial Drill #1', type: 'DRILL' },
    { code: 'GRIND-01', name: 'Surface Grinder #1', type: 'GRIND' },
  ];
  for (const wc of workCenters) {
    await prisma.workCenter.upsert({
      where: { companyId_code: { companyId: company.id, code: wc.code } },
      update: {},
      create: { companyId: company.id, branchId: mainBranch.id, ...wc },
    });
  }
  console.log('✔ Work centers seeded:', workCenters.length);

  console.log('\n✅ Seeding complete!');
  console.log('   Login: admin@dicandilo.com');
  console.log('   Password: Admin@12345');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
