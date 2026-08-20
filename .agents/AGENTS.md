# Project Rules

- Always omit emojis in all UI text, code, notifications, and responses.

## Data Integrity / Concurrency
- Inventory adjustments (decrease/increase) must use Prisma transactions ($transaction) or optimistic locking (version field) to prevent race conditions.
- Webhook handlers must be idempotent — duplicate webhook deliveries must not double-apply inventory changes.
- Webhook payloads must be verified via HMAC signature before processing.
- Optimistic UI updates for inventory quantities must have a clear rollback path if the server request fails.

## Performance
- Request only the fields needed in Shopify Admin GraphQL queries; use cursor-based pagination (first/after) for lists.
- Use Bulk Operations API for large data sets (thousands+ records) instead of repeated REST/GraphQL calls.
- Avoid N+1 queries in Prisma by explicitly using include/select; load relations only when needed.
- Fetch independent data in loaders with Promise.all instead of sequential awaits.
- Use defer/streaming for slow aggregate data (reports) so it doesn't block initial render.
- Always use key in list rendering; wrap expensive computations in useMemo.

## TypeScript / Code Quality
- Maintain TypeScript strict mode; no any — if unavoidable, leave a comment explaining why.
- Declare explicit types for GraphQL responses, or use codegen.
- Handle loader/action errors through a shared error handler; surface errors to users via Polaris Banner/Toast consistently.
- Keep components/functions single-responsibility; consider splitting files over ~300 lines.
- Extract magic numbers/strings into named constants (e.g., stock thresholds, status codes).

## UI/UX (Polaris)
- Prefer Polaris components and design tokens over custom CSS.
- Show loading state (Skeleton/Spinner) for all data-fetching regions.
- Every list/table must handle empty state and error state.
- Irreversible actions (delete, submit) must be confirmed via Polaris Modal.
- Keep PDF/print templates (delivery notes, picking lists) consistent in A4 margins and font sizing.

## Security
- Never expose API keys or DB credentials from .env in code or commits.
- Request only the minimum Shopify Admin API scopes the app actually needs.
- Verify session tokens via App Bridge; handle expired sessions explicitly.

## Shopify API
- Manage the Admin API version string in a single location; log version changes.
- Retry 429 (rate limit) responses with exponential backoff.
- Keep GraphQL query nesting/cost reasonable — avoid over-fetching deeply nested fields.

## Git / Migrations
- Commit messages follow [type] summary format (feat/fix/refactor/docs).
- Generate migrations with prisma migrate dev; review before production deploy.