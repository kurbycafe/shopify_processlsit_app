import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * Generate Landscape A4 Picking List PDF Buffer
 * @param {Array} items List of aggregated picking items
 * @param {string} techTime Timestamp for picking list
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generatePickListPdfBuffer(items = [], techTime = "") {
  const pdfDoc = await PDFDocument.create();
  const HelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const Helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageWidth = 842; // A4 Landscape
  const pageHeight = 595;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let currentY = pageHeight - 50;

  const colX = {
    location: 40,
    sku: 220,
    product: 330,
    qty: 660,
    orders: 710,
  };

  const drawPageHeader = (pageNum) => {
    page.drawText(`PICKING LIST - [${techTime}]`, {
      x: 40,
      y: pageHeight - 35,
      size: 14,
      font: HelveticaBold,
      color: rgb(0.06, 0.09, 0.16),
    });
    page.drawText(`Page: ${pageNum}`, {
      x: pageWidth - 80,
      y: pageHeight - 35,
      size: 9,
      font: Helvetica,
      color: rgb(0.39, 0.45, 0.55),
    });

    const headerY = pageHeight - 65;
    page.drawRectangle({
      x: 40,
      y: headerY - 5,
      width: pageWidth - 80,
      height: 22,
      color: rgb(0.06, 0.09, 0.16),
    });

    page.drawText("SHELF LOCATION", { x: colX.location + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("SKU", { x: colX.sku + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("PRODUCT DESCRIPTION (ENG)", { x: colX.product + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("QTY", { x: colX.qty + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("ORDERS", { x: colX.orders + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });

    return headerY - 20;
  };

  currentY = drawPageHeader(1);
  let pageCounter = 1;

  items.forEach((item) => {
    if (currentY < 45) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      pageCounter++;
      currentY = drawPageHeader(pageCounter);
    }

    page.drawLine({
      start: { x: 40, y: currentY - 4 },
      end: { x: pageWidth - 40, y: currentY - 4 },
      strokeWidth: 0.5,
      color: rgb(0.88, 0.91, 0.95),
    });

    const cleanLocation = (item.binLocation || "")
      .replace(/신창고/g, "NEW")
      .replace(/매장창고/g, "STORE")
      .replace(/위치 미정/g, "Pending")
      .replace(/위치 미지정/g, "No Bin")
      .replace(/조회중/g, "Querying")
      .replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g, "")
      .split("")
      .map((char) => (char.charCodeAt(0) <= 255 ? char : ""))
      .join("")
      .trim();

    const safeTitle = (item.productName || "")
      .replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g, "Item")
      .split("")
      .map((char) => (char.charCodeAt(0) <= 255 ? char : ""))
      .join("")
      .trim();

    page.drawText(cleanLocation.substring(0, 24), { x: colX.location + 5, y: currentY, size: 9, font: HelveticaBold, color: rgb(0.11, 0.3, 0.85) });
    page.drawText((item.sku || "").substring(0, 16), { x: colX.sku + 5, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.11, 0.14) });

    const trunTitle = safeTitle.length > 36 ? `${safeTitle.substring(0, 34)}...` : safeTitle;
    page.drawText(trunTitle, { x: colX.product + 5, y: currentY, size: 8, font: Helvetica, color: rgb(0.25, 0.32, 0.44) });

    page.drawText(String(item.orderedQty || 0), { x: colX.qty + 5, y: currentY, size: 9, font: HelveticaBold, color: rgb(0, 0, 0) });

    const ordersStr = (item.orderNumbers || []).join(", ");
    const trunOrders = ordersStr.length > 12 ? `${ordersStr.substring(0, 10)}...` : ordersStr;
    page.drawText(trunOrders, { x: colX.orders + 5, y: currentY, size: 8, font: Helvetica, color: rgb(0.11, 0.3, 0.85) });

    currentY -= 18;
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
