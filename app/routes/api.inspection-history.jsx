import prisma from "../db.server";
import dayjs from "dayjs";

// CORS origin validator
function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowed =
    origin.includes("myshopify.com") ||
    origin.includes("dawayo.de") ||
    origin.includes("localhost") ||
    origin.includes("process-list-beryl.vercel.app");

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://dawayo.de",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shop-Domain",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
  };
}

// GET: 검수 내역 조회 API
export const loader = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    const orderName = url.searchParams.get("orderName");
    const query = url.searchParams.get("query") || "";
    const status = url.searchParams.get("status") || "ALL";
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const shop = url.searchParams.get("shop");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 250);
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);
    const skip = (page - 1) * limit;

    const whereClause = {};

    if (shop) {
      whereClause.shop = shop;
    }

    if (orderId) {
      whereClause.orderId = { contains: orderId, mode: "insensitive" };
    }

    if (orderName) {
      whereClause.orderName = { contains: orderName, mode: "insensitive" };
    }

    if (status !== "ALL") {
      whereClause.status = status;
    }

    if (query.trim() !== "") {
      const q = query.trim();
      whereClause.OR = [
        { orderName: { contains: q, mode: "insensitive" } },
        { inspectorName: { contains: q, mode: "insensitive" } },
        {
          items: {
            some: {
              OR: [
                { productTitle: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { barcode: { contains: q, mode: "insensitive" } },
                { substitutedProductTitle: { contains: q, mode: "insensitive" } }
              ]
            }
          }
        }
      ];
    }

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt.gte = dayjs(startDate).startOf("day").toDate();
      }
      if (endDate) {
        whereClause.createdAt.lte = dayjs(endDate).endOf("day").toDate();
      }
    }

    const [total, records] = await Promise.all([
      prisma.inspectionRecord.count({ where: whereClause }),
      prisma.inspectionRecord.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { items: true }
      })
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return Response.json(
      {
        success: true,
        records,
        pagination: {
          total,
          page,
          limit,
          totalPages
        }
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[API] 검수 내역 조회 오류:", error);
    return Response.json(
      { success: false, error: error.message || "검수 내역 조회 중 오류가 발생했습니다." },
      { status: 500, headers: corsHeaders }
    );
  }
};

// POST / PUT: 검수 결과 저장 및 업데이트 API
export const action = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === "POST" || request.method === "PUT") {
    try {
      const data = await request.json();
      const {
        orderId,
        orderName,
        shop = "unknown-shop",
        inspectorName = "외부 API 작업자",
        items = [],
        customShippingAddress = null,
        customBillingAddress = null,
        customVat = null
      } = data;

      if (!orderId || !orderName) {
        return Response.json(
          { success: false, error: "필수 필드(orderId, orderName)가 누락되었습니다." },
          { status: 400, headers: corsHeaders }
        );
      }

      // 검수 상태 자동 판별 (전달받은 status가 없으면 계산)
      let status = data.status;
      if (!status) {
        const hasIssue = items.some((item) => item.issueType != null);
        const isPartial = items.some(
          (item) => (item.inspectedQuantity || 0) < (item.orderedQuantity || 0) && !item.issueType
        );

        if (hasIssue) {
          status = "ISSUE_REPORTED";
        } else if (isPartial) {
          status = "PARTIAL";
        } else {
          status = "SUCCESS";
        }
      }

      // 기존 기록이 있을 경우 안전하게 갱신 (Cascade로 아이템 자동 재생성)
      await prisma.inspectionRecord.deleteMany({
        where: { orderId }
      });

      const record = await prisma.inspectionRecord.create({
        data: {
          orderId,
          orderName,
          shop,
          inspectorName,
          status,
          customShippingAddress: customShippingAddress ? JSON.parse(JSON.stringify(customShippingAddress)) : undefined,
          customBillingAddress: customBillingAddress ? JSON.parse(JSON.stringify(customBillingAddress)) : undefined,
          customVat,
          completedAt: new Date(),
          items: {
            create: items.map((item) => ({
              variantId: item.variantId || "N/A",
              productTitle: item.productTitle || item.title || "미지정 상품",
              variantTitle: item.variantTitle || "",
              sku: item.sku || null,
              barcode: item.barcode || null,
              orderedQuantity: Number(item.orderedQuantity) || 0,
              inspectedQuantity: Number(item.inspectedQuantity) || 0,
              issueType: item.issueType || null,
              issueNote: item.issueNote || null,
              substitutedVariantId: item.substitutedVariantId || null,
              substitutedProductTitle: item.substitutedProductTitle || null
            }))
          }
        },
        include: { items: true }
      });

      return Response.json(
        {
          success: true,
          message: "검수 내역이 성공적으로 저장되었습니다.",
          record
        },
        { headers: corsHeaders }
      );
    } catch (error) {
      console.error("[API] 검수 내역 저장 오류:", error);
      return Response.json(
        { success: false, error: error.message || "검수 내역 저장 중 오류가 발생했습니다." },
        { status: 500, headers: corsHeaders }
      );
    }
  }

  return Response.json(
    { success: false, error: "허용되지 않은 HTTP 메서드입니다." },
    { status: 405, headers: corsHeaders }
  );
};
