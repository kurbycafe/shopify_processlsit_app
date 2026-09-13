import { createMobileHandler } from "../services/mobileApi.server.js";
import { resolveMobileResource } from "../services/mobileData.server.js";

export const loader = createMobileHandler(resolveMobileResource);
export const action = loader;
