/**
 * Formula-injection defence for spreadsheet exports (CSV + tab-separated files).
 *
 * A cell whose first character is one of `= + - @ TAB CR` is evaluated as a
 * formula when the file is opened in Excel / Numbers / Banana. RFC-4180
 * quote-wrapping does NOT stop that evaluation — only prefixing a single quote
 * does. Exported labels and descriptions can be admin-editable or sender-controlled.
 *
 * Apply to BOTH the quoted CSV and the unquoted tab-separated Banana export —
 * the tab export has no surrounding quotes, so it's the more exposed of the two.
 */
function neutralizeSpreadsheetFormula(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // A plain number is not a formula. Prefixing strict numerics turns them
  // into text cells and silently removes them from spreadsheet calculations.
  // Only strict numerics are exempt — an
  // optional sign, digits, one decimal separator (dot or comma), digits.
  if (/^-?\d+(?:[.,]\d+)?$/.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

module.exports = { neutralizeSpreadsheetFormula };
