import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { resolveCanonicalShop } from "../services/mobileStorefront.server.js";
import { listTemperatureProducts, saveProductTemperatures, TemperatureError } from "../services/productTemperatures.server.js";

function failure(error) {
  const status = error instanceof TemperatureError ? error.status : 503;
  return Response.json({ success: false, message: error instanceof TemperatureError ? error.message : "상품 온도 정보를 처리하지 못했습니다. 잠시 후 다시 시도해주세요." },
    { status, headers: { "Cache-Control": "no-store" } });
}
export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  try {
    const result = await listTemperatureProducts({ admin, db: prisma, shop: resolveCanonicalShop(session.shop),
      after: new URL(request.url).searchParams.get("after") || null });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  if (request.method !== "POST") return Response.json({ success: false, message: "POST 요청이 필요합니다." }, { status: 405, headers: { Allow: "POST" } });
  try {
    let input;
    try { input = await request.json(); } catch { throw new TemperatureError(400, "저장 요청 형식이 올바르지 않습니다."); }
    const result = await saveProductTemperatures({ admin, db: prisma, shop: resolveCanonicalShop(session.shop), input });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
