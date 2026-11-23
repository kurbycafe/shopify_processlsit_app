import prisma from "../db.server";
import { jsonCorsHeaders } from "../utils/cors.server.js";
import { getShopAliases } from "../utils/shopDomain.js";
import {
  getCachedNotice,
  getStaleCachedNotice,
  rememberNotice,
} from "../services/storefrontCache.server.js";

const MAX_SHOP_LENGTH = 255;

const NOTICE_CORS_OPTIONS = {
  extra: { "Cache-Control": "public, max-age=15, must-revalidate" },
};

function resolveShop(request, explicitShop = null) {
  const url = new URL(request.url);
  const rawShop =
    explicitShop ||
    request.headers.get("x-shop-domain") ||
    url.searchParams.get("shop") ||
    "dawayo.de";

  return rawShop.replace(/^https?:\/\//, "").split("/")[0].toLowerCase().trim().slice(0, MAX_SHOP_LENGTH);
}

async function peekStorefrontNoticeVersion(shop) {
  const select = { id: true, shop: true, isActive: true, noticeVersion: true, updatedAt: true };
  let meta = await prisma.storefrontNotice.findUnique({ where: { shop }, select });
  if (!meta) {
    const aliases = getShopAliases(shop);
    if (aliases.length > 1) {
      meta = await prisma.storefrontNotice.findFirst({
        where: { shop: { in: aliases } },
        orderBy: { updatedAt: "desc" },
        select,
      });
    }
  }
  return meta;
}

async function fetchStorefrontNotice(shop) {
  let notice = await prisma.storefrontNotice.findUnique({
    where: { shop },
  });

  if (!notice) {
    const aliases = getShopAliases(shop);
    if (aliases.length > 1) {
      notice = await prisma.storefrontNotice.findFirst({
        where: { shop: { in: aliases } },
        orderBy: { updatedAt: "desc" },
      });
    }
  }

  return notice;
}

function noticeVersionKey(meta) {
  if (!meta) return "none";
  const ts = meta.updatedAt instanceof Date ? meta.updatedAt.toISOString() : String(meta.updatedAt || "");
  return `${meta.id || ""}:${meta.isActive ? "1" : "0"}:${meta.noticeVersion || ""}:${ts}`;
}

export const loader = async ({ request }) => {
  const corsHeaders = jsonCorsHeaders(request, NOTICE_CORS_OPTIONS);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const shop = resolveShop(request);
  try {
    let meta;
    try {
      meta = await peekStorefrontNoticeVersion(shop);
    } catch (firstError) {
      console.warn("[Storefront Notice API] First read failed, retrying", firstError?.name);
      await new Promise((resolve) => setTimeout(resolve, 150));
      meta = await peekStorefrontNoticeVersion(shop);
    }

    const versionKey = noticeVersionKey(meta);
    const cached = getCachedNotice(shop, versionKey);
    if (cached) {
      return Response.json(cached, { headers: corsHeaders });
    }

    const now = Date.now();
    const notice = meta ? await fetchStorefrontNotice(meta.shop || shop) : null;

    if (!notice || !notice.isActive) {
      const emptyPayload = { success: true, data: null };
      rememberNotice(shop, emptyPayload, now, versionKey);
      return Response.json(emptyPayload, { headers: corsHeaders });
    }

    let parsedItems = [];
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

    const normalizedItems = (Array.isArray(parsedItems) ? parsedItems : []).map((item) => ({
      ...item,
      title: typeof item?.title === "string" ? item.title : "",
      desc: typeof item?.desc === "string" ? item.desc : typeof item?.description === "string" ? item.description : "",
      description:
        typeof item?.description === "string" ? item.description : typeof item?.desc === "string" ? item.desc : "",
    }));

    const noticeVersion = notice.noticeVersion || "v1.0.0";
    const subtext = notice.subtext || "";

    const payload = {
      success: true,
      data: {
        isActive: notice.isActive,
        noticeVersion,
        version: noticeVersion,
        badgeTag: notice.badgeTag || "NOTICE",
        title: notice.title || "",
        subtext,
        description: subtext,
        updatedAt: notice.updatedAt || null,
        items: normalizedItems,
      },
    };
    rememberNotice(shop, payload, now, versionKey);

    return Response.json(payload, { headers: corsHeaders });
  } catch (error) {
    const stale = getStaleCachedNotice(shop);
    if (stale) {
      console.warn("[Storefront Notice API] Serving stale notice after DB failure:", error?.name);
      return Response.json(stale, {
        headers: {
          ...corsHeaders,
          "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
        },
      });
    }
    console.error("[Storefront Notice API Error]:", error);
    return Response.json(
      { success: false, data: null },
      { status: 500, headers: corsHeaders }
    );
  }
};
