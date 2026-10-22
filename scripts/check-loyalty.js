import { createJoyLoyalty, LOYALTY_POLICY } from '../app/services/joyLoyalty.server.js';
import { customerShop } from '../app/services/customerApi.server.js';
// Read-only check: never sends an award or queries a customer's personal data.
const loyalty = createJoyLoyalty();
if (!loyalty.configured()) {
  console.error(JSON.stringify({ ready: false, reason: 'Set server-only JOY_APP_KEY and JOY_SECRET_KEY.' }));
  process.exitCode = 1;
} else {
  try {
    const result = await loyalty.checkConnection({ shop: customerShop() });
    console.log(JSON.stringify({ ready: true, ...result, policy: LOYALTY_POLICY, awardTested: false }));
  } catch {
    console.error(JSON.stringify({ ready: false, reason: 'Joy credentials, plan access or store identity could not be verified.' }));
    process.exitCode = 1;
  }
}
