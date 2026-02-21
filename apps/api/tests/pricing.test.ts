/**
 * Unit tests for pricing engine logic
 */

interface PricingRule {
  id: string;
  priority: number;
  ruleType: string;
  priceType: 'FIXED' | 'DISCOUNT_PCT' | 'MARKUP_PCT';
  customerId?: string;
  customerGroupId?: string;
  productId?: string;
  categoryId?: string;
  minQty?: number;
  maxQty?: number;
  price?: number;
  discountPct?: number;
  markupPct?: number;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

/**
 * Pricing engine: finds the best applicable rule and returns the unit price.
 * Rules are evaluated in priority order (highest first).
 */
function calculatePrice(
  baseListPrice: number,
  qty: number,
  rules: PricingRule[],
  context: {
    customerId?: string;
    customerGroupId?: string;
    productId?: string;
    categoryId?: string;
    date?: Date;
  }
): { price: number; ruleId: string | null; ruleName: string | null } {
  const now = context.date ?? new Date();

  // Sort rules by priority descending
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    // Check date validity
    if (rule.effectiveFrom && now < rule.effectiveFrom) continue;
    if (rule.effectiveTo && now > rule.effectiveTo) continue;

    // Check quantity range
    if (rule.minQty !== undefined && qty < rule.minQty) continue;
    if (rule.maxQty !== undefined && qty > rule.maxQty) continue;

    // Check entity match
    if (rule.customerId && rule.customerId !== context.customerId) continue;
    if (rule.customerGroupId && rule.customerGroupId !== context.customerGroupId) continue;
    if (rule.productId && rule.productId !== context.productId) continue;
    if (rule.categoryId && rule.categoryId !== context.categoryId) continue;

    // Apply pricing
    let price = baseListPrice;
    if (rule.priceType === 'FIXED' && rule.price !== undefined) {
      price = rule.price;
    } else if (rule.priceType === 'DISCOUNT_PCT' && rule.discountPct !== undefined) {
      price = Math.round(baseListPrice * (1 - rule.discountPct / 100));
    } else if (rule.priceType === 'MARKUP_PCT' && rule.markupPct !== undefined) {
      price = Math.round(baseListPrice * (1 + rule.markupPct / 100));
    }

    return { price, ruleId: rule.id, ruleName: rule.ruleType };
  }

  return { price: baseListPrice, ruleId: null, ruleName: null };
}

describe('Pricing Engine', () => {
  const listPrice = 10000; // $100.00 in cents

  it('returns list price when no rules match', () => {
    const result = calculatePrice(listPrice, 10, [], {});
    expect(result.price).toBe(listPrice);
    expect(result.ruleId).toBeNull();
  });

  it('applies fixed price rule', () => {
    const rules: PricingRule[] = [{
      id: 'r1', priority: 10, ruleType: 'PRODUCT', priceType: 'FIXED',
      productId: 'prod-1', price: 8500,
    }];
    const result = calculatePrice(listPrice, 1, rules, { productId: 'prod-1' });
    expect(result.price).toBe(8500);
  });

  it('applies discount percentage rule', () => {
    const rules: PricingRule[] = [{
      id: 'r1', priority: 10, ruleType: 'CUSTOMER', priceType: 'DISCOUNT_PCT',
      customerId: 'cust-1', discountPct: 15,
    }];
    const result = calculatePrice(listPrice, 1, rules, { customerId: 'cust-1' });
    expect(result.price).toBe(8500); // 10000 * 0.85 = 8500
  });

  it('applies quantity break rule only when qty meets threshold', () => {
    const rules: PricingRule[] = [{
      id: 'r1', priority: 5, ruleType: 'QUANTITY_BREAK', priceType: 'DISCOUNT_PCT',
      minQty: 100, discountPct: 10,
    }];
    // qty < minQty — no discount
    const noDiscount = calculatePrice(listPrice, 50, rules, {});
    expect(noDiscount.price).toBe(listPrice);

    // qty >= minQty — discount applies
    const withDiscount = calculatePrice(listPrice, 100, rules, {});
    expect(withDiscount.price).toBe(9000); // 10% off
  });

  it('higher priority rule wins over lower priority', () => {
    const rules: PricingRule[] = [
      { id: 'low', priority: 1, ruleType: 'PRODUCT', priceType: 'FIXED', productId: 'prod-1', price: 9000 },
      { id: 'high', priority: 10, ruleType: 'CUSTOMER', priceType: 'FIXED', customerId: 'cust-1', price: 7500 },
    ];
    const result = calculatePrice(listPrice, 1, rules, { productId: 'prod-1', customerId: 'cust-1' });
    expect(result.ruleId).toBe('high');
    expect(result.price).toBe(7500);
  });

  it('respects effective date range', () => {
    const yesterday = new Date(Date.now() - 86400000);
    const tomorrow = new Date(Date.now() + 86400000);
    const expired: PricingRule[] = [{
      id: 'r1', priority: 10, ruleType: 'PRODUCT', priceType: 'FIXED',
      productId: 'prod-1', price: 5000,
      effectiveFrom: new Date('2020-01-01'),
      effectiveTo: yesterday,
    }];
    // Expired rule — should not apply
    const result = calculatePrice(listPrice, 1, expired, { productId: 'prod-1' });
    expect(result.price).toBe(listPrice);

    // Future rule
    const future: PricingRule[] = [{
      id: 'r2', priority: 10, ruleType: 'PRODUCT', priceType: 'FIXED',
      productId: 'prod-1', price: 5000,
      effectiveFrom: tomorrow,
    }];
    const result2 = calculatePrice(listPrice, 1, future, { productId: 'prod-1' });
    expect(result2.price).toBe(listPrice);
  });

  it('does not match rule for different customer', () => {
    const rules: PricingRule[] = [{
      id: 'r1', priority: 10, ruleType: 'CUSTOMER', priceType: 'FIXED',
      customerId: 'cust-A', price: 5000,
    }];
    const result = calculatePrice(listPrice, 1, rules, { customerId: 'cust-B' });
    expect(result.price).toBe(listPrice);
  });

  it('applies markup percentage correctly', () => {
    const rules: PricingRule[] = [{
      id: 'r1', priority: 5, ruleType: 'PRODUCT', priceType: 'MARKUP_PCT',
      productId: 'prod-1', markupPct: 20,
    }];
    const result = calculatePrice(listPrice, 1, rules, { productId: 'prod-1' });
    expect(result.price).toBe(12000); // 10000 * 1.20 = 12000
  });
});
