import { createHash } from "node:crypto";
import { requireCustomer } from "./customerCommunity.server.js";
import { MobileApiError } from "./mobileApi.server.js";
import { getShopAliases } from "./subscriptionService.server.js";

const B2B_TAG_SET = new Set(["b2b", "wholesale", "b2b-approved"]);

const CUSTOMER_B2B_QUERY = `#graphql
  query ProcesslistB2bCustomer($id: ID!) {
    customer(id: $id) {
      id
      email
      tags
    }
  }
`;

const CREATE_B2B_DISCOUNT_MUTATION = `#graphql
  mutation ProcesslistCreateB2bDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

function addTwoMonths(dateInput) {
  const start = new Date(dateInput);
  const end = new Date(start.getTime());
  end.setUTCMonth(end.getUTCMonth() + 2);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function buildB2bCouponCode(shop, customerId, periodBucket) {
  const digest = createHash("sha256")
    .update(JSON.stringify([shop, "B2B_10_COUPON", customerId, periodBucket]))
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return `B2B10-${periodBucket}-${digest}`;
}

function buildRequestKey(shop, customerId, code) {
  return createHash("sha256")
    .update(JSON.stringify([shop, "B2B_COUPON", customerId, code]))
    .digest("hex");
}

function formatCouponResponse(payload) {
  if (!payload?.code) return null;
  const expiresAtIso = payload.expiresAtIso || payload.expiresAt || null;
  const expiresDate = expiresAtIso ? String(expiresAtIso).slice(0, 10) : null;
  return {
    id: `b2b_${payload.code}`,
    code: payload.code,
    discountPercent: 10,
    discount: "10% 할인",
    title: "이번 달의 B2B 파트너 10% 할인 쿠폰",
    titleDe: "B2B-Partner 10% Rabattgutschein (2-Monats-Zyklus)",
    titleEn: "B2B Partner 10% Discount Coupon (2-Month Cycle)",
    description: "B2B 사업자 회원 전용 2개월 주기 자동 갱신 10% 할인 쿠폰입니다. 번호를 복사하거나 장바구니에 바로 적용하세요.",
    descriptionDe: "Exklusiver 10% B2B-Rabattgutschein (automatische Verlängerung alle 2 Monate).",
    descriptionEn: "Exclusive 10% B2B wholesale coupon (automatically renewed every 2 months).",
    startsAt: payload.startsAt || null,
    expiresAt: expiresDate,
    expiresAtIso,
    cycleMonths: 2,
    shopifySynced: Boolean(payload.shopifyDiscountId),
    isB2bCoupon: true,
    isUsed: false,
  };
}

async function registerDiscountInShopify({ graphql, adminClient, shop, code, customerId, startsAt, expiresAtIso }) {
  const basicCodeDiscount = {
    title: `B2B 파트너 10% 할인 (${code})`,
    code,
    startsAt,
    endsAt: expiresAtIso,
    customerSelection: customerId && /^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)
      ? { customers: { add: [customerId] } }
      : { all: true },
    customerGets: {
      value: { percentage: 0.1 },
      items: { all: true },
    },
    appliesOncePerCustomer: false,
  };

  try {
    if (adminClient?.graphql) {
      const res = await adminClient.graphql(CREATE_B2B_DISCOUNT_MUTATION, {
        variables: { basicCodeDiscount },
      });
      const json = await res.json();
      const nodeId = json?.data?.discountCodeBasicCreate?.codeDiscountNode?.id || null;
      return nodeId;
    }
    if (typeof graphql === "function") {
      const json = await graphql(shop, CREATE_B2B_DISCOUNT_MUTATION, { basicCodeDiscount });
      const nodeId = json?.data?.discountCodeBasicCreate?.codeDiscountNode?.id || null;
      return nodeId;
    }
  } catch (err) {
    console.warn("[B2B Coupon] Shopify discountCodeBasicCreate skipped or pending scope:", err?.message || err);
  }
  return null;
}

export async function checkCustomerB2bApproval({ db, shop, customerId, graphql }) {
  const aliases = getShopAliases(shop);

  if (typeof db.customerRequest?.findFirst === "function") {
    const directRecord = await db.customerRequest.findFirst({
      where: {
        shop: { in: aliases },
        customerId,
        type: "B2B",
        status: "CLOSED",
      },
      orderBy: { id: "desc" },
      select: { id: true, payload: true },
    });

    if (directRecord) {
      return {
        approved: true,
        companyName: directRecord.payload?.companyName || null,
        inquiryId: directRecord.id,
      };
    }
  }

  if (typeof graphql === "function") {
    try {
      const res = await graphql(shop, CUSTOMER_B2B_QUERY, { id: customerId });
      const customer = res?.data?.customer;
      const tags = Array.isArray(customer?.tags) ? customer.tags : [];
      const hasB2bTag = tags.some((t) => B2B_TAG_SET.has(String(t || "").trim().toLowerCase()));
      const email = String(customer?.email || "").trim().toLowerCase();

      if (email && typeof db.customerRequest?.findFirst === "function") {
        const emailRecord = await db.customerRequest.findFirst({
          where: {
            shop: { in: aliases },
            type: "B2B",
            status: "CLOSED",
            payload: { path: ["email"], equals: email },
          },
          orderBy: { id: "desc" },
          select: { id: true, customerId: true, payload: true },
        });

        if (emailRecord) {
          if (!emailRecord.customerId && typeof db.customerRequest?.updateMany === "function") {
            await db.customerRequest
              .updateMany({
                where: { id: emailRecord.id, shop: { in: aliases } },
                data: { customerId },
              })
              .catch(() => {});
          }
          return {
            approved: true,
            companyName: emailRecord.payload?.companyName || null,
            inquiryId: emailRecord.id,
          };
        }
      }

      if (hasB2bTag) {
        return {
          approved: true,
          companyName: null,
          inquiryId: null,
        };
      }
    } catch {
      // Ignore upstream customer lookup error and default to unapproved if no DB record matched
    }
  }

  return { approved: false, companyName: null, inquiryId: null };
}

export async function ensureCustomerB2bCoupon({
  db,
  shop,
  customerId,
  companyName = null,
  graphql = null,
  adminClient = null,
  now = new Date(),
}) {
  if (!db.customerRequest?.findFirst || !db.customerRequest?.upsert) {
    throw new MobileApiError(503, "NOT_CONFIGURED", "B2B coupon service is unavailable.");
  }

  const aliases = getShopAliases(shop);
  const nowMs = now.getTime();

  // Check for an existing active 2-month B2B coupon for this customer
  const existing = await db.customerRequest.findFirst({
    where: {
      shop: { in: aliases },
      customerId,
      type: "B2B_COUPON",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, payload: true, createdAt: true },
  });

  if (existing?.payload?.code && existing?.payload?.expiresAtIso) {
    const expMs = Date.parse(existing.payload.expiresAtIso);
    if (Number.isFinite(expMs) && expMs > nowMs) {
      return formatCouponResponse(existing.payload);
    }
  }

  // Otherwise, issue a new 2-month 10% coupon for the current cycle
  const startsAt = now.toISOString();
  const expiresAtDate = addTwoMonths(now);
  const expiresAtIso = expiresAtDate.toISOString();

  // Period bucket: YYMM + 2-month window index
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const periodBucket = `${yy}${mm}`;
  const code = buildB2bCouponCode(shop, customerId, periodBucket);
  const reqKey = buildRequestKey(shop, customerId, code);

  const shopifyDiscountId = await registerDiscountInShopify({
    graphql,
    adminClient,
    shop,
    code,
    customerId,
    startsAt,
    expiresAtIso,
  });

  const payload = {
    code,
    discountPercent: 10,
    cycleMonths: 2,
    companyName: companyName || null,
    startsAt,
    expiresAt: expiresAtIso.slice(0, 10),
    expiresAtIso,
    shopifyDiscountId: shopifyDiscountId || null,
  };

  const saved = await db.customerRequest.upsert({
    where: { requestKey: reqKey },
    create: {
      shop,
      customerId,
      type: "B2B_COUPON",
      status: "CLOSED",
      requestKey: reqKey,
      payload,
    },
    update: {
      payload,
      status: "CLOSED",
    },
    select: { payload: true },
  });

  return formatCouponResponse(saved.payload);
}

export async function customerB2bCoupon({ db, shop, request, verify, graphql }) {
  const customerId = await requireCustomer(verify, request, shop);
  const approval = await checkCustomerB2bApproval({ db, shop, customerId, graphql });

  if (!approval.approved) {
    return {
      isB2b: false,
      companyName: null,
      coupon: null,
    };
  }

  const coupon = await ensureCustomerB2bCoupon({
    db,
    shop,
    customerId,
    companyName: approval.companyName,
    graphql,
  });

  return {
    isB2b: true,
    companyName: approval.companyName,
    coupon,
  };
}
