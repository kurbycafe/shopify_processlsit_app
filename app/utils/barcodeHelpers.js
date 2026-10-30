export function normalizeBarcode(raw) {
  if (raw === null || raw === undefined) return "";
  let s = String(raw).trim();
  // Strip AIM Symbology Identifier (e.g. ]E0, ]E1, ]E2, ]E3, ]E4, ]C1, ]e0, etc.)
  s = s.replace(/^\][A-Za-z0-9]{2}/, "");
  // Strip ASCII control characters (0x00 - 0x1F and 0x7F)
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  s = s.replace(/[\x00-\x1F\x7F]/g, "");
  return s.trim();
}

function matchTwoCodes(rawScan, rawTarget) {
  const scan = normalizeBarcode(rawScan);
  const target = normalizeBarcode(rawTarget);

  if (!scan || !target) return false;

  // 1. Exact case-insensitive match
  if (scan.toLowerCase() === target.toLowerCase()) {
    return true;
  }

  // 2. Numeric matches
  const scanDigits = /^\d+$/.test(scan);
  const targetDigits = /^\d+$/.test(target);

  if (scanDigits && targetDigits) {
    // 2a. Strip leading zeroes (e.g. "0880111889721" vs "880111889721")
    const scanNoZero = scan.replace(/^0+/, "");
    const targetNoZero = target.replace(/^0+/, "");
    if (scanNoZero && targetNoZero && scanNoZero === targetNoZero) {
      return true;
    }

    // 2b. GTIN-14 zero-padding match
    if (scan.padStart(14, "0") === target.padStart(14, "0")) {
      return true;
    }

    // 2c. 13-digit EAN-13 vs 12-digit code without check digit
    // e.g. physical scan "8801118897214" vs Shopify stored "880111889721"
    if (scan.length === 13 && target.length === 12 && scan.startsWith(target)) {
      return true;
    }
    if (target.length === 13 && scan.length === 12 && target.startsWith(scan)) {
      return true;
    }

    // 2d. 14-digit GTIN vs 12 or 13-digit codes
    // GTIN-14 format: [1 indicator digit][12 or 13 product digits][check digit]
    if (scan.length === 14) {
      if (scan.endsWith(target) || scan.slice(1).startsWith(target)) {
        return true;
      }
      if (target.length === 12 && scan.slice(1, 13) === target) {
        return true;
      }
    }
    if (target.length === 14) {
      if (target.endsWith(scan) || target.slice(1).startsWith(scan)) {
        return true;
      }
      if (scan.length === 12 && target.slice(1, 13) === scan) {
        return true;
      }
    }

    // 2e. 8-digit EAN-8 vs 7-digit without check digit
    if (scan.length === 8 && target.length === 7 && scan.startsWith(target)) {
      return true;
    }
    if (target.length === 8 && scan.length === 7 && target.startsWith(scan)) {
      return true;
    }
  }

  return false;
}

export function isBarcodeOrSkuMatch(item, rawCode) {
  if (!item || !rawCode) return false;
  const scan = normalizeBarcode(rawCode);
  if (!scan) return false;

  // 1. Check item.barcode
  if (item.barcode) {
    const rawBarcodeStr = String(item.barcode);
    if (matchTwoCodes(scan, rawBarcodeStr)) {
      return true;
    }
    // Handle comma, slash, semicolon, or whitespace separated barcodes
    const parts = rawBarcodeStr.split(/[,/;\s|]+/).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) {
        if (matchTwoCodes(scan, part)) {
          return true;
        }
      }
    }
  }

  // 2. Check item.sku
  if (item.sku) {
    const rawSkuStr = String(item.sku);
    if (matchTwoCodes(scan, rawSkuStr)) {
      return true;
    }
    const parts = rawSkuStr.split(/[,/;\s|]+/).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) {
        if (matchTwoCodes(scan, part)) {
          return true;
        }
      }
    }
  }

  // 3. Check item.variantId (numeric ID, e.g. "gid://shopify/ProductVariant/44567890123456")
  if (item.variantId) {
    const numericVariantId = String(item.variantId).replace(/\D/g, "");
    if (numericVariantId && matchTwoCodes(scan, numericVariantId)) {
      return true;
    }
  }

  // 4. Check item.id (numeric line item ID)
  if (item.id) {
    const numericLineId = String(item.id).replace(/\D/g, "");
    if (numericLineId && matchTwoCodes(scan, numericLineId)) {
      return true;
    }
  }

  return false;
}
