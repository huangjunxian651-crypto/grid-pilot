/**
 * Precision formatting utilities for exchange orders.
 * Aligned with Go utils/precision.go.
 */

/**
 * Format a price to tick size precision (rounds to nearest tick).
 * Aligned with Go RoundPrice: math.Round(price * (1/tick)) / (1/tick)
 */
export function formatPrice(price: number, tickSize: number): number {
  if (tickSize <= 0) return price;
  const inv = 1 / tickSize;
  return Math.round(price * inv) / inv;
}

/**
 * Format a quantity to step size precision (rounds down to floor).
 * Aligned with Go RoundQty: math.Floor(qty * (1/step) + epsilon) / (1/step)
 * Uses floor to avoid buying more than intended (Go comment: "avoid buying beyond funds").
 */
export function formatQty(qty: number, stepSize: number): number {
  if (stepSize <= 0) return qty;
  const inv = 1 / stepSize;
  // +0.0001 epsilon prevents float-residue from flooring a good value (Go: "+0.0001 防止浮点数略小于整数导致的错误 Floor")
  return Math.floor(qty * inv + 0.0001) / inv;
}

/**
 * Get decimal precision count from a step size.
 * e.g., stepSize=0.001 → 3, stepSize=0.01 → 2
 */
export function getPrecision(stepSize: number): number {
  if (stepSize <= 0) return 8;
  const str = stepSize.toString();
  if (str.includes('.')) {
    return str.split('.')[1].length;
  }
  return 0;
}

/**
 * Format to fixed decimal places (for API string serialization).
 * Some exchanges require formatted strings with specific decimal places.
 */
export function toFixedPrecision(value: number, precision: number): string {
  return value.toFixed(precision);
}
