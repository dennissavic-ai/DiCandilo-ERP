/**
 * Unit tests for inventory business logic
 */

// ── Stock quantity calculations ────────────────────────────────────────────────

function calculateAvailableQty(onHand: number, allocated: number): number {
  return Math.max(0, onHand - allocated);
}

function calculateWeightKg(weightGrams: number): number {
  return weightGrams / 1000;
}

function calculateWeightLbs(weightGrams: number): number {
  return weightGrams / 453.592;
}

function mmToInches(mm: number): number {
  return mm / 25.4;
}

function mmToFeet(mm: number): number {
  return mm / 304.8;
}

function centsToDisplay(cents: number, decimals = 2): string {
  return (cents / 100).toFixed(decimals);
}

function calculateAverageCost(
  existingQty: number,
  existingCostCents: number,
  newQty: number,
  newCostCents: number
): number {
  const totalQty = existingQty + newQty;
  if (totalQty === 0) return 0;
  const totalCost = existingQty * existingCostCents + newQty * newCostCents;
  return Math.round(totalCost / totalQty);
}

function calculateInventoryValue(qtyOnHand: number, unitCostCents: number): number {
  return Math.round(qtyOnHand * unitCostCents);
}

// ── FIFO queue ─────────────────────────────────────────────────────────────────

interface FIFOLayer {
  qty: number;
  costCents: number;
}

function fifoIssue(
  layers: FIFOLayer[],
  qtyToIssue: number
): { remaining: FIFOLayer[]; costOfGoodsSold: number; qtyIssued: number } {
  const remaining = layers.map((l) => ({ ...l }));
  let qtyLeft = qtyToIssue;
  let cogs = 0;

  for (const layer of remaining) {
    if (qtyLeft <= 0) break;
    const take = Math.min(qtyLeft, layer.qty);
    cogs += take * layer.costCents;
    layer.qty -= take;
    qtyLeft -= take;
  }

  return {
    remaining: remaining.filter((l) => l.qty > 0),
    costOfGoodsSold: cogs,
    qtyIssued: qtyToIssue - qtyLeft,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Inventory Quantity Logic', () => {
  it('calculates available quantity', () => {
    expect(calculateAvailableQty(100, 30)).toBe(70);
    expect(calculateAvailableQty(10, 10)).toBe(0);
    expect(calculateAvailableQty(5, 8)).toBe(0); // never negative
  });

  it('converts weight from grams to kg', () => {
    expect(calculateWeightKg(15000)).toBe(15);
    expect(calculateWeightKg(500)).toBe(0.5);
  });

  it('converts weight from grams to lbs', () => {
    expect(calculateWeightLbs(453592)).toBeCloseTo(1000, 0);
  });

  it('converts mm to inches', () => {
    expect(mmToInches(25.4)).toBeCloseTo(1, 5);
    expect(mmToInches(304.8)).toBeCloseTo(12, 5);
  });

  it('converts mm to feet', () => {
    expect(mmToFeet(304.8)).toBeCloseTo(1, 5);
    expect(mmToFeet(6000)).toBeCloseTo(19.685, 2);
  });
});

describe('Financial Calculations', () => {
  it('converts cents to display string', () => {
    expect(centsToDisplay(10050)).toBe('100.50');
    expect(centsToDisplay(0)).toBe('0.00');
    expect(centsToDisplay(99)).toBe('0.99');
  });

  it('calculates average cost on receipt', () => {
    // 100 units @ $1.80 + 50 units @ $2.10 = (180 + 105) / 150 = $1.90
    const avg = calculateAverageCost(100, 180, 50, 210);
    expect(avg).toBe(190);
  });

  it('handles average cost when existing qty is zero', () => {
    const avg = calculateAverageCost(0, 0, 50, 200);
    expect(avg).toBe(200);
  });

  it('calculates inventory value', () => {
    expect(calculateInventoryValue(100, 1800)).toBe(180000); // 100 * $18.00 = $1800.00
  });
});

describe('FIFO Issue Logic', () => {
  it('issues from oldest layer first', () => {
    const layers: FIFOLayer[] = [
      { qty: 50, costCents: 100 }, // $1.00 — oldest
      { qty: 50, costCents: 120 }, // $1.20 — newest
    ];
    const result = fifoIssue(layers, 30);
    expect(result.qtyIssued).toBe(30);
    expect(result.costOfGoodsSold).toBe(3000); // 30 * $1.00
    expect(result.remaining[0].qty).toBe(20); // 50 - 30 remaining in layer 1
    expect(result.remaining[1].qty).toBe(50); // layer 2 untouched
  });

  it('spans multiple layers when first is exhausted', () => {
    const layers: FIFOLayer[] = [
      { qty: 20, costCents: 100 },
      { qty: 80, costCents: 150 },
    ];
    const result = fifoIssue(layers, 50);
    expect(result.qtyIssued).toBe(50);
    // 20 * 100 + 30 * 150 = 2000 + 4500 = 6500
    expect(result.costOfGoodsSold).toBe(6500);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].qty).toBe(50); // 80 - 30 remaining
  });

  it('issues exactly what is available when requested exceeds stock', () => {
    const layers: FIFOLayer[] = [{ qty: 10, costCents: 100 }];
    const result = fifoIssue(layers, 25);
    expect(result.qtyIssued).toBe(10);
    expect(result.remaining).toHaveLength(0);
  });

  it('returns empty remaining when all stock is consumed', () => {
    const layers: FIFOLayer[] = [
      { qty: 10, costCents: 100 },
      { qty: 10, costCents: 120 },
    ];
    const result = fifoIssue(layers, 20);
    expect(result.remaining).toHaveLength(0);
    expect(result.qtyIssued).toBe(20);
  });
});
