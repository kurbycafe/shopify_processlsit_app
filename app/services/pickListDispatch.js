export async function dispatchPickList({ shop, items, orders, clientTime, techTime }, {
  db, generatePdf, sendEmail,
}) {
  if (!Array.isArray(items) || !items.length || !Array.isArray(orders) || !orders.length || orders.length > 1000) {
    throw new Error("발송할 상품과 주문 목록을 확인해 주세요.");
  }
  const uniqueOrders = [...new Map(orders.map(order => [order.id, order])).values()];
  if (uniqueOrders.some(order => !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(order.id) || !order.name)) {
    throw new Error("올바르지 않은 주문 정보입니다.");
  }
  const records = await db.inspectionRecord.findMany({
    where: { orderId: { in: uniqueOrders.map(order => order.id) } }, select: { orderId: true, shop: true },
  });
  if (records.some(record => record.shop !== shop)) throw new Error("다른 상점의 주문은 처리할 수 없습니다.");
  const pdf = await generatePdf(items, techTime);
  await sendEmail({ mailTitle: `${clientTime} 기준 처리중 리스트`, base64Pdf: pdf.toString("base64"), techTime });
  try {
    await db.$transaction(async tx => {
      for (const order of uniqueOrders) {
        await tx.inspectionRecord.upsert({
          where: { orderId: order.id }, update: { isPickListPrinted: true },
          create: { orderId: order.id, orderName: order.name, shop, status: "PENDING", isPickListPrinted: true },
        });
      }
    });
    return { success: true, recorded: true, message: "처리중 리스트 PDF가 물류 이메일로 발송되었습니다." };
  } catch (error) {
    console.error("Pick-list email delivered but status recording failed:", error.message);
    return { success: true, recorded: false, message: "이메일은 발송되었지만 주문의 발송 표시를 저장하지 못했습니다. 중복 발송하지 말고 상태를 확인해 주세요." };
  }
}
