import { parseWarehouseInfo, compareRegalAscending } from "./warehouseHelpers.js";

/**
 * Generates standalone, full-bleed A4 Landscape HTML for guaranteed multi-page printing without iframe cutoff
 */
export function generatePickListPrintHtml({
  items = [],
  formattedTime = "",
  warehouseTab = "ALL",
  totalOrdersCount = 0,
}) {
  const storeItems = [];
  const newOnlyItems = [];
  const noBinItems = [];

  items.forEach((item) => {
    const info = item.whInfo || parseWarehouseInfo(item.binLocation);
    if (info.category === "STORE") {
      storeItems.push(item);
    } else if (info.category === "NEW_ONLY") {
      newOnlyItems.push(item);
    } else {
      noBinItems.push(item);
    }
  });

  storeItems.sort(compareRegalAscending);
  newOnlyItems.sort(compareRegalAscending);
  noBinItems.sort(compareRegalAscending);

  const totalQty = items.reduce((sum, i) => sum + (i.orderedQty || 0), 0);
  const storeQty = storeItems.reduce((sum, i) => sum + (i.orderedQty || 0), 0);
  const newQty = newOnlyItems.reduce((sum, i) => sum + (i.orderedQty || 0), 0);
  const noBinQty = noBinItems.reduce((sum, i) => sum + (i.orderedQty || 0), 0);

  const renderSectionHtml = (title, badgeText, badgeBg, badgeColor, itemList, sectionQty) => {
    if (!itemList || itemList.length === 0) return "";

    const rowsHtml = itemList
      .map((item, idx) => {
        const itemWh = item.whInfo || parseWarehouseInfo(item.binLocation);
        const locationMain = itemWh.storeShelf || itemWh.newShelf || item.binLocation || "위치 미정";
        const locationSub = itemWh.hasBoth && itemWh.newShelf ? `<div class="sub-location">(신창고: ${itemWh.newShelf})</div>` : "";
        const ordersText = (item.orderNumbers || []).slice(0, 4).join(", ") + ((item.orderNumbers || []).length > 4 ? ` 외 ${item.orderNumbers.length - 4}건` : "");

        const rowBg = idx % 2 === 1 ? "background-color: #f8fafc;" : "";

        return `
          <tr style="${rowBg}">
            <td class="loc-cell">
              <span class="loc-badge" style="background: ${itemWh.isNewOnly ? '#cffafe; color: #0891b2;' : itemWh.category === 'NO_BIN' ? '#fef3c7; color: #d97706;' : '#dbeafe; color: #2563eb;'}">
                ${itemWh.isNewOnly ? '신창고' : itemWh.category === 'NO_BIN' ? '미지정' : '매장'}
              </span>
              <strong>${locationMain}</strong>
              ${locationSub}
            </td>
            <td class="product-cell">
              <strong>${item.productName || '상품'}</strong>
            </td>
            <td class="code-cell">
              <div class="sku">${item.sku || '-'}</div>
              <div class="barcode">${item.barcode || ''}</div>
            </td>
            <td class="qty-cell">${item.orderedQty || 0} 개</td>
            <td class="stock-cell">${item.inventoryQty !== null ? `${item.inventoryQty} 개` : '-'}</td>
            <td class="orders-cell">${ordersText}</td>
          </tr>
        `;
      })
      .join("");

    return `
      <div class="section-container">
        <div class="section-header">
          <div class="section-title">
            <span class="section-badge" style="background: ${badgeBg}; color: ${badgeColor};">${badgeText}</span>
            <span>${title}</span>
            <span class="count-tag">(${itemList.length}종 품목)</span>
          </div>
          <div class="section-total">피킹 수량: <strong>${sectionQty.toLocaleString()}</strong> 개</div>
        </div>
        <table class="pick-table">
          <thead>
            <tr>
              <th style="width: 22%;">창고 위치 (레갈 번호)</th>
              <th style="width: 33%;">상품명</th>
              <th style="width: 17%;">SKU / 바코드</th>
              <th style="width: 9%; text-align: right;">피킹 수량</th>
              <th style="width: 9%; text-align: right;">현재 재고</th>
              <th style="width: 10%;">관련 주문</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  };

  let sectionsHtml = "";
  if (warehouseTab === "ALL" || warehouseTab === "STORE") {
    sectionsHtml += renderSectionHtml(
      "1. 매장창고 처리중 리스트 (STORE WAREHOUSE)",
      "매장창고",
      "#dbeafe",
      "#1d4ed8",
      storeItems,
      storeQty
    );
  }
  if (warehouseTab === "ALL" || warehouseTab === "NEW_ONLY") {
    sectionsHtml += renderSectionHtml(
      "2. 신창고 전용 처리중 리스트 (NEW / MAIN WAREHOUSE)",
      "신창고 전용",
      "#cffafe",
      "#0e7490",
      newOnlyItems,
      newQty
    );
  }
  if (warehouseTab === "ALL" || warehouseTab === "NO_BIN") {
    sectionsHtml += renderSectionHtml(
      "3. 위치 미지정 처리중 리스트 (UNASSIGNED LOCATION)",
      "위치 미지정",
      "#fef3c7",
      "#b45309",
      noBinItems,
      noBinQty
    );
  }

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>처리중 리스트 - ${formattedTime}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 8mm 6mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      padding: 8px 12px;
      font-size: 12px;
      line-height: 1.35;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 2px solid #0f172a;
      margin-bottom: 12px;
    }
    .header-left h1 {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
    }
    .header-left p {
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
    }
    .header-right {
      text-align: right;
      font-size: 12px;
    }
    .header-right .summary-tag {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
    }
    .header-right .time-tag {
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
    }
    .section-container {
      margin-bottom: 16px;
      page-break-inside: auto;
      break-inside: auto;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-bottom: none;
      padding: 6px 10px;
      border-radius: 4px 4px 0 0;
    }
    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
    }
    .section-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
    }
    .count-tag {
      font-size: 11px;
      color: #64748b;
      font-weight: normal;
    }
    .section-total {
      font-size: 12px;
      color: #334155;
    }
    table.pick-table {
      width: 100%;
      border-collapse: collapse;
      page-break-inside: auto;
      break-inside: auto;
      border: 1px solid #cbd5e1;
    }
    table.pick-table thead {
      display: table-header-group;
    }
    table.pick-table tfoot {
      display: table-footer-group;
    }
    table.pick-table tr {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    table.pick-table th {
      background-color: #0f172a !important;
      color: #ffffff !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      padding: 6px 8px;
      font-size: 11px;
      font-weight: 700;
      text-align: left;
      border-right: 1px solid #334155;
    }
    table.pick-table td {
      padding: 5px 8px;
      font-size: 11px;
      border-bottom: 1px solid #e2e8f0;
      border-right: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    .loc-cell {
      font-size: 12px;
    }
    .loc-badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      margin-right: 4px;
    }
    .sub-location {
      font-size: 10px;
      color: #64748b;
      margin-top: 1px;
    }
    .product-cell {
      font-size: 11.5px;
      line-height: 1.25;
    }
    .code-cell {
      font-family: monospace;
      font-size: 10.5px;
      color: #334155;
    }
    .code-cell .barcode {
      color: #64748b;
      font-size: 9.5px;
    }
    .qty-cell {
      text-align: right;
      font-weight: 800;
      font-size: 13px;
      color: #0f172a;
    }
    .stock-cell {
      text-align: right;
      font-size: 11px;
      color: #475569;
    }
    .orders-cell {
      font-size: 10px;
      color: #64748b;
    }
    @media print {
      body {
        padding: 0;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="header-left">
      <h1>피킹 및 처리중 리스트 (Process &amp; Pick List)</h1>
      <p>매장창고 &amp; 신창고 구역별 레갈번호 오름차순 정렬</p>
    </div>
    <div class="header-right">
      <div class="summary-tag">미처리 주문: ${totalOrdersCount}건 / 총 ${items.length}종 (${totalQty.toLocaleString()}개)</div>
      <div class="time-tag">출력 일시: ${formattedTime}</div>
    </div>
  </div>

  ${sectionsHtml}

  <script>
    window.onload = function() {
      window.focus();
      window.print();
    };
  </script>
</body>
</html>
  `;
}
