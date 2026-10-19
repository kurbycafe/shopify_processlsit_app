function quantity(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("입고 수량은 0 이상의 정수여야 합니다.");
  return number;
}

// Update existing rows in place. Receipt IDs and quantities survive Odoo resynchronization.
export async function mergeContainerItems(tx, containerId, incoming, { fromOdoo = false } = {}) {
  const current = await tx.containerItem.findMany({ where: { containerId }, orderBy: { createdAt: "asc" } });
  const unused = new Set(current.map(item => item.id));
  for (const item of incoming) {
    const available = current.filter(existing => unused.has(existing.id));
    let match = available.find(existing => item.id && item.id === existing.id);
    if (!match) {
      const skuMatches = item.sku ? available.filter(existing => item.sku === existing.sku) : [];
      const barcodeMatches = item.barcode ? available.filter(existing => item.barcode === existing.barcode) : [];
      const matches = skuMatches.length && barcodeMatches.length
        ? skuMatches.filter(existing => barcodeMatches.some(barcode => barcode.id === existing.id))
        : skuMatches.length ? skuMatches : barcodeMatches;
      if (skuMatches.length && barcodeMatches.length && matches.length === 0) throw new Error("SKU와 바코드가 서로 다른 입고 행을 가리킵니다.");
      if (matches.length > 1) throw new Error("동일한 SKU 또는 바코드의 품목이 여러 개입니다. 입고 행 ID를 확인해 주세요.");
      match = matches[0];
    }
    if (match) unused.delete(match.id);
    const data = {
      sku: item.sku || null, barcode: item.barcode || null,
      productName: item.odooName || item.productName || item.title || "품목",
      expectedQty: quantity(item.expectedQty ?? item.qty ?? 0),
      unitPrice: item.wholesalePrice ?? item.unitPrice ?? null,
      unitPerBox: quantity(item.unitPerBox ?? 0), boxQty: quantity(item.boxQty ?? 0),
    };
    if (!fromOdoo && item.receivedQty !== undefined) data.receivedQty = quantity(item.receivedQty);
    if (match) {
      await tx.containerItem.update({ where: { id: match.id }, data });
    } else {
      await tx.containerItem.create({ data: { containerId, ...data, receivedQty: data.receivedQty ?? 0 } });
    }
  }
  // Keep orphaned receipt evidence; unreceived removed Odoo rows can safely disappear.
  if (unused.size) await tx.containerItem.deleteMany({ where: { id: { in: [...unused] }, receivedQty: 0 } });
}

export async function lockContainer(tx, shop, reference) {
  const key = `${shop}:${reference}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export async function completeContainerReceipt(tx, containerId) {
  const items = await tx.containerItem.findMany({ where: { containerId } });
  for (const item of items) {
    if (item.receivedQty < item.expectedQty) {
      await tx.containerItem.update({ where: { id: item.id }, data: { receivedQty: item.expectedQty } });
    }
  }
}
