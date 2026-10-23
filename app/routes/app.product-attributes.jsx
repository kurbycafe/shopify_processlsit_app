import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { resolveCanonicalShop } from "../services/mobileStorefront.server.js";
import { listAttributeProducts, saveProductAttributes, AttributeError } from "../services/productAttributes.server.js";
const headers = { "Cache-Control": "no-store" };
function failure(error) {
 return Response.json({ success: false, message: error instanceof AttributeError ? error.message : "상품 속성 저장 결과를 확인하지 못했습니다. 목록을 새로고침하여 실제 값을 확인해주세요." },
  { status: error instanceof AttributeError ? error.status : 503, headers });
}
export async function loader({ request }) {
 const { admin, session } = await authenticate.admin(request);
 try { return Response.json(await listAttributeProducts({ admin, db: prisma, shop: resolveCanonicalShop(session.shop), after: new URL(request.url).searchParams.get("after") || null }), { headers }); }
 catch (error) { return failure(error); }
}
export async function action({ request }) {
 const { admin, session } = await authenticate.admin(request);
 if (request.method !== "POST") return Response.json({ success: false, message: "POST 요청이 필요합니다." }, { status: 405, headers: { ...headers, Allow: "POST" } });
 try {
  let input;
  try { input = await request.json(); } catch { throw new AttributeError(400, "저장 요청 형식이 올바르지 않습니다."); }
  return Response.json(await saveProductAttributes({ admin, db: prisma, shop: resolveCanonicalShop(session.shop), input }), { headers });
 } catch (error) { return failure(error); }
}
