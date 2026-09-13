import { operationalIdentity } from "../services/operationalApi.server.js";
import prisma from "../db.server.js";
import {
  getUpcomingContainers,
  fetchOdooContainerProducts,
  getContainerItemsByPo,
  isOdooConfigured,
} from "../services/odooClient.server.js";
import { notifySubscribersForContainer } from "../services/subscriptionService.server.js";

// Origin allowlist validation for container endpoints
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shop-Domain",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
  };
}

// GET: Retrieve container shipments and item details from DB & Odoo
export const loader = async ({ request }) => {
  const headers = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const identity = operationalIdentity(request, "containers:read");
  if (identity instanceof Response) return identity;
  const shop = identity.shop;
  if (shop !== process.env.MOBILE_API_ODOO_SHOP) return Response.json({ success: false, error: { code: "FORBIDDEN", message: "Shop not configured for Odoo." } }, { status: 403, headers });

  try {
    const url = new URL(request.url);
    const containerRef = (
      url.searchParams.get("containerRef") ||
      url.searchParams.get("po") ||
      ""
    ).trim();

    // 1. If specific container / PO is requested:
    if (containerRef) {
      let dbContainer = null;
      try {
        dbContainer = await prisma.container.findUnique({
          where: {
            shop_containerRef: {
              shop,
              containerRef,
            },
          },
          include: { items: true },
        });
      } catch (dbErr) {
        console.warn("[API Container] DB findUnique warning:", dbErr.message);
      }

      // If not in DB and Odoo is configured, try fetching from Odoo
      if (!dbContainer && isOdooConfigured()) {
        try {
          const odooData = await fetchOdooContainerProducts(containerRef);
          if (odooData && odooData.items.length > 0) {
            try {
              dbContainer = await prisma.container.create({
                data: {
                  shop,
                  containerRef: odooData.poName || containerRef,
                  supplier: odooData.partnerId || null,
                  scheduledDate: odooData.scheduledDate || null,
                  status: "SCHEDULED",
                  items: {
                    create: odooData.items.map((it) => ({
                      sku: it.sku || null,
                      barcode: it.barcode || null,
                      productName: it.odooName || "품목",
                      expectedQty: it.qty || 0,
                      receivedQty: 0,
                      unitPrice: it.wholesalePrice || 0,
                      unitPerBox: it.unitPerBox || 0,
                      boxQty: it.boxQty || 0,
                    })),
                  },
                },
                include: { items: true },
              });
            } catch (createErr) {
              console.warn("[API Container] DB create notice:", createErr.message);
              // Fallback to Odoo in-memory object
              dbContainer = {
                shop,
                containerRef: odooData.poName || containerRef,
                supplier: odooData.partnerId || null,
                scheduledDate: odooData.scheduledDate || null,
                status: "SCHEDULED",
                items: odooData.items.map((it) => ({
                  sku: it.sku || null,
                  barcode: it.barcode || null,
                  productName: it.odooName || "품목",
                  expectedQty: it.qty || 0,
                  receivedQty: 0,
                  unitPrice: it.wholesalePrice || 0,
                  unitPerBox: it.unitPerBox || 0,
                  boxQty: it.boxQty || 0,
                })),
              };
            }
          }
        } catch (odooErr) {
          console.warn("[API Container] Odoo fallback query warning:", odooErr.message);
        }
      }

      if (!dbContainer) {
        // Fallback to basic line item query
        const basicItems = await getContainerItemsByPo(containerRef);
        return Response.json(
          {
            success: true,
            data: {
              containerRef,
              shop,
              status: "SCHEDULED",
              itemCount: basicItems.length,
              items: basicItems.map((b) => ({
                productName: b.productName,
                expectedQty: b.qty,
                receivedQty: 0,
                unitPrice: b.price,
              })),
            },
          },
          { headers }
        );
      }

      return Response.json(
        {
          success: true,
          data: dbContainer,
        },
        { headers }
      );
    }

    // 2. Return all registered containers for shop
    let dbContainers = [];
    try {
      dbContainers = await prisma.container.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { items: true } },
        },
      });
    } catch (dbListErr) {
      console.warn("[API Container] DB findMany warning:", dbListErr.message);
    }

    // Also get upcoming Odoo schedule for overview
    let upcomingOdoo = [];
    try {
      upcomingOdoo = await getUpcomingContainers();
    } catch (odooScheduleErr) {
      console.warn("[API Container] Upcoming Odoo schedule warning:", odooScheduleErr.message);
    }

    return Response.json(
      {
        success: true,
        data: {
          containers: dbContainers,
          upcomingSchedule: upcomingOdoo,
        },
      },
      { headers }
    );
  } catch (error) {
    console.error("[API Container] Loader Error:", error);
    return Response.json(
      {
        success: false,
        error: {
          code: "CONTAINER_FETCH_FAILED",
          message: "컨테이너 입고 일정을 조회하는 중 오류가 발생했습니다.",
        },
      },
      { status: 500, headers }
    );
  }
};

