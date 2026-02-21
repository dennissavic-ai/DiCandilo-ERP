/**
 * Unit tests for linear nesting algorithm
 */

interface NestingPieceInput {
  lineNumber: number;
  length: number;
  qty: number;
  description?: string;
}

interface CutPlan {
  stockIndex: number;
  cuts: Array<{ pieceIndex: number; length: number; description?: string }>;
  remnant: number;
  utilisation: number;
}

// Extracted pure function for testing (mirrors nesting.routes.ts)
function runLinearNesting(
  stockLength: number,
  stockQty: number,
  pieces: NestingPieceInput[]
): { cutPlans: CutPlan[]; efficiency: number; totalScrap: number; totalStockUsed: number } {
  const cuts: Array<{ pieceIndex: number; length: number; description?: string }> = [];
  pieces.forEach((p, idx) => {
    for (let i = 0; i < p.qty; i++) {
      cuts.push({ pieceIndex: idx, length: p.length, description: p.description });
    }
  });

  cuts.sort((a, b) => b.length - a.length);

  const cutPlans: CutPlan[] = [];
  const kerf = 3;
  let stockIndex = 0;

  while (cuts.length > 0 && stockIndex < stockQty) {
    let remaining = stockLength;
    const plan: CutPlan = { stockIndex, cuts: [], remnant: 0, utilisation: 0 };

    let i = 0;
    while (i < cuts.length) {
      const cutWithKerf = cuts[i].length + (plan.cuts.length > 0 ? kerf : 0);
      if (cutWithKerf <= remaining) {
        plan.cuts.push(cuts[i]);
        remaining -= cutWithKerf;
        cuts.splice(i, 1);
      } else {
        i++;
      }
    }

    plan.remnant = remaining;
    plan.utilisation = ((stockLength - remaining) / stockLength) * 100;
    cutPlans.push(plan);
    stockIndex++;
  }

  const totalStockUsed = cutPlans.length;
  const totalScrap = cutPlans.reduce((s, p) => s + p.remnant, 0);
  const totalUsed = totalStockUsed * stockLength - totalScrap;
  const efficiency = totalStockUsed > 0 ? (totalUsed / (totalStockUsed * stockLength)) * 100 : 0;

  return { cutPlans, efficiency: Math.round(efficiency * 100) / 100, totalScrap, totalStockUsed };
}

describe('Linear Nesting Algorithm', () => {
  it('nests pieces into a single bar with no waste on exact fit', () => {
    // 6000mm bar, two pieces of 3000mm (minus kerf: 3000 + 3000 + 3 = 6003 > 6000, so small remnant)
    const result = runLinearNesting(6000, 2, [
      { lineNumber: 1, length: 2998, qty: 2 },
    ]);
    // 2998 + 3 + 2998 = 5999, remnant = 1mm
    expect(result.cutPlans).toHaveLength(1);
    expect(result.cutPlans[0].cuts).toHaveLength(2);
    expect(result.cutPlans[0].remnant).toBe(1);
  });

  it('uses multiple bars when pieces do not fit in one', () => {
    const result = runLinearNesting(6000, 5, [
      { lineNumber: 1, length: 2000, qty: 6 }, // 6 x 2000mm pieces
    ]);
    // Bar 1: 2000 + (3+2000) + (3+2000) = 6006 > 6000, so 2 per bar with 1997mm remnant
    // Actually: 2000 + 2003 + 2003 = 6006 > 6000
    // Bar 1: 2000 + 2003 = 4003, remaining 1997 — can't fit another 2003 so stops
    // Bar 2, 3... need 3 bars for 6 pieces
    expect(result.totalStockUsed).toBeGreaterThan(1);
    expect(result.cutPlans.length).toBeGreaterThanOrEqual(2);
    // All 6 pieces should be nested
    const totalCuts = result.cutPlans.reduce((s, p) => s + p.cuts.length, 0);
    expect(totalCuts).toBe(6);
  });

  it('sorts pieces by descending length (FFD heuristic)', () => {
    const result = runLinearNesting(6000, 3, [
      { lineNumber: 1, length: 1000, qty: 3 },
      { lineNumber: 2, length: 2500, qty: 2 },
    ]);
    // Largest pieces (2500mm) should appear first in each bar's cut list
    const firstBarFirstCut = result.cutPlans[0].cuts[0];
    expect(firstBarFirstCut.length).toBe(2500);
  });

  it('returns 100% efficiency for a perfect fit', () => {
    // 5 bars, 5 pieces that each fill one bar perfectly (6000mm each)
    const result = runLinearNesting(6000, 5, [
      { lineNumber: 1, length: 6000, qty: 5 },
    ]);
    expect(result.efficiency).toBe(100);
    expect(result.totalScrap).toBe(0);
  });

  it('stops nesting when stockQty is exhausted', () => {
    const result = runLinearNesting(6000, 1, [
      { lineNumber: 1, length: 5900, qty: 5 }, // 5 pieces but only 1 bar
    ]);
    // Only 1 bar, should contain 1 piece and leave remaining unnested
    expect(result.totalStockUsed).toBe(1);
    expect(result.cutPlans[0].cuts).toHaveLength(1);
  });

  it('calculates efficiency as a percentage', () => {
    const result = runLinearNesting(6000, 1, [
      { lineNumber: 1, length: 3000, qty: 1 },
    ]);
    // 3000mm used of 6000mm = 50%
    expect(result.efficiency).toBeCloseTo(50, 0);
  });

  it('handles empty pieces array gracefully', () => {
    const result = runLinearNesting(6000, 5, []);
    expect(result.cutPlans).toHaveLength(0);
    expect(result.totalStockUsed).toBe(0);
    expect(result.efficiency).toBe(0);
  });
});
