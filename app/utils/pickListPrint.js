import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { parseWarehouseInfo, compareRegalAscending } from "./warehouseHelpers.js";

export async function generatePickListPdfBuffer(items = [], techTime = "") {
  const pdfDoc = await PDFDocument.create();
  const HelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const Helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageWidth = 842;
  const pageHeight = 595;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let currentY = pageHeight - 45;

  const colX = {
    location: 40,
    sku: 220,
    product: 340,
    qty: 670,
    orders: 720,
  };

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

  let pageCounter = 1;

  const drawPageHeader = (pageNum) => {
    page.drawText(`PICKING LIST (PROCESS LIST) - [${techTime}]`, {
      x: 40,
      y: pageHeight - 32,
      size: 13,
      font: HelveticaBold,
      color: rgb(0.06, 0.09, 0.16),
    });
    page.drawText(`Page ${pageNum}`, {
      x: pageWidth - 85,
      y: pageHeight - 32,
      size: 9,
      font: Helvetica,
      color: rgb(0.39, 0.45, 0.55),
    });

    const headerY = pageHeight - 56;
    page.drawRectangle({
      x: 40,
      y: headerY - 4,
      width: pageWidth - 80,
      height: 20,
      color: rgb(0.06, 0.09, 0.16),
    });

    page.drawText("SHELF / REGAL LOCATION", { x: colX.location + 5, y: headerY, size: 8.5, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("SKU / BARCODE", { x: colX.sku + 5, y: headerY, size: 8.5, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("PRODUCT DESCRIPTION (ENG)", { x: colX.product + 5, y: headerY, size: 8.5, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("QTY", { x: colX.qty + 5, y: headerY, size: 8.5, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("ORDERS", { x: colX.orders + 5, y: headerY, size: 8.5, font: HelveticaBold, color: rgb(1, 1, 1) });

    return headerY - 18;
  };

  currentY = drawPageHeader(1);

  const drawSectionBanner = (title, count, qty, bgColor, textColor) => {
    if (currentY < 60) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      pageCounter++;
      currentY = drawPageHeader(pageCounter);
    }

    currentY -= 4;
    page.drawRectangle({
      x: 40,
      y: currentY - 4,
      width: pageWidth - 80,
      height: 18,
      color: bgColor,
    });

    page.drawText(`${title} - (${count} Items / Total ${qty} Qty)`, {
      x: 46,
      y: currentY,
      size: 9,
      font: HelveticaBold,
      color: textColor,
    });

    currentY -= 18;
  };

  const renderItemRows = (itemList, isStoreSection = false) => {
    itemList.forEach((item) => {
      if (currentY < 40) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        pageCounter++;
        currentY = drawPageHeader(pageCounter);
      }

      page.drawLine({
        start: { x: 40, y: currentY - 3 },
        end: { x: pageWidth - 40, y: currentY - 3 },
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

      const locColor = isStoreSection ? rgb(0.1, 0.3, 0.85) : rgb(0.03, 0.5, 0.6);

      page.drawText(cleanLocation.substring(0, 26), {
        x: colX.location + 5,
        y: currentY,
        size: 9,
        font: HelveticaBold,
        color: locColor,
      });

      page.drawText((item.sku || "").substring(0, 16), {
        x: colX.sku + 5,
        y: currentY,
        size: 8.5,
        font: Helvetica,
        color: rgb(0.1, 0.11, 0.14),
      });

      const trunTitle = safeTitle.length > 42 ? `${safeTitle.substring(0, 40)}...` : safeTitle;
      page.drawText(trunTitle, {
        x: colX.product + 5,
        y: currentY,
        size: 8,
        font: Helvetica,
        color: rgb(0.25, 0.32, 0.44),
      });

      page.drawText(String(item.orderedQty || 0), {
        x: colX.qty + 5,
        y: currentY,
        size: 9,
        font: HelveticaBold,
        color: rgb(0, 0, 0),
      });

      const ordersStr = (item.orderNumbers || []).join(", ");
      const trunOrders = ordersStr.length > 14 ? `${ordersStr.substring(0, 12)}...` : ordersStr;
      page.drawText(trunOrders, {
        x: colX.orders + 5,
        y: currentY,
        size: 8,
        font: Helvetica,
        color: rgb(0.11, 0.3, 0.85),
      });

      currentY -= 17;
    });
  };

  if (storeItems.length > 0) {
    const storeQty = storeItems.reduce((sum, i) => sum + i.orderedQty, 0);
    drawSectionBanner("1. [ STORE WAREHOUSE / STORE PICKING ]", storeItems.length, storeQty, rgb(0.9, 0.94, 1.0), rgb(0.08, 0.25, 0.7));
    renderItemRows(storeItems, true);
    currentY -= 6;
  }

  if (newOnlyItems.length > 0) {
    const newQty = newOnlyItems.reduce((sum, i) => sum + i.orderedQty, 0);
    drawSectionBanner("2. [ NEW WAREHOUSE / MAIN WH PICKING ]", newOnlyItems.length, newQty, rgb(0.88, 0.98, 0.99), rgb(0.04, 0.45, 0.5));
    renderItemRows(newOnlyItems, false);
    currentY -= 6;
  }

  if (noBinItems.length > 0) {
    const noBinQty = noBinItems.reduce((sum, i) => sum + i.orderedQty, 0);
    drawSectionBanner("3. [ UNASSIGNED LOCATION / NO BIN ]", noBinItems.length, noBinQty, rgb(1.0, 0.97, 0.88), rgb(0.7, 0.4, 0.05));
    renderItemRows(noBinItems, false);
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
