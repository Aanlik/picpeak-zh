/** Parse and clamp integer input for bounded project settings. */

/**
 * Parse a value as an integer clamped to [min, max]; `undefined` on
 * anything that doesn't parse (null, undefined, '', booleans, garbage).
 *
 * Exists because the inline guard `Number.isFinite(+v) ? parseInt(v)`
 * disagrees with itself for null/''/true (`+null` is 0 but
 * `parseInt(null)` is NaN), which let NaN through Math.min/Math.max
 * and into an INSERT — PostgreSQL rejects NaN for integer columns
 * while SQLite silently stores NULL, so it only failed on PG.
 */
function clampIntOrUndefined(value, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

module.exports = { clampIntOrUndefined };
