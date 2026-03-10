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

  await prisma.role.upsert({
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

  await prisma.role.upsert({
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

  await prisma.role.upsert({
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
  const locationDefs = [
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
  for (const loc of locationDefs) {
    const l = await prisma.inventoryLocation.upsert({
      where: { branchId_code: { branchId: mainBranch.id, code: loc.code } },
      update: {},
      create: { branchId: mainBranch.id, ...loc, createdBy: adminUser.id },
    });
    if (!firstLocation) firstLocation = l;
  }
  console.log('✔ Inventory locations seeded:', locationDefs.length);

  // ── Sample Products ───────────────────────────────────────────────────────
  const products = [
    // Flat / Plate
    { code: 'HR-PLT-6X1500X3000', categoryId: catFlat.id, description: 'Hot Rolled Plate 6mm x 1500 x 3000mm', uom: 'EA', materialType: 'steel', grade: 'A36', shape: 'plate', standardThickness: 6, standardWidth: 1500, standardLength: 3000, weightPerMeter: 47100, costMethod: CostMethod.AVERAGE, standardCost: 18000, listPrice: 24000, isBought: true, isSold: true, isStocked: true },
    { code: 'HR-PLT-10X1500X3000', categoryId: catFlat.id, description: 'Hot Rolled Plate 10mm x 1500 x 3000mm', uom: 'EA', materialType: 'steel', grade: 'A36', shape: 'plate', standardThickness: 10, standardWidth: 1500, standardLength: 3000, weightPerMeter: 78500, costMethod: CostMethod.AVERAGE, standardCost: 29500, listPrice: 39000, isBought: true, isSold: true, isStocked: true },
    { code: 'HR-PLT-16X2000X6000', categoryId: catFlat.id, description: 'Hot Rolled Plate 16mm x 2000 x 6000mm', uom: 'EA', materialType: 'steel', grade: '350', shape: 'plate', standardThickness: 16, standardWidth: 2000, standardLength: 6000, weightPerMeter: 251200, costMethod: CostMethod.AVERAGE, standardCost: 92000, listPrice: 118000, isBought: true, isSold: true, isStocked: true, trackByHeat: true, requiresMtr: true },
    { code: 'HR-PLT-25X2000X6000', categoryId: catFlat.id, description: 'Hot Rolled Plate 25mm x 2000 x 6000mm', uom: 'EA', materialType: 'steel', grade: '350', shape: 'plate', standardThickness: 25, standardWidth: 2000, standardLength: 6000, weightPerMeter: 392500, costMethod: CostMethod.AVERAGE, standardCost: 145000, listPrice: 188000, isBought: true, isSold: true, isStocked: true, trackByHeat: true, requiresMtr: true },
    // Sheet
    { code: 'CR-SHT-2X1200X2400', categoryId: catFlat.id, description: 'Cold Rolled Sheet 2mm x 1200 x 2400mm', uom: 'EA', materialType: 'steel', grade: 'CQ', shape: 'sheet', finish: 'cold rolled', standardThickness: 2, standardWidth: 1200, standardLength: 2400, weightPerMeter: 15700, costMethod: CostMethod.FIFO, standardCost: 8500, listPrice: 11500, isBought: true, isSold: true, isStocked: true },
    { code: 'GI-SHT-1.6X1200X2400', categoryId: catFlat.id, description: 'Galvanised Sheet 1.6mm x 1200 x 2400mm', uom: 'EA', materialType: 'steel', grade: 'G300', shape: 'sheet', coating: 'galvanised', standardThickness: 2, standardWidth: 1200, standardLength: 2400, weightPerMeter: 12000, costMethod: CostMethod.AVERAGE, standardCost: 9200, listPrice: 12500, isBought: true, isSold: true, isStocked: true },
    { code: 'SS-SHT-2X1200X2400', categoryId: catFlat.id, description: '316L Stainless Sheet 2mm x 1200 x 2400mm', uom: 'EA', materialType: 'stainless', grade: '316L', shape: 'sheet', standardThickness: 2, standardWidth: 1200, standardLength: 2400, weightPerMeter: 15700, costMethod: CostMethod.FIFO, standardCost: 31000, listPrice: 42000, isBought: true, isSold: true, isStocked: true, trackByHeat: true, requiresMtr: true },
    // Flat Bar
    { code: 'AL-FLAT-3X300X2400', categoryId: catFlat.id, description: '6061-T6 Aluminium Flat Bar 3mm x 300 x 2400mm', uom: 'EA', materialType: 'aluminum', grade: '6061', alloy: 'T6', shape: 'flat', standardThickness: 3, standardWidth: 300, standardLength: 2400, weightPerMeter: 2430, costMethod: CostMethod.AVERAGE, standardCost: 9500, listPrice: 13000, isBought: true, isSold: true, isStocked: true },
    { code: 'MS-FLAT-6X50X6000', categoryId: catFlat.id, description: 'Mild Steel Flat Bar 6mm x 50mm x 6000mm', uom: 'M', materialType: 'steel', grade: 'G250', shape: 'flat', standardThickness: 6, standardWidth: 50, standardLength: 6000, weightPerMeter: 2360, costMethod: CostMethod.AVERAGE, standardCost: 380, listPrice: 520, isBought: true, isSold: true, isStocked: true, reorderPoint: 100 },
    { code: 'MS-FLAT-10X75X6000', categoryId: catFlat.id, description: 'Mild Steel Flat Bar 10mm x 75mm x 6000mm', uom: 'M', materialType: 'steel', grade: 'G250', shape: 'flat', standardThickness: 10, standardWidth: 75, standardLength: 6000, weightPerMeter: 5890, costMethod: CostMethod.AVERAGE, standardCost: 880, listPrice: 1180, isBought: true, isSold: true, isStocked: true, reorderPoint: 60 },
    // Round Bar
    { code: 'MS-RND-20', categoryId: catLong.id, description: 'Mild Steel Round Bar 20mm Dia x 6000mm', uom: 'M', materialType: 'steel', grade: '1020', shape: 'round bar', standardWidth: 20, standardLength: 6000, weightPerMeter: 2470, costMethod: CostMethod.AVERAGE, standardCost: 380, listPrice: 510, isBought: true, isSold: true, isStocked: true, reorderPoint: 100 },
    { code: 'MS-RND-50', categoryId: catLong.id, description: 'Mild Steel Round Bar 50mm Dia x 6000mm', uom: 'M', materialType: 'steel', grade: '1020', shape: 'round bar', standardWidth: 50, standardLength: 6000, weightPerMeter: 15400, costMethod: CostMethod.AVERAGE, standardCost: 1200, listPrice: 1650, isBought: true, isSold: true, isStocked: true, reorderPoint: 50 },
    { code: 'MS-RND-75', categoryId: catLong.id, description: 'Mild Steel Round Bar 75mm Dia x 6000mm', uom: 'M', materialType: 'steel', grade: '1020', shape: 'round bar', standardWidth: 75, standardLength: 6000, weightPerMeter: 34700, costMethod: CostMethod.AVERAGE, standardCost: 2600, listPrice: 3500, isBought: true, isSold: true, isStocked: true, trackByHeat: true, requiresMtr: true },
    { code: 'SS-RND-25', categoryId: catLong.id, description: '316 Stainless Round Bar 25mm Dia x 3000mm', uom: 'M', materialType: 'stainless', grade: '316', shape: 'round bar', standardWidth: 25, standardLength: 3000, weightPerMeter: 3850, costMethod: CostMethod.FIFO, standardCost: 2100, listPrice: 2900, isBought: true, isSold: true, isStocked: true, trackByHeat: true, requiresMtr: true },
    // RHS / SHS Tube
    { code: 'MS-RHS-50X25X2', categoryId: catTube.id, description: 'Mild Steel RHS 50x25x2mm x 8000mm', uom: 'M', materialType: 'steel', grade: 'C350L0', shape: 'RHS', standardThickness: 2, standardWidth: 50, standardLength: 8000, weightPerMeter: 1830, costMethod: CostMethod.AVERAGE, standardCost: 285, listPrice: 390, isBought: true, isSold: true, isStocked: true, reorderPoint: 200 },
    { code: 'MS-RHS-100X50X3', categoryId: catTube.id, description: 'Mild Steel RHS 100x50x3mm x 8000mm', uom: 'M', materialType: 'steel', grade: 'C350L0', shape: 'RHS', standardThickness: 3, standardWidth: 100, standardLength: 8000, weightPerMeter: 6710, costMethod: CostMethod.AVERAGE, standardCost: 960, listPrice: 1300, isBought: true, isSold: true, isStocked: true, reorderPoint: 100 },
    { code: 'MS-SHS-75X75X3', categoryId: catTube.id, description: 'Mild Steel SHS 75x75x3mm x 8000mm', uom: 'M', materialType: 'steel', grade: 'C350L0', shape: 'RHS', standardThickness: 3, standardWidth: 75, standardLength: 8000, weightPerMeter: 6440, costMethod: CostMethod.AVERAGE, standardCost: 920, listPrice: 1250, isBought: true, isSold: true, isStocked: true, reorderPoint: 80 },
    { code: 'SS-RHS-50X50X3', categoryId: catTube.id, description: '304 Stainless RHS 50x50x3mm x 6000mm', uom: 'M', materialType: 'stainless', grade: '304', alloy: 'L', shape: 'RHS', standardThickness: 3, standardWidth: 50, standardLength: 6000, weightPerMeter: 4390, costMethod: CostMethod.FIFO, standardCost: 3500, listPrice: 4800, isBought: true, isSold: true, isStocked: true, trackByHeat: true, requiresMtr: true },
    // CHS Pipe
    { code: 'MS-CHS-48.3X3.2', categoryId: catTube.id, description: 'Mild Steel CHS 48.3mm OD x 3.2mm x 6000mm', uom: 'M', materialType: 'steel', grade: 'C350L0', shape: 'pipe', standardThickness: 3, standardWidth: 48, standardLength: 6000, weightPerMeter: 3560, costMethod: CostMethod.AVERAGE, standardCost: 520, listPrice: 710, isBought: true, isSold: true, isStocked: true },
    { code: 'MS-CHS-76X3.2', categoryId: catTube.id, description: 'Mild Steel CHS 76.1mm OD x 3.2mm x 6000mm', uom: 'M', materialType: 'steel', grade: 'C350L0', shape: 'pipe', standardThickness: 3, standardWidth: 76, standardLength: 6000, weightPerMeter: 5750, costMethod: CostMethod.AVERAGE, standardCost: 840, listPrice: 1140, isBought: true, isSold: true, isStocked: true },
    // Angle
    { code: 'MS-ANG-65X65X6', categoryId: catLong.id, description: 'Mild Steel Angle 65x65x6mm x 6000mm', uom: 'M', materialType: 'steel', grade: 'G300', shape: 'structural', standardThickness: 6, standardWidth: 65, standardLength: 6000, weightPerMeter: 5730, costMethod: CostMethod.AVERAGE, standardCost: 830, listPrice: 1120, isBought: true, isSold: true, isStocked: true, reorderPoint: 60 },
    { code: 'MS-ANG-100X100X8', categoryId: catLong.id, description: 'Mild Steel Angle 100x100x8mm x 9000mm', uom: 'M', materialType: 'steel', grade: 'G350', shape: 'structural', standardThickness: 8, standardWidth: 100, standardLength: 9000, weightPerMeter: 12200, costMethod: CostMethod.AVERAGE, standardCost: 1750, listPrice: 2350, isBought: true, isSold: true, isStocked: true, reorderPoint: 40 },
    // Channel
    { code: 'MS-PFC-100X50', categoryId: catLong.id, description: 'Mild Steel PFC 100x50mm x 9000mm', uom: 'M', materialType: 'steel', grade: 'G350', shape: 'structural', standardWidth: 100, standardLength: 9000, weightPerMeter: 10700, costMethod: CostMethod.AVERAGE, standardCost: 1580, listPrice: 2120, isBought: true, isSold: true, isStocked: true },
    { code: 'MS-PFC-150X75', categoryId: catLong.id, description: 'Mild Steel PFC 150x75mm x 9000mm', uom: 'M', materialType: 'steel', grade: 'G350', shape: 'structural', standardWidth: 150, standardLength: 9000, weightPerMeter: 18000, costMethod: CostMethod.AVERAGE, standardCost: 2650, listPrice: 3550, isBought: true, isSold: true, isStocked: true },
    // Beam
    { code: 'MS-UB-150X14', categoryId: catLong.id, description: 'Universal Beam 150 UB 14 x 9000mm', uom: 'M', materialType: 'steel', grade: 'G300', shape: 'structural', standardWidth: 150, standardLength: 9000, weightPerMeter: 14200, costMethod: CostMethod.AVERAGE, standardCost: 2100, listPrice: 2850, isBought: true, isSold: true, isStocked: true },
    { code: 'MS-UB-200X25', categoryId: catLong.id, description: 'Universal Beam 200 UB 25 x 9000mm', uom: 'M', materialType: 'steel', grade: 'G300', shape: 'structural', standardWidth: 200, standardLength: 9000, weightPerMeter: 25100, costMethod: CostMethod.AVERAGE, standardCost: 3680, listPrice: 4950, isBought: true, isSold: true, isStocked: true, reorderPoint: 20 },
    { code: 'MS-UC-150X23', categoryId: catLong.id, description: 'Universal Column 150 UC 23 x 6000mm', uom: 'M', materialType: 'steel', grade: 'G300', shape: 'structural', standardWidth: 150, standardLength: 6000, weightPerMeter: 23400, costMethod: CostMethod.AVERAGE, standardCost: 3400, listPrice: 4600, isBought: true, isSold: true, isStocked: true },
    // Aluminium Misc
    { code: 'AL-SHS-50X50X3', categoryId: catTube.id, description: '6061-T6 Aluminium SHS 50x50x3mm x 6000mm', uom: 'M', materialType: 'aluminum', grade: '6061', alloy: 'T6', shape: 'RHS', standardThickness: 3, standardWidth: 50, standardLength: 6000, weightPerMeter: 1390, costMethod: CostMethod.AVERAGE, standardCost: 2100, listPrice: 2900, isBought: true, isSold: true, isStocked: true },
    { code: 'AL-PLT-6X1200X2400', categoryId: catFlat.id, description: '5083-H111 Aluminium Plate 6mm x 1200 x 2400mm', uom: 'EA', materialType: 'aluminum', grade: '5083', alloy: 'H111', shape: 'plate', standardThickness: 6, standardWidth: 1200, standardLength: 2400, weightPerMeter: 16200, costMethod: CostMethod.FIFO, standardCost: 34000, listPrice: 46000, isBought: true, isSold: true, isStocked: true, requiresMtr: true },
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

  // ── 50 Customers ──────────────────────────────────────────────────────────
  const customerDefs = [
    { code: 'ACME-001', name: 'ACME Manufacturing', creditLimit: 5000000, creditTerms: 30, contacts: [{ name: 'John Smith', email: 'john@acme.com', phone: '+1 555 100 0001', isPrimary: true }] },
    { code: 'BLDG-002', name: 'BuildRight Construction', creditLimit: 2500000, creditTerms: 14, contacts: [{ name: 'Sarah Jones', email: 'sjones@buildright.com', phone: '+1 555 100 0002', isPrimary: true }] },
    { code: 'FABR-003', name: 'Precision Fabricators LLC', creditLimit: 1000000, creditTerms: 30, contacts: [{ name: 'Mike Chen', email: 'mike@precisionfab.com', phone: '+1 555 100 0003', isPrimary: true }] },
    { code: 'STLW-004', name: 'SteelWorks Industries', creditLimit: 3000000, creditTerms: 30, contacts: [{ name: 'Lisa Brown', email: 'lbrown@steelworks.com', phone: '+1 555 100 0004', isPrimary: true }] },
    { code: 'MINE-005', name: 'MineCorp Equipment', creditLimit: 8000000, creditTerms: 60, contacts: [{ name: 'Dave Wilson', email: 'dwilson@minecorp.com', phone: '+1 555 100 0005', isPrimary: true }] },
    { code: 'RAIL-006', name: 'Pacific Rail Services', creditLimit: 4000000, creditTerms: 30, contacts: [{ name: 'Tom Andrews', email: 'tandrews@pacrail.com', phone: '+1 555 100 0006', isPrimary: true }] },
    { code: 'HVAC-007', name: 'CoolFlow HVAC Systems', creditLimit: 750000, creditTerms: 14, contacts: [{ name: 'Emma Davis', email: 'edavis@coolflow.com', phone: '+1 555 100 0007', isPrimary: true }] },
    { code: 'SHIP-008', name: 'Harbour Shipbuilding', creditLimit: 12000000, creditTerms: 60, contacts: [{ name: 'James Taylor', email: 'jtaylor@harbourship.com', phone: '+1 555 100 0008', isPrimary: true }] },
    { code: 'ENGR-009', name: 'Advanced Engineering Co', creditLimit: 2000000, creditTerms: 30, contacts: [{ name: 'Rachel Kim', email: 'rkim@adveng.com', phone: '+1 555 100 0009', isPrimary: true }] },
    { code: 'FOOD-010', name: 'FoodPro Equipment', creditLimit: 500000, creditTerms: 14, contacts: [{ name: 'Chris Martin', email: 'cmartin@foodpro.com', phone: '+1 555 100 0010', isPrimary: true }] },
    { code: 'POWE-011', name: 'PowerGen Solutions', creditLimit: 6000000, creditTerms: 45, contacts: [{ name: 'Amanda White', email: 'awhite@powergen.com', phone: '+1 555 100 0011', isPrimary: true }] },
    { code: 'FRAM-012', name: 'FrameTech Structures', creditLimit: 1500000, creditTerms: 21, contacts: [{ name: 'Paul Garcia', email: 'pgarcia@frametech.com', phone: '+1 555 100 0012', isPrimary: true }] },
    { code: 'AGRI-013', name: 'AgriMech Industries', creditLimit: 900000, creditTerms: 30, contacts: [{ name: 'Susan Lee', email: 'slee@agrimech.com', phone: '+1 555 100 0013', isPrimary: true }] },
    { code: 'AUTO-014', name: 'AutoParts Manufacturing', creditLimit: 3500000, creditTerms: 30, contacts: [{ name: 'Brian Moore', email: 'bmoore@autoparts.com', phone: '+1 555 100 0014', isPrimary: true }] },
    { code: 'PETR-015', name: 'PetroTech Services', creditLimit: 10000000, creditTerms: 45, contacts: [{ name: 'Karen Hall', email: 'khall@petrotech.com', phone: '+1 555 100 0015', isPrimary: true }] },
    { code: 'WELD-016', name: 'ProWeld Solutions', creditLimit: 600000, creditTerms: 14, contacts: [{ name: 'Tony Adams', email: 'tadams@proweld.com', phone: '+1 555 100 0016', isPrimary: true }] },
    { code: 'PUMP-017', name: 'FluidFlow Pumps', creditLimit: 1200000, creditTerms: 30, contacts: [{ name: 'Nancy Clark', email: 'nclark@fluidflow.com', phone: '+1 555 100 0017', isPrimary: true }] },
    { code: 'TANK-018', name: 'TankTech Industries', creditLimit: 2200000, creditTerms: 30, contacts: [{ name: 'Steve Rodriguez', email: 'srodriguez@tanktech.com', phone: '+1 555 100 0018', isPrimary: true }] },
    { code: 'CONV-019', name: 'ConveyorPro Systems', creditLimit: 800000, creditTerms: 21, contacts: [{ name: 'Diane Lewis', email: 'dlewis@conveyorpro.com', phone: '+1 555 100 0019', isPrimary: true }] },
    { code: 'GEARB-020', name: 'GearBox Engineering', creditLimit: 450000, creditTerms: 14, contacts: [{ name: 'Frank Walker', email: 'fwalker@gearbox.com', phone: '+1 555 100 0020', isPrimary: true }] },
    { code: 'CONST-021', name: 'Apex Construction Group', creditLimit: 7000000, creditTerms: 45, contacts: [{ name: 'Helen Young', email: 'hyoung@apexcg.com', phone: '+1 555 100 0021', isPrimary: true }] },
    { code: 'CRANE-022', name: 'LiftRight Cranes', creditLimit: 5500000, creditTerms: 30, contacts: [{ name: 'Gary Harris', email: 'gharris@liftright.com', phone: '+1 555 100 0022', isPrimary: true }] },
    { code: 'PRES-023', name: 'PressureVessel Co', creditLimit: 1800000, creditTerms: 30, contacts: [{ name: 'Olivia Scott', email: 'oscott@pressvessel.com', phone: '+1 555 100 0023', isPrimary: true }] },
    { code: 'SAFE-024', name: 'SafeGuard Enclosures', creditLimit: 350000, creditTerms: 14, contacts: [{ name: 'Mark Thompson', email: 'mthompson@safeguard.com', phone: '+1 555 100 0024', isPrimary: true }] },
    { code: 'GATE-025', name: 'GateWay Structures', creditLimit: 950000, creditTerms: 21, contacts: [{ name: 'Patricia King', email: 'pking@gatewayst.com', phone: '+1 555 100 0025', isPrimary: true }] },
    { code: 'DRIL-026', name: 'DrillRight Mining Equip', creditLimit: 9000000, creditTerms: 45, contacts: [{ name: 'Edward Wright', email: 'ewright@drillright.com', phone: '+1 555 100 0026', isPrimary: true }] },
    { code: 'ARCH-027', name: 'ArchMet Architectural', creditLimit: 700000, creditTerms: 21, contacts: [{ name: 'Gloria Baker', email: 'gbaker@archmet.com', phone: '+1 555 100 0027', isPrimary: true }] },
    { code: 'TANK2-028', name: 'OilTank Solutions', creditLimit: 4500000, creditTerms: 30, contacts: [{ name: 'Joseph Nelson', email: 'jnelson@oiltank.com', phone: '+1 555 100 0028', isPrimary: true }] },
    { code: 'BRIG-029', name: 'BridgeTech Engineering', creditLimit: 15000000, creditTerms: 60, contacts: [{ name: 'Margaret Hill', email: 'mhill@bridgetech.com', phone: '+1 555 100 0029', isPrimary: true }] },
    { code: 'ROOF-030', name: 'RoofMet Roofing Systems', creditLimit: 500000, creditTerms: 14, contacts: [{ name: 'Richard Carter', email: 'rcarter@roofmet.com', phone: '+1 555 100 0030', isPrimary: true }] },
    { code: 'MACH-031', name: 'MachineTech Industries', creditLimit: 2800000, creditTerms: 30, contacts: [{ name: 'Sandra Mitchell', email: 'smitchell@machtech.com', phone: '+1 555 100 0031', isPrimary: true }] },
    { code: 'BULK-032', name: 'BulkStore Silos', creditLimit: 1100000, creditTerms: 21, contacts: [{ name: 'Charles Perez', email: 'cperez@bulkstore.com', phone: '+1 555 100 0032', isPrimary: true }] },
    { code: 'STAG-033', name: 'StageCraft Productions', creditLimit: 300000, creditTerms: 7, contacts: [{ name: 'Donna Roberts', email: 'droberts@stagecraft.com', phone: '+1 555 100 0033', isPrimary: true }] },
    { code: 'DOCK-034', name: 'DockMet Port Equipment', creditLimit: 6500000, creditTerms: 45, contacts: [{ name: 'William Turner', email: 'wturner@dockmet.com', phone: '+1 555 100 0034', isPrimary: true }] },
    { code: 'ENRG-035', name: 'SolarFrame Energy', creditLimit: 2300000, creditTerms: 30, contacts: [{ name: 'Betty Phillips', email: 'bphillips@solarframe.com', phone: '+1 555 100 0035', isPrimary: true }] },
    { code: 'VENT-036', name: 'VentilTech Systems', creditLimit: 420000, creditTerms: 14, contacts: [{ name: 'Donald Campbell', email: 'dcampbell@ventiltech.com', phone: '+1 555 100 0036', isPrimary: true }] },
    { code: 'FIRE-037', name: 'FireShield Protection', creditLimit: 650000, creditTerms: 21, contacts: [{ name: 'Ruth Parker', email: 'rparker@fireshield.com', phone: '+1 555 100 0037', isPrimary: true }] },
    { code: 'WTRE-038', name: 'WaterTreat Technologies', creditLimit: 1700000, creditTerms: 30, contacts: [{ name: 'Raymond Evans', email: 'revans@watertreat.com', phone: '+1 555 100 0038', isPrimary: true }] },
    { code: 'FORW-039', name: 'ForestWorks Timber', creditLimit: 380000, creditTerms: 14, contacts: [{ name: 'Shirley Edwards', email: 'sedwards@forestworks.com', phone: '+1 555 100 0039', isPrimary: true }] },
    { code: 'SECU-040', name: 'SecureVault Systems', creditLimit: 850000, creditTerms: 21, contacts: [{ name: 'Walter Collins', email: 'wcollins@securevault.com', phone: '+1 555 100 0040', isPrimary: true }] },
    { code: 'COLD-041', name: 'ColdChain Storage', creditLimit: 1400000, creditTerms: 30, contacts: [{ name: 'Joyce Stewart', email: 'jstewart@coldchain.com', phone: '+1 555 100 0041', isPrimary: true }] },
    { code: 'LIFT-042', name: 'LiftShaft Elevators', creditLimit: 3200000, creditTerms: 30, contacts: [{ name: 'Henry Sanchez', email: 'hsanchez@liftshaft.com', phone: '+1 555 100 0042', isPrimary: true }] },
    { code: 'WELD2-043', name: 'AusWeld Fabrications', creditLimit: 720000, creditTerms: 14, contacts: [{ name: 'Virginia Morris', email: 'vmorris@ausweld.com', phone: '+1 555 100 0043', isPrimary: true }] },
    { code: 'SOLAR-044', name: 'SunMount Racking', creditLimit: 550000, creditTerms: 21, contacts: [{ name: 'Eugene Rogers', email: 'erogers@sunmount.com', phone: '+1 555 100 0044', isPrimary: true }] },
    { code: 'HIWY-045', name: 'HighWay Barriers', creditLimit: 4800000, creditTerms: 45, contacts: [{ name: 'Judy Reed', email: 'jreed@highwaybarriers.com', phone: '+1 555 100 0045', isPrimary: true }] },
    { code: 'COMM-046', name: 'CommercialKit Interiors', creditLimit: 280000, creditTerms: 7, contacts: [{ name: 'Dennis Cook', email: 'dcook@commercialkit.com', phone: '+1 555 100 0046', isPrimary: true }] },
    { code: 'TELE-047', name: 'TeleTower Structures', creditLimit: 6200000, creditTerms: 45, contacts: [{ name: 'Carolyn Morgan', email: 'cmorgan@teletower.com', phone: '+1 555 100 0047', isPrimary: true }] },
    { code: 'GATE2-048', name: 'SecureGate Fencing', creditLimit: 470000, creditTerms: 14, contacts: [{ name: 'Arthur Bell', email: 'abell@securegate.com', phone: '+1 555 100 0048', isPrimary: true }] },
    { code: 'NAUT-049', name: 'NauticalCraft Marine', creditLimit: 3800000, creditTerms: 30, contacts: [{ name: 'Mildred Murphy', email: 'mmurphy@nauticalcraft.com', phone: '+1 555 100 0049', isPrimary: true }] },
    { code: 'AERO-050', name: 'AeroFrame Aerospace', creditLimit: 20000000, creditTerms: 60, contacts: [{ name: 'Lawrence Bailey', email: 'lbailey@aeroframe.com', phone: '+1 555 100 0050', isPrimary: true }] },
  ];

  const createdCustomers: { id: string; code: string; name: string }[] = [];
  for (const cust of customerDefs) {
    const c = await prisma.customer.upsert({
      where: { companyId_code: { companyId: company.id, code: cust.code } },
      update: {},
      create: {
        companyId: company.id,
        code: cust.code,
        name: cust.name,
        creditLimit: cust.creditLimit,
        creditTerms: cust.creditTerms,
        contacts: cust.contacts,
        isActive: true,
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });
    createdCustomers.push({ id: c.id, code: c.code, name: c.name });
  }
  console.log('✔ Customers seeded:', createdCustomers.length);

  // ── 10 Suppliers ──────────────────────────────────────────────────────────
  const supplierDefs = [
    { code: 'NUCOR-001', name: 'Nucor Steel', legalName: 'Nucor Corporation', paymentTerms: 30, currencyCode: 'USD', contactName: 'Mike Reynolds', contactEmail: 'mreynolds@nucor.com', contactPhone: '+1 704 366 7000' },
    { code: 'RYERSON-002', name: 'Ryerson Metals', legalName: 'Ryerson Tull Inc', paymentTerms: 45, currencyCode: 'USD', contactName: 'Janet Foster', contactEmail: 'jfoster@ryerson.com', contactPhone: '+1 773 762 2121' },
    { code: 'BLUESCOPE-003', name: 'BlueScope Steel', legalName: 'BlueScope Steel Limited', paymentTerms: 30, currencyCode: 'USD', contactName: 'Andrew McLeod', contactEmail: 'amcleod@bluescope.com', contactPhone: '+61 2 9080 3000' },
    { code: 'METALS4U-004', name: 'Metals4U', legalName: 'Metals4U Pty Ltd', paymentTerms: 14, currencyCode: 'USD', contactName: 'Rebecca Stone', contactEmail: 'rstone@metals4u.com', contactPhone: '+1 800 555 0104' },
    { code: 'SSAB-005', name: 'SSAB Americas', legalName: 'SSAB Swedish Steel Inc', paymentTerms: 30, currencyCode: 'USD', contactName: 'Lars Eriksson', contactEmail: 'lars.eriksson@ssab.com', contactPhone: '+1 800 255 6003' },
    { code: 'RELIANCE-006', name: 'Reliance Steel', legalName: 'Reliance Steel & Aluminum Co', paymentTerms: 30, currencyCode: 'USD', contactName: 'Patricia Nguyen', contactEmail: 'pnguyen@rsac.com', contactPhone: '+1 213 687 7700' },
    { code: 'SERVICE-007', name: 'ServiceCenter Direct', legalName: 'ServiceCenter Direct LLC', paymentTerms: 21, currencyCode: 'USD', contactName: 'Kevin Brady', contactEmail: 'kbrady@scdirect.com', contactPhone: '+1 312 555 0107' },
    { code: 'SAMUEL-008', name: 'Samuel Steel', legalName: 'Samuel, Son & Co', paymentTerms: 45, currencyCode: 'USD', contactName: 'Catherine Walsh', contactEmail: 'cwalsh@samuel.com', contactPhone: '+1 905 827 4111' },
    { code: 'STLTECH-009', name: 'SteelTech Supply', legalName: 'SteelTech Supply Pty Ltd', paymentTerms: 21, currencyCode: 'USD', contactName: 'Robert Cheng', contactEmail: 'rcheng@steeltech.com', contactPhone: '+1 800 555 0109' },
    { code: 'ATLAS-010', name: 'Atlas Metals', legalName: 'Atlas Metals & Materials Inc', paymentTerms: 30, currencyCode: 'USD', contactName: 'Jennifer Patel', contactEmail: 'jpatel@atlasmetals.com', contactPhone: '+1 800 555 0110' },
  ];

  const createdSuppliers: { id: string; code: string; name: string }[] = [];
  for (const sup of supplierDefs) {
    const { contactName, contactEmail, contactPhone, ...supData } = sup;
    const s = await prisma.supplier.upsert({
      where: { companyId_code: { companyId: company.id, code: sup.code } },
      update: {},
      create: {
        companyId: company.id,
        ...supData,
        contacts: [{ name: contactName, email: contactEmail, phone: contactPhone, isPrimary: true }],
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });
    createdSuppliers.push({ id: s.id, code: s.code, name: s.name });
  }
  console.log('✔ Suppliers seeded:', createdSuppliers.length);

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

  // ── Sample Sales Orders (needed for invoices, work orders, manifests) ─────
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 86400000);

  const soCustomers = createdCustomers.slice(0, 12);
  const createdSOs: { id: string; orderNumber: string; customerId: string; totalAmount: number }[] = [];

  const soData = [
    { customer: soCustomers[0], amount: 4850000, status: 'SHIPPED' as const, daysOld: 45 },
    { customer: soCustomers[1], amount: 1230000, status: 'INVOICED' as const, daysOld: 60 },
    { customer: soCustomers[2], amount: 875000, status: 'IN_PRODUCTION' as const, daysOld: 7 },
    { customer: soCustomers[3], amount: 2640000, status: 'CONFIRMED' as const, daysOld: 3 },
    { customer: soCustomers[4], amount: 9900000, status: 'DRAFT' as const, daysOld: 1 },
    { customer: soCustomers[5], amount: 3175000, status: 'READY_TO_SHIP' as const, daysOld: 10 },
    { customer: soCustomers[6], amount: 560000, status: 'SHIPPED' as const, daysOld: 30 },
    { customer: soCustomers[7], amount: 7200000, status: 'IN_PRODUCTION' as const, daysOld: 5 },
    { customer: soCustomers[8], amount: 1450000, status: 'CONFIRMED' as const, daysOld: 2 },
    { customer: soCustomers[9], amount: 380000, status: 'CLOSED' as const, daysOld: 90 },
    { customer: soCustomers[10], amount: 2100000, status: 'DRAFT' as const, daysOld: 0 },
    { customer: soCustomers[11], amount: 6600000, status: 'CONFIRMED' as const, daysOld: 4 },
  ];

  for (let i = 0; i < soData.length; i++) {
    const so = soData[i];
    const orderNum = `SO-${String(i + 1).padStart(6, '0')}`;
    const existing = await prisma.salesOrder.findFirst({ where: { companyId: company.id, orderNumber: orderNum } });
    if (!existing) {
      const created = await prisma.salesOrder.create({
        data: {
          companyId: company.id,
          branchId: mainBranch.id,
          customerId: so.customer.id,
          orderNumber: orderNum,
          status: so.status,
          orderDate: daysAgo(so.daysOld),
          requiredDate: daysFromNow(14),
          currencyCode: 'USD',
          subtotal: BigInt(so.amount),
          totalAmount: BigInt(so.amount),
          notes: `Sample sales order for ${so.customer.name}`,
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
          lines: {
            create: [{
              lineNumber: 1,
              productId: createdProducts[i % createdProducts.length].id,
              description: `Steel materials — ${so.customer.name}`,
              uom: 'EA',
              qtyOrdered: 10,
              unitPrice: BigInt(Math.round(so.amount / 10)),
              lineTotal: BigInt(so.amount),
              createdBy: adminUser.id,
            }],
          },
        },
      });
      createdSOs.push({ id: created.id, orderNumber: orderNum, customerId: so.customer.id, totalAmount: so.amount });
    } else {
      createdSOs.push({ id: existing.id, orderNumber: orderNum, customerId: so.customer.id, totalAmount: so.amount });
    }
  }
  console.log('✔ Sample sales orders seeded:', createdSOs.length);

  // ── Sample Work Orders ────────────────────────────────────────────────────
  const woStatuses = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'IN_PROGRESS', 'SCHEDULED', 'COMPLETED', 'IN_PROGRESS', 'DRAFT', 'COMPLETED', 'SCHEDULED'];
  for (let i = 0; i < 10; i++) {
    const woNum = `WO-${String(i + 1).padStart(6, '0')}`;
    const existing = await prisma.workOrder.findFirst({ where: { companyId: company.id, workOrderNumber: woNum } });
    if (!existing) {
      await prisma.workOrder.create({
        data: {
          companyId: company.id,
          branchId: mainBranch.id,
          salesOrderId: i < createdSOs.length ? createdSOs[i].id : null,
          workOrderNumber: woNum,
          status: woStatuses[i] as any,
          priority: (i % 5) + 1,
          scheduledDate: daysFromNow(i * 2),
          notes: `Work order ${i + 1} — cutting and processing`,
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
    }
  }
  console.log('✔ Work orders seeded: 10');

  // ── Sample Shipping Manifests ─────────────────────────────────────────────
  const manifestStatuses = ['PENDING', 'PENDING', 'SHIPPED', 'DELIVERED', 'DELIVERED', 'SHIPPED', 'PENDING', 'DELIVERED'];
  const carriers = ['TNT', 'Toll Priority', 'StarTrack', 'FedEx', 'DHL', 'Mainfreight', 'Linfox', 'TNT'];
  for (let i = 0; i < 8; i++) {
    const manNum = `MAN-${String(i + 1).padStart(6, '0')}`;
    const existing = await prisma.shipmentManifest.findFirst({ where: { companyId: company.id, manifestNumber: manNum } });
    if (!existing) {
      await prisma.shipmentManifest.create({
        data: {
          companyId: company.id,
          salesOrderId: i < createdSOs.length ? createdSOs[i].id : null,
          manifestNumber: manNum,
          status: manifestStatuses[i] as any,
          carrier: carriers[i],
          trackingNumber: `TRK${String(100000 + i).padStart(10, '0')}`,
          shipDate: manifestStatuses[i] !== 'PENDING' ? daysAgo(10 - i) : null,
          deliveredAt: manifestStatuses[i] === 'DELIVERED' ? daysAgo(8 - i) : null,
          notes: `Delivery to ${createdCustomers[i % createdCustomers.length].name}`,
          createdBy: adminUser.id,
        },
      });
    }
  }
  console.log('✔ Shipping manifests seeded: 8');

  // ── Sample AR Invoices ────────────────────────────────────────────────────
  const invStatuses: Array<'SENT' | 'PAID' | 'OVERDUE' | 'PARTIALLY_PAID' | 'DRAFT'> = [
    'SENT', 'PAID', 'OVERDUE', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'SENT', 'DRAFT', 'OVERDUE',
    'PAID', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID',
  ];
  for (let i = 0; i < 15; i++) {
    const invNum = `INV-${String(i + 1).padStart(6, '0')}`;
    const existing = await prisma.invoice.findFirst({ where: { companyId: company.id, invoiceNumber: invNum } });
    if (!existing) {
      const custIdx = i % createdCustomers.length;
      const total = BigInt([4850000, 1230000, 875000, 2640000, 9900000, 3175000, 560000, 7200000, 1450000, 380000, 2100000, 6600000, 990000, 1750000, 3200000][i]);
      const status = invStatuses[i];
      const paid = status === 'PAID' ? total : status === 'PARTIALLY_PAID' ? total / BigInt(2) : BigInt(0);
      const due = total - paid;
      const invoiceDate = daysAgo(30 + i * 3);
      const dueDate = new Date(invoiceDate.getTime() + 30 * 86400000);

      await prisma.invoice.create({
        data: {
          companyId: company.id,
          customerId: createdCustomers[custIdx].id,
          invoiceNumber: invNum,
          status,
          invoiceDate,
          dueDate,
          currencyCode: 'USD',
          subtotal: total,
          totalAmount: total,
          amountPaid: paid,
          balanceDue: due,
          notes: `Invoice for ${createdCustomers[custIdx].name}`,
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
          lines: {
            create: [{
              lineNumber: 1,
              description: 'Steel materials and processing',
              uom: 'EA',
              qty: 1,
              unitPrice: total,
              lineSubtotal: total,
              lineTotal: total,
            }],
          },
        },
      });
    }
  }
  console.log('✔ AR Invoices seeded: 15');

  // ── Sample AP Invoices (Supplier Invoices) ────────────────────────────────
  const apStatuses: Array<'PENDING' | 'APPROVED' | 'PAID' | 'PARTIALLY_PAID'> = [
    'PENDING', 'APPROVED', 'PAID', 'PENDING', 'APPROVED', 'PAID', 'PARTIALLY_PAID', 'PENDING', 'APPROVED', 'PAID',
  ];
  for (let i = 0; i < 10; i++) {
    const supIdx = i % createdSuppliers.length;
    const apNum = `AP-INV-${String(i + 1).padStart(5, '0')}`;
    // SupplierInvoice doesn't have a unique constraint on invoiceNumber per supplier, just check
    const existing = await prisma.supplierInvoice.findFirst({ where: { supplierId: createdSuppliers[supIdx].id, invoiceNumber: apNum } });
    if (!existing) {
      const total = BigInt([2400000, 1800000, 3600000, 900000, 5400000, 1200000, 720000, 4800000, 660000, 2100000][i]);
      const status = apStatuses[i];
      const paid = status === 'PAID' ? total : status === 'PARTIALLY_PAID' ? total / BigInt(2) : BigInt(0);
      const invoiceDate = daysAgo(20 + i * 4);
      const dueDate = new Date(invoiceDate.getTime() + 30 * 86400000);

      await prisma.supplierInvoice.create({
        data: {
          supplierId: createdSuppliers[supIdx].id,
          invoiceNumber: apNum,
          invoiceDate,
          dueDate,
          status,
          subtotal: total,
          totalAmount: total,
          amountPaid: paid,
          notes: `Invoice from ${createdSuppliers[supIdx].name}`,
          createdBy: adminUser.id,
        },
      });
    }
  }
  console.log('✔ AP Invoices seeded: 10');

  // ── Shipping Manifests ────────────────────────────────────────────────────
  const carriers = ['Toll', 'TNT', 'Startrack', 'Linfox', 'Border Express', 'Direct Freight'];
  const shipStatuses = ['DELIVERED', 'DELIVERED', 'DELIVERED', 'DISPATCHED', 'DISPATCHED', 'CONFIRMED', 'DRAFT'];
  const createdSOs = await prisma.salesOrder.findMany({ where: { companyId: company.id }, take: 12, include: { customer: true } });
  let manifestCount = 0;
  for (let i = 0; i < Math.min(10, createdSOs.length); i++) {
    const so = createdSOs[i];
    const status = shipStatuses[i % shipStatuses.length] as 'DELIVERED' | 'DISPATCHED' | 'CONFIRMED' | 'DRAFT';
    const dispatchDate = daysFromNow(-30 + i * 3);
    const mNum = `MAN-${String(i + 1).padStart(6, '0')}`;
    const existing = await (prisma as any).shipmentManifest.findFirst({ where: { companyId: company.id, manifestNumber: mNum } });
    if (!existing) {
      await (prisma as any).shipmentManifest.create({
        data: {
          companyId: company.id,
          salesOrderId: so.id,
          manifestNumber: mNum,
          status,
          dispatchDate,
          deliveredDate: status === 'DELIVERED' ? new Date(dispatchDate.getTime() + 2 * 24 * 60 * 60 * 1000) : null,
          carrier: carriers[i % carriers.length],
          trackingNumber: status !== 'DRAFT' ? `TRK${String(100000 + i * 7).padStart(8, '0')}` : null,
          deliveryAddress: `${so.customer.name}, 123 Industrial Ave, Perth WA 6000`,
          notes: `Delivery for ${so.orderNumber}`,
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      manifestCount++;
    }
  }
  console.log('✔ Shipping manifests seeded:', manifestCount);

  // ── CRM Call Reports ──────────────────────────────────────────────────────
  const prospects = await (prisma as any).prospect.findMany({ where: { companyId: company.id }, take: 20 });
  const callTypes = ['CALL', 'EMAIL', 'MEETING', 'VISIT'];
  const callOutcomes = ['Interested, following up', 'Requested quote', 'Not ready yet', 'Strong interest', 'Meeting scheduled', 'Awaiting decision'];
  let callReportCount = 0;
  for (let i = 0; i < Math.min(15, prospects.length); i++) {
    const prospect = prospects[i];
    const existing = await (prisma as any).callReport.findFirst({ where: { prospectId: prospect.id } });
    if (!existing) {
      await (prisma as any).callReport.create({
        data: {
          companyId: company.id,
          prospectId: prospect.id,
          userId: adminUser.id,
          callDate: daysFromNow(-10 + i),
          type: callTypes[i % callTypes.length],
          subject: `${callTypes[i % callTypes.length]} with ${prospect.contactName ?? prospect.companyName}`,
          notes: callOutcomes[i % callOutcomes.length],
          outcome: callOutcomes[i % callOutcomes.length],
          createdBy: adminUser.id,
        },
      });
      callReportCount++;
    }
  }
  console.log('✔ CRM call reports seeded:', callReportCount);

  // ── Cashflow Entries ──────────────────────────────────────────────────────
  const cfEntries = [
    { type: 'OPENING_BALANCE', amount: BigInt(25000000), description: 'Opening bank balance', daysOffset: -30 },
    { type: 'MANUAL_INCOME',   amount: BigInt(4500000),  description: 'Customer payment — ACME Manufacturing', daysOffset: -25 },
    { type: 'MANUAL_EXPENSE',  amount: BigInt(-1800000), description: 'Supplier payment — Steel Direct', daysOffset: -22 },
    { type: 'MANUAL_INCOME',   amount: BigInt(7200000),  description: 'Customer payment — BuildRight Construction', daysOffset: -18 },
    { type: 'MANUAL_EXPENSE',  amount: BigInt(-3200000), description: 'Payroll — Week ending', daysOffset: -14 },
    { type: 'MANUAL_EXPENSE',  amount: BigInt(-950000),  description: 'Rent & occupancy', daysOffset: -10 },
    { type: 'MANUAL_INCOME',   amount: BigInt(3100000),  description: 'Customer payment — SteelWorks Industries', daysOffset: -7 },
    { type: 'MANUAL_EXPENSE',  amount: BigInt(-620000),  description: 'Insurance premium', daysOffset: -5 },
  ];
  for (const entry of cfEntries) {
    const entryDate = daysFromNow(entry.daysOffset); entryDate.setHours(0, 0, 0, 0);
    const existing = await (prisma as any).cashFlowEntry.findFirst({ where: { companyId: company.id, type: entry.type, entryDate } });
    if (!existing) {
      await (prisma as any).cashFlowEntry.create({
        data: { companyId: company.id, entryDate, type: entry.type, amount: entry.amount, description: entry.description, createdBy: adminUser.id },
      });
    }
  }
  console.log('✔ Cashflow entries seeded: 8');

  // ── CRM Pipeline Stages ───────────────────────────────────────────────────
  const defaultStages = [
    { name: 'LEAD', color: 'gray', order: 0, isWon: false, isLost: false },
    { name: 'CONTACTED', color: 'blue', order: 1, isWon: false, isLost: false },
    { name: 'QUALIFIED', color: 'teal', order: 2, isWon: false, isLost: false },
    { name: 'PROPOSAL', color: 'amber', order: 3, isWon: false, isLost: false },
    { name: 'NEGOTIATION', color: 'orange', order: 4, isWon: false, isLost: false },
    { name: 'WON', color: 'green', order: 5, isWon: true, isLost: false },
    { name: 'LOST', color: 'red', order: 6, isWon: false, isLost: true },
  ];

  for (const stage of defaultStages) {
    const existing = await (prisma as any).pipelineStage.findFirst({ where: { companyId: company.id, name: stage.name } });
    if (!existing) {
      await (prisma as any).pipelineStage.create({ data: { companyId: company.id, ...stage } });
    }
  }
  console.log('✔ CRM pipeline stages seeded: 7');

  // ── 50 CRM Prospects ─────────────────────────────────────────────────────
  const prospectStages = ['LEAD', 'LEAD', 'CONTACTED', 'CONTACTED', 'QUALIFIED', 'QUALIFIED', 'PROPOSAL', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'CONTACTED'];
  const industries = ['Manufacturing', 'Construction', 'Mining', 'Energy', 'Marine', 'Agriculture', 'Automotive', 'Aerospace'];
  const prospectNames = [
    ['Iron Ridge Mining', 'Tom Hanson'], ['SteelFrame Builders', 'Angela Morris'], ['Pacific Pipe Works', 'Liam Chen'],
    ['EquipCraft Industries', 'Sophia Turner'], ['NorthernMet Resources', 'Jake Williams'], ['Delta Construction', 'Olivia Brown'],
    ['Coastline Fabricators', 'Noah Davis'], ['HydroMet Engineering', 'Ava Martinez'], ['RockSolid Structures', 'Elijah Johnson'],
    ['OceanFloor Tech', 'Emma Wilson'], ['GreenField Energy', 'Mason Anderson'], ['Summit Mining Co', 'Isabella Thomas'],
    ['Rapid Build Solutions', 'Aiden Taylor'], ['DeepSea Systems', 'Mia Jackson'], ['CraneOps International', 'Lucas White'],
    ['TerraFirm Drilling', 'Charlotte Harris'], ['BlastRight Mining', 'Ethan Martin'], ['PortMet Services', 'Amelia Thompson'],
    ['LineMet Pipelines', 'Oliver Garcia'], ['BridgeWorks Inc', 'Harper Martinez'], ['UrbanSteel Group', 'Benjamin Robinson'],
    ['FuturePipe Ventures', 'Evelyn Clark'], ['AlloyTech Corp', 'Sebastian Rodriguez'], ['SpanMet Structures', 'Abigail Lewis'],
    ['HarborCraft Boats', 'Matthew Lee'], ['PrimeMet Solutions', 'Scarlett Walker'], ['TechFrame Modular', 'Alexander Hall'],
    ['NextGen Steel', 'Sofia Allen'], ['ProBuild Contractors', 'James Young'], ['MetalCore Industries', 'Chloe Hernandez'],
    ['DataCenter Build', 'Benjamin King'], ['SkyFrame Towers', 'Penelope Wright'], ['FlexMet Fabricators', 'Levi Lopez'],
    ['PrecisionCut Co', 'Victoria Hill'], ['SafetyFirst Barriers', 'Jack Scott'], ['AtlasMet Resources', 'Aria Green'],
    ['DuraMet Structures', 'Owen Adams'], ['AceMet Holdings', 'Hannah Baker'], ['CoreFab Engineering', 'Sebastian Gonzalez'],
    ['VibeMet Solutions', 'Elena Nelson'], ['BluePrint Steel', 'Julian Carter'], ['NovaMet Industries', 'Stella Mitchell'],
    ['EdgeFrame Structures', 'Kai Perez'], ['SolidMet Corp', 'Naomi Roberts'], ['ZenithSteel Group', 'Aaron Turner'],
    ['GroundBreak Mining', 'Lily Phillips'], ['SteelPath Solutions', 'Caleb Campbell'], ['TerraSteel Resources', 'Zoe Parker'],
    ['ArcMet Fabricators', 'Dylan Evans'], ['FusionMet Corp', 'Layla Edwards'],
  ];

  let prospectCount = 0;
  for (let i = 0; i < 50; i++) {
    const [company_name, contact_name] = prospectNames[i];
    const stage = prospectStages[i % prospectStages.length];
    const existing = await (prisma as any).prospect.findFirst({ where: { companyId: company.id, companyName: company_name } });
    if (!existing) {
      await (prisma as any).prospect.create({
        data: {
          companyId: company.id,
          companyName: company_name,
          contactName: contact_name,
          email: `${contact_name.toLowerCase().replace(' ', '.')}@${company_name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')}.com`,
          phone: `+1 555 ${String(200 + i).padStart(3, '0')} ${String(1000 + i).padStart(4, '0')}`,
          stage,
          industry: industries[i % industries.length],
          estimatedValue: BigInt([500000, 1200000, 800000, 2500000, 350000, 4000000, 1500000, 900000, 3200000, 600000][i % 10]),
          probability: { LEAD: 10, CONTACTED: 20, QUALIFIED: 40, PROPOSAL: 60, NEGOTIATION: 75, WON: 100, LOST: 0 }[stage] ?? 50,
          nextFollowUp: daysFromNow(7 + (i % 14)),
          notes: `Interested in structural steel and processing services. Initial contact via ${i % 3 === 0 ? 'trade show' : i % 3 === 1 ? 'website inquiry' : 'referral'}.`,
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      prospectCount++;
    }
  }
  console.log('✔ CRM prospects seeded:', prospectCount);

  console.log('\n✅ Seeding complete!');
  console.log('   Login: admin@dicandilo.com');
  console.log('   Password: Admin@12345');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
