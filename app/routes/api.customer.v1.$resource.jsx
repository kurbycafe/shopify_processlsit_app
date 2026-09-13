import { createCustomerHandler } from "../services/customerApi.server.js";
import { resolveCustomerResource } from "../services/customerData.server.js";

export const loader = createCustomerHandler(resolveCustomerResource);
export const action = loader;
