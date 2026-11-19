import { handleProductMetaAction, handleProductMetaLoader } from "../services/productMetaServer.server.js";
import { listTemperatureProducts, saveProductTemperatures, TemperatureError } from "../services/productTemperatures.server.js";

// Keeps the admin menu on screen and offers a retry when this screen fails.
export { RouteErrorBoundary as ErrorBoundary } from "../components/common/RouteErrorBoundary.jsx";

const FALLBACK_ERROR_MESSAGE = "상품 온도 정보를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";

export async function loader({ request }) {
  return handleProductMetaLoader({
    request,
    ErrorClass: TemperatureError,
    fallbackErrorMessage: FALLBACK_ERROR_MESSAGE,
    listProducts: listTemperatureProducts,
  });
}

export async function action({ request }) {
  return handleProductMetaAction({
    request,
    ErrorClass: TemperatureError,
    fallbackErrorMessage: FALLBACK_ERROR_MESSAGE,
    saveProducts: saveProductTemperatures,
  });
}
