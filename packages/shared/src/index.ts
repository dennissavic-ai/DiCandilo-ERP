// ─── Shared type definitions & pure utilities ─────────────────────────────────
// Used by both /api and /web packages.

// ── Units ─────────────────────────────────────────────────────────────────────

/** Convert integer cents to a display string: 10050 → "100.50" */
export function centsToDisplay(cents: number, decimals = 2): string {
  return (cents / 100).toFixed(decimals);
}

/** Convert a dollar string/number to integer cents: "19.99" → 1999 */
export function dollarsToCents(dollars: number | string): number {
  return Math.round(Number(dollars) * 100);
}

/** Millimetres → inches (2 decimal places) */
export function mmToInches(mm: number): number {
  return Math.round((mm / 25.4) * 100) / 100;
}

/** Millimetres → feet */
export function mmToFeet(mm: number): number {
  return Math.round((mm / 304.8) * 1000) / 1000;
}

/** Grams → kilograms */
export function gramsToKg(grams: number): number {
  return Math.round((grams / 1000) * 1000) / 1000;
}

/** Grams → pounds */
export function gramsToLbs(grams: number): number {
  return Math.round((grams / 453.592) * 1000) / 1000;
}

/** Format a dimension for display */
export function formatDimension(mm: number | null | undefined): string {
  if (!mm) return '—';
  if (mm >= 1000) return `${(mm / 1000).toFixed(3)}m`;
  return `${mm}mm`;
}

// ── Date utilities ─────────────────────────────────────────────────────────────

/** Returns "YYYY-MM" period string from a Date */
export function toPeriod(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Format a date for display: "15 Jan 2024" */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Format a datetime for display */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Common enums (mirrors Prisma enums for frontend use) ──────────────────────

export type CostMethod = 'FIFO' | 'AVERAGE' | 'STANDARD';
export type TransactionType = 'RECEIPT' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'SCRAP' | 'REMNANT' | 'OPENING';
export type POStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'INVOICED' | 'CLOSED' | 'CANCELLED';
export type SOStatus = 'DRAFT' | 'CONFIRMED' | 'IN_PRODUCTION' | 'READY_TO_SHIP' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'INVOICED' | 'CLOSED' | 'CANCELLED';
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CONVERTED';
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'WRITTEN_OFF';
export type WOStatus = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

// ── Validation helpers ────────────────────────────────────────────────────────

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

// ── Number formatting ─────────────────────────────────────────────────────────

export function formatCurrency(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatPercent(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

// ── Quantity arithmetic ───────────────────────────────────────────────────────

export function calculateAvailableQty(onHand: number, allocated: number): number {
  return Math.max(0, onHand - allocated);
}

export function calculateAverageCost(
  existingQty: number,
  existingCostCents: number,
  newQty: number,
  newCostCents: number
): number {
  const totalQty = existingQty + newQty;
  if (totalQty === 0) return 0;
  return Math.round((existingQty * existingCostCents + newQty * newCostCents) / totalQty);
}

// ── String utilities ──────────────────────────────────────────────────────────

export function generateReference(prefix: string, count: number, pad = 6): string {
  return `${prefix}-${String(count + 1).padStart(pad, '0')}`;
}

export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
}

export function initials(firstName?: string, lastName?: string): string {
  return `${(firstName ?? '')[0] ?? ''}${(lastName ?? '')[0] ?? ''}`.toUpperCase();
}