// POST: Register or update container status and items
export const action = async ({ request }) => {
  const headers = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return Response.json(
      {
        success: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "허용되지 않은 HTTP 메서드입니다.",
        },
      },
      { status: 405, headers }
    );
  }

  const identity = operationalIdentity(request, "containers:write");
  if (identity instanceof Response) return identity;
  const shop = identity.shop;
  if (shop !== process.env.MOBILE_API_ODOO_SHOP) return Response.json({ success: false, error: { code: "FORBIDDEN", message: "Shop not configured for Odoo." } }, { status: 403, headers });

  try {
    const body = await request.json();
    const {
      containerRef,
      actionType = "sync",
      status = "SCHEDULED",
      supplier,
      scheduledDate,
      notes,
      items = [],
    } = body;

    if (!containerRef || typeof containerRef !== "string" || containerRef.trim() === "") {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "containerRef(PO 번호 또는 컨테이너 참조번호)는 필수 항목입니다.",
          },
        },
        { status: 400, headers }
      );
    }

    const cleanRef = containerRef.trim();

    // 1. Sync from Odoo
    if (actionType === "sync" && isOdooConfigured()) {
      try {
        const odooData = await fetchOdooContainerProducts(cleanRef);
        const syncedItems = odooData.items || [];

        // Transactional upsert container + items
        const updated = await prisma.$transaction(async (tx) => {
          const container = await tx.container.upsert({
            where: {
              shop_containerRef: {
                shop,
                containerRef: cleanRef,
              },
            },
            update: {
              supplier: odooData.partnerId || supplier || null,
              scheduledDate: odooData.scheduledDate || scheduledDate || null,
              status: status || "SCHEDULED",
              notes: notes || undefined,
              syncedAt: new Date(),
            },
            create: {
              shop,
              containerRef: cleanRef,
              supplier: odooData.partnerId || supplier || null,
              scheduledDate: odooData.scheduledDate || scheduledDate || null,
              status: status || "SCHEDULED",
              notes: notes || null,
              syncedAt: new Date(),
            },
          });

          // Re-sync items
          if (syncedItems.length > 0) {
            await tx.containerItem.deleteMany({
              where: { containerId: container.id },
            });

            await tx.containerItem.createMany({
              data: syncedItems.map((it) => ({
                containerId: container.id,
                sku: it.sku || null,
                barcode: it.barcode || null,
                productName: it.odooName || "품목",
                expectedQty: it.qty || 0,
                receivedQty: 0,
                unitPrice: it.wholesalePrice || 0,
                unitPerBox: it.unitPerBox || 0,
                boxQty: it.boxQty || 0,
              })),
            });
          }

          return await tx.container.findUnique({
            where: { id: container.id },
            include: { items: true },
          });
        });

        return Response.json(
          {
            success: true,
            message: `컨테이너 [${cleanRef}] Odoo 동기화가 완료되었습니다.`,
            data: updated,
          },
          { headers }
        );
      } catch (syncErr) {
        console.warn("[API Container] Odoo sync failed, falling back to manual save:", syncErr.message);
      }
    }

    // 2. Manual Update / Upsert with provided items
    const result = await prisma.$transaction(async (tx) => {
      const container = await tx.container.upsert({
        where: {
          shop_containerRef: {
            shop,
            containerRef: cleanRef,
          },
        },
        update: {
          status,
          supplier: supplier || undefined,
          scheduledDate: scheduledDate || undefined,
          notes: notes !== undefined ? notes : undefined,
          receivedAt: status === "RECEIVED" ? new Date() : undefined,
          syncedAt: new Date(),
        },
        create: {
          shop,
          containerRef: cleanRef,
          status,
          supplier: supplier || null,
          scheduledDate: scheduledDate || null,
          notes: notes || null,
          receivedAt: status === "RECEIVED" ? new Date() : null,
          syncedAt: new Date(),
        },
      });

      if (Array.isArray(items) && items.length > 0) {
        await tx.containerItem.deleteMany({
          where: { containerId: container.id },
        });

        await tx.containerItem.createMany({
          data: items.map((it) => ({
            containerId: container.id,
            sku: it.sku || null,
            barcode: it.barcode || null,
            productName: it.productName || it.title || "품목",
            expectedQty: Number(it.expectedQty || it.qty) || 0,
            receivedQty: Number(it.receivedQty) || 0,
            unitPrice: it.unitPrice !== undefined ? Number(it.unitPrice) : null,
            unitPerBox: Number(it.unitPerBox) || 0,
            boxQty: Number(it.boxQty) || 0,
          })),
        });
      }

      return await tx.container.findUnique({
        where: { id: container.id },
        include: { items: true },
      });
    });

    if (status === "RECEIVED" && result?.items?.length > 0) {
      try {
        await notifySubscribersForContainer({
          shop,
          containerRef: cleanRef,
          receivedAt: new Date(),
          items: result.items,
        });
      } catch (notifErr) {
        console.warn("[API Container] Restock notification trigger notice:", notifErr.message);
      }
    }

    return Response.json(
      {
        success: true,
        message: `컨테이너 [${cleanRef}] 정보가 성공적으로 저장되었습니다.`,
        data: result,
      },
      { headers }
    );
  } catch (error) {
    console.error("[API Container] Action Error:", error);
    return Response.json(
      {
        success: false,
        error: {
          code: "CONTAINER_ACTION_FAILED",
          message: error.message || "컨테이너 상태 업데이트 중 오류가 발생했습니다.",
        },
      },
      { status: 500, headers }
    );
  }
};
