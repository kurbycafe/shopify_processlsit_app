const normalize = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;

export function resolveTaxRate(taxLines, taxable = true) {
  if (taxable === false) return 0;
  if (!Array.isArray(taxLines)) throw new Error("Actual item tax data is required to issue an invoice");
  return normalize(taxLines.reduce((sum, line) => {
    const rate = line.rate;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
      throw new Error("Invalid invoice tax rate");
    }
    return sum + rate * 100;
  }, 0));
}

export function resolveShippingTaxRate(shippingLines, grossShipping, taxesIncluded = true) {
  return resolveShippingTaxDetails(shippingLines, grossShipping, taxesIncluded).shippingTaxRate;
}

export function resolveShippingTaxDetails(shippingLines, grossShipping, taxesIncluded = true) {
  if (shippingLines?.pageInfo?.hasNextPage) throw new Error("Cannot invoice incomplete shipping tax data");
  const lines = shippingLines?.edges?.map(edge => edge.node) || shippingLines?.nodes || shippingLines;
  if (!Array.isArray(lines)) throw new Error("Actual shipping tax data is required to issue an invoice");
  let tax = 0;
  const rates = new Set();
  const shippingTaxBreakdown = {};
  for (const line of lines) {
    if (!Array.isArray(line.taxLines || line.tax_lines)) throw new Error("Shipping tax lines are missing");
    for (const item of line.taxLines || line.tax_lines) {
      const amount = Number(item.priceSet?.shopMoney?.amount ?? item.price);
      if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid shipping tax amount");
      const rate = resolveTaxRate([item]);
      if (rate !== 0) rates.add(rate);
      if (amount > 0) shippingTaxBreakdown[rate] = normalize((shippingTaxBreakdown[rate] || 0) + amount);
      tax += amount;
    }
  }
  tax = normalize(tax);
  const value = Number(grossShipping);
  const net = taxesIncluded ? value - tax : value;
  if (!Number.isFinite(net) || net < 0 || (tax > 0 && net === 0)) throw new Error("Invalid shipping tax total");
  // Use the real nominal rate when uniform; cent rounding must not invent 19.085%.
  const shippingTaxRate = rates.size === 1 ? [...rates][0] : tax === 0 ? 0 : normalize(tax / net * 100);
  return { shippingTaxRate, originalShippingTaxRate: shippingTaxRate, shippingTaxAmount: tax, shippingTaxBreakdown };
}
