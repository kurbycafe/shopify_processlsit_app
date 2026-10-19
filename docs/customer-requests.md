# Customer request API improvements

These endpoints use the configured CUSTOMER_API_SHOP. The caller cannot override the shop.
All successful submissions refer to a persisted database receipt. Database failures return an error.

- POST /api/customer/v1/b2b-inquiry: public business inquiry; requires companyName and email.
  Optional contactName, phone, vatId and message are validated and stored. Repeated identical
  submissions reuse the stored receipt. Response: accepted, inquiryId, status, submittedAt.
- POST /api/customer/v1/return-request: requires a Customer Account Bearer token, orderId and reason.
  orderId accepts a numeric Shopify order ID, canonical Order GID, or a conventional #order-number.
  The exact order must appear in the authenticated customer's Shopify orders before any request is saved.
  Optional type is return or exchange; optional productName is customer-provided context.
  Submitted customerId/email/shop values cannot establish ownership.
  Response: accepted, returnId, canonical orderId, status, submittedAt.
  This records a review request; it does not approve a Shopify return or perform a refund.
- GET /api/customer/v1/notification-preferences: authenticated saved preferences for the current customer.
- POST /api/customer/v1/notification-preferences: authenticated non-empty partial boolean updates.
  Supported keys are pushEnabled, orderUpdates, events, marketing. Unknown fields are rejected.
  Independent database columns avoid lost updates when different preferences change concurrently.
  These values store app preferences; they do not register a push device or alter Shopify email marketing consent.
- GET /api/customer/v1/arrivals: SCHEDULED, IN_TRANSIT, ARRIVED only; completed RECEIVED records excluded.
  limit is 1..25 (default 25), cursor is the previous pagination.nextCursor.
  Public response includes status, scheduledDate, updatedAt, and up to 50 SKU/title items per entry.
  itemsTruncated reports more than 50 items. Barcode, expected/received quantities, purchase prices,
  supplier, container ID/reference and internal notes are never exposed.
  Incoming quantities do not establish current sellable inventory in the mobile app.

## Admin workflow

Open /app/customer-requests in the authenticated Shopify app. The navigation label is
고객 문의 · 반품 접수. The page shows at most 25 requests, offers status filtering and next-page
navigation, and permits REQUESTED / REVIEWING / CLOSED status changes within session.shop only.
Status updates are internal review tracking; they do not send email, approve returns or create refunds.

## Database preparation

New Prisma models: CustomerRequest and CustomerNotificationPreference.
InspectionItem.orderLineId is nullable so existing inspection records remain compatible.

Prepared additive SQL: prisma/migrations/20261016090000_customer_requests/migration.sql.
Shared statements in app/services/customerSchema.js are used by the existing runtime schema
repair and scripts/prepare-customer-schema.js deployment preparation.
No production database migration or deployment was performed during development.
Regenerate Prisma Client and review/apply additive schema preparation in the target environment
before enabling the new endpoints. Never reset or replace an existing production database.
The project previously had no checked-in migration baseline, so review migration history before
choosing prisma migrate deploy for an existing database; the established additive preparation
script is retained for the existing deployment path.

## Verification

Customer Account ownership query validated against the official Shopify Customer Account API 2026-01 schema.
Customer service tests cover persistence failure, byte limits, real receipts, duplicate submissions,
customer/order ownership, account isolation, partial boolean updates, admin shop constraints,
arrival response allowlists, and readiness checks for missing columns/indexes.
Mobile regression tests cover accepted receipt IDs, anonymous writes, pagination, and exact SKU/current availability.

The mobile return list currently displays receipts created in that session. This change does not add
a customer-facing paginated return-history endpoint or automatic sync of subsequent admin status changes.
