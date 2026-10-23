import { authenticate } from "../shopify.server.js";
import { listExpiryProducts, saveProductExpiry, ExpiryError } from "../services/productExpiry.server.js";

function failure(error) {
  const status = error instanceof ExpiryError ? error.status : 503;
  return Response.json({ success: false, message: error instanceof ExpiryError ? error.message : "상품 유통기한 정보를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.", ...(error instanceof ExpiryError ? { details: error.details } : {}) },
    { status, headers: { "Cache-Control": "no-store" } });
}
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  try {
    const result = await listExpiryProducts({ admin,
      after: new URL(request.url).searchParams.get("after") || null });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  if (request.method !== "POST") return Response.json({ success: false, message: "POST 요청이 필요합니다." }, { status: 405, headers: { Allow: "POST" } });
  try {
    let input;
    try { input = await request.json(); } catch { throw new ExpiryError(400, "저장 요청 형식이 올바르지 않습니다."); }
    const result = await saveProductExpiry({ admin, input });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
