export function isBarcodeOrSkuMatch(item, rawCode) {
  if (!item || !rawCode) return false;
  const scan = String(rawCode).trim();
  if (!scan) return false;

  const scanLower = scan.toLowerCase();
  const barcode = String(item.barcode || "").trim();
  const barcodeLower = barcode.toLowerCase();
  const sku = String(item.sku || "").trim();
  const skuLower = sku.toLowerCase();

  if (barcode && (barcode === scan || barcodeLower === scanLower)) {
    return true;
  }
  if (sku && (sku === scan || skuLower === scanLower)) {
    return true;
  }

  if (barcode) {
    const scanStrip = scan.replace(/^0+/, "");
    const barcodeStrip = barcode.replace(/^0+/, "");
    if (scanStrip && barcodeStrip && scanStrip === barcodeStrip) {
      return true;
    }

    if (/^\d+$/.test(scan) && /^\d+$/.test(barcode)) {
      if (scan.padStart(14, "0") === barcode.padStart(14, "0")) {
        return true;
      }
    }
  }

  if (sku && /^\d+$/.test(scan) && /^\d+$/.test(sku)) {
    if (scan.replace(/^0+/, "") === sku.replace(/^0+/, "")) {
      return true;
    }
  }

  return false;
}
