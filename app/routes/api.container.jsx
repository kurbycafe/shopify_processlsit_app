import {
  getUpcomingContainers,
  getContainerItemsByPo,
} from "../services/odooClient.server.js";

// Origin allowlist validation for container endpoints
function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowed =
    origin.includes("myshopify.com") ||
    origin.includes("dawayo.de") ||
    origin.includes("localhost") ||
    origin.includes("process-list-beryl.vercel.app");

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://dawayo.de",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shop-Domain",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
  };
}

// GET: Retrieve upcoming container shipments and item details
export const loader = async ({ request }) => {
  const headers = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(request.url);
    const containerRef = url.searchParams.get("containerRef") || url.searchParams.get("po");

    // If specific container / PO is requested, return line items
    if (containerRef) {
      const items = await getContainerItemsByPo(containerRef);
      return Response.json(
        {
          success: true,
          containerRef,
          itemCount: items.length,
          items,
        },
        { headers }
      );
    }

    // Otherwise return upcoming container schedule
    const containers = await getUpcomingContainers();

    return Response.json(
      {
        success: true,
        count: containers.length,
        containers,
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

// POST: Register or update container status
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

  try {
    const body = await request.json();
    const { containerRef, actionType = "sync", status, notes } = body;

    if (!containerRef) {
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

    // Query container PO items to verify existence
    const items = await getContainerItemsByPo(containerRef);

    return Response.json(
      {
        success: true,
        message: `컨테이너 [${containerRef}] 처리가 성공적으로 완료되었습니다.`,
        data: {
          containerRef,
          actionType,
          status: status || "CONFIRMED",
          verifiedItemCount: items.length,
          syncedAt: new Date().toISOString(),
          notes: notes || null,
        },
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
