import prisma from "../db.server.js";
import { handleProductMetaAction, handleProductMetaLoader } from "../services/productMetaServer.server.js";
import { AttributeError, listAttributeProducts, saveProductAttributes } from "../services/productAttributes.server.js";

// Keeps the admin menu on screen and offers a retry when this screen fails.
export { RouteErrorBoundary as ErrorBoundary } from "../components/common/RouteErrorBoundary.jsx";

const FALLBACK_ERROR_MESSAGE = "상품 속성 저장 결과를 확인하지 못했습니다. 목록을 새로고침하여 실제 값을 확인해주세요.";

export async function loader({ request }) {
  return handleProductMetaLoader({
    request,
    ErrorClass: AttributeError,
    fallbackErrorMessage: FALLBACK_ERROR_MESSAGE,
    listProducts: listAttributeProducts,
    db: prisma,
    useCanonicalShop: true,
  });
}

export async function action({ request }) {
  return handleProductMetaAction({
    request,
    ErrorClass: AttributeError,
    fallbackErrorMessage: FALLBACK_ERROR_MESSAGE,
    saveProducts: saveProductAttributes,
    db: prisma,
    useCanonicalShop: true,
  });
}
