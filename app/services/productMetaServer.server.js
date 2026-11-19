import { authenticate } from "../shopify.server.js";
import { resolveCanonicalShop } from "../utils/shopDomain.js";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Parses JSON or object config payloads stored in `MobileStorefrontConfig.tickersJson`.
 */
export function parseExtendedConfig(raw, ErrorClass) {
  if (raw == null) return {};
  let value = raw;
  try {
    if (typeof value === "string") value = JSON.parse(value);
  } catch {
    throw new ErrorClass(409, "기존 앱 설정을 읽을 수 없습니다. 설정을 확인한 뒤 다시 시도해주세요.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ErrorClass(409, "기존 앱 설정 형식이 올바르지 않습니다.");
  }
  return value;
}

/**
 * Executes a Shopify Admin GraphQL query or mutation and normalizes transport / API errors.
 */
export async function executeProductMetaGraphql(
  admin,
  query,
  variables,
  ErrorClass,
  {
    networkMessage = "Shopify 요청 결과를 확인하지 못했습니다. 새로고침하여 실제 값을 확인해주세요.",
    apiErrorMessage = "Shopify 상품 조회에 실패했습니다. 상품 조회 권한과 연결 상태를 확인해주세요.",
  } = {}
) {
  let response;
  let result;
  try {
    response = await admin.graphql(query, { variables });
    result = await response.json();
  } catch {
    throw new ErrorClass(502, networkMessage);
  }
  if (response.ok === false || result.errors?.length || !result.data) {
    throw new ErrorClass(502, apiErrorMessage);
  }
  return result.data;
}

/**
 * Validates cursor pagination arguments and GraphQL `products` connection shape.
 */
export function validateProductPageConnection(
  connection,
  after,
  ErrorClass,
  {
    invalidResponseMessage = "Shopify 상품 목록 응답이 올바르지 않습니다.",
    nextPageErrorMessage = "상품 목록의 다음 페이지를 확인하지 못했습니다.",
  } = {}
) {
  if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== "boolean") {
    throw new ErrorClass(502, invalidResponseMessage);
  }
  if (
    connection.pageInfo.hasNextPage &&
    (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after)
  ) {
    throw new ErrorClass(502, nextPageErrorMessage);
  }
}

export function validateCursorParam(after, ErrorClass) {
  if (after !== null && (typeof after !== "string" || after.length > 2000)) {
    throw new ErrorClass(400, "상품 페이지 값이 올바르지 않습니다.");
  }
}

function failureResponse(error, ErrorClass, fallbackErrorMessage) {
  const status = error instanceof ErrorClass ? error.status : 503;
  return Response.json(
    {
      success: false,
      message: error instanceof ErrorClass ? error.message : fallbackErrorMessage,
      ...(error instanceof ErrorClass ? { details: error.details } : {}),
    },
    { status, headers: RESPONSE_HEADERS }
  );
}

/**
 * Shared loader handler for `/app/product-*` admin resource endpoints.
 */
export async function handleProductMetaLoader({
  request,
  ErrorClass,
  fallbackErrorMessage,
  listProducts,
  db = null,
  useCanonicalShop = false,
}) {
  const { admin, session } = await authenticate.admin(request);
  try {
    const after = new URL(request.url).searchParams.get("after") || null;
    const result = await listProducts({
      admin,
      ...(db ? { db } : {}),
      ...(useCanonicalShop ? { shop: resolveCanonicalShop(session.shop) } : {}),
      after,
    });
    return Response.json(result, { headers: RESPONSE_HEADERS });
  } catch (error) {
    return failureResponse(error, ErrorClass, fallbackErrorMessage);
  }
}

/**
 * Shared action handler for `/app/product-*` admin resource endpoints.
 */
export async function handleProductMetaAction({
  request,
  ErrorClass,
  fallbackErrorMessage,
  saveProducts,
  db = null,
  useCanonicalShop = false,
}) {
  const { admin, session } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return Response.json(
      { success: false, message: "POST 요청이 필요합니다." },
      { status: 405, headers: { Allow: "POST" } }
    );
  }
  try {
    let input;
    try {
      input = await request.json();
    } catch {
      throw new ErrorClass(400, "저장 요청 형식이 올바르지 않습니다.");
    }
    const result = await saveProducts({
      admin,
      ...(db ? { db } : {}),
      ...(useCanonicalShop ? { shop: resolveCanonicalShop(session.shop) } : {}),
      input,
    });
    return Response.json(result, { headers: RESPONSE_HEADERS });
  } catch (error) {
    return failureResponse(error, ErrorClass, fallbackErrorMessage);
  }
}
