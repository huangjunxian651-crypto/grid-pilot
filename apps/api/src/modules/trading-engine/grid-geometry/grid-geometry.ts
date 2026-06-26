export interface PlaceabilityInfo {
  minQty: number;
  minNotional: number;
  quantoMultiplier: number;
}

export function isPlaceable(qty: number, price: number, info: PlaceabilityInfo): boolean {
  const absQty = Math.abs(qty);
  if (info.minQty > 0 && absQty < info.minQty) return false;
  const notional = absQty * price * (info.quantoMultiplier > 0 ? info.quantoMultiplier : 1);
  if (info.minNotional > 0 && notional < info.minNotional) return false;
  return true;
}
