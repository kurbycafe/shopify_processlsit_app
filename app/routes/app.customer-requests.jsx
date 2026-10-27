import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { listCustomerRequests, updateCustomerRequest } from "../services/customerRequests.server.js";
import { dispatchMobileNotifications } from "../services/mobileNotificationQueue.server.js";
import { MobileApiError } from "../services/mobileApi.server.js";
import CustomerRequestsManager from "../components/CustomerRequestsManager.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const search = new URL(request.url).searchParams;
  const status = search.get("status") || "REQUESTED";
  const type = search.get("type") || null;
  try {
    return {
      ...(await listCustomerRequests({
        db: prisma,
        shop: session.shop,
        status,
        type,
        after: search.get("cursor"),
      })),
      status,
      type,
      error: null,
    };
  } catch (error) {
    return Response.json(
      {
        requests: [],
        nextCursor: null,
        status,
        type,
        error:
          error instanceof MobileApiError
            ? error.message
            : "고객 요청을 불러오지 못했습니다. 다시 시도해주세요.",
      },
      { status: error instanceof MobileApiError ? error.status : 503 }
    );
  }
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return Response.json(
      { error: "POST 요청이 필요합니다." },
      { status: 405, headers: { Allow: "POST" } }
    );
  }
  const form = await request.formData();
  const replyValue = form.has("reply") ? String(form.get("reply") ?? "") : undefined;
  try {
    const result = await updateCustomerRequest({
      db: prisma,
      shop: session.shop,
      id: form.get("id"),
      status: form.get("status"),
      reply: replyValue,
      admin,
      applyTags: form.get("applyTags") === "true",
    });
    if (replyValue?.trim()) {
      await dispatchMobileNotifications({ db: prisma, shop: session.shop, limit: 20 }).catch(() => {});
    }
    return result;
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof MobileApiError
            ? error.message
            : "요청 상태를 저장하지 못했습니다. 다시 시도해주세요.",
      },
      { status: error instanceof MobileApiError ? error.status : 503 }
    );
  }
};

export default function CustomerRequestsPage() {
  return (
    <Page fullWidth>
      <CustomerRequestsManager />
    </Page>
  );
}
