import prisma, { ensureDatabaseSchema } from "../db.server";
import dayjs from "dayjs";

// CORS origin validator
function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  let allowed = false;

  try {
    if (origin) {
      const url = new URL(origin);
      const host = url.hostname.toLowerCase();
      if (
        host === "dawayo.de" ||
        host.endsWith(".dawayo.de") ||
        host.endsWith(".myshopify.com") ||
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".vercel.app")
      ) {
        allowed = true;
      }
    }
  } catch (e) {
    allowed = false;
  }

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://dawayo.de",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shop-Domain",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function resolveShop(request, explicitShop = null) {
  const url = new URL(request.url);
  const rawShop =
    explicitShop ||
    request.headers.get("x-shop-domain") ||
    url.searchParams.get("shop") ||
    "dawayo.de";

  return rawShop.replace(/^https?:\/\//, "").split("/")[0].toLowerCase().trim();
}

// GET: 검수 내역 조회 API
export const loader = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    await ensureDatabaseSchema();
    const url = new URL(request.url);
    const shop = resolveShop(request);
    const orderId = url.searchParams.get("orderId");
    const orderName = url.searchParams.get("orderName");
    const query = (url.searchParams.get("query") || "").trim();
    const status = url.searchParams.get("status") || "ALL";
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 250);
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);
    const skip = (page - 1) * limit;

    const whereClause = {
      OR: [
        { shop },
        { shop: shop.replace(".myshopify.com", "") },
        { shop: "dawayo.de" },
      ],
    };

    if (orderId) {
      whereClause.orderId = { contains: orderId, mode: "insensitive" };
    }

    if (orderName) {
      whereClause.orderName = { contains: orderName, mode: "insensitive" };
    }

    if (status !== "ALL") {
      whereClause.status = status;
    }

    if (query !== "") {
      whereClause.AND = [
        {
          OR: [
            { orderName: { contains: query, mode: "insensitive" } },
            { inspectorName: { contains: query, mode: "insensitive" } },
            {
              items: {
                some: {
                  OR: [
                    { productTitle: { contains: query, mode: "insensitive" } },
                    { sku: { contains: query, mode: "insensitive" } },
                    { barcode: { contains: query, mode: "insensitive" } },
                    { substitutedProductTitle: { contains: query, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        },
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
        include: { items: true },
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return Response.json(
      {
        success: true,
        data: {
          records,
          pagination: {
            total,
            page,
            limit,
            totalPages,
          },
        },
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[API] 검수 내역 조회 오류:", error);
    return Response.json(
      {
        success: false,
        error: {
          code: "FETCH_FAILED",
          message: error.message || "검수 내역 조회 중 오류가 발생했습니다.",
        },
      },
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
      const shop = resolveShop(request, data.shop);
      const {
        orderId,
        orderName,
        inspectorName = "외부 API 작업자",
        items = [],
        customShippingAddress = null,
        customBillingAddress = null,
        customVat = null,
      } = data;

      if (!orderId || !orderName) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "필수 항목(orderId, orderName)이 누락되었습니다.",
            },
          },
          { status: 400, headers: corsHeaders }
        );
      }

      // 검수 상태 자동 판별
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

      // Transactional record update/upsert
      const record = await prisma.$transaction(async (tx) => {
        // Find existing record
        const existing = await tx.inspectionRecord.findUnique({
          where: { orderId },
        });

        if (existing) {
          await tx.inspectionItem.deleteMany({
            where: { inspectionRecordId: existing.id },
          });

          return await tx.inspectionRecord.update({
            where: { id: existing.id },
            data: {
              orderName,
              shop,
              inspectorName,
              status,
              customShippingAddress: customShippingAddress
                ? JSON.parse(JSON.stringify(customShippingAddress))
                : undefined,
              customBillingAddress: customBillingAddress
                ? JSON.parse(JSON.stringify(customBillingAddress))
                : undefined,
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
                  substitutedProductTitle: item.substitutedProductTitle || null,
                })),
              },
            },
            include: { items: true },
          });
        }

        return await tx.inspectionRecord.create({
          data: {
            orderId,
            orderName,
            shop,
            inspectorName,
            status,
            customShippingAddress: customShippingAddress
              ? JSON.parse(JSON.stringify(customShippingAddress))
              : undefined,
            customBillingAddress: customBillingAddress
              ? JSON.parse(JSON.stringify(customBillingAddress))
              : undefined,
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
                substitutedProductTitle: item.substitutedProductTitle || null,
              })),
            },
          },
          include: { items: true },
        });
      });

      return Response.json(
        {
          success: true,
          message: "검수 내역이 성공적으로 저장되었습니다.",
          data: { record },
        },
        { headers: corsHeaders }
      );
    } catch (error) {
      console.error("[API] 검수 내역 저장 오류:", error);
      return Response.json(
        {
          success: false,
          error: {
            code: "SAVE_FAILED",
            message: error.message || "검수 내역 저장 중 오류가 발생했습니다.",
          },
        },
        { status: 500, headers: corsHeaders }
      );
    }
  }

  return Response.json(
    {
      success: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "허용되지 않은 HTTP 메서드입니다.",
      },
    },
    { status: 405, headers: corsHeaders }
  );
};
