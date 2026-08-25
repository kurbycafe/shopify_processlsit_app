/**
 * Flexible & Exact Barcode/SKU Matcher
 * Preserves leading zeros exactly as-is, while also matching when scanner or DB has leading zero discrepancies
 */
export function isBarcodeOrSkuMatch(item, rawCode) {
  if (!item || !rawCode) return false;
  const scan = String(rawCode).trim();
  if (!scan) return false;

  const scanLower = scan.toLowerCase();
  const barcode = String(item.barcode || "").trim();
  const barcodeLower = barcode.toLowerCase();
  const sku = String(item.sku || "").trim();
  const skuLower = sku.toLowerCase();

  // 1. Exact string match (Preserving leading zeros exactly: e.g. "0123456" === "0123456")
  if (barcode && (barcode === scan || barcodeLower === scanLower)) {
    return true;
  }
  if (sku && (sku === scan || skuLower === scanLower)) {
    return true;
  }

  // 2. Leading zero normalization (e.g. scanner sent "08801043014830" but item has "8801043014830" or vice-versa)
  if (barcode) {
    const scanStrip = scan.replace(/^0+/, "");
    const barcodeStrip = barcode.replace(/^0+/, "");
    if (scanStrip && barcodeStrip && scanStrip === barcodeStrip) {
      return true;
    }

    // 3. Standard GTIN-14 / EAN-13 zero-padded match (if numeric)
    if (/^\d+$/.test(scan) && /^\d+$/.test(barcode)) {
      if (scan.padStart(14, "0") === barcode.padStart(14, "0")) {
        return true;
      }
    }
  }

  // 4. SKU numeric zero-normalization fallback
  if (sku && /^\d+$/.test(scan) && /^\d+$/.test(sku)) {
    if (scan.replace(/^0+/, "") === sku.replace(/^0+/, "")) {
      return true;
    }
  }

  return false;
}
