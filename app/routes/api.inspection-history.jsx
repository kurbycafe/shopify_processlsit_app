import { operationalIdentity } from "../services/operationalApi.server.js";
import { unauthenticated } from "../shopify.server.js";
import { readInspectionOrder, validateInspectionSubstitutes } from "../services/inspectionOrders.server.js";
import { normalizeOperationalInspectionItems } from "../services/inspectionValidation.js";
import { MobileApiError, readId } from "../services/mobileApi.server.js";
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

// GET: 검수 내역 조회 API
export const loader = async ({ request }) => {
  const corsHeaders = { ...getCorsHeaders(request), "Cache-Control": "private, no-store", Vary: "Origin" };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const identity = operationalIdentity(request, "inspections:read");
  if (identity instanceof Response) return identity;
  const shop = identity.shop;

  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    const orderName = url.searchParams.get("orderName");
    const query = (url.searchParams.get("query") || "").trim();
    const status = url.searchParams.get("status") || "ALL";
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const readInteger = (name, fallback) => {
      const raw = (url.searchParams.get(name) || "").trim() || String(fallback);
      const value = Number(raw);
      if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(value)) {
        throw new MobileApiError(400, "VALIDATION_ERROR", `${name} 값은 정수여야 합니다.`);
      }
      return value;
    };
    const limit = Math.min(Math.max(readInteger("limit", 50), 1), 250);
    const page = Math.max(readInteger("page", 1), 1);
    const skip = (page - 1) * limit;
    // Prisma's integer offset must stay finite and within its supported range.
    if (!Number.isSafeInteger(skip) || skip > 2_147_483_647) {
      throw new MobileApiError(400, "VALIDATION_ERROR", "요청한 페이지가 조회 범위를 초과했습니다.");
    }

    const whereClause = { shop };

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
      const readDate = (value, boundary) => {
        const date = dayjs(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !date.isValid() || date.format("YYYY-MM-DD") !== value) {
          throw new MobileApiError(400, "VALIDATION_ERROR", "날짜는 올바른 YYYY-MM-DD 형식이어야 합니다.");
        }
        return boundary === "start" ? date.startOf("day").toDate() : date.endOf("day").toDate();
      };
      if (startDate) {
        whereClause.createdAt.gte = readDate(startDate, "start");
      }
      if (endDate) {
        whereClause.createdAt.lte = readDate(endDate, "end");
      }
      if (whereClause.createdAt.gte && whereClause.createdAt.lte && whereClause.createdAt.gte > whereClause.createdAt.lte) {
        throw new MobileApiError(400, "VALIDATION_ERROR", "시작일은 종료일보다 늦을 수 없습니다.");
      }
    }

    await ensureDatabaseSchema();
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
    if (error instanceof MobileApiError) {
      return Response.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.status, headers: corsHeaders });
    }
    console.error("[API] 검수 내역 조회 오류:", error);
    return Response.json(
      {
        success: false,
        error: {
          code: "FETCH_FAILED",
          message: "검수 내역 조회 중 오류가 발생했습니다. 다시 시도해 주세요.",
        },
      },
      { status: 500, headers: corsHeaders }
    );
  }
};

// POST / PUT: 검수 결과 저장 및 업데이트 API
export const action = async ({ request }) => {
  const corsHeaders = { ...getCorsHeaders(request), "Cache-Control": "private, no-store", Vary: "Origin" };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === "POST" || request.method === "PUT") {
    const identity = operationalIdentity(request, "inspections:write");
    if (identity instanceof Response) return identity;
    const shop = identity.shop;
    try {
      let data;
      try { data = await request.json(); }
      catch { throw new MobileApiError(400, "VALIDATION_ERROR", "올바른 JSON 검수 데이터를 보내주세요."); }
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new MobileApiError(400, "VALIDATION_ERROR", "검수 데이터를 확인해 주세요.");
      const {
        orderId: rawOrderId,
        orderName: suppliedOrderName,
        inspectorName = "외부 API 작업자",
        items: suppliedItems = [],
        customShippingAddress = null,
        customBillingAddress = null,
        customVat = null,
      } = data;

      if (!rawOrderId || !suppliedOrderName || !Array.isArray(suppliedItems) || !suppliedItems.length) {
        throw new MobileApiError(400,"VALIDATION_ERROR","주문과 검수 상품을 확인해 주세요.");
      }
      const orderId=readId(String(rawOrderId),"Order");
      const { admin }=await unauthenticated.admin(shop);
      const order=await readInspectionOrder(admin,{id:orderId});
      if (!order || order.cancelledAt) throw new MobileApiError(404,"ORDER_NOT_FOUND","Order not found.");
      let items;
      try { items=normalizeOperationalInspectionItems(suppliedItems,order.lineItems.edges.map(edge=>edge.node)); await validateInspectionSubstitutes(admin,items); }
      catch(error){throw new MobileApiError(400,"VALIDATION_ERROR",error.message);}
      const orderName=order.name;
      const computedStatus=items.some(item=>item.issueType)?"ISSUE_REPORTED":items.some(item=>item.inspectedQuantity<item.orderedQuantity)?"PARTIAL":"SUCCESS";
      if (data.status && !["PENDING","FAILED","SUCCESS","PARTIAL","ISSUE_REPORTED"].includes(data.status)) throw new MobileApiError(400,"VALIDATION_ERROR","잘못된 검수 상태입니다.");
      if (data.status==="SUCCESS" && computedStatus!=="SUCCESS") throw new MobileApiError(400,"VALIDATION_ERROR","미완료 검수를 완료 상태로 저장할 수 없습니다.");
      const status=["PENDING","FAILED"].includes(data.status)?data.status:computedStatus;
      await ensureDatabaseSchema();

      // Transactional record update/upsert
      const record = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${shop}:${orderId}`}, 0))`;
        // Find existing record
        const existing = await tx.inspectionRecord.findUnique({
          where: { orderId },
        });

        if (existing && existing.shop !== shop) throw new MobileApiError(404, "ORDER_NOT_FOUND", "Order not found.");
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
                  orderLineId: item.id,
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
                orderLineId: item.id,
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
      if (error instanceof MobileApiError) return Response.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.status, headers: corsHeaders });
      console.error("[API] 검수 내역 저장 오류:", error);
      return Response.json(
        {
          success: false,
          error: {
            code: "SAVE_FAILED",
            message: "검수 내역 저장 중 오류가 발생했습니다. 다시 시도해주세요.",
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
