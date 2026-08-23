import prisma from "../db.server";

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

// 기본 디폴트 공지 설정 (DB 기록이 없을 시 방어용)
const DEFAULT_NOTICE = {
  isActive: true,
  noticeVersion: "v1.3.0",
  badgeTag: "NEW ANNOUNCEMENT",
  title: "다와요(Dawayo) 서비스 안내",
  subtext: "고객님께 더 빠르고 정확한 서비스를 제공하기 위해 시스템이 업데이트되었습니다.",
  items: [
    { title: "실시간 ERP 입고 시스템", desc: "입고 예정 상품 관리 및 재고 반영 속도가 향상되었습니다." },
    { title: "품절 상품 재입고 알림", desc: "품절 상품 상세 페이지에서 입고 예정일(ETA) 확인 및 재입고 알림 신청이 가능합니다." },
    { title: "피킹 및 검수 강화", desc: "안전하고 정확한 검수 절차를 거쳐 발송됩니다." },
  ],
};

export const loader = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const shop = resolveShop(request);

    let notice = await prisma.storefrontNotice.findUnique({
      where: { shop },
    });

    if (!notice) {
      // Fallback search with loose shop pattern or latest
      notice = await prisma.storefrontNotice.findFirst({
        where: {
          shop: { contains: "dawayo", mode: "insensitive" },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!notice) {
      return Response.json(
        { success: true, data: DEFAULT_NOTICE },
        { headers: corsHeaders }
      );
    }

    let parsedItems = DEFAULT_NOTICE.items;
    if (notice.itemsJson) {
      try {
        parsedItems =
          typeof notice.itemsJson === "string"
            ? JSON.parse(notice.itemsJson)
            : notice.itemsJson;
      } catch (e) {
        console.warn("Failed to parse notice itemsJson:", e);
      }
    }

    return Response.json(
      {
        success: true,
        data: {
          isActive: notice.isActive,
          noticeVersion: notice.noticeVersion || "v1.3.0",
          badgeTag: notice.badgeTag || "NEW ANNOUNCEMENT",
          title: notice.title || DEFAULT_NOTICE.title,
          subtext: notice.subtext || DEFAULT_NOTICE.subtext,
          items: parsedItems,
        },
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[Storefront Notice API Error]:", error);
    return Response.json(
      { success: false, data: DEFAULT_NOTICE },
      { status: 500, headers: corsHeaders }
    );
  }
};
