// Isolated tests must never discover or mutate the deployment database or mail service.
process.env.NODE_ENV = "test";
process.env.PRISMA_DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test?connect_timeout=1";
process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-secret-for-tokens";
process.env.SHOPIFY_APP_URL = "https://example.com";
process.env.SCOPES = "read_orders,read_products";
for (const key of ["BREVO_API_KEY", "SMTP_PASSWORD", "SMTP_USER", "VAPID_PRIVATE_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON", "GOOGLE_APPLICATION_CREDENTIALS", "PUSH_WORKER_SECRET"]) delete process.env[key];
process.env.OPT_OUT_INSTRUMENTATION = "true";
