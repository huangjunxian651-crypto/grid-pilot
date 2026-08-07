import { describe, it, expect } from 'vitest';
import { mapBoxValidationError } from './box-error-code';

describe('mapBoxValidationError', () => {
  it('maps overlap errors to BOX_OVERLAP', () => {
    expect(mapBoxValidationError(['box [1,2] overlaps existing box [1,2]']).code).toBe('BOX_OVERLAP');
  });

  it('maps direction mismatch errors to BOX_DIRECTION_MISMATCH', () => {
    expect(mapBoxValidationError(['box direction (SHORT) must match robot direction (LONG)']).code).toBe(
      'BOX_DIRECTION_MISMATCH',
    );
  });

  it('maps stop-loss invariant errors to BOX_STOPLOSS_REQUIRED', () => {
    expect(mapBoxValidationError(['non-loss-edge box [1,2] must have stop-loss (stopLossGridCount > 0)']).code).toBe(
      'BOX_STOPLOSS_REQUIRED',
    );
  });

  it('maps order-size-below-minimum errors to BOX_ORDER_SIZE_BELOW_MINIMUM', () => {
    const errors = ['order size 0.005 below exchange minimum at box low price 2390 (minQty=0.001, minNotional=20, suggested>=0.00837)'];
    expect(mapBoxValidationError(errors).code).toBe('BOX_ORDER_SIZE_BELOW_MINIMUM');
  });

  it('does not misclassify order-size errors as geometry errors (both could match loosely-worded substrings)', () => {
    const errors = ['order size 0.005 below exchange minimum at box low price 2390 (minQty=0.001, minNotional=20, suggested>=0.00837)'];
    expect(mapBoxValidationError(errors).code).not.toBe('BOX_GEOMETRY_INVALID');
  });

  it('maps geometry errors to BOX_GEOMETRY_INVALID', () => {
    expect(mapBoxValidationError(['takeProfitPrice must be positive']).code).toBe('BOX_GEOMETRY_INVALID');
  });

  it('falls back to BOX_VALIDATION_FAILED for unrecognized errors', () => {
    expect(mapBoxValidationError(['something unexpected happened']).code).toBe('BOX_VALIDATION_FAILED');
  });
});
