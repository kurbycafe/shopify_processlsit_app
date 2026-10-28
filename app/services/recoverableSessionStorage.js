import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

// The upstream adapter caches a failed startup check permanently. Allow later
// requests to retry once the database becomes available again.
export class RecoverableSessionStorage extends PrismaSessionStorage {
  constructor(prisma, options) {
    super(prisma, options);
    this.ready = this.ready.catch(() => false);
    this.recovery = null;
    this.lastAttempt = 0;
  }

  async ensureReady() {
    if (await this.ready) return;
    if (!this.recovery && Date.now() - this.lastAttempt >= 5000) {
      this.lastAttempt = Date.now();
      this.recovery = this.isReady().finally(() => { this.recovery = null; });
    }
    if (this.recovery && await this.recovery) return;
    throw new Error("Shopify session storage is temporarily unavailable");
  }
}
