/**
 * Round half up (away from zero at *.5).
 * 50.49 → 50, 50.5 → 51. Not banker's rounding.
 */
export function roundHalfUp(value, decimals = 1) {
  if (!Number.isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const factor = 10 ** decimals;
  const scaled = abs * factor;
  const whole = Math.floor(scaled + 1e-12);
  const frac = scaled - whole;
  const next = frac >= 0.5 - 1e-12 ? whole + 1 : whole;
  return (sign * next) / factor;
}
