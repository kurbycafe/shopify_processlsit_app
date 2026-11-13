import { getShopAliases } from "../utils/shopDomain.js";

/**
 * Normalizes order identifiers and order names from a CustomerRequest so
 * InspectionRecords can be matched regardless of GID, numeric ID, or #name format.
 */
export function extractOrderLookupRefs(record) {
  const refs = [record?.orderId, record?.payload?.orderId, record?.payload?.orderName]
    .map((val) => String(val || "").trim())
    .filter(Boolean);
  const orderIds = [];
  const orderNames = [];
  for (const ref of refs) {
    if (/^gid:\/\/shopify\/Order\/\d+$/.test(ref)) {
      orderIds.push(ref, ref.split("/").pop());
    } else if (/^\d{6,}$/.test(ref)) {
      orderIds.push(ref, `gid://shopify/Order/${ref}`);
      orderNames.push(`#${ref}`, ref);
    } else {
      const stripped = ref.replace(/^#/, "");
      orderNames.push(ref, `#${stripped}`, stripped);
    }
  }
  return {
    orderIds: [...new Set(orderIds)],
    orderNames: [...new Set(orderNames)],
  };
}

/**
 * Batch-attaches warehouse InspectionRecord details to CS requests linked to orders
 * so agents can check inspector, completion time, and item shortages/substitutions directly.
 */
export async function attachOrderInspections(db, shop, records) {
  if (!Array.isArray(records) || records.length === 0 || typeof db?.inspectionRecord?.findMany !== "function") {
    return records;
  }

  const allOrderIds = new Set();
  const allOrderNames = new Set();
  const refsPerRecord = records.map((record) => {
    const refs = extractOrderLookupRefs(record);
    refs.orderIds.forEach((id) => allOrderIds.add(id));
    refs.orderNames.forEach((name) => allOrderNames.add(name));
    return refs;
  });

  if (allOrderIds.size === 0 && allOrderNames.size === 0) {
    return records;
  }

  try {
    const inspections = await db.inspectionRecord.findMany({
      where: {
        shop: { in: getShopAliases(shop) },
        OR: [
          ...(allOrderIds.size > 0 ? [{ orderId: { in: [...allOrderIds] } }] : []),
          ...(allOrderNames.size > 0 ? [{ orderName: { in: [...allOrderNames] } }] : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        orderId: true,
        orderName: true,
        inspectorName: true,
        status: true,
        isLieferscheinPrinted: true,
        lieferscheinPrintedAt: true,
        isPickListPrinted: true,
        completedAt: true,
        updatedAt: true,
        items: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            productTitle: true,
            variantTitle: true,
            sku: true,
            orderedQuantity: true,
            inspectedQuantity: true,
            issueType: true,
            issueNote: true,
            substitutedProductTitle: true,
          },
        },
      },
    });

    if (!Array.isArray(inspections) || inspections.length === 0) {
      return records.map((record) => ({ ...record, inspection: null }));
    }

    const byOrderId = new Map();
    const byOrderName = new Map();
    // Process PENDING records first so completed inspections win if orderName collides.
    const ordered = [
      ...inspections.filter((row) => row.status === "PENDING"),
      ...inspections.filter((row) => row.status !== "PENDING"),
    ];
    for (const row of ordered) {
      if (row.orderId) {
        byOrderId.set(row.orderId, row);
        const numeric = String(row.orderId).split("/").pop();
        if (numeric) byOrderId.set(numeric, row);
      }
      if (row.orderName) {
        const clean = String(row.orderName).trim().toLowerCase();
        byOrderName.set(clean, row);
        byOrderName.set(clean.replace(/^#/, ""), row);
      }
    }

    return records.map((record, idx) => {
      const { orderIds, orderNames } = refsPerRecord[idx];
      let matched = null;
      for (const oid of orderIds) {
        if (byOrderId.has(oid)) {
          matched = byOrderId.get(oid);
          break;
        }
      }
      if (!matched) {
        for (const name of orderNames) {
          const clean = name.trim().toLowerCase();
          if (byOrderName.has(clean)) {
            matched = byOrderName.get(clean);
            break;
          }
        }
      }
      return { ...record, inspection: matched || null };
    });
  } catch (err) {
    console.warn("[CustomerRequests] Failed to attach order inspection history:", err?.message || err);
    return records;
  }
}

