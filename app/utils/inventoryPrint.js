import { formatCurrency } from "./formatters";
import { DEFAULT_CURRENCY } from "../constants/shopify";

/**
 * Generate A4 HTML content for Monthly Inventory Valuation Report print / PDF
 * @param {object} params
 * @param {Array} params.items Filtered inventory items
 * @param {string} params.selectedMonth Selected YYYY-MM
 * @param {string} params.shopName Shop name
 * @param {string} params.currencyCode Currency code
 * @returns {string} Complete HTML string
 */
export function generateInventoryReportHTML({ items = [], selectedMonth, shopName = "Shopify Store", currencyCode = DEFAULT_CURRENCY }) {
  const reportTimestamp = new Date().toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const totalStock = items.reduce((acc, i) => acc + (i.inventoryQuantity || 0), 0);
  const totalValuation = items.reduce((acc, i) => acc + (i.valuation || 0), 0);

  const tableRows = items
    .map(
      (item, index) => `
    <tr>
      <td style="text-align: center; color: #555;">${index + 1}</td>
      <td style="font-family: monospace; font-weight: 600;">${item.sku || "-"}</td>
      <td style="font-weight: 500;">${item.fullName || item.title || "-"}</td>
      <td style="text-align: right;">${formatCurrency(item.price || 0, currencyCode)}</td>
      <td style="text-align: center;">
        <span class="tax-badge tax-${item.taxRate || 0}">${item.taxRate || 0}%</span>
      </td>
      <td style="text-align: right; font-weight: 600; color: ${(item.inventoryQuantity || 0) < 0 ? "#d32f2f" : "#111"};">
        ${(item.inventoryQuantity || 0).toLocaleString()}
      </td>
      <td style="text-align: right; font-weight: 600;">${formatCurrency(item.valuation || 0, currencyCode)}</td>
    </tr>
  `
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>월별 인벤토리 보고서 - ${selectedMonth}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 12mm 10mm 15mm 10mm;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color: #1a1a1a;
          margin: 0;
          padding: 0;
          background: #fff;
          font-size: 11px;
          line-height: 1.4;
        }
        .header-container {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #111;
          padding-bottom: 12px;
          margin-bottom: 16px;
        }
        .title-area h1 {
          font-size: 20px;
          margin: 0 0 4px 0;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .title-area p {
          margin: 0;
          color: #666;
          font-size: 11px;
        }
        .meta-area {
          text-align: right;
          font-size: 11px;
        }
        .meta-area div {
          margin-bottom: 2px;
        }
        .kpi-container {
          display: flex;
          gap: 12px;
          margin-bottom: 16px;
        }
        .kpi-card {
          flex: 1;
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 6px;
          padding: 8px 12px;
        }
        .kpi-title {
          font-size: 10px;
          color: #6c757d;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .kpi-value {
          font-size: 14px;
          font-weight: 700;
          color: #111;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        th {
          background-color: #f1f3f5;
          color: #212529;
          font-weight: 700;
          text-align: left;
          padding: 7px 8px;
          border-top: 1px solid #ced4da;
          border-bottom: 1px solid #ced4da;
          font-size: 10px;
        }
        td {
          padding: 6px 8px;
          border-bottom: 1px solid #e9ecef;
          vertical-align: middle;
        }
        tr:nth-child(even) {
          background-color: #fdfdfd;
        }
        .tax-badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
        }
        .tax-19 { background: #e7f5ff; color: #1971c2; }
        .tax-7 { background: #ebfbee; color: #2b8a3e; }
        .tax-0 { background: #f1f3f5; color: #495057; }
        .summary-row td {
          background-color: #f1f3f5;
          font-weight: 700;
          border-top: 2px solid #343a40;
          border-bottom: 2px solid #343a40;
          font-size: 11px;
        }
        .signature-area {
          margin-top: 30px;
          display: flex;
          justify-content: flex-end;
          gap: 40px;
          page-break-inside: avoid;
        }
        .signature-box {
          width: 140px;
          text-align: center;
        }
        .signature-title {
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 35px;
          color: #495057;
        }
        .signature-line {
          border-top: 1px solid #868e96;
          padding-top: 4px;
          font-size: 10px;
          color: #6c757d;
        }
        @media print {
          .no-print { display: none; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <div class="header-container">
        <div class="title-area">
          <h1>월별 인벤토리 평가 보고서</h1>
          <p>Monthly Inventory Valuation Report (${selectedMonth})</p>
        </div>
        <div class="meta-area">
          <div><strong>상호명:</strong> ${shopName}</div>
          <div><strong>보고서 추출 일시:</strong> ${reportTimestamp}</div>
          <div><strong>화폐 단위:</strong> ${currencyCode}</div>
        </div>
      </div>

      <div class="kpi-container">
        <div class="kpi-card">
          <div class="kpi-title">총 상품(옵션) 품목 수</div>
          <div class="kpi-value">${items.length.toLocaleString()} 개</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">총 재고 수량</div>
          <div class="kpi-value">${totalStock.toLocaleString()} 개</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">총 재고 평가 금액</div>
          <div class="kpi-value">${formatCurrency(totalValuation, currencyCode)}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 35px; text-align: center;">No.</th>
            <th style="width: 110px;">SKU</th>
            <th>상품명 (Product Name)</th>
            <th style="width: 85px; text-align: right;">단가 (Price)</th>
            <th style="width: 65px; text-align: center;">적용 세율</th>
            <th style="width: 75px; text-align: right;">재고 수량</th>
            <th style="width: 100px; text-align: right;">재고 평가 금액</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr class="summary-row">
            <td colspan="3" style="text-align: center;">합계 (TOTAL)</td>
            <td style="text-align: right;">-</td>
            <td style="text-align: center;">-</td>
            <td style="text-align: right;">${totalStock.toLocaleString()}</td>
            <td style="text-align: right;">${formatCurrency(totalValuation, currencyCode)}</td>
          </tr>
        </tbody>
      </table>

      <div class="signature-area">
        <div class="signature-box">
          <div class="signature-title">재고 담당자</div>
          <div class="signature-line">(서명 / 날인)</div>
        </div>
        <div class="signature-box">
          <div class="signature-title">관리 책임자</div>
          <div class="signature-line">(서명 / 날인)</div>
        </div>
      </div>

      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 300);
        };
      </script>
    </body>
    </html>
  `;
}
